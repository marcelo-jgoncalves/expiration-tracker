/**
 * DocumentRequestService — lado autenticado (tenant) de 04-domain-model-guest-upload.md
 * (D-037): criar/consultar/cancelar uma solicitação de documento a um convidado. Emissão de
 * token nunca expõe o `secret` de volta na leitura (`GET`) — só na criação, uma única vez.
 */
import type { RequestContext } from "../../identity/domain/request-context.js";
import { authorize } from "../../identity/domain/authorization.js";
import { ConflictError, NotFoundError, QuotaExceededError } from "../../../shared/errors/app-error.js";
import { buildVersionedCreate, buildVersionedUpdate } from "../../../shared/dynamodb/occ.js";
import { requirementAssignmentKey, REQUIREMENT_ASSIGNMENT_SK_PREFIX, type RequirementAssignment } from "../domain/requirement-assignment.js";
import { documentRequestKey, type DocumentRequest, type CreateDocumentRequestInput } from "../domain/document-request.js";
import { guestTokenPointerKey, issueGuestToken, epochSecondsFromIso, GUEST_TOKEN_TTL_SECONDS, type GuestTokenPointer } from "../domain/guest-token.js";
import { buildSubjectAuditEvent, appendSubjectAuditToTransaction, type SubjectAuditAction, type SubjectAuditResourceType } from "../domain/audit-event.js";
import {
  documentRequestDeliveryPreferenceKey,
  resolveInitialInviteDeliveryMode,
  type DocumentRequestDeliveryPreference,
  type DocumentRequestDeliveryMode,
} from "../domain/document-request-delivery-preference.js";
import { isTransactionCanceled, type SubjectStore, type TransactWriteEntry } from "../ports/subject-store.js";
import type { SubjectIdGenerator } from "./id-generator.js";
import { DocumentChasingMaterializer } from "./document-chasing-materializer.js";
import { InitialInviteRateLimiter } from "./initial-invite-rate-limiter.js";
import type { ShardConfig } from "../../reminder/domain/shard-config.js";
import type { EmailProviderAdapter } from "../../notification/ports/email-provider.js";
import { sanitizeTenantText } from "../../notification/providers/email-templates.js";

export interface DocumentRequestServiceDeps {
  store: SubjectStore;
  tableName: string;
  ids: SubjectIdGenerator;
  /** Pepper do hash de token — vem de Secrets Manager no composition root real, nunca hardcoded. */
  guestTokenPepper: string;
  /** M10 cluster 4 (D-039/D-046): MESMA config de shard do GSI3 usado por reminders — o índice
   * é fisicamente compartilhado, não faz sentido as duas gerações divergirem em v1. */
  shardConfig: ShardConfig;
  /** M10 cluster 4 (D-049): convite inicial automatizado — kill switch global, default
   * `false` (env/Terraform, não AppConfig - esse mecanismo só existe no design do M7, ainda
   * não implementado). Envio NUNCA acontece se `false`, independente de preferência/override. */
  initialInviteEmailEnabled: boolean;
  /** Ausentes quando o kill switch está `false` - o serviço nunca tenta enviar nesse caso,
   * então não precisa forçar essas deps em todo composition root/teste que não usa a feature. */
  emailProvider?: EmailProviderAdapter;
  guestUploadBaseUrl?: string;
  now?: () => string;
}

export interface CreatedDocumentRequest {
  request: DocumentRequest;
  /** Token completo (`selector.secret`) — retornado UMA ÚNICA VEZ, nunca reconstruível depois (só o hash é persistido). */
  guestToken: string;
  /** M10 cluster 4 (D-049): resultado do convite inicial automatizado, se solicitado -
   * `undefined` quando `deliveryMode` era `MANUAL` (comportamento inalterado, sem tentativa de envio). */
  initialInviteDeliveryStatus?: "SENT" | "FAILED" | "DISABLED_BY_KILL_SWITCH";
}

export class DocumentRequestService {
  private readonly store: SubjectStore;
  private readonly tableName: string;
  private readonly ids: SubjectIdGenerator;
  private readonly pepper: string;
  private readonly shardConfig: ShardConfig;
  private readonly initialInviteEmailEnabled: boolean;
  private readonly emailProvider?: EmailProviderAdapter;
  private readonly guestUploadBaseUrl: string;
  private readonly now: () => string;
  private readonly chasingMaterializer: DocumentChasingMaterializer;
  private readonly initialInviteRateLimiter: InitialInviteRateLimiter;

  constructor(deps: DocumentRequestServiceDeps) {
    this.store = deps.store;
    this.tableName = deps.tableName;
    this.ids = deps.ids;
    this.pepper = deps.guestTokenPepper;
    this.shardConfig = deps.shardConfig;
    this.initialInviteEmailEnabled = deps.initialInviteEmailEnabled;
    this.emailProvider = deps.emailProvider;
    this.guestUploadBaseUrl = deps.guestUploadBaseUrl ?? "https://app.example.invalid/guest/document-requests";
    this.now = deps.now ?? (() => new Date().toISOString());
    this.chasingMaterializer = new DocumentChasingMaterializer(this.store, this.now);
    this.initialInviteRateLimiter = new InitialInviteRateLimiter(this.store, this.now);
  }

  async createDocumentRequest(ctx: RequestContext, subjectId: string, assignmentId: string, input: CreateDocumentRequestInput): Promise<CreatedDocumentRequest> {
    const assignment = await this.readActiveAssignment(ctx.tenant.tenantId, subjectId, assignmentId);
    authorize({ context: ctx, action: "requirement:request-document", resource: { tenantId: assignment.tenantId } });

    // M10 cluster 4 (D-049): resolve o modo de entrega ANTES de criar qualquer coisa - se
    // EMAIL foi solicitado (por override ou preferência de tenant) mas o kill switch global
    // está desligado, o convite simplesmente permanece MANUAL (nunca um erro - o kill switch
    // é uma válvula de segurança, não uma feature que o chamador precisa saber que existe).
    const tenantDeliveryDefault = await this.getDocumentRequestDeliveryPreferenceDefault(assignment.tenantId);
    const deliveryMode = resolveInitialInviteDeliveryMode({ override: input.initialInviteDelivery, tenantDefault: tenantDeliveryDefault });
    const willAttemptEmail = deliveryMode === "EMAIL" && this.initialInviteEmailEnabled;

    if (deliveryMode === "EMAIL" && !this.initialInviteEmailEnabled) {
      await this.writeInitialInviteAudit(ctx, assignmentId, "INITIAL_INVITE_EMAIL_DISABLED_BY_KILL_SWITCH", {});
    }

    // Rate limit verificado ANTES da criação, quando o envio foi de fato solicitado -
    // bloqueia com 429, nunca cria parcialmente (mesma disciplina fail-closed de
    // TenantEntitlement/D-038) - diferente de falha de SES pós-criação, que é best-effort.
    if (willAttemptEmail) {
      try {
        await this.initialInviteRateLimiter.consumeInitialInvite(assignment.tenantId, input.recipientEmail);
      } catch (err) {
        if (err instanceof QuotaExceededError) {
          await this.writeInitialInviteAudit(ctx, assignmentId, "INITIAL_INVITE_EMAIL_RATE_LIMITED", {});
        }
        throw err;
      }
    }

    const documentRequestId = this.ids.newAssignmentId();
    const now = this.now();
    // D-037: "14 dias OU deadline, o que vier primeiro" - achado real de revisão adversarial
    // (Codex): a versão anterior sempre usava now+14d, ignorando um deadline mais próximo.
    const defaultTtlExpiresAt = new Date(Date.parse(now) + GUEST_TOKEN_TTL_SECONDS * 1000).toISOString();
    const tokenExpiresAt = input.deadline && input.deadline < defaultTtlExpiresAt ? input.deadline : defaultTtlExpiresAt;
    const issued = issueGuestToken(this.pepper);

    const request: DocumentRequest = {
      ...documentRequestKey(assignment.tenantId, subjectId, assignmentId, documentRequestId),
      entityType: "DocumentRequest",
      documentRequestId,
      tenantId: assignment.tenantId,
      subjectId,
      assignmentId,
      recipientEmail: input.recipientEmail,
      recipientDisplayName: input.recipientDisplayName,
      requestedByUserId: ctx.principal.userId,
      requestedAt: now,
      deadline: input.deadline,
      status: "REQUESTED",
      tokenSelectorHash: issued.selectorHash,
      tokenVersion: 1,
      tokenExpiresAt,
      submissionCount: 0,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const pointer: GuestTokenPointer = {
      ...guestTokenPointerKey(issued.selectorHash),
      entityType: "GuestTokenPointer",
      selectorHash: issued.selectorHash,
      secretHash: issued.secretHash,
      tenantId: assignment.tenantId,
      subjectId,
      assignmentId,
      documentRequestId,
      tokenVersion: 1,
      expiresAt: tokenExpiresAt,
      purgeAfterTtl: epochSecondsFromIso(tokenExpiresAt),
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    // Request + ponteiro tenantless na mesma transação — nunca um sem o outro (04-domain-model-guest-upload.md).
    const entries: TransactWriteEntry[] = [
      { Put: buildVersionedCreate(this.tableName, request as unknown as Record<string, unknown> & { PK: string; SK: string }) },
      { Put: buildVersionedCreate(this.tableName, pointer as unknown as Record<string, unknown> & { PK: string; SK: string }) },
    ];
    this.appendAudit(entries, ctx, {
      resourceType: "RequirementAssignment",
      resourceId: documentRequestId,
      subjectId,
      action: "ASSIGN_REQUIREMENT",
      previousVersion: undefined,
      newVersion: 1,
      changes: { after: { documentRequestId, recipientDisplayName: input.recipientDisplayName } }, // nunca loga o e-mail bruto no diff de auditoria redigido
    });

    try {
      await this.store.transactWrite(entries);
    } catch (err) {
      if (isTransactionCanceled(err)) throw new ConflictError("Failed to create document request under contention.", { subjectId, assignmentId });
      throw err;
    }

    // M10 cluster 4 (D-039/D-046): materializa os DocumentChasingOccurrence (T7/T3/EXPIRED) fora
    // da transação acima - mesmo espírito de ReminderMaterializer.materialize(), idempotente via
    // putIfAbsent, seguro para retry se falhar aqui (o DocumentRequest já foi criado com sucesso;
    // uma falha de materialização não deve desfazer isso, a reconciliação futura cobriria o gap).
    await this.chasingMaterializer.materialize({
      tenantId: assignment.tenantId,
      subjectId,
      assignmentId,
      documentRequestId,
      documentRequestVersion: request.version,
      tokenExpiresAt,
      shardConfig: this.shardConfig,
    });

    if (deliveryMode === "EMAIL" && !this.initialInviteEmailEnabled) {
      return { request, guestToken: issued.token, initialInviteDeliveryStatus: "DISABLED_BY_KILL_SWITCH" };
    }
    if (!willAttemptEmail) {
      return { request, guestToken: issued.token };
    }

    // Best-effort, fora da transação acima (D-049): falha de SES nunca desfaz a criação do
    // request - o token continua disponível na resposta para fallback manual.
    await this.writeInitialInviteAudit(ctx, documentRequestId, "INITIAL_INVITE_EMAIL_REQUESTED", {});
    const guestLink = `${this.guestUploadBaseUrl}?token=${encodeURIComponent(issued.token)}`;
    try {
      await this.emailProvider!.send({
        to: input.recipientEmail,
        templateId: "document-request-initial-invite",
        templateVersion: 1,
        locale: "pt-BR",
        renderContext: {
          requirementName: sanitizeTenantText(assignment.requirementName, "documento solicitado"),
          deadlineLocal: input.deadline?.slice(0, 10),
          guestLink,
        },
        tags: { attemptId: documentRequestId, intentId: documentRequestId, tenantId: assignment.tenantId, correlationId: ctx.correlationId },
      });
      await this.writeInitialInviteAudit(ctx, documentRequestId, "INITIAL_INVITE_EMAIL_SENT", {});
      return { request, guestToken: issued.token, initialInviteDeliveryStatus: "SENT" };
    } catch (err) {
      await this.writeInitialInviteAudit(ctx, documentRequestId, "INITIAL_INVITE_EMAIL_FAILED", { after: { reason: err instanceof Error ? err.message : "SEND_FAILED" } });
      return { request, guestToken: issued.token, initialInviteDeliveryStatus: "FAILED" };
    }
  }

  /** M10 cluster 4 (D-049): preferência de TENANT (não por subject/assignment) - default
   * `MANUAL` quando nunca configurada. */
  async getDocumentRequestDeliveryPreference(ctx: RequestContext): Promise<DocumentRequestDeliveryMode> {
    authorize({ context: ctx, action: "tenant:configure-document-request-delivery", resource: { tenantId: ctx.tenant.tenantId } });
    return this.getDocumentRequestDeliveryPreferenceDefault(ctx.tenant.tenantId);
  }

  async setDocumentRequestDeliveryPreference(ctx: RequestContext, mode: DocumentRequestDeliveryMode): Promise<void> {
    authorize({ context: ctx, action: "tenant:configure-document-request-delivery", resource: { tenantId: ctx.tenant.tenantId } });

    const now = this.now();
    const key = documentRequestDeliveryPreferenceKey(ctx.tenant.tenantId);
    const existing = await this.store.get<DocumentRequestDeliveryPreference>(key);
    const entries: TransactWriteEntry[] = existing
      ? [
          {
            Update: buildVersionedUpdate({
              tableName: this.tableName,
              key,
              tenantId: ctx.tenant.tenantId,
              expectedVersion: existing.version,
              set: { initialInviteDeliveryDefault: mode, updatedByUserId: ctx.principal.userId },
            }),
          },
        ]
      : [
          {
            Put: buildVersionedCreate(this.tableName, {
              ...key,
              entityType: "DocumentRequestDeliveryPreference",
              tenantId: ctx.tenant.tenantId,
              initialInviteDeliveryDefault: mode,
              updatedByUserId: ctx.principal.userId,
              createdAt: now,
              updatedAt: now,
              version: 1,
            } as unknown as Record<string, unknown> & { PK: string; SK: string }),
          },
        ];
    this.appendAudit(entries, ctx, {
      resourceType: "DocumentRequestDeliveryPreference",
      resourceId: ctx.tenant.tenantId,
      subjectId: ctx.tenant.tenantId, // preferência é de tenant, não de subject - sem subject real a referenciar
      action: "CONFIGURE_DOCUMENT_REQUEST_DELIVERY",
      previousVersion: existing?.version,
      newVersion: (existing?.version ?? 0) + 1,
      changes: { after: { initialInviteDeliveryDefault: mode } },
    });

    try {
      await this.store.transactWrite(entries);
    } catch (err) {
      if (isTransactionCanceled(err)) throw new ConflictError("Failed to update document request delivery preference under contention.", { tenantId: ctx.tenant.tenantId });
      throw err;
    }
  }

  private async getDocumentRequestDeliveryPreferenceDefault(tenantId: string): Promise<DocumentRequestDeliveryMode> {
    const preference = await this.store.get<DocumentRequestDeliveryPreference>(documentRequestDeliveryPreferenceKey(tenantId));
    return preference?.initialInviteDeliveryDefault ?? "MANUAL";
  }

  private async writeInitialInviteAudit(
    ctx: RequestContext,
    resourceId: string,
    action: "INITIAL_INVITE_EMAIL_REQUESTED" | "INITIAL_INVITE_EMAIL_SENT" | "INITIAL_INVITE_EMAIL_FAILED" | "INITIAL_INVITE_EMAIL_RATE_LIMITED" | "INITIAL_INVITE_EMAIL_DISABLED_BY_KILL_SWITCH",
    changes: Record<string, unknown>,
  ): Promise<void> {
    const entries: TransactWriteEntry[] = [];
    this.appendAudit(entries, ctx, {
      resourceType: "DocumentRequest",
      resourceId,
      subjectId: ctx.tenant.tenantId, // trilha por tenant - sem e-mail bruto (D-049), subjectId real não é necessário aqui
      action,
      previousVersion: undefined,
      newVersion: 1,
      changes,
    });
    await this.store.transactWrite(entries);
  }

  async getDocumentRequest(ctx: RequestContext, subjectId: string, documentRequestId: string): Promise<DocumentRequest> {
    const request = await this.readActiveRequest(ctx.tenant.tenantId, subjectId, documentRequestId);
    authorize({ context: ctx, action: "requirement:read", resource: { tenantId: request.tenantId } });
    return request;
  }

  async listDocumentRequests(ctx: RequestContext, subjectId: string, assignmentId: string): Promise<DocumentRequest[]> {
    const assignment = await this.readActiveAssignment(ctx.tenant.tenantId, subjectId, assignmentId);
    authorize({ context: ctx, action: "requirement:read", resource: { tenantId: assignment.tenantId } });
    const rows = await this.store.queryByPk<DocumentRequest>(
      requirementAssignmentKey(assignment.tenantId, subjectId, assignmentId).PK,
      `REQASSIGN#${assignmentId}#DOCREQ#`,
    );
    return rows;
  }

  async revokeDocumentRequest(ctx: RequestContext, subjectId: string, documentRequestId: string, expectedVersion: number): Promise<void> {
    const request = await this.readActiveRequest(ctx.tenant.tenantId, subjectId, documentRequestId);
    authorize({ context: ctx, action: "requirement:update", resource: { tenantId: request.tenantId } });

    const now = this.now();
    const entries: TransactWriteEntry[] = [
      {
        Update: buildVersionedUpdate({
          tableName: this.tableName,
          key: documentRequestKey(request.tenantId, subjectId, request.assignmentId, documentRequestId),
          tenantId: request.tenantId,
          expectedVersion,
          set: { status: "REVOKED", revokedAt: now },
        }),
      },
      {
        Update: buildVersionedUpdate({
          tableName: this.tableName,
          key: guestTokenPointerKey(request.tokenSelectorHash),
          tenantId: request.tenantId,
          expectedVersion: await this.pointerVersion(request.tokenSelectorHash),
          set: { revokedAt: now },
        }),
      },
    ];
    try {
      await this.store.transactWrite(entries);
    } catch (err) {
      if (isTransactionCanceled(err)) throw new ConflictError("VERSION_CONFLICT", { cause: "transaction condition failed" });
      throw err;
    }
  }

  private async pointerVersion(selectorHash: string): Promise<number> {
    const pointer = await this.store.get<GuestTokenPointer>(guestTokenPointerKey(selectorHash));
    if (!pointer) throw new ConflictError("Guest token pointer vanished before revocation.", { selectorHash });
    return pointer.version;
  }

  private appendAudit(
    entries: TransactWriteEntry[],
    ctx: RequestContext,
    input: { resourceType: SubjectAuditResourceType; resourceId: string; subjectId: string; action: SubjectAuditAction; previousVersion: number | undefined; newVersion: number; changes: Record<string, unknown> },
  ): void {
    const event = buildSubjectAuditEvent({
      auditEventId: this.ids.newAuditEventId(),
      tenantId: ctx.tenant.tenantId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      subjectId: input.subjectId,
      action: input.action,
      actor: { type: "USER", userId: ctx.principal.userId },
      previousVersion: input.previousVersion,
      newVersion: input.newVersion,
      changes: input.changes,
      occurredAt: this.now(),
      correlationId: ctx.correlationId,
    });
    appendSubjectAuditToTransaction(entries, this.tableName, event);
  }

  private async readActiveAssignment(tenantId: string, subjectId: string, assignmentId: string): Promise<RequirementAssignment> {
    const assignment = await this.store.get<RequirementAssignment>(requirementAssignmentKey(tenantId, subjectId, assignmentId));
    if (!assignment || assignment.deletedAt) throw new NotFoundError("RequirementAssignment not found.", { subjectId, assignmentId });
    return assignment;
  }

  private async readActiveRequest(tenantId: string, subjectId: string, documentRequestId: string): Promise<DocumentRequest> {
    // documentRequestId sozinho não endereça a partição (precisa de assignmentId) - varre a
    // coleção de requirements do subject e localiza pelo SK. Aceitável no v1 (poucos
    // documentRequests por subject); revisar se o volume crescer.
    const rows = await this.store.queryByPk<DocumentRequest>(`TENANT#${tenantId}#SUBJECT#${subjectId}`, REQUIREMENT_ASSIGNMENT_SK_PREFIX);
    const found = rows.find((r) => r.entityType === "DocumentRequest" && r.documentRequestId === documentRequestId);
    if (!found) throw new NotFoundError("DocumentRequest not found.", { subjectId, documentRequestId });
    return found;
  }
}

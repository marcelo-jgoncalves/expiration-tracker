/**
 * DocumentRequestService — lado autenticado (tenant) de 04-domain-model-guest-upload.md
 * (D-037): criar/consultar/cancelar uma solicitação de documento a um convidado. Emissão de
 * token nunca expõe o `secret` de volta na leitura (`GET`) — só na criação, uma única vez.
 */
import type { RequestContext } from "../../identity/domain/request-context.js";
import { authorize } from "../../identity/domain/authorization.js";
import { ConflictError, NotFoundError } from "../../../shared/errors/app-error.js";
import { buildVersionedCreate, buildVersionedUpdate } from "../../../shared/dynamodb/occ.js";
import { requirementAssignmentKey, REQUIREMENT_ASSIGNMENT_SK_PREFIX, type RequirementAssignment } from "../domain/requirement-assignment.js";
import { documentRequestKey, type DocumentRequest, type CreateDocumentRequestInput } from "../domain/document-request.js";
import { guestTokenPointerKey, issueGuestToken, epochSecondsFromIso, GUEST_TOKEN_TTL_SECONDS, type GuestTokenPointer } from "../domain/guest-token.js";
import { buildSubjectAuditEvent, appendSubjectAuditToTransaction } from "../domain/audit-event.js";
import { isTransactionCanceled, type SubjectStore, type TransactWriteEntry } from "../ports/subject-store.js";
import type { SubjectIdGenerator } from "./id-generator.js";
import { DocumentChasingMaterializer } from "./document-chasing-materializer.js";
import type { ShardConfig } from "../../reminder/domain/shard-config.js";

export interface DocumentRequestServiceDeps {
  store: SubjectStore;
  tableName: string;
  ids: SubjectIdGenerator;
  /** Pepper do hash de token — vem de Secrets Manager no composition root real, nunca hardcoded. */
  guestTokenPepper: string;
  /** M10 cluster 4 (D-039/D-046): MESMA config de shard do GSI3 usado por reminders — o índice
   * é fisicamente compartilhado, não faz sentido as duas gerações divergirem em v1. */
  shardConfig: ShardConfig;
  now?: () => string;
}

export interface CreatedDocumentRequest {
  request: DocumentRequest;
  /** Token completo (`selector.secret`) — retornado UMA ÚNICA VEZ, nunca reconstruível depois (só o hash é persistido). */
  guestToken: string;
}

export class DocumentRequestService {
  private readonly store: SubjectStore;
  private readonly tableName: string;
  private readonly ids: SubjectIdGenerator;
  private readonly pepper: string;
  private readonly shardConfig: ShardConfig;
  private readonly now: () => string;
  private readonly chasingMaterializer: DocumentChasingMaterializer;

  constructor(deps: DocumentRequestServiceDeps) {
    this.store = deps.store;
    this.tableName = deps.tableName;
    this.ids = deps.ids;
    this.pepper = deps.guestTokenPepper;
    this.shardConfig = deps.shardConfig;
    this.now = deps.now ?? (() => new Date().toISOString());
    this.chasingMaterializer = new DocumentChasingMaterializer(this.store, this.now);
  }

  async createDocumentRequest(ctx: RequestContext, subjectId: string, assignmentId: string, input: CreateDocumentRequestInput): Promise<CreatedDocumentRequest> {
    const assignment = await this.readActiveAssignment(ctx.tenant.tenantId, subjectId, assignmentId);
    authorize({ context: ctx, action: "requirement:request-document", resource: { tenantId: assignment.tenantId } });

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

    return { request, guestToken: issued.token };
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
    input: { resourceType: "RequirementAssignment"; resourceId: string; subjectId: string; action: "ASSIGN_REQUIREMENT"; previousVersion: number | undefined; newVersion: number; changes: Record<string, unknown> },
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

/**
 * GuestSubmissionService — lado do convidado (sem conta) de 04-domain-model-guest-upload.md
 * (D-037). NUNCA passa por `RequestContext`/`authorize()` — o convidado é validado só pelo
 * token. Toda falha de validação retorna o MESMO erro genérico (`GuestTokenInvalidError`),
 * SEM detalhe algum no corpo da resposta (anti-enumeration — `AppError.toJSON()` inclui
 * `details` na resposta HTTP, então este módulo nunca populates `details` com o motivo real).
 */
import { randomUUID } from "node:crypto";
import { AppError, ValidationError, TenantNotActiveError } from "../../../shared/errors/app-error.js";
import { buildVersionedCreate, buildVersionedUpdate } from "../../../shared/dynamodb/occ.js";
import { executeTenantBusinessMutation } from "../../../shared/tenant-lifecycle/tenant-business-mutation.js";
import { parseGuestToken, secretMatches, guestTokenPointerKey, hmacGuestTokenCrypto, type GuestTokenPointer } from "../domain/guest-token.js";
import { documentRequestKey, type DocumentRequest } from "../domain/document-request.js";
import { requirementAssignmentKey, type RequirementAssignment } from "../domain/requirement-assignment.js";
import { documentSubmissionKey, type DocumentSubmission } from "../domain/document-submission.js";
import { isTransactionCanceled, type SubjectStore, type TransactWriteEntry } from "../ports/subject-store.js";
import type { SubjectIdGenerator } from "./id-generator.js";
import type { GuestRateLimiter } from "./guest-rate-limiter.js";
import { MAX_UPLOAD_BYTES } from "../../document/application/upload-validation.js";
import type { UploadUrlSigner } from "../../document/ports/upload-url-signer.js";
import { sanitizeTenantText } from "../../notification/providers/email-templates.js";

const ALLOWED_MEDIA_TYPES: ReadonlySet<string> = new Set(["application/pdf", "image/jpeg", "image/png"]);
const PRESIGN_TTL_SECONDS = 600;

/** Erro único e genérico para toda falha de validação de guest token — NUNCA carrega `details`
 * (categoria AUTH -> 401, mesmo em caminhos completamente distintos: token malformado,
 * inexistente, secret errado, expirado, revogado). */
export class GuestTokenInvalidError extends AppError {
  constructor() {
    super({ code: "GUEST_TOKEN_INVALID", category: "AUTH", message: "Invalid or expired link.", retryable: false });
    this.name = "GuestTokenInvalidError";
  }
}

export interface GuestRequestInfo {
  requirementName: string;
  deadline?: string;
  allowedMediaTypes: string[];
  maxUploadBytes: number;
  /** W5-01/GTR-01 (`decisions-log.md` D-060): identity of whoever created the request, shown
   * to the guest so an unauthenticated document upload no longer arrives from an anonymous
   * source. Always present (never `undefined`) - falls back to a generic, honest placeholder
   * when the tenant never captured `UserProfile.requesterDisplayName` (never inferred, e.g.
   * from an e-mail domain). */
  requesterDisplayName: string;
}

const REQUESTER_NAME_FALLBACK = "Solicitante não identificado";

export interface StartGuestSubmissionInput {
  fileName: string;
  mediaType: string;
  contentLength: number;
  checksumSha256: string;
}

export interface StartGuestSubmissionResult {
  submissionId: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresAt: string;
}

export interface GuestSubmissionServiceDeps {
  store: SubjectStore;
  tableName: string;
  quarantineBucket: string;
  ids: SubjectIdGenerator;
  signer: UploadUrlSigner;
  rateLimiter: GuestRateLimiter;
  guestTokenPepper: string;
  /** W5-01/GTR-01 (D-060): resolves `UserProfile.requesterDisplayName` for the request's
   * creator (`DocumentRequest.requestedByUserId`) - same injected-resolver pattern as
   * `resolveInternalUserEmail` in `document-chasing-dispatch`'s dispatch.ts, deliberately NOT a
   * direct identity-module import (composition-root wiring, not a cross-module dependency). */
  resolveRequesterDisplayName?: (input: { tenantId: string; userId: string }) => Promise<string | undefined>;
  now?: () => string;
}

interface ResolvedToken {
  pointer: GuestTokenPointer;
  request: DocumentRequest;
}

export class GuestSubmissionService {
  private readonly store: SubjectStore;
  private readonly tableName: string;
  private readonly quarantineBucket: string;
  private readonly ids: SubjectIdGenerator;
  private readonly signer: UploadUrlSigner;
  private readonly rateLimiter: GuestRateLimiter;
  private readonly pepper: string;
  private readonly resolveRequesterDisplayName?: (input: { tenantId: string; userId: string }) => Promise<string | undefined>;
  private readonly now: () => string;

  constructor(deps: GuestSubmissionServiceDeps) {
    this.store = deps.store;
    this.tableName = deps.tableName;
    this.quarantineBucket = deps.quarantineBucket;
    this.ids = deps.ids;
    this.signer = deps.signer;
    this.rateLimiter = deps.rateLimiter;
    this.pepper = deps.guestTokenPepper;
    this.resolveRequesterDisplayName = deps.resolveRequesterDisplayName;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async getRequestInfo(rawToken: string): Promise<GuestRequestInfo> {
    const resolved = await this.resolveToken(rawToken);
    const assignment = await this.store.get<RequirementAssignment>(
      requirementAssignmentKey(resolved.request.tenantId, resolved.request.subjectId, resolved.request.assignmentId),
    );
    if (!assignment || assignment.deletedAt) throw new GuestTokenInvalidError();

    if (resolved.request.status === "REQUESTED") {
      await this.markOpened(resolved.request);
    }

    const resolvedRequesterName = await this.resolveRequesterDisplayName?.({
      tenantId: resolved.request.tenantId,
      userId: resolved.request.requestedByUserId,
    });

    return {
      requirementName: assignment.requirementName,
      deadline: resolved.request.deadline,
      allowedMediaTypes: [...ALLOWED_MEDIA_TYPES],
      maxUploadBytes: MAX_UPLOAD_BYTES,
      requesterDisplayName: sanitizeTenantText(resolvedRequesterName, REQUESTER_NAME_FALLBACK),
    };
  }

  async startSubmission(rawToken: string, input: StartGuestSubmissionInput): Promise<StartGuestSubmissionResult> {
    const resolved = await this.resolveToken(rawToken);

    if (!ALLOWED_MEDIA_TYPES.has(input.mediaType)) {
      throw new ValidationError("Unsupported media type.", { mediaType: input.mediaType });
    }
    if (input.contentLength <= 0 || input.contentLength > MAX_UPLOAD_BYTES) {
      throw new ValidationError("contentLength must be between 1 and 10MiB.");
    }
    if (!/^[a-f0-9]{64}$/i.test(input.checksumSha256)) {
      throw new ValidationError("checksumSha256 must be a 64-character hex SHA-256 digest.");
    }

    const { tenantId, subjectId, assignmentId, documentRequestId } = resolved.pointer;
    const submissionId = this.ids.newSubmissionId();
    const now = this.now();
    const expiresAt = new Date(Date.parse(now) + PRESIGN_TTL_SECONDS * 1000).toISOString();
    // Formato canônico de submission-anchored quarantine key (submission-quarantine-key.ts) -
    // nunca colide com o formato item-anchored existente de M6.
    const quarantineKey = `tenant/${tenantId}/subject/${subjectId}/assignment/${assignmentId}/submission/${submissionId}/document/${submissionId}/slot/${submissionId}/${randomUUID()}`;

    const submission: DocumentSubmission = {
      ...documentSubmissionKey(tenantId, subjectId, assignmentId, submissionId),
      entityType: "DocumentSubmission",
      submissionId,
      tenantId,
      subjectId,
      assignmentId,
      documentRequestId,
      fileName: input.fileName,
      mediaType: input.mediaType,
      contentLength: input.contentLength,
      checksumSha256: input.checksumSha256,
      status: "PENDING_UPLOAD",
      quarantineObject: { bucket: this.quarantineBucket, key: quarantineKey, versionId: "" },
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    const entries: TransactWriteEntry[] = [
      { Put: buildVersionedCreate(this.tableName, submission as unknown as Record<string, unknown> & { PK: string; SK: string }) },
      {
        Update: buildVersionedUpdate({
          tableName: this.tableName,
          key: documentRequestKey(tenantId, subjectId, assignmentId, documentRequestId),
          tenantId,
          expectedVersion: resolved.request.version,
          set: {
            status: "SUBMITTED",
            lastSubmissionId: submissionId,
            submissionCount: resolved.request.submissionCount + 1,
          },
        }),
      },
    ];

    try {
      // W3-07 (D-070 chunk 7/N): fenced via TenantBusinessMutation - GuestSubmissionService is a
      // public surface that never passes through RequestContext/Cognito, so the lifecycle fence
      // must be enforced here directly instead of relying on the authenticated-flow machinery
      // (`bootstrap-identity.ts`'s resolver). The guest-token validation above is completely
      // unchanged; this only adds the lifecycle ConditionCheck to the SAME TransactWriteItems.
      await executeTenantBusinessMutation({ store: this.store, tableName: this.tableName, tenantId, entries });
    } catch (err) {
      // Corrida real (ex. dois envios quase simultâneos do mesmo link) OU tenant em
      // DELETING/não-ACTIVE - convidado só vê o erro genérico, nunca detalhe de qual condição
      // falhou (anti-enumeration: revelar "tenant is being deleted" a um chamador não
      // autenticado seria um oracle novo, então TenantNotActiveError também vira o mesmo
      // GuestTokenInvalidError genérico, não um erro distinto).
      if (isTransactionCanceled(err) || err instanceof TenantNotActiveError) throw new GuestTokenInvalidError();
      throw err;
    }

    const presigned = await this.signer.presignUpload({
      bucket: this.quarantineBucket,
      key: quarantineKey,
      mediaType: input.mediaType,
      contentLength: input.contentLength,
      checksumSha256: input.checksumSha256,
      metadata: { submissionId, tenantId },
      expiresInSeconds: PRESIGN_TTL_SECONDS,
    });

    return { submissionId, uploadUrl: presigned.uploadUrl, requiredHeaders: presigned.requiredHeaders, expiresAt };
  }

  /** Valida o token de ponta a ponta: parse estrutural -> lookup por selectorHash -> comparação
   * `timingSafeEqual` do secret -> expiração/revogação -> rate limit por token. Qualquer falha
   * em qualquer etapa produz o MESMO erro genérico. */
  private async resolveToken(rawToken: string): Promise<ResolvedToken> {
    const parsed = parseGuestToken(rawToken);
    if (!parsed) throw new GuestTokenInvalidError();

    const selectorHash = hmacGuestTokenCrypto.hash(this.pepper, parsed.selector);

    // Rate limit consumido ANTES do lookup do ponteiro, por selectorHash (calculável mesmo
    // que o ponteiro não exista) — achado real de revisão adversarial (Codex): consumir só
    // depois de confirmar que o ponteiro existe criava um oracle de enumeração (selector
    // real esgota o limite e vira 429 QuotaExceededError; selector inexistente nunca chega
    // lá e sempre dá 401). Qualquer estouro de rate limit também vira o MESMO erro genérico
    // abaixo, nunca 429 diferenciado nesta superfície pública.
    try {
      await this.rateLimiter.consume({ selectorHash, limit: 30, windowSeconds: 60 });
    } catch {
      throw new GuestTokenInvalidError();
    }

    const pointer = await this.store.get<GuestTokenPointer>(guestTokenPointerKey(selectorHash));

    // Caminho dummy anti-timing (achado real de revisão adversarial): mesmo quando o ponteiro
    // não existe, ainda computamos um hash e uma comparação timingSafeEqual equivalente, para
    // que o tempo de resposta não dependa de o selector existir ou não. O hash dummy nunca
    // pode colidir com um secretHash real (prefixo fixo que issueGuestToken() nunca produz).
    const targetSecretHash = pointer?.secretHash ?? hmacGuestTokenCrypto.hash(this.pepper, `dummy:${selectorHash}`);
    const secretOk = secretMatches(this.pepper, parsed.secret, targetSecretHash);
    if (!pointer || !secretOk) throw new GuestTokenInvalidError();

    if (pointer.revokedAt) throw new GuestTokenInvalidError();
    if (pointer.expiresAt < this.now()) throw new GuestTokenInvalidError();

    const request = await this.store.get<DocumentRequest>(documentRequestKey(pointer.tenantId, pointer.subjectId, pointer.assignmentId, pointer.documentRequestId));
    if (!request || request.status === "CANCELLED" || request.status === "REVOKED" || request.status === "EXPIRED") {
      throw new GuestTokenInvalidError();
    }
    // D-037: TTL é "14 dias OU deadline, o que vier primeiro" — expiresAt do ponteiro já
    // reflete isso na criação (document-request-service.ts), mas revalida aqui também caso
    // um deadline seja editado no futuro sem reemitir o token.
    if (request.deadline && request.deadline < this.now()) throw new GuestTokenInvalidError();

    return { pointer, request };
  }

  private async markOpened(request: DocumentRequest): Promise<void> {
    try {
      await this.store.transactWrite([
        {
          Update: buildVersionedUpdate({
            tableName: this.tableName,
            key: documentRequestKey(request.tenantId, request.subjectId, request.assignmentId, request.documentRequestId),
            tenantId: request.tenantId,
            expectedVersion: request.version,
            set: { status: "OPENED", lastOpenedAt: this.now() },
          }),
        },
      ]);
    } catch (err) {
      // Best-effort - corrida de leitura concorrente (2 aberturas quase simultâneas do mesmo
      // link) nunca deve impedir o convidado de ver as informações do pedido.
      if (!isTransactionCanceled(err)) throw err;
    }
  }
}

/**
 * ExternalShareLinkService — D-225 (`docs/architecture/reviews/external-sharing-scoping/
 * estado-final-consolidado.md`). Two entry-point families, split by trust boundary exactly like
 * `GuestDocumentAccessService`:
 *
 *  - `createShareLink`/`revokeShareLink`/`listShareLinks` — authenticated, tenant-facing
 *    (`RBAC docarchive:share-link-*`, ADMIN_ROLES, wired at the HTTP layer via `authorize()`).
 *    This service itself never calls `authorize()` — callers pass an already-`AuthorizedTenantId`.
 *  - `resolveForAnonymousAccess` — the visitor's route. NEVER touches `RequestContext`/
 *    `authorize()`; validated only by the bearer token, same anti-enumeration discipline as
 *    `GuestDocumentAccessService.resolveCredential` (Decision 1/5: parse -> rate limit BEFORE
 *    lookup -> pointer lookup -> dummy-safe secret compare -> status/expiry -> live revalidation).
 *
 * Decision 6 (frozen copy): `resolveForAnonymousAccess` revalidates ONLY `DocumentFile.
 * scanStatus="CLEAN"` + `cleanObject` presence + tenant ACTIVE + link ACTIVE/unexpired — it
 * deliberately NEVER re-reads `DocumentVersion.state`/`Document.status` after creation.
 */
import { AppError, ConflictError, NotFoundError } from "../../../shared/errors/app-error.js";
import { authorizedTenantIdFromPersistedEntity, type AuthorizedTenantId } from "../../identity/domain/authorization.js";
import {
  buildExistenceConditionCheck,
  buildVersionedCreate,
  buildVersionedUpdate,
  isTransactionCanceled,
  type EntityKey,
  type TransactWriteEntry,
} from "../../../shared/dynamodb/occ.js";
import { executeTenantBusinessMutation } from "../../../shared/tenant-lifecycle/tenant-business-mutation.js";
import { tenantLifecycleKey, TENANT_ACTIVE_STATUS, type TenantLifecycleRecord } from "../../../shared/tenant-lifecycle/tenant-lifecycle-record.js";
import {
  addDaysIso,
  epochSecondsFromIso,
  externalShareLinkGsi1Keys,
  externalShareLinkKey,
  externalShareLinkPointerKey,
  externalShareLinkSecretMatches,
  hmacExternalShareLinkCrypto,
  issueExternalShareLinkToken,
  parseExternalShareLinkToken,
  DEFAULT_SHARE_LINK_TTL_DAYS,
  MAX_ACTIVE_SHARE_LINKS_PER_DOCUMENT,
  MAX_SHARE_LINK_TTL_DAYS,
  SHARE_LINK_AUDIT_MARGIN_DAYS,
  SHARE_LINK_PRESIGN_TTL_SECONDS,
  type ExternalShareLink,
  type ExternalShareLinkPointer,
} from "../domain/external-share-link.js";
import { documentKey, type Document } from "../domain/document.js";
import { documentVersionKey, type DocumentVersion } from "../domain/document-version.js";
import { documentFileKey, type DocumentFile } from "../domain/document-file.js";
import { documentTypeKey, type DocumentType } from "../domain/document-type.js";
import type { DocumentArchiveStore } from "../ports/document-archive-store.js";
import type { DocumentArchiveIdGenerator } from "./id-generator.js";
import type { DocumentArchiveGuestRateLimiter } from "./document-archive-guest-rate-limiter.js";
import type { ExternalShareLinkFileStore } from "../ports/external-share-link-file-store.js";
import {
  auditExternalShareLinkCreated,
  auditExternalShareLinkPresignIssued,
  auditExternalShareLinkRevoked,
  auditExternalShareLinkTenantInactiveBlocked,
} from "../../../shared/observability/security-audit.js";

/** Single generic error for every anonymous-access failure mode (Decision 1/5), same posture as
 * `GuestAccessInvalidError`. */
export class ExternalShareLinkInvalidError extends AppError {
  constructor() {
    super({ code: "EXTERNAL_SHARE_LINK_INVALID", category: "AUTH", message: "Invalid, expired, or revoked share link.", retryable: false });
    this.name = "ExternalShareLinkInvalidError";
  }
}

export class ExternalShareLinkCapExceededError extends ConflictError {
  constructor() {
    super("This Document already has the maximum number of active share links.");
    this.name = "ExternalShareLinkCapExceededError";
  }
}

const RATE_LIMIT_PER_MINUTE = 30;
const RATE_LIMIT_WINDOW_SECONDS = 60;

export interface ExternalShareLinkServiceDeps {
  store: DocumentArchiveStore;
  tableName: string;
  ids: DocumentArchiveIdGenerator;
  rateLimiter: DocumentArchiveGuestRateLimiter;
  fileStore: ExternalShareLinkFileStore;
  /** Own pepper, never shared with `RequestAccessCredential`/`GuestSession`'s pepper (design
   * Decision 2). */
  pepper: string;
  now?: () => string;
}

export interface CreateShareLinkInput {
  tenantId: AuthorizedTenantId;
  documentId: string;
  createdByUserId: string;
  /** Days until expiry — clamped by the caller-facing HTTP schema to [1, 30]; this service still
   * re-asserts the cap defensively (never trusts a caller who bypasses the schema). */
  ttlDays?: number;
}

export interface CreatedShareLink {
  link: ExternalShareLink;
  /** Full `selector.secret` token — returned ONLY here, never persisted raw, never retrievable
   * again (same one-shot-reveal discipline as every other credential this codebase issues). */
  token: string;
}

export interface ResolvedExternalShareLinkAccess {
  documentTypeNameSnapshot: string;
  documentIssuedDate: string | null;
  fileName: string;
  downloadUrl: string;
}

export class ExternalShareLinkService {
  private readonly store: DocumentArchiveStore;
  private readonly tableName: string;
  private readonly ids: DocumentArchiveIdGenerator;
  private readonly rateLimiter: DocumentArchiveGuestRateLimiter;
  private readonly fileStore: ExternalShareLinkFileStore;
  private readonly pepper: string;
  private readonly now: () => string;

  constructor(deps: ExternalShareLinkServiceDeps) {
    this.store = deps.store;
    this.tableName = deps.tableName;
    this.ids = deps.ids;
    this.rateLimiter = deps.rateLimiter;
    this.fileStore = deps.fileStore;
    this.pepper = deps.pepper;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  /**
   * Decision 8/9 — one `TransactWriteItems`: ConditionChecks on Document/DocumentFile/
   * DocumentVersion referential integrity, an atomic cap+reconciliation Update on `Document.
   * activeExternalShareLinkCount`, and the link/pointer Puts. If the cap is hit, queries GSI1
   * (Decision 9, at most `MAX_ACTIVE_SHARE_LINKS_PER_DOCUMENT` items) for naturally-expired
   * active links and reconciles them (REVOKED, `EXPIRED_RECONCILED`) IN THE SAME transaction as
   * the new link's creation — never a separate prior transaction (Codex Rodada 4 achado).
   */
  async createShareLink(input: CreateShareLinkInput): Promise<CreatedShareLink> {
    const now = this.now();
    const document = await this.store.get<Document>(documentKey(input.tenantId, input.documentId));
    if (!document || document.tenantId !== input.tenantId) throw new NotFoundError("Document not found.");

    const version = document.currentVersionId
      ? await this.findVersionById(input.tenantId, input.documentId, document.currentVersionId)
      : undefined;
    if (!version || version.state !== "ACCEPTED") {
      throw new ConflictError("Document has no ACCEPTED version to share.");
    }
    if (!version.principalFileId) throw new ConflictError("Accepted version has no principal file.");

    const file = await this.store.get<DocumentFile>(documentFileKey(input.tenantId, input.documentId, version.seq, version.principalFileId));
    if (!file || file.scanStatus !== "CLEAN") throw new ConflictError("Principal file is not CLEAN.");

    const documentType = await this.store.get<DocumentType>(documentTypeKey(input.tenantId, document.documentTypeId));

    const currentCount = document.activeExternalShareLinkCount ?? 0;
    let reconciled: ExternalShareLink[] = [];
    if (currentCount >= MAX_ACTIVE_SHARE_LINKS_PER_DOCUMENT) {
      const page = await this.store.queryIndexPage<ExternalShareLink>({
        indexName: "GSI1",
        partitionKeyValue: `TENANT#${input.tenantId}#DOCSHARE#${input.documentId}#STATUS#ACTIVE`,
        limit: MAX_ACTIVE_SHARE_LINKS_PER_DOCUMENT,
      });
      reconciled = page.items.filter((l) => l.expiresAt < now);
      if (reconciled.length === 0) throw new ExternalShareLinkCapExceededError();
    }
    const newCount = currentCount - reconciled.length + 1;
    if (newCount > MAX_ACTIVE_SHARE_LINKS_PER_DOCUMENT) throw new ExternalShareLinkCapExceededError();

    const ttlDays = Math.min(input.ttlDays ?? DEFAULT_SHARE_LINK_TTL_DAYS, MAX_SHARE_LINK_TTL_DAYS);
    const expiresAt = addDaysIso(now, ttlDays);
    const purgeAfterTtl = epochSecondsFromIso(addDaysIso(expiresAt, SHARE_LINK_AUDIT_MARGIN_DAYS));

    const issued = issueExternalShareLinkToken(this.pepper);
    const shareId = this.ids.newShareId();

    const link: ExternalShareLink = {
      ...externalShareLinkKey(input.tenantId, input.documentId, shareId),
      entityType: "ExternalShareLink",
      tenantId: input.tenantId,
      documentId: input.documentId,
      documentTypeNameSnapshot: documentType?.displayName ?? document.documentTypeId,
      documentVersionId: version.versionId,
      documentFileId: file.fileId,
      documentFileSeq: version.seq,
      ...(version.issuedAt !== undefined ? { documentIssuedDateSnapshot: version.issuedAt } : {}),
      selectorHash: issued.selectorHash,
      secretHash: issued.secretHash,
      status: "ACTIVE",
      createdByUserId: input.createdByUserId,
      expiresAt,
      purgeAfterTtl,
      createdAt: now,
      updatedAt: now,
      version: 1,
      ...externalShareLinkGsi1Keys(input.tenantId, input.documentId, "ACTIVE", now, shareId),
    };

    const pointer: ExternalShareLinkPointer = {
      ...externalShareLinkPointerKey(issued.selectorHash),
      entityType: "ExternalShareLinkPointer",
      tenantId: input.tenantId,
      documentId: input.documentId,
      shareId,
      selectorHash: issued.selectorHash,
      secretHash: issued.secretHash,
      purgeAfterTtl,
    };

    const entries: TransactWriteEntry[] = [
      buildExistenceConditionCheck({ tableName: this.tableName, key: documentKey(input.tenantId, input.documentId), extra: { tenantId: input.tenantId } }),
      buildExistenceConditionCheck({
        tableName: this.tableName,
        key: documentFileKey(input.tenantId, input.documentId, version.seq, version.principalFileId),
        extra: { scanStatus: "CLEAN", documentId: input.documentId, versionId: version.versionId },
      }),
      buildExistenceConditionCheck({
        tableName: this.tableName,
        key: documentVersionKey(input.tenantId, input.documentId, version.seq),
        extra: { state: "ACCEPTED", documentId: input.documentId },
      }),
      {
        Update: buildVersionedUpdate({
          tableName: this.tableName,
          key: documentKey(input.tenantId, input.documentId),
          tenantId: input.tenantId,
          expectedVersion: document.version,
          set: { activeExternalShareLinkCount: newCount },
          now,
        }),
      },
      ...reconciled.map((expired) => ({
        Update: buildVersionedUpdate({
          tableName: this.tableName,
          key: externalShareLinkKey(input.tenantId, input.documentId, this.shareIdFromSk(expired.SK)),
          tenantId: input.tenantId,
          expectedVersion: expired.version,
          set: { status: "REVOKED", revokedAt: now, ...externalShareLinkGsi1Keys(input.tenantId, input.documentId, "REVOKED", now, this.shareIdFromSk(expired.SK)) },
          now,
        }),
      })),
      { Put: buildVersionedCreate(this.tableName, link as unknown as Record<string, unknown> & EntityKey) },
      { Put: buildVersionedCreate(this.tableName, pointer as unknown as Record<string, unknown> & EntityKey) },
    ];

    try {
      await executeTenantBusinessMutation({ store: this.store, tableName: this.tableName, tenantId: input.tenantId, entries });
    } catch (err) {
      if (isTransactionCanceled(err)) throw new ExternalShareLinkCapExceededError();
      throw err;
    }

    for (const expired of reconciled) {
      auditExternalShareLinkRevoked({ tenantId: input.tenantId, documentId: input.documentId, shareId: this.shareIdFromSk(expired.SK), reason: "EXPIRED_RECONCILED" });
    }
    auditExternalShareLinkCreated({ tenantId: input.tenantId, documentId: input.documentId, shareId, createdByUserId: input.createdByUserId, expiresAt });

    return { link, token: `${shareId}.${issued.token}` };
  }

  /**
   * Decision 7 — `ACTIVE -> REVOKED` via OCC, tenant-fenced. Bloqueia toda NOVA emissão de
   * presign imediatamente (Decision 4); um presign já emitido continua válido pela janela
   * residual (<=5min), propriedade estrutural da AWS documentada, não uma falha deste design.
   */
  async revokeShareLink(input: { tenantId: AuthorizedTenantId; documentId: string; shareId: string; expectedVersion: number; revokedByUserId: string }): Promise<void> {
    const document = await this.store.get<Document>(documentKey(input.tenantId, input.documentId));
    if (!document || document.tenantId !== input.tenantId) throw new NotFoundError("Document not found.");
    const now = this.now();
    const newCount = Math.max((document.activeExternalShareLinkCount ?? 0) - 1, 0);

    const entries: TransactWriteEntry[] = [
      {
        Update: buildVersionedUpdate({
          tableName: this.tableName,
          key: externalShareLinkKey(input.tenantId, input.documentId, input.shareId),
          tenantId: input.tenantId,
          expectedVersion: input.expectedVersion,
          set: { status: "REVOKED", revokedAt: now, revokedByUserId: input.revokedByUserId, ...externalShareLinkGsi1Keys(input.tenantId, input.documentId, "REVOKED", now, input.shareId) },
          extraConditions: [{ expression: "#status = :active", names: { "#status": "status" }, values: { ":active": "ACTIVE" } }],
          now,
        }),
      },
      {
        Update: buildVersionedUpdate({
          tableName: this.tableName,
          key: documentKey(input.tenantId, input.documentId),
          tenantId: input.tenantId,
          expectedVersion: document.version,
          set: { activeExternalShareLinkCount: newCount },
          now,
        }),
      },
    ];

    try {
      await this.store.transactWrite(entries);
    } catch (err) {
      if (isTransactionCanceled(err)) throw new ConflictError("Share link is not ACTIVE or was modified concurrently.");
      throw err;
    }
    auditExternalShareLinkRevoked({ tenantId: input.tenantId, documentId: input.documentId, shareId: input.shareId, revokedByUserId: input.revokedByUserId, reason: "MANUAL" });
  }

  /** Decision 12 — paginated GSI1 listing, ADMIN-tier only (RBAC enforced at the HTTP layer). */
  async listShareLinks(input: { tenantId: AuthorizedTenantId; documentId: string; status: "ACTIVE" | "REVOKED"; exclusiveStartKey?: Record<string, unknown> }): Promise<{ items: ExternalShareLink[]; lastEvaluatedKey?: Record<string, unknown> }> {
    return this.store.queryIndexPage<ExternalShareLink>({
      indexName: "GSI1",
      partitionKeyValue: `TENANT#${input.tenantId}#DOCSHARE#${input.documentId}#STATUS#${input.status}`,
      exclusiveStartKey: input.exclusiveStartKey,
    });
  }

  /**
   * Decision 1/3/5/6 — the visitor's own entry point. Never touches `RequestContext`/
   * `authorize()`. Order is fixed: parse -> rate limit (BEFORE lookup) -> pointer lookup ->
   * dummy-safe secret compare -> link status/expiry -> tenant ACTIVE -> file freshness -> presign.
   */
  async resolveForAnonymousAccess(rawToken: string, requestContext: { ip: string }): Promise<ResolvedExternalShareLinkAccess> {
    // Decision 3: the route is `GET /external-share/{shareId}/{token}` — `shareId` is
    // logging-only (the pointer's own `shareId` is the sole resolution authority, see
    // `externalShareLinkPointerKey`'s doc comment); this function receives only the `token` path
    // segment (`selector.secret`), never the route's `shareId`.
    const parsed = parseExternalShareLinkToken(rawToken);
    if (!parsed) throw new ExternalShareLinkInvalidError();

    const selectorHash = hmacExternalShareLinkCrypto.hash(this.pepper, parsed.selector);

    try {
      await this.rateLimiter.consumeBoth({ requestKey: selectorHash, ip: requestContext.ip, limit: RATE_LIMIT_PER_MINUTE, windowSeconds: RATE_LIMIT_WINDOW_SECONDS });
    } catch {
      throw new ExternalShareLinkInvalidError();
    }

    const pointer = await this.store.get<ExternalShareLinkPointer>(externalShareLinkPointerKey(selectorHash));
    const targetSecretHash = pointer?.secretHash ?? hmacExternalShareLinkCrypto.hash(this.pepper, `dummy:${selectorHash}`);
    const secretOk = externalShareLinkSecretMatches(this.pepper, parsed.secret, targetSecretHash);
    if (!pointer || !secretOk) throw new ExternalShareLinkInvalidError();

    const tenantId = authorizedTenantIdFromPersistedEntity(pointer);
    const link = await this.store.get<ExternalShareLink>(externalShareLinkKey(tenantId, pointer.documentId, pointer.shareId));
    if (!link) throw new ExternalShareLinkInvalidError();
    if (link.status !== "ACTIVE") throw new ExternalShareLinkInvalidError();
    if (link.expiresAt < this.now()) throw new ExternalShareLinkInvalidError();

    const tenant = await this.store.get<TenantLifecycleRecord>(tenantLifecycleKey(tenantId));
    if (!tenant || tenant.status !== TENANT_ACTIVE_STATUS) {
      auditExternalShareLinkTenantInactiveBlocked({ tenantId, documentId: pointer.documentId, shareId: pointer.shareId, ipHash: hmacExternalShareLinkCrypto.hash(this.pepper, requestContext.ip) });
      throw new ExternalShareLinkInvalidError();
    }

    // Decision 6: revalidate ONLY DocumentFile.scanStatus/cleanObject — NEVER DocumentVersion.
    // state/Document.status again (the frozen-copy contract). `documentFileSeq` was frozen at
    // creation precisely so this key can be rebuilt without touching DocumentVersion at all.
    const file = await this.store.get<DocumentFile>(documentFileKey(tenantId, link.documentId, link.documentFileSeq, link.documentFileId));
    if (!file || file.scanStatus !== "CLEAN" || !file.cleanObject) throw new ExternalShareLinkInvalidError();

    const downloadUrl = await this.fileStore.presignDownload({
      objectRef: file.cleanObject,
      fileName: sanitizeFileName(`${link.documentTypeNameSnapshot}.pdf`),
      expiresInSeconds: SHARE_LINK_PRESIGN_TTL_SECONDS,
    });

    auditExternalShareLinkPresignIssued({ tenantId, documentId: link.documentId, shareId: pointer.shareId, ipHash: hmacExternalShareLinkCrypto.hash(this.pepper, requestContext.ip) });

    return {
      documentTypeNameSnapshot: link.documentTypeNameSnapshot,
      documentIssuedDate: link.documentIssuedDateSnapshot ?? null,
      fileName: sanitizeFileName(`${link.documentTypeNameSnapshot}.pdf`),
      downloadUrl,
    };
  }

  private async findVersionById(tenantId: AuthorizedTenantId, documentId: string, versionId: string): Promise<DocumentVersion | undefined> {
    const rows = await this.store.queryByPk<DocumentVersion>(`TENANT#${tenantId}#DOCUMENT#${documentId}`, "VERSION#");
    return rows.find((v) => v.entityType === "DocumentVersion" && v.versionId === versionId);
  }

  private shareIdFromSk(sk: string): string {
    return sk.slice("SHARE#".length);
  }
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 200);
}

/**
 * GuestDocumentAccessService — D-143 Decision 4, the document-archive analogue of
 * `src/modules/subject/application/guest-submission-service.ts`. NEVER touches
 * `RequestContext`/`authorize()` — the guest is validated only by credential/session tokens,
 * deliberately outside normal RBAC (same posture as the subject-module precedent).
 *
 * Three layers, three entry points:
 *  1. `resolveCredential()` — validates a `RequestAccessCredential` token end to end (parse ->
 *     rate limit BEFORE lookup, to avoid an existence oracle -> pointer lookup -> dummy-safe
 *     secret compare -> expiry/revocation -> DocumentRequest liveness).
 *  2. `startGuestSession()` — the ONLY way a `GuestSession` is minted (Decision 4: never
 *     automatically from the credential alone, an explicit human interstitial action every
 *     time — see `guest-session.ts`'s doc comment for why).
 *  3. `submitEvidence()` — validates a `GuestSession` token (same resolve discipline as the
 *     credential) + CSRF double-submit + its OWN idempotency key (never the credential/session,
 *     so a network retry can never double-create a DocumentVersion), then creates a brand-new
 *     Document + DocumentVersion landing at RECEIVED (C2, `document-domain-functional-decisions.md`:
 *     "Todo upload externo deve chegar como RECEIVED e depender de aceite interno" — guest
 *     uploads must NEVER auto-accept) in one `TransactWriteItems`, fenced through
 *     `executeTenantBusinessMutation` exactly like the subject-module precedent.
 *
 * Anti-enumeration discipline (Decision 4, mirrors `GuestTokenInvalidError`): every failure mode
 * of every one of the three entry points — malformed/nonexistent/wrong-secret/expired/revoked/
 * rate-limited/CSRF-mismatch — collapses to the SAME `GuestAccessInvalidError`, with no `details`
 * populated (`AppError.toJSON()` serializes `details` into the HTTP response).
 */
import { AppError, ValidationError, TenantNotActiveError } from "../../../shared/errors/app-error.js";
import { authorizedTenantIdFromPersistedEntity, type AuthorizedTenantId } from "../../identity/domain/authorization.js";
import { buildExistenceConditionCheck, buildVersionedCreate, buildVersionedUpdate, isTransactionCanceled, type EntityKey } from "../../../shared/dynamodb/occ.js";
import { documentTypeKey, type DocumentType } from "../domain/document-type.js";
import { executeTenantBusinessMutation } from "../../../shared/tenant-lifecycle/tenant-business-mutation.js";
import type { UploadUrlSigner } from "../../document/ports/upload-url-signer.js";
import { MAX_UPLOAD_BYTES } from "../../document/application/upload-validation.js";
import {
  buildDocumentArchiveQuarantineKey,
  deriveDocumentFileMaintenanceDue,
  documentFileGsi8Keys,
  documentFileKey,
  FILE_SCAN_TIMEOUT_SECONDS,
  isNonTerminalFileScanStatus,
  type DocumentFile,
} from "../domain/document-file.js";
import { MAX_OCC_RETRIES } from "./apply-file-scan-result.js";
import { defaultStorageQuota, storageQuotaKey, wouldExceedStorageQuota, type TenantStorageQuota } from "../domain/storage-quota.js";
import {
  epochSecondsFromIso,
  hmacRequestAccessCrypto,
  issueRequestAccessCredential,
  parseRequestAccessToken,
  requestAccessCredentialKey,
  requestAccessSecretMatches,
  type IssuedRequestAccessCredential,
  type RequestAccessCredential,
} from "../domain/request-access-credential.js";
import {
  GUEST_SESSION_TTL_SECONDS,
  guestSessionCsrfMatches,
  guestSessionKey,
  guestSessionSecretMatches,
  hmacGuestSessionCrypto,
  issueGuestSession,
  parseGuestSessionToken,
  type GuestSession,
  type IssuedGuestSession,
} from "../domain/guest-session.js";
import { documentRequestKey, isDocumentRequestLive, type DocumentRequest } from "../domain/document-request.js";
import { requirementKey } from "../domain/requirement.js";
import { trackedSubjectKeyForFence } from "../domain/requirement-template.js";
import { documentKey, documentGsi1Keys, documentGsi2Keys, type Document } from "../domain/document.js";
import { documentVersionKey, reviewQueueGsi5Keys, type DocumentVersion } from "../domain/document-version.js";
import { documentVersionEventKey, type DocumentVersionEvent } from "../domain/document-version-event.js";
import type { DocumentArchiveStore } from "../ports/document-archive-store.js";
import type { DocumentArchiveIdGenerator } from "./id-generator.js";
import type { DocumentArchiveGuestRateLimiter } from "./document-archive-guest-rate-limiter.js";

/** Single generic error for every guest-auth/CSRF/rate-limit failure mode (Decision 4). */
export class GuestAccessInvalidError extends AppError {
  constructor() {
    super({ code: "GUEST_ACCESS_INVALID", category: "AUTH", message: "Invalid, expired, or unauthorized guest access.", retryable: false });
    this.name = "GuestAccessInvalidError";
  }
}

const RATE_LIMIT_PER_MINUTE = 30;
const RATE_LIMIT_WINDOW_SECONDS = 60;

// ADR-0013 (D-265) — same allowlist/size ceiling as `document`/M6's own
// `ALLOWED_MEDIA_TYPES`/`MAX_UPLOAD_BYTES` (`document-service.ts`), ported as a literal (not
// cross-imported as a Set) rather than reused, same "no cross-module coupling on an internal
// constant shape" precedent `storage-quota.ts`'s module doc comment already establishes —
// `MAX_UPLOAD_BYTES` itself IS imported (a plain number, not a module-internal shape).
const ALLOWED_MEDIA_TYPES: ReadonlySet<string> = new Set(["application/pdf", "image/jpeg", "image/png"]);

// 10 minutes — same window `document-archive-service.ts`'s `PRESIGN_TTL_SECONDS` uses, reusing
// `FILE_SCAN_TIMEOUT_SECONDS` rather than a second constant (D-179 slice 3 precedent: presign
// window and scan-timeout deadline must never drift apart).
const PRESIGN_TTL_SECONDS = FILE_SCAN_TIMEOUT_SECONDS;
// ADR-0013 Rodada 3 — small margin so a presigned URL is never issued expiring at the exact
// instant the reconciliation worker could already declare TIMEOUT.
const PRESIGN_SAFETY_MARGIN_SECONDS = 5;

export interface GuestDocumentAccessServiceDeps {
  store: DocumentArchiveStore;
  tableName: string;
  ids: DocumentArchiveIdGenerator;
  rateLimiter: DocumentArchiveGuestRateLimiter;
  pepper: string;
  /** ADR-0013 (D-265) — the SAME quarantine bucket/signer `DocumentArchiveService` already
   * depends on (`document-archive-service.ts`'s own deps doc comment) — no new bucket, no new
   * signer abstraction, only a second call site against the existing ones. */
  quarantineBucket: string;
  signer: UploadUrlSigner;
  now?: () => string;
}

export interface ResolvedCredential {
  credential: RequestAccessCredential;
  request: DocumentRequest;
  /** G02 (Block 6, D-2xx) — the guest wizard's own card copy ("{Fornecedor} solicitou evidência
   * para o requisito: {Requisito}") needs a human-readable name, never the opaque
   * subjectId/requirementId this service otherwise deals in exclusively. Best-effort/absent-safe
   * (`?`): a Subject/Requirement deleted after the credential was issued must never turn an
   * otherwise-valid guest session into a hard failure — the UI degrades to omitting the name,
   * same "no fabricated value" discipline as the rest of this module. */
  subjectDisplayName?: string;
  requirementName?: string;
}

export interface ResolvedSession {
  session: GuestSession;
  request: DocumentRequest;
}

export interface IssueCredentialInput {
  tenantId: string;
  subjectId: string;
  requirementId: string;
  documentRequestId: string;
  /** TTL for the credential — must equal the business Request's deadline (Decision 4). Callers
   * (the future recurrence/DocumentRequest-creation flow) always supply this explicitly; this
   * service never invents a default TTL. */
  expiresAt: string;
}

export interface StartGuestSessionResult {
  session: IssuedGuestSession;
  expiresAt: string;
  /** G02 (Block 6, D-2xx) — see `ResolvedCredential`'s own doc comment; startGuestSession is the
   * ONE call G02 actually makes on page load (it never calls the bare layer-1 GET route
   * directly, see `document-archive-guest-handlers.ts`'s header comment), so this is the single
   * place the wizard's card copy gets its display names from. */
  subjectDisplayName?: string;
  requirementName?: string;
}

export interface SubmitEvidenceInput {
  fileName: string;
  /** Mandatory since D-243 (clean cutover, no coexistence with the old free-text `documentType`
   * field D-184 had left optional) — always validated against the tenant's DocumentType catalog
   * via the transactional ConditionCheck below. */
  documentTypeId: string;
  /** ADR-0013 (D-265) — real upload metadata, validated against the same allowlist/size ceiling
   * as the authenticated path (`ALLOWED_MEDIA_TYPES`/`MAX_UPLOAD_BYTES` above). Any validation
   * failure collapses into the generic `GuestAccessInvalidError`, never a differentiated message
   * (anti-enumeration discipline, module header comment). */
  mediaType: string;
  contentLength: number;
  checksumSha256: string;
  /** Idempotency key OWNED by this call, distinct from the credential/session token — a network
   * retry replaying the same key must never double-create a DocumentVersion. */
  idempotencyKey: string;
}

export interface SubmitEvidenceResult {
  documentId: string;
  versionId: string;
  seq: number;
  /** ADR-0013 (D-265) — needed so `confirmUploadInFlight()` can resolve this submission's
   * `DocumentFile` from the idempotency record alone (never a raw client-supplied `fileId`). */
  fileId: string;
  /** Present only while the file is still `PENDING_UPLOAD` and inside its presign window — see
   * `computeUploadOffer()`. Absent means "nothing more to do for this submission" (already
   * uploaded, expired, or otherwise terminal) — never distinguished further, same anti-
   * enumeration collapse as the rest of this module. */
  uploadUrl?: string;
  requiredHeaders?: Record<string, string>;
}

/** Deliberately minimal — never exposes `metadataFields`/`status`/timestamps/`version` to a
 * guest, only what a submission UI needs to populate a `documentType` choice. */
export interface GuestDocumentTypeSummary {
  documentTypeId: string;
  displayName: string;
}

export class GuestDocumentAccessService {
  private readonly store: DocumentArchiveStore;
  private readonly tableName: string;
  private readonly ids: DocumentArchiveIdGenerator;
  private readonly rateLimiter: DocumentArchiveGuestRateLimiter;
  private readonly pepper: string;
  private readonly quarantineBucket: string;
  private readonly signer: UploadUrlSigner;
  private readonly now: () => string;

  constructor(deps: GuestDocumentAccessServiceDeps) {
    this.store = deps.store;
    this.tableName = deps.tableName;
    this.ids = deps.ids;
    this.rateLimiter = deps.rateLimiter;
    this.pepper = deps.pepper;
    this.quarantineBucket = deps.quarantineBucket;
    this.signer = deps.signer;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  /** Issuance entry point — normally invoked by an authenticated internal flow when a
   * DocumentRequest is created (recurrence's job, D-143 Decision 8, a separate follow-up task).
   * Kept here as the minimal, explicit extension point this task needs: guest access cannot be
   * exercised end to end without SOME way to mint a credential. */
  async issueCredential(input: IssueCredentialInput): Promise<IssuedRequestAccessCredential> {
    const issued = issueRequestAccessCredential(this.pepper);
    const now = this.now();
    const credential: RequestAccessCredential = {
      ...requestAccessCredentialKey(issued.selectorHash),
      entityType: "RequestAccessCredential",
      selectorHash: issued.selectorHash,
      secretHash: issued.secretHash,
      tenantId: input.tenantId,
      subjectId: input.subjectId,
      requirementId: input.requirementId,
      documentRequestId: input.documentRequestId,
      tokenVersion: 1,
      expiresAt: input.expiresAt,
      purgeAfterTtl: epochSecondsFromIso(input.expiresAt),
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const created = await this.store.putIfAbsent(credential);
    if (!created) {
      // Astronomically unlikely selector collision (128 bits) — never silently overwrite an
      // existing credential pointer.
      throw new ValidationError("Could not issue credential (selector collision).");
    }
    return issued;
  }

  /** Layer 1: validates a `RequestAccessCredential` token end to end. Never mints a session —
   * callers that only need to SHOW request info (an interstitial page) call this alone. */
  async resolveCredential(rawToken: string, requestContext: { ip: string }): Promise<ResolvedCredential> {
    const parsed = parseRequestAccessToken(rawToken);
    if (!parsed) throw new GuestAccessInvalidError();

    const selectorHash = hmacRequestAccessCrypto.hash(this.pepper, parsed.selector);

    // Rate limit consumed BEFORE lookup, by both the selector (computable even if no pointer
    // exists) and IP — Decision 4's multidimensional requirement, applied at the earliest point
    // an oracle could otherwise form (same discipline as GuestSubmissionService.resolveToken).
    try {
      await this.rateLimiter.consumeBoth({ requestKey: selectorHash, ip: requestContext.ip, limit: RATE_LIMIT_PER_MINUTE, windowSeconds: RATE_LIMIT_WINDOW_SECONDS });
    } catch {
      throw new GuestAccessInvalidError();
    }

    const pointer = await this.store.get<RequestAccessCredential>(requestAccessCredentialKey(selectorHash));

    // Dummy anti-timing path — even when no pointer exists, still compute a hash and a
    // timingSafeEqual comparison so response time never depends on selector existence. The dummy
    // hash's fixed prefix can never collide with a real secretHash (issueRequestAccessCredential
    // never produces this literal input).
    const targetSecretHash = pointer?.secretHash ?? hmacRequestAccessCrypto.hash(this.pepper, `dummy:${selectorHash}`);
    const secretOk = requestAccessSecretMatches(this.pepper, parsed.secret, targetSecretHash);
    if (!pointer || !secretOk) throw new GuestAccessInvalidError();

    if (pointer.revokedAt) throw new GuestAccessInvalidError();
    if (pointer.expiresAt < this.now()) throw new GuestAccessInvalidError();

    const request = await this.store.get<DocumentRequest>(documentRequestKey(authorizedTenantIdFromPersistedEntity(pointer), pointer.subjectId, pointer.documentRequestId));
    if (!request || !isDocumentRequestLive(request.status)) throw new GuestAccessInvalidError();
    // Re-validate against the live Request's deadline too (same "credential TTL OR deadline,
    // whichever is sooner, re-checked at resolve time" discipline as GuestTokenPointer's D-037
    // precedent) — catches a deadline edited after the credential was issued without reissuing it.
    if (request.deadline && request.deadline < this.now()) throw new GuestAccessInvalidError();

    if (request.status === "REQUESTED") await this.markOpened(request);

    const tenantId = authorizedTenantIdFromPersistedEntity(pointer);
    const [subject, requirement] = await Promise.all([
      this.store.get<EntityKey & { displayName?: string }>(trackedSubjectKeyForFence(tenantId, pointer.subjectId)),
      this.store.get<EntityKey & { name?: string }>(requirementKey(tenantId, pointer.subjectId, pointer.requirementId)),
    ]);

    return { credential: pointer, request, subjectDisplayName: subject?.displayName, requirementName: requirement?.name };
  }

  /**
   * Discovery route (item 6 of D-173's estado-final-consolidado.md, engineering-only slice —
   * see D-19x for the full contradiction/pendency writeup): lets a guest who has a valid
   * credential token discover which `DocumentTypeId`s are currently valid to submit, WITHOUT any
   * `authorize()`/`RequestContext` — same token-resolution discipline as `resolveCredential()`,
   * reused here rather than duplicated. Only ACTIVE types are ever returned (never DRAFT/
   * DEPRECATED) — a guest has no legitimate reason to see a type it cannot successfully submit
   * against, since D-184's transactional ConditionCheck would reject anything else anyway.
   * Read-only, no side effect (does NOT call `markOpened` — that is `resolveCredential`'s own
   * concern and this route can be polled/refreshed by a guest UI without mutating Request state).
   */
  async listActiveDocumentTypesForGuest(rawToken: string, requestContext: { ip: string }): Promise<GuestDocumentTypeSummary[]> {
    const parsed = parseRequestAccessToken(rawToken);
    if (!parsed) throw new GuestAccessInvalidError();

    const selectorHash = hmacRequestAccessCrypto.hash(this.pepper, parsed.selector);
    try {
      await this.rateLimiter.consumeBoth({ requestKey: selectorHash, ip: requestContext.ip, limit: RATE_LIMIT_PER_MINUTE, windowSeconds: RATE_LIMIT_WINDOW_SECONDS });
    } catch {
      throw new GuestAccessInvalidError();
    }

    const pointer = await this.store.get<RequestAccessCredential>(requestAccessCredentialKey(selectorHash));
    const targetSecretHash = pointer?.secretHash ?? hmacRequestAccessCrypto.hash(this.pepper, `dummy:${selectorHash}`);
    const secretOk = requestAccessSecretMatches(this.pepper, parsed.secret, targetSecretHash);
    if (!pointer || !secretOk) throw new GuestAccessInvalidError();
    if (pointer.revokedAt) throw new GuestAccessInvalidError();
    if (pointer.expiresAt < this.now()) throw new GuestAccessInvalidError();

    const request = await this.store.get<DocumentRequest>(documentRequestKey(authorizedTenantIdFromPersistedEntity(pointer), pointer.subjectId, pointer.documentRequestId));
    if (!request || !isDocumentRequestLive(request.status)) throw new GuestAccessInvalidError();
    if (request.deadline && request.deadline < this.now()) throw new GuestAccessInvalidError();

    // Same GSI1 DOCTYPESTATUS namespace as DocumentArchiveService.listDocumentTypes, read
    // directly against the store (never through that authorize()-gated method — this whole
    // module never calls authorize()/RequestContextResolver, see file header). Catalogs are
    // small (a handful to low hundreds of types per tenant), so — unlike the internal
    // paginated-by-design admin listing — this accumulates every page here: a guest-facing
    // discovery list has no caller-driven cursor to hand back, and a hard page cap (`MAX_PAGES`)
    // bounds the cost of a pathological tenant rather than looping unbounded.
    const MAX_PAGES = 20;
    const items: DocumentType[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await this.store.queryIndexPage<DocumentType>({
        indexName: "GSI1",
        partitionKeyValue: `TENANT#${pointer.tenantId}#DOCTYPESTATUS#ACTIVE`,
        exclusiveStartKey,
      });
      items.push(...result.items);
      if (!result.lastEvaluatedKey) break;
      exclusiveStartKey = result.lastEvaluatedKey;
    }

    return items.map((item) => ({ documentTypeId: item.documentTypeId, displayName: item.displayName }));
  }

  /** Layer 2: the ONLY way a GuestSession is minted — always an explicit call, never a side
   * effect of `resolveCredential`. */
  async startGuestSession(rawToken: string, requestContext: { ip: string }): Promise<StartGuestSessionResult> {
    const resolved = await this.resolveCredential(rawToken, requestContext);
    const issued = issueGuestSession(this.pepper);
    const now = this.now();
    const expiresAt = new Date(Date.parse(now) + GUEST_SESSION_TTL_SECONDS * 1000).toISOString();
    const session: GuestSession = {
      ...guestSessionKey(issued.selectorHash),
      entityType: "GuestSession",
      selectorHash: issued.selectorHash,
      secretHash: issued.secretHash,
      tenantId: resolved.credential.tenantId,
      subjectId: resolved.credential.subjectId,
      requirementId: resolved.credential.requirementId,
      documentRequestId: resolved.credential.documentRequestId,
      credentialSelectorHash: resolved.credential.selectorHash,
      csrfTokenHash: issued.csrfTokenHash,
      expiresAt,
      purgeAfterTtl: epochSecondsFromIso(expiresAt),
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const created = await this.store.putIfAbsent(session);
    if (!created) throw new GuestAccessInvalidError(); // astronomically unlikely selector collision.
    return { session: issued, expiresAt, subjectDisplayName: resolved.subjectDisplayName, requirementName: resolved.requirementName };
  }

  /** Resolves a GuestSession token — same parse/rate-limit/lookup/dummy-compare/expiry
   * discipline as `resolveCredential`, over the session's own tenantless namespace. */
  private async resolveSession(rawSessionToken: string, requestContext: { ip: string }): Promise<ResolvedSession> {
    const parsed = parseGuestSessionToken(rawSessionToken);
    if (!parsed) throw new GuestAccessInvalidError();

    const selectorHash = hmacGuestSessionCrypto.hash(this.pepper, parsed.selector);
    try {
      await this.rateLimiter.consumeBoth({ requestKey: selectorHash, ip: requestContext.ip, limit: RATE_LIMIT_PER_MINUTE, windowSeconds: RATE_LIMIT_WINDOW_SECONDS });
    } catch {
      throw new GuestAccessInvalidError();
    }

    const pointer = await this.store.get<GuestSession>(guestSessionKey(selectorHash));
    const targetSecretHash = pointer?.secretHash ?? hmacGuestSessionCrypto.hash(this.pepper, `dummy:${selectorHash}`);
    const secretOk = guestSessionSecretMatches(this.pepper, parsed.secret, targetSecretHash);
    if (!pointer || !secretOk) throw new GuestAccessInvalidError();
    if (pointer.expiresAt < this.now()) throw new GuestAccessInvalidError();

    const request = await this.store.get<DocumentRequest>(documentRequestKey(authorizedTenantIdFromPersistedEntity(pointer), pointer.subjectId, pointer.documentRequestId));
    if (!request || !isDocumentRequestLive(request.status)) throw new GuestAccessInvalidError();

    return { session: pointer, request };
  }

  /** Double-submit CSRF check shared by `submitEvidence()`/`confirmUploadInFlight()` (Codex
   * review round 1, D-265 implementation: this was copy-pasted between the two before, real
   * drift risk the ADR's own "reused, not duplicated" intent named). Cookie and header must both
   * be present AND equal AND match the session's own stored hash (defends both "no cookie at
   * all" and "attacker can set an arbitrary matching pair but doesn't know the real session's
   * csrfToken" — the latter is the whole point of hashing it server-side rather than only
   * comparing cookie===header). */
  private assertCsrf(requestContext: { csrfCookieValue: string | undefined; csrfHeaderValue: string | undefined }, session: GuestSession): void {
    if (!requestContext.csrfCookieValue || !requestContext.csrfHeaderValue || requestContext.csrfCookieValue !== requestContext.csrfHeaderValue) {
      throw new GuestAccessInvalidError();
    }
    if (!guestSessionCsrfMatches(this.pepper, requestContext.csrfHeaderValue, session.csrfTokenHash)) {
      throw new GuestAccessInvalidError();
    }
  }

  /** Layer 3: idempotent evidence submission. `csrfCookieValue`/`csrfHeaderValue` are the raw
   * double-submit pair — mismatch (missing either side, or the two differing) is a CSRF failure
   * and collapses into the same generic error as every other guest-auth failure mode.
   *
   * ADR-0013 (D-265) — now persists a real `DocumentFile` (PENDING_UPLOAD) in the same
   * transaction and returns a presigned PUT, reusing the exact `DocumentFile`/scan pipeline
   * already `APPROVED`/in production for `document`/`subject`/`document-archive` (D-163). Never
   * activates the STARTER/PROMOTER gate (D-193) — inherited unchanged, a guest file follows the
   * identical CLEAN-eligibility path an authenticated upload already does today. */
  async submitEvidence(
    rawSessionToken: string,
    requestContext: { ip: string; csrfCookieValue: string | undefined; csrfHeaderValue: string | undefined },
    input: SubmitEvidenceInput,
  ): Promise<SubmitEvidenceResult> {
    const resolved = await this.resolveSession(rawSessionToken, requestContext);
    this.assertCsrf(requestContext, resolved.session);

    const tenantId = authorizedTenantIdFromPersistedEntity(resolved.session);
    const subjectId = resolved.session.subjectId;

    const idempotencyKey = { PK: `TENANT#${tenantId}#SUBJECT#${subjectId}`, SK: `DOCREQUEST#${resolved.request.documentRequestId}#SUBMIT#${input.idempotencyKey}` };
    // D-243 replay policy (payload-agnostic, first-write-wins, preserves D-143 Decision 4/D-184
    // unchanged): this short-circuit runs BEFORE `documentTypeId` is ever read/validated below —
    // a replay with the same key and a DIFFERENT `documentTypeId` still returns the original
    // snapshot untouched, never re-validating or comparing the two values. ADR-0013 (Rodada 3):
    // a replay also re-derives the upload offer fresh (never caches a stale `uploadUrl`) — the
    // presign window is bounded by the FILE's own GSI8 deadline, never reopened.
    const existingReplay = await this.store.get<{ resultSnapshot: SubmitEvidenceResult } & EntityKey>(idempotencyKey);
    if (existingReplay) return this.withFreshUploadOffer(tenantId, existingReplay.resultSnapshot);

    // ADR-0013 (D-265) — validated in this fixed order (mediaType -> contentLength ->
    // checksumSha256), any failure collapses to the generic guest error, never reaching the
    // transaction below. Schema-level constraints (`docarchive-guest-submit-evidence-request.v1.json`)
    // already enforce the same allowlist/range/pattern before this is reached — this is
    // defense-in-depth at the service boundary, same "double-track" discipline the schema's own
    // comment documents.
    if (!ALLOWED_MEDIA_TYPES.has(input.mediaType)) throw new GuestAccessInvalidError();
    // Codex review round 1 (D-265 implementation): `Number.isInteger` closes a defense-in-depth
    // gap the schema alone already covers (fractional/NaN `contentLength`) but this service-level
    // check didn't — the schema is the HTTP boundary, this is the belt-and-suspenders re-check.
    if (!Number.isInteger(input.contentLength) || input.contentLength <= 0 || input.contentLength > MAX_UPLOAD_BYTES) throw new GuestAccessInvalidError();
    if (!/^[a-f0-9]{64}$/i.test(input.checksumSha256)) throw new GuestAccessInvalidError();

    const now = this.now();
    const documentId = this.ids.newDocumentId();
    const versionId = this.ids.newVersionId();
    const fileId = this.ids.newFileId();
    // D-243 (supersedes D-184's conditional guard): `documentTypeId` is now mandatory end to end —
    // the HTTP schema already rejects a missing/renamed field with 400 before this is reached, and
    // the old free-text `documentType ?? requirementId` fallback is removed entirely (no coexistence,
    // clean cutover). Always validated against the tenant's DocumentType catalog via the
    // unconditional ConditionCheck below.
    const documentTypeId = input.documentTypeId;

    const document: Document = {
      ...documentKey(tenantId, documentId),
      entityType: "Document",
      documentId,
      tenantId,
      subjectId,
      documentTypeId,
      status: "ACTIVE",
      hasValidity: false,
      createdAt: now,
      updatedAt: now,
      version: 1,
      ...documentGsi1Keys(tenantId, "ACTIVE", now, documentId),
      // GSI2 (Documents-by-Subject) — a second attribute set on the same physical row, no
      // mirror item needed (same pattern as DocumentArchiveService.createDocument).
      ...documentGsi2Keys(tenantId, subjectId, documentTypeId, documentId),
    };

    // ADR-0013 (D-265), reusing `reserveFiles()`'s exact GSI8/quarantine-key construction —
    // never a second convention for the same concept.
    const due = deriveDocumentFileMaintenanceDue({ scanStatus: "PENDING_UPLOAD", createdAt: now })!;
    const file: DocumentFile = {
      ...documentFileKey(tenantId, documentId, 1, fileId),
      entityType: "DocumentFile",
      tenantId,
      documentId,
      versionId,
      seq: 1,
      fileId,
      role: "PRINCIPAL",
      scanStatus: "PENDING_UPLOAD",
      mediaType: input.mediaType,
      contentLength: input.contentLength,
      checksumSha256: input.checksumSha256,
      quarantineObject: { bucket: this.quarantineBucket, key: buildDocumentArchiveQuarantineKey(tenantId, documentId, 1, fileId), versionId: "" },
      createdAt: now,
      updatedAt: now,
      version: 1,
      ...documentFileGsi8Keys({ dueAtIso: due.dueAtIso, tenantId, fileId }),
    };

    const version: DocumentVersion = {
      ...documentVersionKey(tenantId, documentId, 1),
      entityType: "DocumentVersion",
      versionId,
      documentId,
      tenantId,
      seq: 1,
      // C2 (document-domain-functional-decisions.md): every guest upload lands as RECEIVED,
      // never auto-accepted — this single transaction goes straight to RECEIVED (the compressed
      // internal-flow precedent for "DRAFT -> RECEIVED in one step", never further to ACCEPTED).
      state: "RECEIVED",
      origin: "GUEST_UPLOAD",
      receivedAt: now,
      // ADR-0013 (D-265) — the file set is sealed at creation (a guest submission is always
      // exactly one PRINCIPAL file, never a batch), mirroring `reserveFiles()`'s literal-Put
      // discipline: these fields are NEVER a second `Update` on the same item within one
      // transaction (DynamoDB would reject two actions against the same key).
      fileSetSealed: true,
      principalFileId: fileId,
      totalFiles: 1,
      pendingFileScans: 1,
      infectedFileScans: 0,
      requestId: resolved.request.documentRequestId,
      createdAt: now,
      updatedAt: now,
      version: 1,
      ...reviewQueueGsi5Keys(tenantId, "RECEIVED", now, versionId),
    };

    const event: DocumentVersionEvent = {
      ...documentVersionEventKey(tenantId, documentId, 1, this.ids.newEventId()),
      entityType: "DocumentVersionEvent",
      tenantId,
      documentId,
      versionId,
      type: "RECEIVED",
      toState: "RECEIVED",
      actor: `guest:${resolved.request.documentRequestId}`,
      occurredAt: now,
    };

    const result: SubmitEvidenceResult = { documentId, versionId, seq: 1, fileId };
    const idempotencyRecord = {
      ...idempotencyKey,
      entityType: "IdempotencyRecord" as const,
      tenantId,
      payloadHash: `submitEvidence:${resolved.request.documentRequestId}:${input.idempotencyKey}`,
      resultSnapshot: result,
      createdAt: now,
    };

    // storage-quota-scoping (D-249) / ADR-0013 (D-265) — same reservation-time capacity hold
    // `reserveFiles()` takes, extended to the guest path (a caller-free upload target that
    // previously never consumed quota at all — this change closes that abuse vector as a direct
    // consequence of storing real bytes). In-memory check first for a clear early collapse;
    // the transactional `Update` below is what actually serializes concurrent guest submissions.
    const quota = await this.ensureStorageQuota(tenantId);
    if (wouldExceedStorageQuota(quota, input.contentLength)) {
      // Never a differentiated QuotaExceededError here (that's the authenticated-path 429) — a
      // guest must never learn the tenant's storage state, same anti-enumeration collapse as
      // every other failure mode this module has.
      throw new GuestAccessInvalidError();
    }

    const entries = [
      // D-243: unconditional as of this decision (D-184's presence guard is removed — always
      // required, always validated). Stays at position [0] (same `buildExistenceConditionCheck`/
      // `documentTypeKey` as D-175/D-184); TOCTOU-safe by the same transaction, anti-enumeration
      // `catch` below collapses nonexistent/`DEPRECATED` to the same generic guest error.
      buildExistenceConditionCheck({ tableName: this.tableName, key: documentTypeKey(tenantId, documentTypeId), extra: { status: "ACTIVE" } }),
      { Put: buildVersionedCreate(this.tableName, document as unknown as Record<string, unknown> & EntityKey) },
      { Put: buildVersionedCreate(this.tableName, version as unknown as Record<string, unknown> & EntityKey) },
      { Put: buildVersionedCreate(this.tableName, file as unknown as Record<string, unknown> & EntityKey) },
      { Put: buildVersionedCreate(this.tableName, event as unknown as Record<string, unknown> & EntityKey) },
      { Put: buildVersionedCreate(this.tableName, idempotencyRecord as unknown as Record<string, unknown> & EntityKey) },
      {
        Update: buildVersionedUpdate({
          tableName: this.tableName,
          key: documentRequestKey(tenantId, subjectId, resolved.request.documentRequestId),
          tenantId,
          expectedVersion: resolved.request.version,
          set: { status: "SUBMITTED", lastSubmissionId: versionId, submissionCount: resolved.request.submissionCount + 1 },
          now,
        }),
      },
      {
        Update: buildVersionedUpdate({
          tableName: this.tableName,
          key: storageQuotaKey(tenantId),
          tenantId,
          expectedVersion: quota.version,
          set: { reservedBytes: quota.reservedBytes + input.contentLength },
          now,
          extraConditions: [
            {
              expression: "#used + #reserved + :requested <= #limit",
              names: { "#used": "usedBytes", "#reserved": "reservedBytes", "#limit": "limitBytes" },
              values: { ":requested": input.contentLength },
            },
          ],
        }),
      },
    ];

    try {
      await executeTenantBusinessMutation({ store: this.store, tableName: this.tableName, tenantId, entries });
    } catch (err) {
      if (isTransactionCanceled(err)) {
        const replay = await this.store.get<{ resultSnapshot: SubmitEvidenceResult } & EntityKey>(idempotencyKey);
        if (replay) return this.withFreshUploadOffer(tenantId, replay.resultSnapshot);
        // A genuine race (e.g. two near-simultaneous submits of the same session) or the tenant
        // leaving ACTIVE — the guest never sees which; same anti-enumeration collapse as every
        // other failure mode on this surface.
        throw new GuestAccessInvalidError();
      }
      if (err instanceof TenantNotActiveError) throw new GuestAccessInvalidError();
      throw err;
    }

    return this.withFreshUploadOffer(tenantId, result);
  }

  /** ADR-0013 (D-265) — re-reads the `DocumentFile` fresh and computes whether a presigned PUT
   * should still be offered, never trusting an in-memory copy from before the transaction
   * committed (mirrors `applyFileScanResult()`'s own "always re-read" discipline). */
  private async withFreshUploadOffer(tenantId: AuthorizedTenantId, result: SubmitEvidenceResult): Promise<SubmitEvidenceResult> {
    const file = await this.store.get<DocumentFile>(documentFileKey(tenantId, result.documentId, result.seq, result.fileId));
    if (!file) return result;
    return { ...result, ...(await this.computeUploadOffer(file)) };
  }

  /** ADR-0013 (D-265), Rodada 3 — presign contract: present = "send the bytes now, the record
   * still accepts them"; absent = "nothing more to do for this submission" (already uploaded,
   * SCANNING, or terminal) — never distinguished further to the guest. Never presigns past the
   * file's own GSI8 deadline (`FILE_SCAN_TIMEOUT_SECONDS`/`PRESIGN_TTL_SECONDS` are deliberately
   * the same window, `document-file.ts`'s own doc comment) — a replay years-late must never
   * reopen a fresh 600s window past when the reconciliation worker could already have declared
   * TIMEOUT. */
  private async computeUploadOffer(file: DocumentFile): Promise<Pick<SubmitEvidenceResult, "uploadUrl" | "requiredHeaders">> {
    if (file.scanStatus !== "PENDING_UPLOAD") return {};
    const dueAtIso = file.GSI8SK?.split("#TENANT#")[0];
    if (!dueAtIso) return {}; // Defensive — a PENDING_UPLOAD file always has a GSI8 pointer (deriveDocumentFileMaintenanceDue), but never assume it over trusting the read.
    const remainingSeconds = (Date.parse(dueAtIso) - Date.parse(this.now())) / 1000 - PRESIGN_SAFETY_MARGIN_SECONDS;
    if (remainingSeconds <= 0) return {};
    const presigned = await this.signer.presignUpload({
      bucket: file.quarantineObject.bucket,
      key: file.quarantineObject.key,
      mediaType: file.mediaType,
      contentLength: file.contentLength,
      checksumSha256: file.checksumSha256,
      metadata: { documentId: file.documentId, versionId: file.versionId, fileId: file.fileId, tenantId: file.tenantId },
      expiresInSeconds: Math.min(PRESIGN_TTL_SECONDS, Math.floor(remainingSeconds)),
    });
    return { uploadUrl: presigned.uploadUrl, requiredHeaders: presigned.requiredHeaders };
  }

  /** Get-or-create of the default storage quota row — same shape as
   * `DocumentArchiveService.ensureStorageQuota()`/`apply-file-scan-result.ts`'s free-function
   * version, duplicated here rather than shared because each of those call sites' own `deps`
   * shape differs (a class instance here vs. a free-function `deps` object there) — same
   * precedent `apply-file-scan-result.ts`'s own copy already establishes. */
  private async ensureStorageQuota(tenantId: AuthorizedTenantId): Promise<TenantStorageQuota> {
    const key = storageQuotaKey(tenantId);
    const existing = await this.store.get<TenantStorageQuota>(key);
    if (existing) return existing;
    const created = defaultStorageQuota(tenantId, this.now());
    const wrote = await this.store.putIfAbsent(created);
    if (wrote) return created;
    const fresh = await this.store.get<TenantStorageQuota>(key);
    if (!fresh) throw new GuestAccessInvalidError(); // Lost the creation race and re-read vanished — treat as generic guest failure, never a 500 a guest could learn from.
    return fresh;
  }

  /**
   * ADR-0013 (D-265) — called by the guest client immediately after S3 confirms 200 on the PUT.
   * Extends the file's GSI8 reconciliation deadline exactly once (`deadlineExtended`), narrowing
   * the race against the reconciliation worker's TIMEOUT sweep down to the network round-trip
   * between the S3 response and this call reaching DynamoDB — never a formal proof of zero race
   * under any adversarial network condition, the same class of guarantee the rest of the scan
   * pipeline already operates under (eventual consistency across S3/GuardDuty/EventBridge/SQS).
   * NEVER touches `scanStatus` or the scan pipeline itself — purely a deadline extension. Resolves
   * `fileId`/`documentId` SOLELY from the idempotency record of the original `submitEvidence()`
   * call (never a raw client-supplied `fileId` — that would not prove possession of the
   * submission).
   */
  async confirmUploadInFlight(
    rawSessionToken: string,
    requestContext: { ip: string; csrfCookieValue: string | undefined; csrfHeaderValue: string | undefined },
    idempotencyKey: string,
  ): Promise<{ extended: boolean }> {
    const resolved = await this.resolveSession(rawSessionToken, requestContext);
    this.assertCsrf(requestContext, resolved.session);

    const tenantId = authorizedTenantIdFromPersistedEntity(resolved.session);
    const subjectId = resolved.session.subjectId;
    const idempotencyRecordKey = { PK: `TENANT#${tenantId}#SUBJECT#${subjectId}`, SK: `DOCREQUEST#${resolved.request.documentRequestId}#SUBMIT#${idempotencyKey}` };
    const record = await this.store.get<{ resultSnapshot: SubmitEvidenceResult } & EntityKey>(idempotencyRecordKey);
    if (!record) throw new GuestAccessInvalidError(); // No matching submission for this session — never accepts a loose fileId.

    const key = documentFileKey(tenantId, record.resultSnapshot.documentId, record.resultSnapshot.seq, record.resultSnapshot.fileId);

    for (let attempt = 0; attempt < MAX_OCC_RETRIES; attempt++) {
      const file = await this.store.get<DocumentFile>(key);
      if (!file || !isNonTerminalFileScanStatus(file.scanStatus)) return { extended: false };
      if (file.deadlineExtended === true) return { extended: true };

      // Codex review round 2 (D-265 implementation) — real bug found and fixed: a file can still
      // be `PENDING_UPLOAD` (never advanced to `SCANNING`, meaning no physical S3 event has EVER
      // been observed) while its ORIGINAL GSI8 deadline has already passed — e.g. the guest never
      // actually completed the PUT and retried much later. Extending in that case would falsely
      // resurrect a submission that never received a single byte, and the frontend's own
      // `{extended:true}` == success contract would then lie. `SCANNING` is deliberately EXEMPT
      // from this check — reaching it at all is itself proof a physical event already arrived, so
      // the original deadline having lapsed since then is irrelevant (same reasoning ADR-0013 §3
      // gives for accepting SCANNING unconditionally).
      if (file.scanStatus === "PENDING_UPLOAD") {
        const originalDueAtIso = file.GSI8SK?.split("#TENANT#")[0];
        if (!originalDueAtIso || Date.parse(originalDueAtIso) <= Date.parse(this.now())) return { extended: false };
      }

      const due = deriveDocumentFileMaintenanceDue({ scanStatus: file.scanStatus, createdAt: this.now() })!;
      try {
        await this.store.transactWrite([
          {
            Update: buildVersionedUpdate({
              tableName: this.tableName,
              key,
              tenantId,
              expectedVersion: file.version,
              set: { deadlineExtended: true, ...documentFileGsi8Keys({ dueAtIso: due.dueAtIso, tenantId, fileId: file.fileId }) },
              now: this.now(),
              extraConditions: [
                { expression: "attribute_not_exists(#extended) OR #extended <> :true", names: { "#extended": "deadlineExtended" }, values: { ":true": true } },
                { expression: "#status IN (:pending, :scanning)", names: { "#status": "scanStatus" }, values: { ":pending": "PENDING_UPLOAD", ":scanning": "SCANNING" } },
              ],
            }),
          },
        ]);
        return { extended: true };
      } catch (err) {
        if (!isTransactionCanceled(err)) throw err;
        // Re-read and re-arbitrate next iteration — never decided from a single cancellation
        // (closes the false-negative a fixed-margin-only approach had: a concurrent
        // `applyFileScanResult()` moving PENDING_UPLOAD->SCANNING is a legitimate retry target,
        // not necessarily "already resolved").
      }
    }
    throw new Error(`confirmUploadInFlight exhausted retries for file ${record.resultSnapshot.fileId} under contention.`);
  }

  private async markOpened(request: DocumentRequest): Promise<void> {
    try {
      await this.store.transactWrite([
        {
          Update: buildVersionedUpdate({
            tableName: this.tableName,
            key: documentRequestKey(authorizedTenantIdFromPersistedEntity(request), request.subjectId, request.documentRequestId),
            tenantId: request.tenantId,
            expectedVersion: request.version,
            set: { status: "OPENED", lastOpenedAt: this.now() },
          }),
        },
      ]);
    } catch (err) {
      // Best-effort — a concurrent read race (two near-simultaneous opens of the same link)
      // must never block the guest from seeing the request's info.
      if (!isTransactionCanceled(err)) throw err;
    }
  }
}

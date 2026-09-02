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
import { buildExistenceConditionCheck, buildVersionedCreate, buildVersionedUpdate, isTransactionCanceled, type EntityKey } from "../../../shared/dynamodb/occ.js";
import { documentTypeKey } from "../domain/document-type.js";
import { executeTenantBusinessMutation } from "../../../shared/tenant-lifecycle/tenant-business-mutation.js";
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

export interface GuestDocumentAccessServiceDeps {
  store: DocumentArchiveStore;
  tableName: string;
  ids: DocumentArchiveIdGenerator;
  rateLimiter: DocumentArchiveGuestRateLimiter;
  pepper: string;
  now?: () => string;
}

export interface ResolvedCredential {
  credential: RequestAccessCredential;
  request: DocumentRequest;
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
}

export interface SubmitEvidenceInput {
  fileName: string;
  documentType?: string;
  /** Idempotency key OWNED by this call, distinct from the credential/session token — a network
   * retry replaying the same key must never double-create a DocumentVersion. */
  idempotencyKey: string;
}

export interface SubmitEvidenceResult {
  documentId: string;
  versionId: string;
  seq: number;
}

export class GuestDocumentAccessService {
  private readonly store: DocumentArchiveStore;
  private readonly tableName: string;
  private readonly ids: DocumentArchiveIdGenerator;
  private readonly rateLimiter: DocumentArchiveGuestRateLimiter;
  private readonly pepper: string;
  private readonly now: () => string;

  constructor(deps: GuestDocumentAccessServiceDeps) {
    this.store = deps.store;
    this.tableName = deps.tableName;
    this.ids = deps.ids;
    this.rateLimiter = deps.rateLimiter;
    this.pepper = deps.pepper;
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

    const request = await this.store.get<DocumentRequest>(documentRequestKey(pointer.tenantId, pointer.subjectId, pointer.documentRequestId));
    if (!request || !isDocumentRequestLive(request.status)) throw new GuestAccessInvalidError();
    // Re-validate against the live Request's deadline too (same "credential TTL OR deadline,
    // whichever is sooner, re-checked at resolve time" discipline as GuestTokenPointer's D-037
    // precedent) — catches a deadline edited after the credential was issued without reissuing it.
    if (request.deadline && request.deadline < this.now()) throw new GuestAccessInvalidError();

    if (request.status === "REQUESTED") await this.markOpened(request);

    return { credential: pointer, request };
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
    return { session: issued, expiresAt };
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

    const request = await this.store.get<DocumentRequest>(documentRequestKey(pointer.tenantId, pointer.subjectId, pointer.documentRequestId));
    if (!request || !isDocumentRequestLive(request.status)) throw new GuestAccessInvalidError();

    return { session: pointer, request };
  }

  /** Layer 3: idempotent evidence submission. `csrfCookieValue`/`csrfHeaderValue` are the raw
   * double-submit pair — mismatch (missing either side, or the two differing) is a CSRF failure
   * and collapses into the same generic error as every other guest-auth failure mode. */
  async submitEvidence(
    rawSessionToken: string,
    requestContext: { ip: string; csrfCookieValue: string | undefined; csrfHeaderValue: string | undefined },
    input: SubmitEvidenceInput,
  ): Promise<SubmitEvidenceResult> {
    const resolved = await this.resolveSession(rawSessionToken, requestContext);

    // Double-submit CSRF: cookie and header must both be present AND equal AND match the
    // session's own stored hash (defends both "no cookie at all" and "attacker can set an
    // arbitrary matching pair but doesn't know the real session's csrfToken" — the latter is the
    // whole point of hashing it server-side rather than only comparing cookie===header).
    if (!requestContext.csrfCookieValue || !requestContext.csrfHeaderValue || requestContext.csrfCookieValue !== requestContext.csrfHeaderValue) {
      throw new GuestAccessInvalidError();
    }
    if (!guestSessionCsrfMatches(this.pepper, requestContext.csrfHeaderValue, resolved.session.csrfTokenHash)) {
      throw new GuestAccessInvalidError();
    }

    const tenantId = resolved.session.tenantId;
    const subjectId = resolved.session.subjectId;
    const requirementId = resolved.session.requirementId;

    const idempotencyKey = { PK: `TENANT#${tenantId}#SUBJECT#${subjectId}`, SK: `DOCREQUEST#${resolved.request.documentRequestId}#SUBMIT#${input.idempotencyKey}` };
    const existingReplay = await this.store.get<{ resultSnapshot: SubmitEvidenceResult } & EntityKey>(idempotencyKey);
    if (existingReplay) return existingReplay.resultSnapshot;

    const now = this.now();
    const documentId = this.ids.newDocumentId();
    const versionId = this.ids.newVersionId();
    // D-173 §5/item 4: `Document.documentTypeId` is the physical row attribute name (renamed
    // end-to-end from `documentType`) — this does NOT change what value the guest flow writes
    // into it. The guest's own free-string `documentType ?? requirementId` fallback is
    // deliberately untouched here (D-175's open decision, guest schema migration remains item 6).
    const documentType = input.documentType ?? requirementId;
    // D-184 (resolves D-175's open decision, option (b)): guard is on PRESENCE of the raw input
    // field (`!== undefined`, not truthy — an explicit empty string is still "supplied", the HTTP
    // schema already rejects it with minLength:1 before this is reached, but the service itself
    // must not silently treat it as absent), never on the post-fallback `documentType` value.
    // Fallback-to-requirementId submissions (the majority today) are byte-identical to before —
    // requirementId is never validated against the DocumentType catalog, since it never was one.
    // Only a caller who explicitly names a DocumentType pays the cost of that value being real and
    // ACTIVE. Idempotency replay (`existingReplay`, above) still short-circuits BEFORE this guard —
    // a deliberate, pre-existing property of `idempotencyKey` (D-143 Decision 4: the key identifies
    // one logical operation, not a payload re-checked on every retry — `fileName` was never
    // re-validated on replay either), not a gap introduced here. See D-184 for the full analysis.
    const documentTypeSupplied = input.documentType !== undefined;

    const document: Document = {
      ...documentKey(tenantId, documentId),
      entityType: "Document",
      documentId,
      tenantId,
      subjectId,
      documentTypeId: documentType,
      status: "ACTIVE",
      hasValidity: false,
      createdAt: now,
      updatedAt: now,
      version: 1,
      ...documentGsi1Keys(tenantId, "ACTIVE", now, documentId),
      // GSI2 (Documents-by-Subject) — a second attribute set on the same physical row, no
      // mirror item needed (same pattern as DocumentArchiveService.createDocument).
      ...documentGsi2Keys(tenantId, subjectId, documentType, documentId),
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
      pendingFileScans: 0,
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

    const result: SubmitEvidenceResult = { documentId, versionId, seq: 1 };
    const idempotencyRecord = {
      ...idempotencyKey,
      entityType: "IdempotencyRecord" as const,
      tenantId,
      payloadHash: `submitEvidence:${resolved.request.documentRequestId}:${input.idempotencyKey}`,
      resultSnapshot: result,
      createdAt: now,
    };

    const entries = [
      // D-184: present only when the guest explicitly supplied a documentType — the entry's
      // index shifts the rest of this array's positions, but the anti-enumeration `catch` below
      // never inspects a specific index for this reason (unlike createDocument()'s D-175
      // codes?.[0] check), so no index-tracking is needed here.
      ...(documentTypeSupplied
        ? [buildExistenceConditionCheck({ tableName: this.tableName, key: documentTypeKey(tenantId, documentType), extra: { status: "ACTIVE" } })]
        : []),
      { Put: buildVersionedCreate(this.tableName, document as unknown as Record<string, unknown> & EntityKey) },
      { Put: buildVersionedCreate(this.tableName, version as unknown as Record<string, unknown> & EntityKey) },
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
    ];

    try {
      await executeTenantBusinessMutation({ store: this.store, tableName: this.tableName, tenantId, entries });
    } catch (err) {
      if (isTransactionCanceled(err)) {
        const replay = await this.store.get<{ resultSnapshot: SubmitEvidenceResult } & EntityKey>(idempotencyKey);
        if (replay) return replay.resultSnapshot;
        // A genuine race (e.g. two near-simultaneous submits of the same session) or the tenant
        // leaving ACTIVE — the guest never sees which; same anti-enumeration collapse as every
        // other failure mode on this surface.
        throw new GuestAccessInvalidError();
      }
      if (err instanceof TenantNotActiveError) throw new GuestAccessInvalidError();
      throw err;
    }

    return result;
  }

  private async markOpened(request: DocumentRequest): Promise<void> {
    try {
      await this.store.transactWrite([
        {
          Update: buildVersionedUpdate({
            tableName: this.tableName,
            key: documentRequestKey(request.tenantId, request.subjectId, request.documentRequestId),
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

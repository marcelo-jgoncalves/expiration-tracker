/**
 * Normalized error taxonomy used across API handlers and async workers.
 *
 * implementation-blueprint.md doesn't name a concrete class hierarchy, but requires
 * (per #6.2) that every consumer "classifica erro como retryable ou terminal" and
 * (per #10.4/NotificationAttempt) that failures carry a normalized error code+category
 * instead of raw SDK exceptions leaking into logs/DLQ metadata. This module is the
 * single place that decision is implemented, so error handling is consistent between
 * the API error-mapper (middleware/error-mapper.ts, M1) and async worker DLQ paths.
 */

export type ErrorCategory =
  | "VALIDATION"
  | "AUTH"
  | "AUTHORIZATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "QUOTA_EXCEEDED"
  | "DEPENDENCY_UNAVAILABLE"
  | "INTERNAL"
  // M7 item 8 (`claude-reconciliation-final-design.md` §1.7): the first 422 in this codebase —
  // a request that is well-formed and passes every OCC/idempotency/authorization check, but
  // violates a business invariant the domain enforces (e.g. confirming an `ExtractedField` that
  // isn't `PENDING_CONFIRMATION`, or a `confirmedValue` that fails its `valueType` validation).
  // Deliberately distinct from VALIDATION (schema/shape) and CONFLICT (OCC/version/idempotency).
  | "BUSINESS_RULE";

export interface AppErrorOptions {
  code: string;
  category: ErrorCategory;
  message: string;
  retryable: boolean;
  /** Arbitrary structured context. MUST be redacted before logging - callers pass raw values here. */
  details?: Record<string, unknown>;
  cause?: unknown;
}

/**
 * Base class for all normalized application errors.
 *
 * HONEST SCOPE of `retryable` (logging-observability-standard.md audit finding, 2026-08-29,
 * correcting an overclaim this comment used to make): implementation-blueprint.md #6.2 asks
 * every consumer to "classifica erro como retryable ou terminal", and this field IS that
 * classification - but no real SQS handler in this codebase branches on it today. Every SQS
 * consumer (reminder-dispatch-handler.ts, email-delivery-handler.ts, textract-task-handler.ts's
 * COMPLETE_OCR, ...) reports EVERY caught error as a batch item failure unconditionally,
 * letting SQS's own `maxReceiveCount`+DLQ redelivery mechanics be the actual retry/terminal
 * decision - `retryable` only reaches a log line (diagnosis), never an `if`. Separately, the M7
 * Step Functions ASL's `Retry`/`Catch` blocks (document-extraction.asl.json) do real
 * conditional retry/terminal routing, but keyed on `errorType` (the thrown class's name)
 * matched statically at deploy time - never on this runtime boolean either. Whether SQS
 * consumers SHOULD start branching on `retryable` (e.g. route a known-terminal error straight
 * to DLQ instead of spending `maxReceiveCount` retries on it first) is a real, undecided
 * product/architecture question - not implemented here, not this session's call to make
 * unilaterally (Type 1, `AGENTS.md` §4/§1). This field is not useless: it is real,
 * meaningful classification metadata surfaced consistently in structured logs today, and the
 * substrate a future decision would build on - just not, as of this comment, itself deciding
 * SQS behavior.
 */
export class AppError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;

  constructor(options: AppErrorOptions) {
    super(options.message);
    this.name = "AppError";
    this.code = options.code;
    this.category = options.category;
    this.retryable = options.retryable;
    this.details = options.details;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
    Error.captureStackTrace?.(this, AppError);
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      category: this.category,
      message: this.message,
      retryable: this.retryable,
      details: this.details,
    };
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super({ code: "VALIDATION_FAILED", category: "VALIDATION", message, retryable: false, details });
    this.name = "ValidationError";
  }
}

export class AuthenticationError extends AppError {
  constructor(message = "Authentication required or invalid.", details?: Record<string, unknown>) {
    super({ code: "AUTH_REQUIRED", category: "AUTH", message, retryable: false, details });
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends AppError {
  constructor(message = "Not authorized for this resource.", details?: Record<string, unknown>) {
    super({ code: "AUTHORIZATION_DENIED", category: "AUTHORIZATION", message, retryable: false, details });
    this.name = "AuthorizationError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found.", details?: Record<string, unknown>) {
    super({ code: "NOT_FOUND", category: "NOT_FOUND", message, retryable: false, details });
    this.name = "NotFoundError";
  }
}

/** Wave B2B-11 (Responsibility + Notifications) - the target userId for an assignee/watcher
 * write is not an eligible member of the Organization (no Membership at all, or a Membership
 * that exists but is not ACTIVE, or a globally-suspended identity - see
 * `expiration/ports/member-eligibility.ts`). Mapped to the same NOT_FOUND category/404 as
 * `NotFoundError` deliberately (Codex round 1: never let the HTTP status distinguish "this
 * person exists but isn't eligible" from "no such person", which would let a caller enumerate
 * real userIds) - the distinction is a NAMED error class for internal logs/metrics only. */
export class IneligibleAssigneeError extends AppError {
  constructor(message = "Target user is not an eligible member of this organization.", details?: Record<string, unknown>) {
    super({ code: "INELIGIBLE_ASSIGNEE", category: "NOT_FOUND", message, retryable: false, details });
    this.name = "IneligibleAssigneeError";
  }
}

/** Version/state conflicts - OCC failures, duplicate creation, stale aggregate. */
export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super({ code: "CONFLICT", category: "CONFLICT", message, retryable: false, details });
    this.name = "ConflictError";
  }
}

export class QuotaExceededError extends AppError {
  constructor(message = "Quota exceeded.", details?: Record<string, unknown>) {
    super({ code: "QUOTA_EXCEEDED", category: "QUOTA_EXCEEDED", message, retryable: false, details });
    this.name = "QuotaExceededError";
  }
}

/** Downstream/provider failure - `retryable` defaults to true (throttling, timeout, 5xx are
 * worth retrying), but pass `false` for a genuinely ambiguous outcome (e.g. the BFF's own
 * UNKNOWN_OUTCOME refresh result, src/modules/bff/application/bff-auth-service.ts) where a
 * blind retry could race an already-rotated credential rather than just re-hit a flaky
 * dependency. */
export class DependencyUnavailableError extends AppError {
  constructor(message: string, details?: Record<string, unknown>, cause?: unknown, retryable = true) {
    super({ code: "DEPENDENCY_UNAVAILABLE", category: "DEPENDENCY_UNAVAILABLE", message, retryable, details, cause });
    this.name = "DependencyUnavailableError";
  }
}

export class InternalError extends AppError {
  constructor(message = "Internal error.", details?: Record<string, unknown>, cause?: unknown) {
    super({ code: "INTERNAL", category: "INTERNAL", message, retryable: false, details, cause });
    this.name = "InternalError";
  }
}

/**
 * M7 extraction/OCR taxonomy (`claude-reconciliation-final-design.md` §2 — the ASL's
 * `RunTextract` Catch block). Each `code` string below is NOT decorative — it MUST literally
 * match the corresponding `ErrorEquals` entry in `document-extraction.asl.json`, because
 * `TextractTaskHandler` reports failures via `SendTaskFailure({ error: <code> })` and Step
 * Functions matches Catch blocks on that exact string. Never rename one without the other.
 */

/** Heuristic classification (extension/magic-bytes/Document metadata) found no supported
 * Textract input format. Never retryable — the same bytes will classify the same way again. */
export class UnsupportedDocumentTypeError extends AppError {
  constructor(message = "Document type is not supported by the extraction pipeline.", details?: Record<string, unknown>) {
    super({ code: "UnsupportedDocumentType", category: "VALIDATION", message, retryable: false, details });
    this.name = "UnsupportedDocumentTypeError";
  }
}

/** The `OCR` AppConfig kill switch was off at the moment `RunTextract` executed. Per design
 * §1.5.1 this is a definitive "no OCR evidence for this pass", never a suspend-and-resume. */
export class OcrDisabledError extends AppError {
  constructor(message = "OCR is disabled by the feature-flags kill switch.", details?: Record<string, unknown>) {
    super({ code: "OcrDisabled", category: "DEPENDENCY_UNAVAILABLE", message, retryable: false, details });
    this.name = "OcrDisabledError";
  }
}

/** Textract itself rejected the document as an unsupported format/corrupt file at
 * `StartDocumentTextDetection` time (distinct from the pre-call heuristic classifier). */
export class TextractUnsupportedDocumentError extends AppError {
  constructor(message = "Textract rejected the document as unsupported.", details?: Record<string, unknown>) {
    super({ code: "TextractUnsupportedDocument", category: "VALIDATION", message, retryable: false, details });
    this.name = "TextractUnsupportedDocumentError";
  }
}

/** Textract job ended (or was read back) in a degraded state the handler cannot use as a
 * reliable OCR artifact — not `PARTIAL_SUCCESS` (which IS usable, per design §3), a harder
 * failure than that (e.g. `FAILED` job status). */
export class TextractPartialFailureError extends AppError {
  constructor(message = "Textract job did not complete usably.", details?: Record<string, unknown>) {
    super({ code: "TextractPartialFailure", category: "DEPENDENCY_UNAVAILABLE", message, retryable: false, details });
    this.name = "TextractPartialFailureError";
  }
}

/** `StartDocumentTextDetection` succeeded but persisting the `TextractJob` correlation record
 * failed even after the handler's own local retry (design §2, "Recuperação do intervalo") — the
 * Textract job is now orphaned (no waiting callback can ever resolve it), but the run itself
 * must not block on that: it falls through to the deterministic parser like any other
 * `RunTextract` failure. */
export class TextractJobPersistenceFailedError extends AppError {
  constructor(message = "Failed to persist TextractJob correlation record after StartDocumentTextDetection succeeded.", details?: Record<string, unknown>) {
    super({ code: "TextractJobPersistenceFailed", category: "DEPENDENCY_UNAVAILABLE", message, retryable: false, details });
    this.name = "TextractJobPersistenceFailedError";
  }
}

/** `PdfParserTaskHandler`'s `RunDeterministicParser` state (M7 item 5, D-035 §1.3) failed to
 * even attempt parsing (e.g. the OCR artifact was declared available but could not be read/
 * parsed as valid Textract block JSON). This is the ONE failure the ASL routes straight to
 * `MarkPendingConfirmation` without trying Bedrock (design §1.2) - the ASL's `Catch` for this
 * state is the generic `States.ALL`, so this `code` does not need to match a specific
 * `ErrorEquals` entry the way the Textract errors above do, but it still follows the same
 * normalized-taxonomy discipline (never a bare `Error`/`throw`). Never thrown just because no
 * candidate value was found - "no candidate" is a normal, successful parser outcome. */
export class DeterministicParserFailedError extends AppError {
  constructor(message = "Deterministic parser failed to process the OCR artifact.", details?: Record<string, unknown>) {
    super({ code: "DeterministicParserFailed", category: "INTERNAL", message, retryable: false, details });
    this.name = "DeterministicParserFailedError";
  }
}

/** `BedrockExtractionTaskHandler`'s `RunBedrock` state (M7 item 6, D-035 §1.9/§1.11) - the
 * `AI_EXTRACTION` kill switch was off (or unreadable, fail-closed) when the handler itself
 * checked it, even though the ASL's `CheckAiKillSwitch` Choice state already gates this path -
 * this is a defense-in-depth re-check, never the only gate. The ASL's `Catch` for `RunBedrock`
 * is the generic `States.ALL`, so this `code` does not need to match a specific `ErrorEquals`. */
export class AiExtractionDisabledError extends AppError {
  constructor(message = "AI_EXTRACTION kill switch is off; failing closed.", details?: Record<string, unknown>) {
    super({ code: "AiExtractionDisabled", category: "VALIDATION", message, retryable: false, details });
    this.name = "AiExtractionDisabledError";
  }
}

/** Bedrock Converse call failed, or the model's tool-call response could not be parsed/
 * validated against the closed `submit_extraction` schema (malformed/missing tool call, wrong
 * tool name, extra fields, token-limit truncation, etc. - design §1.11's adversarial corpus).
 * Never thrown just because the model reported low/no confidence for a field - that is a
 * normal, successful outcome (an empty or low-confidence candidate), not an error. */
export class BedrockExtractionFailedError extends AppError {
  constructor(message = "Bedrock extraction call failed or returned an unusable response.", details?: Record<string, unknown>) {
    super({ code: "BedrockExtractionFailed", category: "DEPENDENCY_UNAVAILABLE", message, retryable: false, details });
    this.name = "BedrockExtractionFailedError";
  }
}

/** `ExtractionValidationTaskHandler`'s `PERSIST_EXTRACTED_FIELDS`/`MARK_PENDING_CONFIRMATION`
 * operations (M7 item 7, D-035 §2/§3) failed to commit — a genuine DynamoDB error, not the
 * expected `DOCUMENT_DISCARDED` outcome (which is not an error at all, see
 * `run-extraction-validation.ts`). The ASL's `Catch` for these states is the generic
 * `States.ALL`, so this `code` does not need to match a specific `ErrorEquals` entry. */
export class ExtractionCommitFailedError extends AppError {
  constructor(message = "Failed to commit extraction run outcome.", details?: Record<string, unknown>, cause?: unknown) {
    super({ code: "ExtractionCommitFailed", category: "DEPENDENCY_UNAVAILABLE", message, retryable: true, details, cause });
    this.name = "ExtractionCommitFailedError";
  }
}

/** M7 item 8 (§1.7): request is well-formed, authorized, and every OCC version matched, but
 * the operation violates a business invariant — HTTP 422. `retryable: false` always: retrying
 * the identical request without changing anything about the world will fail identically. */
export class BusinessRuleError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super({ code: "BUSINESS_RULE_VIOLATION", category: "BUSINESS_RULE", message, retryable: false, details });
    this.name = "BusinessRuleError";
  }
}

/** W3-07 (D-067, `TenantBusinessMutation` lane, `src/shared/tenant-lifecycle/`): thrown when
 * a tenant-scoped business mutation's ConditionCheck against `TenantLifecycleRecord.status =
 * ACTIVE` fails — the tenant has entered DELETING (or has no lifecycle record at all, which
 * this codebase never expects once bootstrap always creates one). `retryable: false`: the
 * tenant is not coming back to ACTIVE, so retrying identically will fail identically. */
export class TenantNotActiveError extends AppError {
  constructor(message = "Tenant is not ACTIVE; mutation rejected.", details?: Record<string, unknown>) {
    super({ code: "TENANT_NOT_ACTIVE", category: "CONFLICT", message, retryable: false, details });
    this.name = "TenantNotActiveError";
  }
}

/** Wave B2B-5 (D-095, RequestContext Cutover): the identity itself is valid/active, but no
 * `ACTIVE` `Membership` exists yet to build a working `RequestContext` from — the caller must
 * be routed through onboarding, never treated as a hard authentication failure. Carries the
 * exact `OnboardingState` (`OnboardingStateResolver`, Wave B2B-4/D-094) so the HTTP/BFF layer
 * can distinguish "create an organization" from "you were suspended" instead of collapsing all
 * non-working states into one generic denial. */
export class OnboardingRequiredError extends AppError {
  constructor(
    readonly onboardingState: string,
    details?: Record<string, unknown>,
  ) {
    super({
      code: "ONBOARDING_REQUIRED",
      category: "AUTH",
      message: `No usable Membership for this identity (onboardingState=${onboardingState}).`,
      retryable: false,
      details: { ...details, onboardingState },
    });
    this.name = "OnboardingRequiredError";
  }
}

/** Wave B2B-5 (D-095, Codex Rodada 1 achado 2.2): `Membership.role` supports 4 values
 * (`OWNER|ADMIN|MEMBER|VIEWER`, `organization/domain/membership.ts`) but the real authorization
 * matrix (`identity/domain/authorization.ts`) only knows 3 until Wave B2B-7 ships the real
 * permission derivation. Thrown explicitly at the `RequestContext`-building boundary instead of
 * letting an unsupported role silently fail every `authorize()` check via the matrix's own
 * unsafe cast — loud, not silent, until the real policy exists. Unreachable today: the only
 * `Membership` writer (`CreateOrganizationService`) always grants `OWNER`. */
export class UnsupportedMembershipRoleError extends AppError {
  constructor(role: string, details?: Record<string, unknown>) {
    super({
      code: "UNSUPPORTED_MEMBERSHIP_ROLE",
      category: "INTERNAL",
      message: `Membership role "${role}" is not supported by the authorization matrix yet (Wave B2B-7).`,
      retryable: false,
      details: { ...details, role },
    });
    this.name = "UnsupportedMembershipRoleError";
  }
}

/** Wave B2B-8 (D-099, physical model §8): thrown when a transaction's `ownerCount > :one`
 * guard fails — the target `Membership` is the organization's last `ACTIVE` `OWNER`, and the
 * requested role-change/remove/leave would zero out `Organization.ownerCount`. Research
 * (GitHub/Slack/Notion, 2026-08-30) found this exact protection convergent across all 4
 * products consulted — this error is the UX-facing name for a mechanism already `APPROVED` in
 * D-086 §8, never exercised by a real writer until this wave. `retryable: false`: the caller
 * must promote a second `OWNER` first, not just retry. */
export class LastOwnerError extends AppError {
  constructor(message = "Cannot complete this action - the organization would be left with no OWNER. Promote another member to OWNER first.", details?: Record<string, unknown>) {
    super({ code: "LAST_OWNER", category: "BUSINESS_RULE", message, retryable: false, details });
    this.name = "LastOwnerError";
  }
}

/** Wave B2B-8 (D-099): a `membership:invite`/`membership:role-change`/`membership:remove` call
 * targets (or would create/promote to) the `OWNER` tier, but the caller's own role is not
 * `OWNER`. Distinct from the generic `AuthorizationDeniedError` (identity/domain/
 * authorization.ts) - the matrix baseline (`ADMIN_ROLES`) already let the caller attempt the
 * action; this is a named service-level check on top of it (research: Slack - only Owners
 * assign/demote Owners, no source shows an Admin touching the Owner tier). */
export class OwnerTierChangeRequiresOwnerError extends AppError {
  constructor(message = "Only an OWNER can invite, promote, or change the role of another OWNER.", details?: Record<string, unknown>) {
    super({ code: "OWNER_TIER_CHANGE_REQUIRES_OWNER", category: "AUTHORIZATION", message, retryable: false, details });
    this.name = "OwnerTierChangeRequiresOwnerError";
  }
}

/** Wave B2B-8 (D-099, physical model §7/§121 Q14): the `InvitationTokenPointer` resolved for an
 * `AcceptInvitation` call failed its transactional guard (`attribute_not_exists(consumedAt) AND
 * expiresAt > :now`) - deliberately generic naming (not `...AlreadyConsumed`): the failed
 * condition cannot distinguish replay from a token that expired in the narrow window between
 * the pre-transaction resolution and the transaction commit (Codex Rodada 2/3 achado,
 * docs/architecture/reviews/multi-user-b2b-wave-b2b8-scoping/), and claiming a specific cause
 * the check cannot prove would be a false diagnostic. */
export class InvitationTokenUnavailableError extends AppError {
  constructor(message = "This invitation link is no longer valid.", details?: Record<string, unknown>) {
    super({ code: "INVITATION_TOKEN_UNAVAILABLE", category: "CONFLICT", message, retryable: false, details });
    this.name = "InvitationTokenUnavailableError";
  }
}

/** Wave B2B-6 (D-101, physical model §11/§12): the caller's selected organization (via
 * `X-Organization-Id`, BFF-derived, or the BFF session's own `activeOrganizationId`) does not
 * resolve to a usable working context - the `Membership` isn't `ACTIVE`, or the `Organization`'s
 * own `TenantLifecycleRecord` isn't `ACTIVE`. `category: "AUTHORIZATION"` (403), not `CONFLICT`:
 * this is an access/context check at the RequestContext-building boundary, not a concurrent-
 * write conflict (research: DEV's x-tenant-id pattern returns 403 on membership mismatch, OWASP
 * Multi Tenant Security treats this as the "Tenant Context Injection" access-control class).
 * Replaces (does not coexist with) the pre-existing `AuthenticationError` this same lifecycle
 * check used to throw - a deliberate, small observable-contract fix (D-093: acceptable, no real
 * users/production). */
export class OrganizationUnavailableError extends AppError {
  constructor(message = "This organization is not available in your current context.", details?: Record<string, unknown>) {
    super({ code: "ORGANIZATION_UNAVAILABLE", category: "AUTHORIZATION", message, retryable: false, details });
    this.name = "OrganizationUnavailableError";
  }
}

/** Wave B2B-6 (D-101): the caller has more than one usable `Membership` (`ACTIVE` + its
 * Organization's `TenantLifecycleRecord` `ACTIVE`) and supplied no `X-Organization-Id` hint -
 * ambiguous, never "pick the first" (same fail-closed discipline as the rest of this codebase).
 * Replaces the `InternalError` this case used to throw before Wave B2B-8 made it reachable. */
export class OrganizationSelectionRequiredError extends AppError {
  constructor(message = "Multiple organizations are available; select one via X-Organization-Id.", details?: Record<string, unknown>) {
    // CONFLICT (409), not AUTHORIZATION - the caller IS allowed, the request is just
    // ambiguous (more than one valid Membership) without a disambiguating hint, closer to "the
    // request can't be completed as given" than to "access denied".
    super({ code: "ORGANIZATION_SELECTION_REQUIRED", category: "CONFLICT", message, retryable: false, details });
    this.name = "OrganizationSelectionRequiredError";
  }
}

/** W3-07 purge orchestrator (D-124, implementing D-121). `CloseOrganizationService` refuses to
 * act when the tenant's `TenantLifecycleRecord` already sits in VERIFIED/DELETED/BLOCKED/HELD —
 * the purge is either past the point of no return or stuck awaiting an operator, and re-launching
 * an execution for it would be nonsensical rather than merely redundant. `category:
 * "CONFLICT"` (409), same as `TenantNotActiveError`: this is a state-of-the-resource refusal, not
 * an authorization decision (the caller genuinely is an OWNER and genuinely may close the org —
 * it just is not in a closable state). `retryable: false`: no amount of retrying moves the record
 * back, only operator remediation of a BLOCKED/HELD tenant does. Deliberately does NOT cover
 * DELETING/QUIESCING/PURGING — those fall through to the unconditional idempotent
 * `StartExecution` retry (Rodada 3 Fix 8's corrected ordering). */
export class OrganizationClosureUnavailableError extends AppError {
  constructor(message = "This organization is already being closed, closed, or on hold - contact support.", details?: Record<string, unknown>) {
    super({ code: "ORGANIZATION_CLOSURE_UNAVAILABLE", category: "CONFLICT", message, retryable: false, details });
    this.name = "OrganizationClosureUnavailableError";
  }
}

/** D-122/D-125 (Responsibility Reassignment on Member Removal): thrown by
 * `RemoveMembershipService.remove()`/`LeaveOrganizationService.leave()` when `targetUserId` is
 * still `assigneeUserId` of at least one `ACTIVE` `ExpirationItem` in the organization
 * (`AssignedActiveItemsLookup`, `organization/ports/assigned-active-items-lookup.ts`). Explicitly
 * best-effort, NOT atomic (Round-3 "Estado final consolidado") - a synchronous read-then-decide
 * precondition before the removal transaction, not part of it; a rare concurrent reassignment
 * between the check and the transaction remains a residual, observed only via the existing
 * `MEMBER_REMOVED`/`MEMBER_LEFT` audit trail and B2B-11's notification-cancellation log, never a
 * new telemetry mechanism invented just for this case. `itemIds` is capped at 20 per
 * `AssignedActiveItemsLookup`'s pagination contract; `totalKnown`/`truncated` always reflect the
 * true count. `retryable: false`: the caller must reassign the flagged items first (via the
 * existing `updateItem` mutation, already validated by `MemberEligibilityChecker`), not just
 * retry the identical removal. */
export class ResponsibilityReassignmentRequiredError extends AppError {
  constructor(
    input: { targetUserId: string; itemIds: string[]; totalKnown: number; truncated: boolean },
    message = "Target user is still the assignee of active expiration items - reassign them before removing this member.",
  ) {
    super({
      code: "RESPONSIBILITY_REASSIGNMENT_REQUIRED",
      category: "BUSINESS_RULE",
      message,
      retryable: false,
      details: { ...input },
    });
    this.name = "ResponsibilityReassignmentRequiredError";
  }
}

/** Normalizes any thrown value into an AppError, for boundaries (handlers, workers). */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) {
    return err;
  }
  if (err instanceof Error) {
    return new InternalError(err.message, undefined, err);
  }
  return new InternalError("Non-Error value thrown.", { thrown: String(err) });
}

/** Classifies any thrown value's `retryable` flag (defaults to `false`/terminal for an
 * unclassified error, never `true`, to avoid treating an unknown failure as safe-to-retry
 * indefinitely per implementation-blueprint.md #6.2). See `AppError`'s own doc comment for the
 * honest current scope: this is NOT today's real SQS/DLQ routing decision (no real consumer
 * branches on it - see that comment for why), it is the classification itself, consulted for
 * logging/diagnosis and available for a future decision to actually drive routing on. */
export function isRetryable(err: unknown): boolean {
  return toAppError(err).retryable;
}

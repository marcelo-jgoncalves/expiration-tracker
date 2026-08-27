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
 * Base class for all normalized application errors. `retryable` drives SQS
 * consumer behavior (retry vs. terminal -> DLQ) per implementation-blueprint.md #6.2.
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

/** SQS/DLQ routing decision. Unknown/internal errors default to retryable=false (terminal) is wrong;
 * default to retryable=true only for explicitly-classified dependency failures, everything unknown is terminal
 * to avoid infinite poison-pill retries per implementation-blueprint.md #6.2. */
export function isRetryable(err: unknown): boolean {
  return toAppError(err).retryable;
}

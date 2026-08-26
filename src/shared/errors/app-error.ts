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
  | "INTERNAL";

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

/**
 * Typed error model - mirrors the exact discriminated shape every backend AppError already
 * serializes (src/shared/errors/app-error.ts's `.toJSON()`: {code, category, message,
 * retryable, details}), reused rather than reinvented (Frontend Production Foundation
 * mission §28: "se contratos já forem compartilháveis com backend: avaliar reutilização
 * segura"). Three categories below (NETWORK, UNKNOWN_OUTCOME, PROCESSING) have no backend
 * AppError equivalent - they describe failures that happen before/around a backend response
 * ever existing, which is a frontend-only concern.
 */

export type BackendErrorCategory =
  | "VALIDATION"
  | "AUTH"
  | "AUTHORIZATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "QUOTA_EXCEEDED"
  | "DEPENDENCY_UNAVAILABLE"
  | "BUSINESS_RULE"
  | "INTERNAL";

export type ErrorCategory = BackendErrorCategory | "NETWORK" | "UNKNOWN_OUTCOME" | "PROCESSING";

export interface ApiErrorShape {
  code: string;
  category: ErrorCategory;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

/**
 * Never reduce every failure to "Something went wrong" (mission §30) - every call site that
 * catches an ApiError has enough structure to render something specific: a NOT_FOUND can
 * offer "go back to the list", a CONFLICT can offer "reload the current state", an
 * UNKNOWN_OUTCOME can offer "check your list before retrying" instead of a blind retry
 * button (CREATE-IDEMPOTENCY-01's exact lesson, carried into the foundation).
 */
export class ApiError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;
  /** HTTP status, when one exists (absent for NETWORK failures that never got a response). */
  readonly status: number | undefined;

  constructor(shape: ApiErrorShape, status?: number) {
    super(shape.message);
    this.name = "ApiError";
    this.code = shape.code;
    this.category = shape.category;
    this.retryable = shape.retryable;
    this.details = shape.details;
    this.status = status;
  }

  /** The request never reached the backend at all (offline, DNS failure, CORS misconfig,
   * connection reset) - distinct from a backend that responded with an error. */
  static network(cause: unknown): ApiError {
    return new ApiError({
      code: "NETWORK_ERROR",
      category: "NETWORK",
      message: "Não foi possível conectar ao servidor.",
      retryable: true,
      details: { cause: String(cause) },
    });
  }

  /**
   * The request may or may not have succeeded (client-side timeout, connection reset mid-
   * response, response body truncated) - never collapsed into a generic failure (mission
   * §40: UNKNOWN_OUTCOME must exist explicitly even though item creation is now idempotent -
   * other operations, or a client-side timeout on ANY operation, can still produce this).
   * `retryable` is deliberately false at this generic level: a caller must decide per
   * operation whether blind retry is safe (see hooks/useIdempotentMutation.ts) - this class
   * itself must never make that call for every possible caller.
   */
  static unknownOutcome(cause: unknown): ApiError {
    return new ApiError({
      code: "UNKNOWN_OUTCOME",
      category: "UNKNOWN_OUTCOME",
      message: "Não foi possível confirmar o resultado desta operação.",
      retryable: false,
      details: { cause: String(cause) },
    });
  }

  /** The response body could not be parsed as the expected shape - a contract mismatch
   * between this frontend and the backend/BFF, not a domain error either side intended. */
  static processing(cause: unknown): ApiError {
    return new ApiError({
      code: "RESPONSE_PROCESSING_FAILED",
      category: "PROCESSING",
      message: "Não foi possível interpretar a resposta do servidor.",
      retryable: false,
      details: { cause: String(cause) },
    });
  }

  static fromResponseBody(body: unknown, status: number): ApiError {
    if (isApiErrorShape(body)) {
      return new ApiError(body, status);
    }
    return new ApiError(
      { code: "UNRECOGNIZED_ERROR_SHAPE", category: "INTERNAL", message: "Erro inesperado do servidor.", retryable: false, details: { status } },
      status,
    );
  }
}

function isApiErrorShape(value: unknown): value is ApiErrorShape {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v["code"] === "string" && typeof v["category"] === "string" && typeof v["message"] === "string" && typeof v["retryable"] === "boolean";
}

/** Distinguishes a genuine version/state conflict (OCC failure, D-053/§31: never collapsed
 * into a generic failure) from every other error category. */
export function isConflict(err: unknown): err is ApiError {
  return err instanceof ApiError && err.category === "CONFLICT";
}

export function isAuthError(err: unknown): err is ApiError {
  return err instanceof ApiError && (err.category === "AUTH" || err.category === "AUTHORIZATION");
}

export function isUnknownOutcome(err: unknown): err is ApiError {
  return err instanceof ApiError && err.category === "UNKNOWN_OUTCOME";
}

/** `LastOwnerError` (Wave B2B-8, D-099/D-100) - the organization's last ACTIVE OWNER can't
 * leave/be demoted/be removed. Checked by `code`, not just `category` - BUSINESS_RULE also
 * covers `OwnerTierChangeRequiresOwnerError` (`BUSINESS_RULE_VIOLATION`), a distinct case this
 * helper must not match. */
export function isLastOwnerError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.category === "BUSINESS_RULE" && err.code === "LAST_OWNER";
}

/** `ResponsibilityReassignmentRequiredError` (D-122/D-125) - `RemoveMembershipService`/
 * `LeaveOrganizationService` refused because the target is still the assignee of at least one
 * ACTIVE `ExpirationItem`. Same helper-parity pattern as `isLastOwnerError` (D-120) - minimal
 * error-message mapping only, no reassignment UI here (out of scope, future work). */
export function isResponsibilityReassignmentRequiredError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.category === "BUSINESS_RULE" && err.code === "RESPONSIBILITY_REASSIGNMENT_REQUIRED";
}

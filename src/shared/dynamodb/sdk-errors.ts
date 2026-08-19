/**
 * Translates raw AWS SDK v3 DynamoDB exceptions into the normalized taxonomy of
 * shared/errors/app-error.ts. Per docs/architecture/m3.5-runtime-design.md §"Adapters
 * DynamoDB reais": this is the ONLY place in the system that inspects SDK exception
 * shapes - callers above the adapter layer never see `ConditionalCheckFailedException`,
 * `TransactionCanceledException` etc. directly, keeping the rest of the system
 * SDK-agnostic (unchanged from M0-M3's design intent).
 */
import { DependencyUnavailableError, InternalError, ValidationError } from "../errors/app-error.js";
import { isConditionalCheckFailed, isTransactionCanceled } from "./occ.js";

const RETRYABLE_SDK_ERROR_NAMES = new Set([
  "ProvisionedThroughputExceededException",
  "ThrottlingException",
  "RequestLimitExceeded",
  "InternalServerError",
  "TimeoutError",
  "NetworkingError",
]);

const TERMINAL_VALIDATION_SDK_ERROR_NAMES = new Set([
  "ValidationException",
  "ItemCollectionSizeLimitExceededException",
]);

function sdkErrorName(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "name" in err) {
    return String((err as { name?: unknown }).name);
  }
  return undefined;
}

/**
 * Maps a raw error thrown by a DynamoDB SDK command into an AppError. Conditional-check
 * failures (`putIfAbsent` returning false, OCC `update` conflicts) are the CALLER's
 * responsibility to turn into `false`/`ConflictError` - this function is for everything
 * ELSE an adapter method doesn't already special-case, i.e. what to do at the bottom of a
 * try/catch after the known conditional-failure paths have been handled.
 */
export function mapDynamoError(err: unknown, operation: string): Error {
  const name = sdkErrorName(err);

  if (name === "AccessDeniedException") {
    // Terminal, operator-facing - never retried into a redrive loop (m3.5-runtime-design.md
    // fault injection table: "role tenant-facing recebe AccessDenied... nenhum retry infinito").
    return new InternalError(`DynamoDB access denied during ${operation}.`, { operation }, err);
  }
  if (name && TERMINAL_VALIDATION_SDK_ERROR_NAMES.has(name)) {
    return new ValidationError(`DynamoDB rejected ${operation}: ${name}.`, { operation, sdkErrorName: name });
  }
  if (name && RETRYABLE_SDK_ERROR_NAMES.has(name)) {
    return new DependencyUnavailableError(`DynamoDB ${operation} failed transiently.`, { operation, sdkErrorName: name }, err);
  }
  // Unknown SDK exception (including raw network/timeout errors with no `.name`, and
  // TransactionCanceledException left unmapped here because callers inspect
  // isTransactionCanceled()/isConditionalCheckFailed() themselves before reaching this
  // fallback) - treat as a retryable dependency failure rather than swallowing detail,
  // per sdk-errors' job of never hiding the cause.
  return new DependencyUnavailableError(`DynamoDB ${operation} failed.`, { operation, sdkErrorName: name }, err);
}

export { isConditionalCheckFailed, isTransactionCanceled };

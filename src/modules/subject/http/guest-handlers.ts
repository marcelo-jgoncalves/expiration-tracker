/**
 * HTTP handlers para /guest/document-requests/{token}* — 04-domain-model-guest-upload.md
 * (D-037). PRIMEIRA rota pública do projeto (sem JWT do Cognito) — o convidado nunca passa por
 * `RequestContextResolver`/`authorize()`, só por `GuestSubmissionService.resolveToken()`. Toda
 * falha retorna a MESMA resposta genérica (nunca revela se o token existe/expirou/foi revogado).
 */
import { AppError, ValidationError, toAppError } from "../../../shared/errors/app-error.js";
import { defaultSchemaRegistry } from "../../../shared/contracts/schema-validator.js";
import type { GuestSubmissionService, StartGuestSubmissionInput } from "../application/guest-submission-service.js";

function validateAgainstSchema(schemaId: string, body: unknown): void {
  const { valid, errors } = defaultSchemaRegistry.validate(schemaId, body);
  if (!valid) throw new ValidationError("Request body failed schema validation.", { errors });
}

const START_SUBMISSION_SCHEMA_ID = "https://expiration-tracker/schemas/api/start-guest-submission-request.v1.json";

export interface GuestHttpRequest<TBody = unknown> {
  pathParameters?: Record<string, string | undefined>;
  body?: TBody;
}

export interface GuestHttpResponse {
  statusCode: number;
  body: Record<string, unknown>;
}

export interface GuestHttpDeps {
  guestSubmissions: GuestSubmissionService;
}

const STATUS_BY_CATEGORY: Record<string, number> = {
  VALIDATION: 400,
  AUTH: 401,
  AUTHORIZATION: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  QUOTA_EXCEEDED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
  INTERNAL: 500,
};

function toResponse(appError: AppError): GuestHttpResponse {
  const status = STATUS_BY_CATEGORY[appError.category] ?? 500;
  return { statusCode: status, body: appError.toJSON() };
}

async function withErrorMapping(fn: () => Promise<GuestHttpResponse>): Promise<GuestHttpResponse> {
  try {
    return await fn();
  } catch (err) {
    return toResponse(err instanceof AppError ? err : toAppError(err));
  }
}

function requireToken(req: GuestHttpRequest): string {
  const token = req.pathParameters?.["token"];
  // Fail-closed genérico mesmo aqui - path parameter ausente não deveria acontecer via API
  // Gateway (rota exige {token}), mas nunca confiar nisso silenciosamente.
  if (!token) throw new ValidationError("Missing token path parameter.");
  return token;
}

export async function handleGetGuestRequest(deps: GuestHttpDeps, req: GuestHttpRequest): Promise<GuestHttpResponse> {
  return withErrorMapping(async () => {
    const token = requireToken(req);
    const info = await deps.guestSubmissions.getRequestInfo(token);
    return { statusCode: 200, body: { request: info } };
  });
}

export async function handleStartGuestSubmission(deps: GuestHttpDeps, req: GuestHttpRequest<StartGuestSubmissionInput>): Promise<GuestHttpResponse> {
  return withErrorMapping(async () => {
    const token = requireToken(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(START_SUBMISSION_SCHEMA_ID, req.body);
    const result = await deps.guestSubmissions.startSubmission(token, req.body);
    return { statusCode: 201, body: result as unknown as Record<string, unknown> };
  });
}

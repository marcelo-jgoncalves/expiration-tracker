/**
 * The single coherent layer for all BFF communication (Frontend Production Foundation
 * mission §27) - no component ever calls fetch() directly. Every request goes through
 * /bff/api/* (the BFF's allowlisted proxy, src/modules/bff/domain/proxy-allowlist.ts),
 * carries credentials (the session cookie) and, for mutating methods, the CSRF header the
 * BFF's triple-layer check requires (src/modules/bff/domain/csrf.ts).
 */
import { ApiError } from "./errors.js";

const CSRF_COOKIE_NAME = "__Host-et_csrf";
const DEFAULT_TIMEOUT_MS = 15_000;
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function readCookie(name: string): string | undefined {
  // Same convergence-on-failure discipline as the rest of this app: an unreadable cookie
  // (privacy mode blocking document.cookie access, etc.) must degrade to "no CSRF token
  // available" rather than throw and crash an unrelated request.
  try {
    const match = document.cookie.split("; ").find((row) => row.startsWith(`${name}=`));
    return match?.split("=")[1];
  } catch {
    return undefined;
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** One value per logical user submission (mission §33-35: never regenerated on retry of
   * the SAME intent, always regenerated for a NEW one) - see hooks/useIdempotentMutation.ts,
   * the only place that should actually generate one. Passed as the Idempotency-Key header,
   * matching the backend contract (src/modules/expiration/http/item-handlers.ts). */
  idempotencyKey?: string;
  /** If-Match header value for OCC-protected mutations (mission §31/§16). */
  expectedVersion?: number;
}

export interface ApiClientEvents {
  /** Fired once per request that receives a 401 - AuthContext subscribes to drive the
   * SESSION_EXPIRED/REAUTH_REQUIRED transition (mission §21-23). Never fired for a 403
   * (AUTHORIZATION) - that means "authenticated but not allowed", not "session is gone". */
  onUnauthorized?: () => void;
}

export class ApiClient {
  private events: ApiClientEvents;

  constructor(
    private readonly baseUrl: string = "/bff/api",
    events: ApiClientEvents = {},
  ) {
    this.events = events;
  }

  /** AuthProvider is the only caller (mission's one-way dependency: AuthContext never
   * imports ApiClient, ApiClient never imports AuthContext - this setter is the seam). */
  setOnUnauthorized(handler: () => void): void {
    this.events = { ...this.events, onUnauthorized: handler };
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? "GET";
    const isMutating = MUTATING_METHODS.has(method);

    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (isMutating) {
      const csrfToken = readCookie(CSRF_COOKIE_NAME);
      if (csrfToken) headers["x-csrf-token"] = csrfToken;
    }
    if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
    if (options.expectedVersion !== undefined) headers["if-match"] = String(options.expectedVersion);

    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    // A caller-supplied signal (e.g. React Query's own cancellation) aborts this request too,
    // without that ALSO looking like a timeout below.
    options.signal?.addEventListener("abort", () => controller.abort());

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        credentials: "include", // the session cookie IS the credential - never a bearer token, D-053
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (cause) {
      clearTimeout(timeout);
      const timedOut = controller.signal.aborted && !options.signal?.aborted;
      // A timed-out MUTATION is a genuine UNKNOWN_OUTCOME (CREATE-IDEMPOTENCY-01's exact
      // lesson: the request may have reached the backend and succeeded, we just never saw
      // the response) - a timed-out READ is safe to just call a network failure, reads have
      // no side effect to be ambiguous about.
      if (timedOut && isMutating) throw ApiError.unknownOutcome(cause);
      throw ApiError.network(cause);
    }
    clearTimeout(timeout);

    if (response.status === 401) {
      this.events.onUnauthorized?.();
    }

    if (response.status === 204) {
      return undefined as T;
    }

    let parsed: unknown;
    try {
      const text = await response.text();
      parsed = text ? JSON.parse(text) : undefined;
    } catch (cause) {
      throw ApiError.processing(cause);
    }

    if (!response.ok) {
      throw ApiError.fromResponseBody(parsed, response.status);
    }
    return parsed as T;
  }

  get<T>(path: string, options: Omit<RequestOptions, "method" | "body"> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: "GET" });
  }
  post<T>(path: string, body: unknown, options: Omit<RequestOptions, "method" | "body"> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: "POST", body });
  }
  put<T>(path: string, body: unknown, options: Omit<RequestOptions, "method" | "body"> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: "PUT", body });
  }
  delete<T>(path: string, options: Omit<RequestOptions, "method" | "body"> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: "DELETE" });
  }
}

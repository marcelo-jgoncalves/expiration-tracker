import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ApiClient } from "../../src/api/client.js";
import { ApiError } from "../../src/api/errors.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

describe("ApiClient", () => {
  beforeEach(() => {
    Object.defineProperty(document, "cookie", { writable: true, value: "" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("always sends credentials: include - the session cookie is the only credential (D-053)", async () => {
    let seenInit: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        seenInit = init;
        return jsonResponse({ ok: true });
      }),
    );
    const client = new ApiClient();
    await client.get("/items/dashboard");
    expect(seenInit?.credentials).toBe("include");
  });

  it("GET requests never include an X-CSRF-Token header (safe method, mission's CSRF rule)", async () => {
    document.cookie = "__Host-et_csrf=secret-csrf-value";
    let seenHeaders: Record<string, string> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        seenHeaders = init?.headers as Record<string, string>;
        return jsonResponse({});
      }),
    );
    await new ApiClient().get("/items/dashboard");
    expect(seenHeaders["x-csrf-token"]).toBeUndefined();
  });

  it("mutating requests attach X-CSRF-Token read from the non-HttpOnly cookie", async () => {
    document.cookie = "__Host-et_csrf=secret-csrf-value";
    let seenHeaders: Record<string, string> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        seenHeaders = init?.headers as Record<string, string>;
        return jsonResponse({});
      }),
    );
    await new ApiClient().post("/items", { name: "x" });
    expect(seenHeaders["x-csrf-token"]).toBe("secret-csrf-value");
  });

  it("attaches Idempotency-Key and If-Match headers when provided", async () => {
    let seenHeaders: Record<string, string> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        seenHeaders = init?.headers as Record<string, string>;
        return jsonResponse({});
      }),
    );
    await new ApiClient().post("/items", { name: "x" }, { idempotencyKey: "key-1", expectedVersion: 3 });
    expect(seenHeaders["idempotency-key"]).toBe("key-1");
    expect(seenHeaders["if-match"]).toBe("3");
  });

  it("a 204 response resolves to undefined, never attempts to parse a body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    const result = await new ApiClient().delete("/items/item-1");
    expect(result).toBeUndefined();
  });

  it("a non-ok response throws an ApiError built from the parsed backend error body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ code: "NOT_FOUND", category: "NOT_FOUND", message: "no such item", retryable: false }, { status: 404 })));
    await expect(new ApiClient().get("/items/missing")).rejects.toMatchObject({ category: "NOT_FOUND", status: 404 });
  });

  it("a network failure on a GET throws ApiError.network, never UNKNOWN_OUTCOME (reads have no side effect to be ambiguous about)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const err = await new ApiClient().get("/items/dashboard").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).category).toBe("NETWORK");
  });

  it("a client-side timeout on a MUTATING request throws UNKNOWN_OUTCOME, not a generic network error (CREATE-IDEMPOTENCY-01's exact lesson)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }),
    );
    const err = await new ApiClient().post("/items", { name: "x" }, { timeoutMs: 5 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).category).toBe("UNKNOWN_OUTCOME");
  });

  it("a client-side timeout on a READ (GET) throws NETWORK, not UNKNOWN_OUTCOME - a read has no side effect to be ambiguous about (found in review: only the mutation timeout path had a test)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }),
    );
    const err = await new ApiClient().get("/items/dashboard", { timeoutMs: 5 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).category).toBe("NETWORK");
  });

  it("calls onUnauthorized exactly once when a 401 is received, never for a 403", async () => {
    const onUnauthorized = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ code: "AUTH_REQUIRED", category: "AUTH", message: "m", retryable: false }, { status: 401 })));
    const client = new ApiClient("/bff/api", { onUnauthorized });
    await client.get("/items/dashboard").catch(() => {});
    expect(onUnauthorized).toHaveBeenCalledTimes(1);

    onUnauthorized.mockClear();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ code: "AUTHORIZATION_DENIED", category: "AUTHORIZATION", message: "m", retryable: false }, { status: 403 })));
    await client.get("/items/dashboard").catch(() => {});
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("setOnUnauthorized rewires the handler after construction (AuthProvider's wiring seam)", async () => {
    const first = vi.fn();
    const second = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ code: "AUTH_REQUIRED", category: "AUTH", message: "m", retryable: false }, { status: 401 })));
    const client = new ApiClient("/bff/api", { onUnauthorized: first });
    client.setOnUnauthorized(second);
    await client.get("/items/dashboard").catch(() => {});
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

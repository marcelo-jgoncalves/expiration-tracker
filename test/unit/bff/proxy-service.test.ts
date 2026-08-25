import { describe, expect, it } from "vitest";
import { ProxyService, type BackendFetcher } from "../../../src/modules/bff/application/proxy-service.js";
import { NotFoundError } from "../../../src/shared/errors/app-error.js";
import type { Session } from "../../../src/modules/bff/domain/session.js";

function fakeSession(overrides: Partial<Session> = {}): Session {
  return {
    PK: "SESSION#x",
    SK: "POINTER",
    entityType: "Session",
    selectorHash: "x",
    secretHash: "y",
    tenantId: "tenant-1",
    userId: "user-1",
    cognitoSubject: "sub-1",
    deviceId: "device-1",
    csrfSecret: "csrf-1",
    encryptedRefreshToken: "enc",
    accessToken: "the-access-token",
    accessTokenExpiresAt: "2026-01-01T00:00:00.000Z",
    absoluteExpiresAt: "2026-02-01T00:00:00.000Z",
    purgeAfterTtl: 0,
    refreshState: "IDLE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

describe("ProxyService", () => {
  it("rejects a request to a non-allowlisted route without ever calling the backend", async () => {
    let called = false;
    const backend: BackendFetcher = { fetch: async () => { called = true; return { statusCode: 200, headers: {}, body: "{}" }; } };
    const proxy = new ProxyService(backend, "https://api.example.com");
    await expect(proxy.forward(fakeSession(), { method: "GET", path: "/admin/secret", headers: {} })).rejects.toBeInstanceOf(NotFoundError);
    expect(called).toBe(false);
  });

  it("rejects /guest/* even though it is a real backend route - never forwarded via the authenticated proxy", async () => {
    let called = false;
    const backend: BackendFetcher = { fetch: async () => { called = true; return { statusCode: 200, headers: {}, body: "{}" }; } };
    const proxy = new ProxyService(backend, "https://api.example.com");
    await expect(proxy.forward(fakeSession(), { method: "GET", path: "/guest/document-requests/tok-1", headers: {} })).rejects.toBeInstanceOf(NotFoundError);
    expect(called).toBe(false);
  });

  it("attaches the session's access token as Bearer, never a token the browser could have supplied", async () => {
    let seenHeaders: Record<string, string> = {};
    const backend: BackendFetcher = {
      fetch: async (input) => {
        seenHeaders = input.headers;
        return { statusCode: 200, headers: {}, body: "{}" };
      },
    };
    const proxy = new ProxyService(backend, "https://api.example.com");
    await proxy.forward(fakeSession({ accessToken: "server-side-secret-token" }), { method: "GET", path: "/items/dashboard", headers: {} });
    expect(seenHeaders["authorization"]).toBe("Bearer server-side-secret-token");
  });

  it("only forwards allowlisted request headers, never an arbitrary header the client sent", async () => {
    let seenHeaders: Record<string, string> = {};
    const backend: BackendFetcher = {
      fetch: async (input) => {
        seenHeaders = input.headers;
        return { statusCode: 200, headers: {}, body: "{}" };
      },
    };
    const proxy = new ProxyService(backend, "https://api.example.com");
    await proxy.forward(fakeSession(), {
      method: "PUT",
      path: "/items/item-1",
      headers: { "content-type": "application/json", "if-match": "3", "x-forwarded-for": "1.2.3.4", cookie: "should-never-be-forwarded=1" },
    });
    expect(seenHeaders["content-type"]).toBe("application/json");
    expect(seenHeaders["if-match"]).toBe("3");
    expect(seenHeaders["x-forwarded-for"]).toBeUndefined();
    expect(seenHeaders["cookie"]).toBeUndefined();
  });

  it("forwards idempotency-key so CREATE-IDEMPOTENCY-01 protection reaches the backend (ADR-0011)", async () => {
    let seenHeaders: Record<string, string> = {};
    const backend: BackendFetcher = {
      fetch: async (input) => {
        seenHeaders = input.headers;
        return { statusCode: 201, headers: {}, body: "{}" };
      },
    };
    const proxy = new ProxyService(backend, "https://api.example.com");
    await proxy.forward(fakeSession(), {
      method: "POST",
      path: "/items",
      headers: { "content-type": "application/json", "idempotency-key": "client-generated-key-1" },
    });
    expect(seenHeaders["idempotency-key"]).toBe("client-generated-key-1");
  });

  it("only forwards allowlisted response headers back to the browser", async () => {
    const backend: BackendFetcher = {
      fetch: async () => ({ statusCode: 200, headers: { "content-type": "application/json", etag: '"v1"', "x-amzn-requestid": "internal-id" }, body: "{}" }),
    };
    const proxy = new ProxyService(backend, "https://api.example.com");
    const result = await proxy.forward(fakeSession(), { method: "GET", path: "/items/item-1", headers: {} });
    expect(result.headers["content-type"]).toBe("application/json");
    expect(result.headers["etag"]).toBe('"v1"');
    expect(result.headers["x-amzn-requestid"]).toBeUndefined();
  });

  it("builds the backend URL from apiBaseUrl + path + query string", async () => {
    let seenUrl = "";
    const backend: BackendFetcher = {
      fetch: async (input) => {
        seenUrl = input.url;
        return { statusCode: 200, headers: {}, body: "{}" };
      },
    };
    const proxy = new ProxyService(backend, "https://api.example.com");
    await proxy.forward(fakeSession(), { method: "GET", path: "/items/dashboard", queryString: "status=overdue", headers: {} });
    expect(seenUrl).toBe("https://api.example.com/items/dashboard?status=overdue");
  });
});

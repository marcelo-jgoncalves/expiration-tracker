/**
 * Regression test for a real production bug found via a live `aws lambda invoke` smoke test
 * against the deployed notifications-handler: `schema-validator.ts`'s `defaultSchemaRegistry`
 * only knows the schemas explicitly listed as static imports (required for the esbuild-cjs
 * Lambda bundle, since `import.meta.url`-based directory walking resolves zero schemas at
 * real cold start - see that file's own comment). The new
 * `update-notification-preferences-request.v1.json` schema was added to disk but NOT to that
 * static list, so every real `PUT /notifications/preferences` failed with 500 "Unknown
 * schema $id" - never caught by test/contract/schemas.test.ts, which validates against
 * `loadAllSchemasFromDisk()` (a different registry, used only by tests/validate-schemas, not
 * by any real handler).
 *
 * This test exercises the REAL handler pipeline (handleUpdatePreferences ->
 * defaultSchemaRegistry, the actual singleton every Lambda imports) end to end, so a future
 * new schema that's added to disk but not registered there would fail this test the same way
 * it failed in production.
 */
import { describe, expect, it } from "vitest";
import { InMemoryNotificationStore } from "./in-memory-store.js";
import { InMemoryIdentityStore, makeIdGenerator } from "../identity/in-memory-store.js";
import { RequestContextResolver, type ValidatedClaims } from "../../../src/modules/identity/application/resolve-request-context.js";
import { IdentityMappingRepository } from "../../../src/modules/identity/persistence/identity-mapping-repository.js";
import { UserRepository } from "../../../src/modules/identity/persistence/user-repository.js";
import { TenantQuotaService } from "../../../src/modules/identity/application/quota.js";
import { NotificationPreferencesService } from "../../../src/modules/notification/application/notification-preferences-service.js";
import { handleGetPreferences, handleUpdatePreferences, type NotificationHttpDeps } from "../../../src/modules/notification/http/preferences-handlers.js";

const TABLE = "MainTable";

function buildDeps(): NotificationHttpDeps {
  const identityStore = new InMemoryIdentityStore();
  const resolver = new RequestContextResolver(new IdentityMappingRepository(identityStore), new UserRepository(identityStore), makeIdGenerator());
  const quota = new TenantQuotaService(identityStore);
  const preferences = new NotificationPreferencesService({
    store: new InMemoryNotificationStore(),
    tableName: TABLE,
    now: () => "2026-08-21T00:00:00.000Z",
  });
  return { resolver, preferences, quota };
}

function claims(overrides: Partial<ValidatedClaims> = {}): ValidatedClaims {
  return {
    sub: "cognito-sub-1",
    tokenId: "jti-1",
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

describe("preferences-handlers.ts - real defaultSchemaRegistry wiring", () => {
  it("handleUpdatePreferences accepts a valid body through the REAL schema registry every Lambda imports (regression: catches a schema added to disk but never registered)", async () => {
    const deps = buildDeps();
    const response = await handleUpdatePreferences(deps, {
      requestId: "r1",
      correlationId: "c1",
      claims: claims(),
      headers: { "if-match": "1" },
      body: { emailEnabled: false, locale: "en-US", quietHours: null },
    });

    expect(response.statusCode).toBe(200);
    expect((response.body["preferences"] as { emailEnabled: boolean }).emailEnabled).toBe(false);
  });

  it("handleGetPreferences lazily creates and returns the caller's own preferences", async () => {
    const deps = buildDeps();
    const response = await handleGetPreferences(deps, { requestId: "r1", correlationId: "c1", claims: claims() });
    expect(response.statusCode).toBe(200);
    expect((response.body["preferences"] as { emailEnabled: boolean }).emailEnabled).toBe(true);
  });

  it("handleUpdatePreferences rejects a body that fails schema validation (extra unknown field)", async () => {
    const deps = buildDeps();
    const response = await handleUpdatePreferences(deps, {
      requestId: "r1",
      correlationId: "c1",
      claims: claims(),
      headers: { "if-match": "1" },
      body: { emailEnabled: false, locale: "en-US", quietHours: null, unknownField: "nope" } as never,
    });
    expect(response.statusCode).toBe(400);
  });
});

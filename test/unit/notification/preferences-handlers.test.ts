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
import { describe, expect, it, vi } from "vitest";
import * as securityAudit from "../../../src/shared/observability/security-audit.js";
import { InMemoryNotificationStore } from "./in-memory-store.js";
import { InMemoryIdentityStore, makeIdGenerator, bootstrapWithOrganization } from "../identity/in-memory-store.js";
import { InMemoryOrganizationStore } from "../organization/in-memory-store.js";
import { RequestContextResolver, type ValidatedClaims } from "../../../src/modules/identity/application/resolve-request-context.js";
import { UserRepository } from "../../../src/modules/identity/persistence/user-repository.js";
import { GlobalUserRepository } from "../../../src/modules/identity/persistence/global-user-repository.js";
import { TenantQuotaService } from "../../../src/modules/identity/application/quota.js";
import { NotificationPreferencesService } from "../../../src/modules/notification/application/notification-preferences-service.js";
import { handleGetPreferences, handleUpdatePreferences, type NotificationHttpDeps } from "../../../src/modules/notification/http/preferences-handlers.js";
import { tenantLifecycleKey } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";

const TABLE = "MainTable";

async function buildDeps(): Promise<NotificationHttpDeps & { identityStore: InMemoryIdentityStore }> {
  const identityStore = new InMemoryIdentityStore();
  const organizations = new InMemoryOrganizationStore();
  // Wave B2B-5 (D-095): bootstrapUser() no longer auto-provisions a tenant - seed a real
  // Organization+Membership for "cognito-sub-1" before any handler call can resolve.
  await bootstrapWithOrganization(identityStore, organizations, TABLE, "cognito-sub-1");
  const resolver = new RequestContextResolver(new UserRepository(identityStore), new GlobalUserRepository(identityStore), organizations, makeIdGenerator(), identityStore, TABLE);
  const quota = new TenantQuotaService(identityStore, TABLE);
  const preferences = new NotificationPreferencesService({
    store: new InMemoryNotificationStore(),
    tableName: TABLE,
    now: () => "2026-08-21T00:00:00.000Z",
  });
  return { resolver, preferences, quota, identityStore };
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
    const deps = await buildDeps();
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
    const deps = await buildDeps();
    const response = await handleGetPreferences(deps, { requestId: "r1", correlationId: "c1", claims: claims() });
    expect(response.statusCode).toBe(200);
    expect((response.body["preferences"] as { emailEnabled: boolean }).emailEnabled).toBe(true);
  });

  it("handleUpdatePreferences rejects a body that fails schema validation (extra unknown field)", async () => {
    const deps = await buildDeps();
    const response = await handleUpdatePreferences(deps, {
      requestId: "r1",
      correlationId: "c1",
      claims: claims(),
      headers: { "if-match": "1" },
      body: { emailEnabled: false, locale: "en-US", quietHours: null, unknownField: "nope" } as never,
    });
    expect(response.statusCode).toBe(400);
  });

  it("emits exactly one security.authorization_denied event on a real authorize() denial, without changing the 403 response", async () => {
    const auditSpy = vi.spyOn(securityAudit, "auditAuthorizationDenied");
    const deps = await buildDeps();
    // W3-07 fence (D-068/D-069 follow-up): quota.consume() now requires a
    // TenantLifecycleRecord for "tenant-x" - this stub resolver bypasses the real bootstrap
    // flow that would normally create one, so seed it directly.
    await deps.identityStore.putIfAbsent({
      ...tenantLifecycleKey("tenant-x"),
      entityType: "TenantLifecycleRecord",
      tenantId: "tenant-x",
      status: "ACTIVE",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:00.000Z",
      version: 1,
    });
    const noRoleResolver = {
      resolve: async () => ({
        tenant: { tenantId: "tenant-x", roles: [] },
        principal: { userId: "user-x" },
        requestId: "r1",
      }),
    } as unknown as NotificationHttpDeps["resolver"];

    const response = await handleGetPreferences({ ...deps, resolver: noRoleResolver }, { requestId: "r1", correlationId: "c1", claims: claims() });

    expect(response.statusCode).toBe(403);
    expect(auditSpy).toHaveBeenCalledTimes(1);
    expect(auditSpy).toHaveBeenCalledWith({ reason: "NO_MEMBERSHIP", action: "notification:configure" });
    auditSpy.mockRestore();
  });
});

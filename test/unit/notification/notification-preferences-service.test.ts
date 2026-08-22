import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryNotificationStore } from "./in-memory-store.js";
import { NotificationPreferencesService } from "../../../src/modules/notification/application/notification-preferences-service.js";
import { AuthorizationDeniedError } from "../../../src/modules/identity/domain/authorization.js";
import { ConflictError } from "../../../src/shared/errors/app-error.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";

const TENANT = "t1";
const USER = "u1";
const TABLE = "MainTable";

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: USER, cognitoSubject: "sub-u1", sessionId: "s1" },
    tenant: { tenantId: TENANT, roles: ["OWNER"] },
    auth: { issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), tokenId: "jti-1" },
    ...overrides,
  };
}

describe("NotificationPreferencesService", () => {
  let store: InMemoryNotificationStore;
  let service: NotificationPreferencesService;

  beforeEach(() => {
    store = new InMemoryNotificationStore();
    service = new NotificationPreferencesService({ store, tableName: TABLE, now: () => "2026-08-21T00:00:00.000Z" });
  });

  it("getOrCreatePreferences lazily creates the documented default when no record exists yet (onboarding never wired this)", async () => {
    const preferences = await service.getOrCreatePreferences(ctx());
    expect(preferences.emailEnabled).toBe(true);
    expect(preferences.consentSource).toBe("MIGRATED_DEFAULT");
    expect(preferences.version).toBe(1);
    expect(preferences.tenantId).toBe(TENANT);
    expect(preferences.userId).toBe(USER);

    // Calling it again returns the SAME record, not a second create.
    const again = await service.getOrCreatePreferences(ctx());
    expect(again.version).toBe(1);
    expect(store.allItems()).toHaveLength(1);
  });

  it("getOrCreatePreferences enforces the authorization matrix (no membership => denied)", async () => {
    await expect(service.getOrCreatePreferences(ctx({ tenant: { tenantId: TENANT, roles: [] } }))).rejects.toBeInstanceOf(
      AuthorizationDeniedError,
    );
  });

  it("updatePreferences creates the record on first use, then applies the update in the same call", async () => {
    const updated = await service.updatePreferences(
      ctx(),
      { emailEnabled: false, locale: "en-US", quietHours: { enabled: true, startLocal: "22:00", endLocal: "07:00", timeZone: "UTC" } },
      1,
    );
    expect(updated.emailEnabled).toBe(false);
    expect(updated.locale).toBe("en-US");
    expect(updated.quietHours).toEqual({ enabled: true, startLocal: "22:00", endLocal: "07:00", timeZone: "UTC" });
    expect(updated.consentSource).toBe("USER_SETTINGS");
    expect(updated.version).toBe(2);
  });

  it("updatePreferences rejects a stale expectedVersion with a version-conflict error", async () => {
    await service.getOrCreatePreferences(ctx()); // creates version 1
    await service.updatePreferences(ctx(), { emailEnabled: true, locale: "pt-BR", quietHours: null }, 1); // -> version 2

    await expect(
      service.updatePreferences(ctx(), { emailEnabled: false, locale: "pt-BR", quietHours: null }, 1),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("updatePreferences can clear quietHours back to null", async () => {
    await service.updatePreferences(
      ctx(),
      { emailEnabled: true, locale: "pt-BR", quietHours: { enabled: true, startLocal: "22:00", endLocal: "07:00", timeZone: "UTC" } },
      1,
    );
    const cleared = await service.updatePreferences(ctx(), { emailEnabled: true, locale: "pt-BR", quietHours: null }, 2);
    expect(cleared.quietHours).toBeNull();
  });
});

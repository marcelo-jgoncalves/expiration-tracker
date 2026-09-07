import { describe, expect, it } from "vitest";
import { InMemoryIdentityStore } from "./in-memory-store.js";
import { GlobalUserRepository, globalUserKey, type GlobalUser } from "../../../src/modules/identity/persistence/global-user-repository.js";
import { ValidationError, NotFoundError } from "../../../src/shared/errors/app-error.js";

function seedUser(store: InMemoryIdentityStore, userId: string): GlobalUser {
  const key = globalUserKey(userId);
  const user: GlobalUser = {
    PK: key.PK,
    SK: "PROFILE",
    entityType: "GlobalUser",
    userId,
    emailNormalized: `${userId}@example.com`,
    identityStatus: "ACTIVE",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    version: 1,
  };
  store.seedRaw(user as unknown as Record<string, unknown> & { PK: string; SK: string });
  return user;
}

describe("GlobalUserRepository.setPhoneNumber", () => {
  it("persists a valid E.164 phone number", async () => {
    const store = new InMemoryIdentityStore();
    seedUser(store, "u1");
    const repo = new GlobalUserRepository(store, () => "2026-09-07T00:00:00.000Z");

    const updated = await repo.setPhoneNumber("u1", "+15551234567");
    expect(updated.phoneE164).toBe("+15551234567");
    expect(updated.updatedAt).toBe("2026-09-07T00:00:00.000Z");

    const reread = await repo.get("u1");
    expect(reread?.phoneE164).toBe("+15551234567");
  });

  // G-V3: a malformed number must be rejected BEFORE any read/write - never partially applied,
  // never stored in any form.
  it("rejects a malformed phone number before touching the store", async () => {
    const store = new InMemoryIdentityStore();
    seedUser(store, "u1");
    const repo = new GlobalUserRepository(store, () => "2026-09-07T00:00:00.000Z");

    await expect(repo.setPhoneNumber("u1", "555-1234")).rejects.toBeInstanceOf(ValidationError);

    const reread = await repo.get("u1");
    expect(reread?.phoneE164).toBeUndefined();
    expect(reread?.updatedAt).toBe("2026-09-01T00:00:00.000Z"); // untouched
  });

  it("rejects setting a phone number on a nonexistent user", async () => {
    const store = new InMemoryIdentityStore();
    const repo = new GlobalUserRepository(store);
    await expect(repo.setPhoneNumber("ghost", "+15551234567")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("overwrites a previous phone number on re-set (current-number semantics, not append)", async () => {
    const store = new InMemoryIdentityStore();
    seedUser(store, "u1");
    const repo = new GlobalUserRepository(store, () => "2026-09-07T00:00:00.000Z");

    await repo.setPhoneNumber("u1", "+15551234567");
    const second = await repo.setPhoneNumber("u1", "+15559999999");
    expect(second.phoneE164).toBe("+15559999999");

    const reread = await repo.get("u1");
    expect(reread?.phoneE164).toBe("+15559999999");
  });
});

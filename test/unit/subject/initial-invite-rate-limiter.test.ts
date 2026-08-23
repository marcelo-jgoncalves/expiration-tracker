import { describe, expect, it } from "vitest";
import { InMemorySubjectStore } from "./in-memory-store.js";
import { InitialInviteRateLimiter } from "../../../src/modules/subject/application/initial-invite-rate-limiter.js";
import { QuotaExceededError } from "../../../src/shared/errors/app-error.js";

describe("InitialInviteRateLimiter (M10 cluster 4, D-049)", () => {
  it("allows requests under all three limits", async () => {
    const store = new InMemorySubjectStore();
    const limiter = new InitialInviteRateLimiter(store, () => "2026-08-23T12:00:00.000Z");
    await expect(limiter.consumeInitialInvite("tenant-1", "vendor@example.com")).resolves.toBeUndefined();
  });

  it("blocks the 4th request to the SAME recipient within 24h (per-recipient limit of 3)", async () => {
    const store = new InMemorySubjectStore();
    const limiter = new InitialInviteRateLimiter(store, () => "2026-08-23T12:00:00.000Z");
    for (let i = 0; i < 3; i++) {
      await limiter.consumeInitialInvite("tenant-1", "vendor@example.com");
    }
    await expect(limiter.consumeInitialInvite("tenant-1", "vendor@example.com")).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it("per-recipient limit does not block a DIFFERENT recipient of the same tenant", async () => {
    const store = new InMemorySubjectStore();
    const limiter = new InitialInviteRateLimiter(store, () => "2026-08-23T12:00:00.000Z");
    for (let i = 0; i < 3; i++) {
      await limiter.consumeInitialInvite("tenant-1", "vendor-a@example.com");
    }
    await expect(limiter.consumeInitialInvite("tenant-1", "vendor-b@example.com")).resolves.toBeUndefined();
  });

  it("blocks the 21st request within the hourly tenant limit (20/h)", async () => {
    const store = new InMemorySubjectStore();
    const limiter = new InitialInviteRateLimiter(store, () => "2026-08-23T12:00:00.000Z");
    // 20 distinct recipients so the per-recipient limit (3/24h) never trips first.
    for (let i = 0; i < 20; i++) {
      await limiter.consumeInitialInvite("tenant-1", `vendor-${i}@example.com`);
    }
    await expect(limiter.consumeInitialInvite("tenant-1", "vendor-21@example.com")).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it("never leaks the recipient hash or tenant id in the thrown error's details", async () => {
    const store = new InMemorySubjectStore();
    const limiter = new InitialInviteRateLimiter(store, () => "2026-08-23T12:00:00.000Z");
    for (let i = 0; i < 3; i++) {
      await limiter.consumeInitialInvite("tenant-1", "vendor@example.com");
    }
    try {
      await limiter.consumeInitialInvite("tenant-1", "vendor@example.com");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(QuotaExceededError);
      expect(JSON.stringify((err as QuotaExceededError).toJSON())).not.toContain("vendor@example.com");
    }
  });
});

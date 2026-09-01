import { describe, expect, it } from "vitest";
import { DocumentArchiveGuestRateLimiter } from "../../../src/modules/document-archive/application/document-archive-guest-rate-limiter.js";
import { QuotaExceededError } from "../../../src/shared/errors/app-error.js";
import { InMemoryDocumentArchiveStore } from "./in-memory-store.js";

describe("DocumentArchiveGuestRateLimiter (D-143 Decision 4: multidimensional requestId+IP, D-146)", () => {
  it("allows calls under the limit", async () => {
    const limiter = new DocumentArchiveGuestRateLimiter(new InMemoryDocumentArchiveStore(), () => "2026-09-01T00:00:00.000Z");
    for (let i = 0; i < 3; i++) {
      await expect(limiter.consumeBoth({ requestKey: "sel-1", ip: "1.2.3.4", limit: 5, windowSeconds: 60 })).resolves.toBeUndefined();
    }
  });

  it("throws QuotaExceededError once the requestKey dimension is exhausted", async () => {
    const limiter = new DocumentArchiveGuestRateLimiter(new InMemoryDocumentArchiveStore(), () => "2026-09-01T00:00:00.000Z");
    for (let i = 0; i < 2; i++) {
      await limiter.consumeBoth({ requestKey: "sel-2", ip: `9.9.9.${i}`, limit: 2, windowSeconds: 60 });
    }
    await expect(limiter.consumeBoth({ requestKey: "sel-2", ip: "9.9.9.99", limit: 2, windowSeconds: 60 })).rejects.toThrow(QuotaExceededError);
  });

  it("throws QuotaExceededError once the IP dimension is exhausted, even with a fresh requestKey each time", async () => {
    const limiter = new DocumentArchiveGuestRateLimiter(new InMemoryDocumentArchiveStore(), () => "2026-09-01T00:00:00.000Z");
    for (let i = 0; i < 2; i++) {
      await limiter.consumeBoth({ requestKey: `sel-fresh-${i}`, ip: "5.5.5.5", limit: 2, windowSeconds: 60 });
    }
    await expect(limiter.consumeBoth({ requestKey: "sel-fresh-final", ip: "5.5.5.5", limit: 2, windowSeconds: 60 })).rejects.toThrow(QuotaExceededError);
  });

  it("never includes the correlatable key in the thrown error's details (anti-enumeration)", async () => {
    const limiter = new DocumentArchiveGuestRateLimiter(new InMemoryDocumentArchiveStore(), () => "2026-09-01T00:00:00.000Z");
    await limiter.consumeBoth({ requestKey: "sel-3", ip: "1.1.1.1", limit: 1, windowSeconds: 60 });
    try {
      await limiter.consumeBoth({ requestKey: "sel-3", ip: "1.1.1.2", limit: 1, windowSeconds: 60 });
      throw new Error("expected QuotaExceededError");
    } catch (err) {
      expect(err).toBeInstanceOf(QuotaExceededError);
      expect((err as QuotaExceededError).details).toBeUndefined();
    }
  });

  it("resets after the window expires (fresh window, same key)", async () => {
    let now = "2026-09-01T00:00:00.000Z";
    const limiter = new DocumentArchiveGuestRateLimiter(new InMemoryDocumentArchiveStore(), () => now);
    await limiter.consumeBoth({ requestKey: "sel-4", ip: "2.2.2.2", limit: 1, windowSeconds: 60 });
    await expect(limiter.consumeBoth({ requestKey: "sel-4", ip: "2.2.2.3", limit: 1, windowSeconds: 60 })).rejects.toThrow(QuotaExceededError);
    now = "2026-09-01T00:02:00.000Z"; // 2 minutes later, window (60s) has expired.
    await expect(limiter.consumeBoth({ requestKey: "sel-4", ip: "2.2.2.4", limit: 1, windowSeconds: 60 })).resolves.toBeUndefined();
  });
});

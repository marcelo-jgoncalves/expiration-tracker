import { describe, expect, it } from "vitest";
import {
  buildWhatsAppPortfolioQuotaEntry,
  evaluateWhatsAppPortfolioQuota,
  whatsAppPortfolioQuotaKey,
  whatsAppPortfolioQuotaWindowEndSk,
  whatsAppPortfolioQuotaWindowStartSk,
} from "../../../src/modules/notification/domain/whatsapp-portfolio-quota.js";

describe("whatsAppPortfolioQuotaKey", () => {
  it("PK is the tenantless portfolio partition, SK is time-first then phone", () => {
    const key = whatsAppPortfolioQuotaKey("2026-09-10T12:00:00.000Z", "+15551234567");
    expect(key).toEqual({ PK: "WHATSAPP#PORTFOLIO", SK: "SENT#2026-09-10T12:00:00.000Z#+15551234567" });
  });
});

describe("buildWhatsAppPortfolioQuotaEntry", () => {
  it("TTL is sentAt + 25h (24h window + 1h grace), in epoch seconds", () => {
    const entry = buildWhatsAppPortfolioQuotaEntry({ sentAtIso: "2026-09-10T12:00:00.000Z", phoneE164: "+15551234567" });
    expect(entry.purgeAfterTtl).toBe(Math.floor(Date.parse("2026-09-11T13:00:00.000Z") / 1000));
    expect(entry.entityType).toBe("WhatsAppPortfolioQuotaEntry");
  });
});

describe("whatsAppPortfolioQuotaWindowStartSk / windowEndSk", () => {
  it("bounds a real 24h range ending at now", () => {
    const start = whatsAppPortfolioQuotaWindowStartSk("2026-09-10T12:00:00.000Z");
    const end = whatsAppPortfolioQuotaWindowEndSk("2026-09-10T12:00:00.000Z");
    expect(start).toBe("SENT#2026-09-09T12:00:00.000Z");
    expect(end.startsWith("SENT#2026-09-10T12:00:00.000Z")).toBe(true);
    expect(start < end).toBe(true);
  });
});

describe("evaluateWhatsAppPortfolioQuota", () => {
  it("allows a brand-new recipient while under the tier limit", () => {
    const decision = evaluateWhatsAppPortfolioQuota({ distinctPhonesInWindow: new Set(["+1"]), to: "+2", tierLimit: 2 });
    expect(decision).toEqual({ allowed: true });
  });

  it("blocks a brand-new recipient once the tier limit of distinct recipients is reached", () => {
    const decision = evaluateWhatsAppPortfolioQuota({ distinctPhonesInWindow: new Set(["+1", "+2"]), to: "+3", tierLimit: 2 });
    expect(decision).toEqual({ allowed: false, reason: "TIER_LIMIT_REACHED" });
  });

  it("always allows a recipient already counted in the window, even at/over the tier limit", () => {
    const decision = evaluateWhatsAppPortfolioQuota({ distinctPhonesInWindow: new Set(["+1", "+2"]), to: "+1", tierLimit: 2 });
    expect(decision).toEqual({ allowed: true });
  });

  it("tier limit of 0 blocks every new recipient", () => {
    const decision = evaluateWhatsAppPortfolioQuota({ distinctPhonesInWindow: new Set(), to: "+1", tierLimit: 0 });
    expect(decision).toEqual({ allowed: false, reason: "TIER_LIMIT_REACHED" });
  });
});

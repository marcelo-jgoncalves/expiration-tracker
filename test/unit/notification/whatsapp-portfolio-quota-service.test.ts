import { describe, expect, it } from "vitest";
import { InMemoryNotificationStore } from "./in-memory-store.js";
import { checkAndRecordWhatsAppPortfolioQuota } from "../../../src/modules/notification/application/whatsapp-portfolio-quota-service.js";

const NOW = "2026-09-10T12:00:00.000Z";

describe("checkAndRecordWhatsAppPortfolioQuota", () => {
  it("allows and records a new recipient under the tier limit", async () => {
    const store = new InMemoryNotificationStore();
    const result = await checkAndRecordWhatsAppPortfolioQuota({ store, tierLimit: 250, now: () => NOW }, "+15551234567");
    expect(result).toEqual({ allowed: true });
    const entries = store.allItems().filter((i) => i["PK"] === "WHATSAPP#PORTFOLIO");
    expect(entries).toHaveLength(1);
  });

  it("blocks a new recipient once the tier limit is reached, without writing a new entry", async () => {
    const store = new InMemoryNotificationStore();
    await store.putIfAbsent({
      PK: "WHATSAPP#PORTFOLIO",
      SK: "SENT#2026-09-10T11:00:00.000Z#+15559999999",
      entityType: "WhatsAppPortfolioQuotaEntry",
      phoneE164: "+15559999999",
      sentAt: "2026-09-10T11:00:00.000Z",
      purgeAfterTtl: 9999999999,
    });
    const result = await checkAndRecordWhatsAppPortfolioQuota({ store, tierLimit: 1, now: () => NOW }, "+15551234567");
    expect(result).toEqual({ allowed: false, reason: "TIER_LIMIT_REACHED" });
    const entries = store.allItems().filter((i) => i["PK"] === "WHATSAPP#PORTFOLIO" && i["phoneE164"] === "+15551234567");
    expect(entries).toHaveLength(0);
  });

  it("fails closed (blocked, never silently allowed) when the window read itself fails", async () => {
    const store = new InMemoryNotificationStore();
    store.queryWhatsAppPortfolioQuotaWindow = async () => {
      throw new Error("boom");
    };
    const result = await checkAndRecordWhatsAppPortfolioQuota({ store, tierLimit: 250, now: () => NOW }, "+15551234567");
    expect(result).toEqual({ allowed: false, reason: "READ_FAILURE" });
  });
});

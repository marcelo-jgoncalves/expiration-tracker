import { describe, expect, it } from "vitest";
import { isWhatsAppChannelEnabled, isWhatsAppDeliveryWorkerEnabled } from "../../../src/modules/notification/application/whatsapp-activation.js";
import type { FeatureFlags } from "../../../src/modules/extraction/ports/feature-flags-reader.js";

function makeFlags(overrides: Partial<FeatureFlags> = {}): FeatureFlags {
  return {
    AI_EXTRACTION: false,
    OCR: false,
    WHATSAPP: false,
    EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED: false,
    DOCUMENT_ARCHIVE_PROMOTION_ENABLED: false,
    WHATSAPP_DELIVERY_WORKER_ENABLED: false,
    ...overrides,
  };
}

describe("WhatsApp two-flag mandatory-order activation (D-197 fatia 3/5, D-10 - same mechanism as D-193 slice 8/9)", () => {
  it("both flags off (default): channel and worker both disabled", () => {
    const flags = makeFlags();
    expect(isWhatsAppChannelEnabled(flags)).toBe(false);
    expect(isWhatsAppDeliveryWorkerEnabled(flags)).toBe(false);
  });

  it("WHATSAPP on, worker flag off: channel enabled, worker still disabled", () => {
    const flags = makeFlags({ WHATSAPP: true });
    expect(isWhatsAppChannelEnabled(flags)).toBe(true);
    expect(isWhatsAppDeliveryWorkerEnabled(flags)).toBe(false);
  });

  it("forbidden reverse order: worker flag on, WHATSAPP off - worker stays disabled by construction", () => {
    const flags = makeFlags({ WHATSAPP: false, WHATSAPP_DELIVERY_WORKER_ENABLED: true });
    expect(isWhatsAppDeliveryWorkerEnabled(flags)).toBe(false);
  });

  it("both flags on (correct order): worker enabled", () => {
    const flags = makeFlags({ WHATSAPP: true, WHATSAPP_DELIVERY_WORKER_ENABLED: true });
    expect(isWhatsAppChannelEnabled(flags)).toBe(true);
    expect(isWhatsAppDeliveryWorkerEnabled(flags)).toBe(true);
  });
});

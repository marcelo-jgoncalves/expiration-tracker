/**
 * D-193 item 8/9 ("Sequenciamento", `estado-final-consolidado.md`) - the pure ordering-safety
 * gate for the two-flag mandatory-order activation of the `document-archive` OCR/extraction
 * pipeline. See `src/modules/extraction/application/document-archive-activation.ts`'s own doc
 * comment for the full mechanism this test file proves.
 */
import { describe, expect, it } from "vitest";
import { isDocumentArchiveExtractionTriggerEnabled, isDocumentArchivePromotionEnabled } from "../../../src/modules/extraction/application/document-archive-activation.js";
import type { FeatureFlags } from "../../../src/modules/extraction/ports/feature-flags-reader.js";

function flags(overrides: Partial<FeatureFlags> = {}): FeatureFlags {
  return {
    AI_EXTRACTION: false,
    OCR: false,
    WHATSAPP: false,
    EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED: false,
    DOCUMENT_ARCHIVE_PROMOTION_ENABLED: false,
    ...overrides,
  };
}

describe("isDocumentArchiveExtractionTriggerEnabled (STARTER)", () => {
  it("is false when both flags are off (the default)", () => {
    expect(isDocumentArchiveExtractionTriggerEnabled(flags())).toBe(false);
  });

  it("is true as soon as the STARTER flag alone is on - never depends on PROMOTER", () => {
    expect(isDocumentArchiveExtractionTriggerEnabled(flags({ EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED: true }))).toBe(true);
  });

  it("stays true even if PROMOTER is also on - STARTER's own gate never looks at PROMOTER", () => {
    expect(isDocumentArchiveExtractionTriggerEnabled(flags({ EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED: true, DOCUMENT_ARCHIVE_PROMOTION_ENABLED: true }))).toBe(true);
  });
});

describe("isDocumentArchivePromotionEnabled (PROMOTER) - the ordering-safety mechanism itself", () => {
  it("G-V3: is false when both flags are off (the default) - completely inert", () => {
    expect(isDocumentArchivePromotionEnabled(flags())).toBe(false);
  });

  it("G-V3: FORBIDDEN REVERSE ORDER - PROMOTER alone (STARTER still off) never activates, closing the 'CLEAN sem consumidor' window by construction", () => {
    expect(isDocumentArchivePromotionEnabled(flags({ DOCUMENT_ARCHIVE_PROMOTION_ENABLED: true }))).toBe(false);
  });

  it("STARTER alone (PROMOTER off) never activates promotion either - both must be on", () => {
    expect(isDocumentArchivePromotionEnabled(flags({ EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED: true }))).toBe(false);
  });

  it("G-V3: CORRECT ORDER - both flags on (STARTER first, then PROMOTER) activates promotion", () => {
    expect(isDocumentArchivePromotionEnabled(flags({ EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED: true, DOCUMENT_ARCHIVE_PROMOTION_ENABLED: true }))).toBe(true);
  });
});

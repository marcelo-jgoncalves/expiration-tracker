import { describe, expect, it } from "vitest";
import { presentExtractedFieldDisclosure } from "../../src/api/presentation.js";
import type { DisclosedExtractedField } from "../../src/api/types.js";

function field(overrides: Partial<DisclosedExtractedField>): DisclosedExtractedField {
  return {
    fieldName: "expirationDate",
    valueType: "DATE",
    sources: ["DETERMINISTIC_PARSER"],
    agreement: "SINGLE_SOURCE",
    state: "PENDING_CONFIRMATION",
    version: 1,
    ...overrides,
  };
}

describe("presentExtractedFieldDisclosure", () => {
  it("labels a pending field with a candidate as Sugerido, with confidence when present", () => {
    const view = presentExtractedFieldDisclosure(field({ candidateValue: "2027-03-31", confidence: 0.92 }));
    expect(view.suggestionLabel).toBe("Sugerido com 92% de confiança");
    expect(view.valueText).toBe("2027-03-31");
  });

  it("never fabricates a confidence percentage when it is absent", () => {
    const view = presentExtractedFieldDisclosure(field({ candidateValue: "2027-03-31" }));
    expect(view.suggestionLabel).toBe("Sugerido");
  });

  it("labels a pending field with no candidate as a distinct 'no value' state, never an empty Sugerido", () => {
    const view = presentExtractedFieldDisclosure(field({ candidateValue: undefined, sources: [] }));
    expect(view.suggestionLabel).toBe("Nenhum valor extraído — preenchimento necessário");
    expect(view.valueText).toBeUndefined();
    expect(view.provenanceLabel).toBeUndefined();
  });

  it("labels MISMATCH as a neutral 'Requer revisão', never asserting a disagreement that may not have occurred", () => {
    const view = presentExtractedFieldDisclosure(field({ candidateValue: "2027-03-31", agreement: "MISMATCH" }));
    expect(view.suggestionLabel).toBe("Requer revisão");
  });

  it("attributes provenance to AI only when BEDROCK is among the sources", () => {
    expect(presentExtractedFieldDisclosure(field({ candidateValue: "x", sources: ["DETERMINISTIC_PARSER"] })).provenanceLabel).toBe("Extraído automaticamente do documento");
    expect(presentExtractedFieldDisclosure(field({ candidateValue: "x", sources: ["TEXTRACT"] })).provenanceLabel).toBe("Extraído por reconhecimento de texto");
    expect(presentExtractedFieldDisclosure(field({ candidateValue: "x", sources: ["DETERMINISTIC_PARSER", "BEDROCK"] })).provenanceLabel).toBe("Sugestão com participação de IA generativa");
  });

  it("labels the pipeline's own auto-confirm sentinel distinctly, never as a fabricated human confirmation", () => {
    const view = presentExtractedFieldDisclosure(field({ state: "CONFIRMED", confirmedValue: "2027-03-31", confirmedBy: "SYSTEM_AUTO_CONFIRM" }));
    expect(view.confirmationLabel).toBe("Confirmado automaticamente");
    expect(view.valueText).toBe("2027-03-31");
  });

  it("labels a real human confirmation plainly, never guessing a display name", () => {
    const view = presentExtractedFieldDisclosure(field({ state: "CONFIRMED", confirmedValue: "2027-03-31", confirmedBy: "user-42" }));
    expect(view.confirmationLabel).toBe("Confirmado");
  });

  it("labels a rejected field distinctly, with no value/suggestion/provenance noise", () => {
    const view = presentExtractedFieldDisclosure(field({ state: "REJECTED" }));
    expect(view.rejectedLabel).toBe("Rejeitado");
    expect(view.valueText).toBeUndefined();
    expect(view.suggestionLabel).toBeUndefined();
    expect(view.provenanceLabel).toBeUndefined();
  });
});

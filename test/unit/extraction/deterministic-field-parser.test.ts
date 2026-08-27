import { describe, expect, it } from "vitest";
import { extractExpirationDateCandidates } from "../../../src/modules/extraction/domain/deterministic-field-parser.js";
import { MAX_DECOMPRESSED_BYTES } from "../../../src/workers/parser-sandbox/parser.js";

describe("extractExpirationDateCandidates", () => {
  it("returns no candidates for text with no date-like pattern", () => {
    const result = extractExpirationDateCandidates("Contrato de prestação de serviços sem datas relevantes.");
    expect(result.candidates).toEqual([]);
    expect(result.best).toBeUndefined();
  });

  it("assigns high confidence to a date near an expiration keyword (pt-BR)", () => {
    const result = extractExpirationDateCandidates("Validade: 31/03/2027\nOutros dados aqui.");
    expect(result.best).toEqual({ value: "2027-03-31", valueType: "DATE", confidence: 0.9 });
    expect(result.candidates).toHaveLength(1);
  });

  it("assigns high confidence to a date near an expiration keyword (en)", () => {
    const result = extractExpirationDateCandidates("Valid until 2027-03-31 for all purposes.");
    expect(result.best?.value).toBe("2027-03-31");
    expect(result.best?.confidence).toBe(0.9);
  });

  it("assigns weak confidence (below threshold) to a bare date with no nearby keyword", () => {
    const result = extractExpirationDateCandidates("Documento emitido em 10/01/2026, sem outra menção.");
    expect(result.best).toEqual({ value: "2026-01-10", valueType: "DATE", confidence: 0.5 });
  });

  it("returns 2+ distinct candidates when the text has real ambiguity (two different dates)", () => {
    const result = extractExpirationDateCandidates(
      "Emitido 10/01/2026. " + "x".repeat(60) + " Validade: 31/03/2027.",
    );
    expect(result.candidates.map((c) => c.value).sort()).toEqual(["2026-01-10", "2027-03-31"]);
    // The keyword-associated one wins as "best".
    expect(result.best?.value).toBe("2027-03-31");
    expect(result.best?.confidence).toBe(0.9);
  });

  it("deduplicates the same date value found multiple times, keeping the highest confidence", () => {
    const result = extractExpirationDateCandidates("31/03/2027 mencionado aqui. Validade: 31/03/2027.");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toEqual({ value: "2027-03-31", valueType: "DATE", confidence: 0.9 });
  });

  it("parses ISO-formatted dates", () => {
    const result = extractExpirationDateCandidates("vencimento em 2027-03-31.");
    expect(result.best?.value).toBe("2027-03-31");
  });

  it("normalizes 2-digit years using the 80/00 pivot", () => {
    const future = extractExpirationDateCandidates("validade 31/03/27");
    expect(future.best?.value).toBe("2027-03-31");
    const past = extractExpirationDateCandidates("validade 31/03/85");
    expect(past.best?.value).toBe("1985-03-31");
  });

  it("ignores impossible day/month combinations", () => {
    const result = extractExpirationDateCandidates("validade 45/13/2027");
    expect(result.candidates).toEqual([]);
  });

  it("truncates input beyond MAX_DECOMPRESSED_BYTES rather than scanning unbounded text", () => {
    const padding = "x".repeat(MAX_DECOMPRESSED_BYTES + 10);
    const text = `${padding}Validade: 31/03/2027`;
    const result = extractExpirationDateCandidates(text);
    // The date is entirely past the truncation boundary, so it must never be found.
    expect(result.candidates).toEqual([]);
  });
});

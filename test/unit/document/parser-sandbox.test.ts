import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { parsePdfStructure, MAX_PAGES, MAX_DECOMPRESSED_BYTES } from "../../../src/workers/parser-sandbox/parser.js";

async function makeValidPdf(pageCount = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([200, 200]);
  return doc.save();
}

describe("parsePdfStructure", () => {
  it("accepts a real, valid, single-page PDF", async () => {
    const bytes = await makeValidPdf(1);
    const result = await parsePdfStructure(bytes);
    expect(result).toEqual({ outcome: "VALID", pageCount: 1 });
  });

  it("rejects as INVALID_STRUCTURE when the input isn't a real PDF at all", async () => {
    const result = await parsePdfStructure(new TextEncoder().encode("this is not a pdf"));
    expect(result.outcome).toBe("INVALID_STRUCTURE");
  });

  it("rejects a PDF exceeding MAX_PAGES with LIMIT_EXCEEDED", async () => {
    const bytes = await makeValidPdf(MAX_PAGES + 1);
    const result = await parsePdfStructure(bytes);
    expect(result).toEqual({ outcome: "LIMIT_EXCEEDED", pageCount: MAX_PAGES + 1 });
  });

  it("rejects raw bytes larger than the decompressed size limit before even attempting to parse", async () => {
    const oversized = new Uint8Array(MAX_DECOMPRESSED_BYTES + 1);
    const result = await parsePdfStructure(oversized);
    expect(result).toEqual({ outcome: "LIMIT_EXCEEDED" });
  });

  it("blocks a PDF containing a /JavaScript keyword, even if otherwise structurally valid", async () => {
    const valid = await makeValidPdf(1);
    // Append a raw JavaScript-action-shaped fragment - the blocklist scan is over raw bytes,
    // not just the parsed object graph, precisely to catch this kind of injection.
    const withJs = Buffer.concat([Buffer.from(valid), Buffer.from("\n/JavaScript (app.alert('x'))")]);
    const result = await parsePdfStructure(withJs);
    expect(result.outcome).toBe("INVALID_STRUCTURE");
  });

  it("blocks a PDF containing an /EmbeddedFile reference", async () => {
    const valid = await makeValidPdf(1);
    const withEmbed = Buffer.concat([Buffer.from(valid), Buffer.from("\n/EmbeddedFile /F (malware.exe)")]);
    const result = await parsePdfStructure(withEmbed);
    expect(result.outcome).toBe("INVALID_STRUCTURE");
  });
});

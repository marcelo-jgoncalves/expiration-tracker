import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildDossierPdf } from "../../../src/modules/document-archive/application/dossier-pdf-builder.js";
import type { DossierExportRow } from "../../../src/modules/document-archive/application/document-archive-service.js";

function makeRow(requirementId: string, overrides: Partial<DossierExportRow> = {}): DossierExportRow {
  return { requirementId, name: `Requisito ${requirementId}`, status: "SATISFIED", evidenceValidUntil: "2027-01-01T00:00:00.000Z", assigneeUserId: "user-1", updatedAt: "2026-09-06T00:00:00.000Z", ...overrides };
}

describe("buildDossierPdf (D-205 fatia 2, decision 6/8)", () => {
  it("produces a valid, loadable PDF for a small row set (single page)", async () => {
    const bytes = await buildDossierPdf({ subjectDisplayName: "ACME Ltda", rows: [makeRow("req-1"), makeRow("req-2")], generatedAt: "2026-09-06T12:00:00.000Z", truncatedNote: "" });
    expect(Buffer.from(bytes.slice(0, 5)).toString("ascii")).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("NEVER omits a row - a row set large enough to overflow one page paginates instead of dropping rows", async () => {
    const rows = Array.from({ length: 60 }, (_, i) => makeRow(`req-${i}`));
    const bytes = await buildDossierPdf({ subjectDisplayName: "ACME Ltda", rows, generatedAt: "2026-09-06T12:00:00.000Z", truncatedNote: "" });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1); // 60 rows don't fit one page at the fixed row height - must have paginated, not truncated.
  });

  it("handles zero rows without throwing (still produces a valid single-page PDF)", async () => {
    const bytes = await buildDossierPdf({ subjectDisplayName: "ACME Ltda", rows: [], generatedAt: "2026-09-06T12:00:00.000Z", truncatedNote: "" });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("never throws on an extremely long Requirement name (narrative truncation is visual, not a crash)", async () => {
    const bytes = await buildDossierPdf({ subjectDisplayName: "ACME Ltda", rows: [makeRow("req-1", { name: "x".repeat(2000) })], generatedAt: "2026-09-06T12:00:00.000Z", truncatedNote: "" });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("includes the truncatedNote text in the document when present (visual signal, not a separate mechanism)", async () => {
    // No text-extraction API in pdf-lib - this only proves the code path with a note runs without
    // throwing and produces a larger byte stream than the no-note case (a real content stream
    // addition, not a no-op).
    const withoutNote = await buildDossierPdf({ subjectDisplayName: "ACME Ltda", rows: [makeRow("req-1")], generatedAt: "2026-09-06T12:00:00.000Z", truncatedNote: "" });
    const withNote = await buildDossierPdf({ subjectDisplayName: "ACME Ltda", rows: [makeRow("req-1")], generatedAt: "2026-09-06T12:00:00.000Z", truncatedNote: "Um ou mais requisitos foram omitidos por limite de tamanho." });
    expect(withNote.length).not.toBe(withoutNote.length);
  });
});

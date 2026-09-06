import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildDossierXlsx } from "../../../src/modules/document-archive/application/dossier-xlsx-builder.js";
import type { DossierExportRow } from "../../../src/modules/document-archive/application/document-archive-service.js";

function makeRow(overrides: Partial<DossierExportRow> = {}): DossierExportRow {
  return { requirementId: "req-1", name: "Alvará Sanitário", status: "SATISFIED", evidenceValidUntil: "2027-01-01T00:00:00.000Z", assigneeUserId: "user-1", updatedAt: "2026-09-06T00:00:00.000Z", ...overrides };
}

/** `exceljs`'s bundled `.d.ts` ships its own nested `@types/node`, whose `Buffer` is structurally
 * incompatible (by TS's nominal-ish branding) with this repo's own `@types/node` `Buffer` - a
 * known class of dependency type-duplication issue, not a real runtime concern (both are the
 * same Node `Buffer` at runtime). Isolated to this test file only via the `unknown` round-trip. */
async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const load = workbook.xlsx.load.bind(workbook.xlsx) as unknown as (b: unknown) => Promise<unknown>;
  await load(buffer);
  return workbook;
}

describe("buildDossierXlsx (D-205 fatia 2, decision 6/7)", () => {
  it("produces a workbook with an info sheet and a Requisitos sheet listing every row, never truncated", async () => {
    const buffer = await buildDossierXlsx({ subjectDisplayName: "ACME Ltda", rows: [makeRow(), makeRow({ requirementId: "req-2", name: "x".repeat(500) })], generatedAt: "2026-09-06T12:00:00.000Z", truncatedNote: "" });

    const workbook = await loadWorkbook(buffer);
    expect(workbook.worksheets.map((w) => w.name)).toEqual(["Informações", "Requisitos"]);

    const sheet = workbook.getWorksheet("Requisitos")!;
    expect(sheet.rowCount).toBe(3); // header + 2 rows
    const longNameCell = sheet.getRow(3).getCell(2).value;
    expect(String(longNameCell)).toHaveLength(500); // NEVER truncated, unlike the PDF sibling.
  });

  it("sanitizes formula-injection trigger characters (leading =, +, -, @) with the SAME mitigation csv-export-writer.ts uses", async () => {
    const buffer = await buildDossierXlsx({ subjectDisplayName: "ACME", rows: [makeRow({ name: "=SUM(A1:A10)", assigneeUserId: "@attacker" })], generatedAt: "2026-09-06T12:00:00.000Z", truncatedNote: "" });

    const workbook = await loadWorkbook(buffer);
    const row = workbook.getWorksheet("Requisitos")!.getRow(2);
    expect(String(row.getCell(2).value)).toBe("'=SUM(A1:A10)");
    expect(String(row.getCell(5).value)).toBe("'@attacker");
  });

  it("includes the truncatedNote on the info sheet when present, omits it when empty", async () => {
    const withNote = await buildDossierXlsx({ subjectDisplayName: "ACME", rows: [makeRow()], generatedAt: "2026-09-06T12:00:00.000Z", truncatedNote: "algo truncado" });
    const wb1 = await loadWorkbook(withNote);
    const info1 = wb1.getWorksheet("Informações")!;
    expect(info1.getRow(4).getCell(2).value).toBe("algo truncado");

    const withoutNote = await buildDossierXlsx({ subjectDisplayName: "ACME", rows: [makeRow()], generatedAt: "2026-09-06T12:00:00.000Z", truncatedNote: "" });
    const wb2 = await loadWorkbook(withoutNote);
    const info2 = wb2.getWorksheet("Informações")!;
    expect(info2.getRow(4).getCell(2).value).not.toBe("algo truncado");
  });

  it("handles zero rows without throwing (an empty-but-valid workbook)", async () => {
    const buffer = await buildDossierXlsx({ subjectDisplayName: "ACME", rows: [], generatedAt: "2026-09-06T12:00:00.000Z", truncatedNote: "" });
    const workbook = await loadWorkbook(buffer);
    expect(workbook.getWorksheet("Requisitos")!.rowCount).toBe(1); // header only.
  });
});

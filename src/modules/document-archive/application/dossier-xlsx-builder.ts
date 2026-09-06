/**
 * Dossier XLSX builder — D-205 decision 6/7 (Roadmap P1 item 16, fatia 2). Exhaustive
 * counterpart to `dossier-pdf-builder.ts`'s narrative one: NEVER truncates a cell value, no
 * matter how long - the PDF is the presentation layer, this is the complete record. `exceljs`
 * is a NEW dependency (design decision 7 anticipates one; no XLSX-writing library existed in
 * this repo before this fatia - `pdf-lib` only ever parsed/created PDFs).
 *
 * Sanitization reuses the SAME formula-injection mitigation `csv-export-writer.ts` already
 * established (extracted to `shared/spreadsheet/formula-injection.ts` in this same fatia so
 * neither writer duplicates the trigger-character set).
 */
import ExcelJS from "exceljs";
import { sanitizeFormulaInjection } from "../../../shared/spreadsheet/formula-injection.js";
import type { DossierExportRow } from "./document-archive-service.js";

export interface DossierXlsxInput {
  subjectDisplayName: string;
  rows: readonly DossierExportRow[];
  generatedAt: string;
  truncatedNote: string;
}

const COLUMNS: { header: string; key: keyof DossierExportRow; width: number }[] = [
  { header: "ID do requisito", key: "requirementId", width: 24 },
  { header: "Requisito", key: "name", width: 40 },
  { header: "Status", key: "status", width: 18 },
  { header: "Válido até", key: "evidenceValidUntil", width: 22 },
  { header: "Responsável (userId)", key: "assigneeUserId", width: 26 },
  { header: "Atualizado em", key: "updatedAt", width: 22 },
];

export async function buildDossierXlsx(input: DossierXlsxInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date(input.generatedAt);

  const info = workbook.addWorksheet("Informações");
  info.columns = [{ width: 24 }, { width: 60 }];
  info.addRow(["Subject", input.subjectDisplayName]);
  info.addRow(["Gerado em", input.generatedAt]);
  info.addRow(["Total de requisitos", input.rows.length]);
  if (input.truncatedNote) info.addRow(["Observação", input.truncatedNote]);
  info.addRow(["Limitação (v1)", "Bytes de documento escaneado não incluídos; histórico de relink de evidência para outro documentId não é reconstruível."]);
  info.getColumn(1).font = { bold: true };

  const sheet = workbook.addWorksheet("Requisitos");
  sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  sheet.getRow(1).font = { bold: true };

  for (const row of input.rows) {
    sheet.addRow({
      requirementId: sanitizeFormulaInjection(row.requirementId),
      name: sanitizeFormulaInjection(row.name),
      status: row.status,
      evidenceValidUntil: row.evidenceValidUntil ?? "",
      assigneeUserId: row.assigneeUserId ? sanitizeFormulaInjection(row.assigneeUserId) : "",
      updatedAt: row.updatedAt,
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

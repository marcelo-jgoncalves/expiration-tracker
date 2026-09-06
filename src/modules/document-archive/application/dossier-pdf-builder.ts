/**
 * Dossier PDF builder — D-205 decision 8 (Roadmap P1 item 16, fatia 2): "PDF sem lib de layout
 * nova - `pdf-lib`'s API de criação, tabela simples/determinística (linhas fixas por página,
 * altura fixa)". `pdf-lib` already lives in this repo (used today only to PARSE uploaded PDFs,
 * `document/` module) - this is the first place it's used to CREATE one.
 *
 * Narrative role (decision 6): text may be truncated with an ellipsis to fit its column width -
 * this is presentation, never data loss - but a ROW (a whole Requirement) is NEVER omitted. The
 * XLSX sibling (`dossier-xlsx-builder.ts`) is the exhaustive counterpart - never truncates a
 * cell - so nothing is lost as long as both documents exist together.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { DossierExportRow } from "./document-archive-service.js";

const PAGE_WIDTH = 595.28; // A4 portrait, points (pdf-lib's native unit).
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
const ROW_HEIGHT = 18; // decision 8: fixed row height.
const FONT_SIZE = 9;
const TITLE_SIZE = 14;
const HEADER_ROW_Y_OFFSET = 150; // space reserved for title/subtitle/column headers on page 1.
const CONTINUATION_HEADER_Y_OFFSET = 60; // smaller reserved space on continuation pages (column headers only).
/** decision 8: fixed rows per page - derived once from the page geometry, never recomputed
 * per-row (a truly fixed layout, not merely "usually fits"). */
const ROWS_PER_FIRST_PAGE = Math.floor((PAGE_HEIGHT - MARGIN * 2 - HEADER_ROW_Y_OFFSET) / ROW_HEIGHT);
const ROWS_PER_CONTINUATION_PAGE = Math.floor((PAGE_HEIGHT - MARGIN * 2 - CONTINUATION_HEADER_Y_OFFSET) / ROW_HEIGHT);

interface Column {
  label: string;
  width: number;
  value: (row: DossierExportRow) => string;
}

const COLUMNS: Column[] = [
  { label: "Requisito", width: 210, value: (r) => r.name },
  { label: "Status", width: 85, value: (r) => r.status },
  { label: "Válido até", width: 90, value: (r) => r.evidenceValidUntil ?? "—" },
  { label: "Responsável", width: 90, value: (r) => r.assigneeUserId ?? "—" },
  { label: "Atualizado em", width: 80, value: (r) => r.updatedAt },
];

export interface DossierPdfInput {
  subjectDisplayName: string;
  rows: readonly DossierExportRow[];
  generatedAt: string;
  /** decision 11's named limitation, printed on the document itself, never hidden. */
  truncatedNote: string;
}

/** Truncates `text` (single line, never wraps) with an ellipsis so it fits within `maxWidth`
 * points at `size`, using the font's own real glyph metrics (never a fixed character count -
 * Helvetica is not monospace). Returns the original text unchanged if it already fits. */
function fitText(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  const ellipsis = "…";
  let truncated = text;
  while (truncated.length > 0 && font.widthOfTextAtSize(truncated + ellipsis, size) > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + ellipsis;
}

function drawColumnHeaders(page: PDFPage, boldFont: PDFFont, y: number): void {
  let x = MARGIN;
  for (const column of COLUMNS) {
    page.drawText(column.label, { x, y, size: FONT_SIZE, font: boldFont, color: rgb(0, 0, 0) });
    x += column.width;
  }
}

function drawRow(page: PDFPage, font: PDFFont, row: DossierExportRow, y: number): void {
  let x = MARGIN;
  for (const column of COLUMNS) {
    const text = fitText(column.value(row), font, FONT_SIZE, column.width - 4);
    page.drawText(text, { x, y, size: FONT_SIZE, font, color: rgb(0, 0, 0) });
    x += column.width;
  }
}

export async function buildDossierPdf(input: DossierPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;
  page.drawText(`Dossiê — ${input.subjectDisplayName}`, { x: MARGIN, y, size: TITLE_SIZE, font: boldFont, color: rgb(0, 0, 0) });
  y -= TITLE_SIZE + 10;
  page.drawText(`Gerado em: ${input.generatedAt}`, { x: MARGIN, y, size: FONT_SIZE, font, color: rgb(0.3, 0.3, 0.3) });
  y -= FONT_SIZE + 8;
  page.drawText(`${input.rows.length} requisito(s). Bytes de documento escaneado não incluídos (v1) - ver XLSX para exportação exaustiva.`, {
    x: MARGIN,
    y,
    size: FONT_SIZE,
    font,
    color: rgb(0.3, 0.3, 0.3),
  });
  y -= FONT_SIZE + 8;
  if (input.truncatedNote) {
    page.drawText(input.truncatedNote, { x: MARGIN, y, size: FONT_SIZE, font: boldFont, color: rgb(0.6, 0, 0) });
    y -= FONT_SIZE + 8;
  }
  y -= 10;
  drawColumnHeaders(page, boldFont, y);
  y -= ROW_HEIGHT;

  let rowsOnThisPage = 0;
  let rowsAllowedOnThisPage = ROWS_PER_FIRST_PAGE;
  for (const row of input.rows) {
    if (rowsOnThisPage >= rowsAllowedOnThisPage) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
      drawColumnHeaders(page, boldFont, y);
      y -= ROW_HEIGHT;
      rowsOnThisPage = 0;
      rowsAllowedOnThisPage = ROWS_PER_CONTINUATION_PAGE;
    }
    drawRow(page, font, row, y);
    y -= ROW_HEIGHT;
    rowsOnThisPage += 1;
  }

  return doc.save();
}

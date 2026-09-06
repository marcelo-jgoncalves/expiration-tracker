/**
 * CSV column definitions/builders shared by the 7 manual `GET /reports/*` routes
 * (`http/reports-handler.ts`, D-195) AND `ReportsService.generateReportCsv` (D-204 fatia 3,
 * the scheduled-delivery worker's system-facing CSV generation) - extracted here so the two
 * never duplicate/drift on column order, same "one place owns the shape" discipline every
 * other cross-layer reuse in this module follows. Pure string building, no I/O.
 */
import { serializeCsvRow } from "../../../shared/csv/csv-export-writer.js";
import type { ExpirationItem } from "../../expiration/domain/expiration-item.js";
import type { Requirement } from "../../document-archive/domain/requirement.js";

/** Moved here (not defined in `reports-service.ts`, which imports it back) to avoid a circular
 * module dependency now that both that service and this file need the same shape. */
export interface RequirementReportRow {
  requirement: Requirement;
  subjectDisplayName?: string;
}

export const EXPIRATION_ITEM_CSV_COLUMNS = ["itemId", "name", "category", "dueDate", "assigneeUserId", "tags", "status", "renewedFromId", "updatedAt"] as const;

function expirationItemRowFields(item: ExpirationItem): string[] {
  return [item.itemId, item.name, item.category, item.dueDate, item.assigneeUserId ?? "", item.tags.join(";"), item.status, item.renewedFromId ?? "", item.updatedAt];
}

export function buildExpirationItemCsv(items: ExpirationItem[]): string {
  let csv = serializeCsvRow([...EXPIRATION_ITEM_CSV_COLUMNS]);
  for (const item of items) csv += serializeCsvRow(expirationItemRowFields(item));
  return csv;
}

export const REQUIREMENT_CSV_COLUMNS = ["requirementId", "subjectId", "subjectDisplayName", "name", "status", "assigneeUserId", "evidenceValidUntil", "updatedAt"] as const;

function requirementRowFields(row: RequirementReportRow): string[] {
  const r = row.requirement;
  return [r.requirementId, r.subjectId, row.subjectDisplayName ?? "", r.name, r.status, r.assigneeUserId ?? "", r.evidenceValidUntil ?? "", r.updatedAt];
}

export function buildRequirementCsv(rows: RequirementReportRow[]): string {
  let csv = serializeCsvRow([...REQUIREMENT_CSV_COLUMNS]);
  for (const row of rows) csv += serializeCsvRow(requirementRowFields(row));
  return csv;
}

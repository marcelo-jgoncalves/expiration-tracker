/**
 * ImportRowResult — D-292 (A15 drill-down gap, `docs/architecture/decisions-log.md` D-269/D-271).
 * Read-only merge of 2 sources that ALREADY existed with no route reading them together:
 * (1) the row plan (`ImportJob.planObjectKey`, NDJSON in S3, written once at parse time —
 * `import-parse-service.ts`) which already knows every row's fate for `REJECT`/`SKIP_DUPLICATE`
 * (these never reach the commit worker, so they never get an `ImportRowOutcome`); (2)
 * `ImportRowOutcome` (`import-row-outcome.ts`), the durable per-row COMMITTED/FAILED record the
 * commit worker already writes for every `CREATE_*` row it attempts.
 *
 * No new persistence, no new write path — this file only merges what's already durably stored,
 * closing the "no per-row drill-down" gap the frontend (`ImportWizard.tsx`) documented as a real
 * backend limitation (D-269).
 */
import type { ImportRowOutcome } from "./import-row-outcome.js";

export type ImportRowResultStatus = "COMMITTED" | "FAILED" | "REJECTED" | "SKIPPED" | "PENDING";

export interface ImportRowResult {
  rowNumber: number;
  status: ImportRowResultStatus;
  /** Rejection code (REJECTED) / skip reason (SKIPPED) / failure reason (FAILED) — 3 different
   * source vocabularies (`ImportRowRejectionCode`/`SKIP_DUPLICATE`'s own 2 reasons/
   * `ImportRowOutcome.failureReason`), deliberately unified into one string field here rather
   * than 3 differently-named optional fields — the frontend only ever needs "why", never which
   * of the 3 vocabularies it came from. */
  reason?: string;
  /** REJECTED only — which CSV column caused it, when known. */
  field?: string;
  /** COMMITTED only — id of the entity this row created (subjectId/documentId/requirementId per
   * `ImportJob.targetEntityType`). */
  entityId?: string;
}

/** One line of the NDJSON plan, read back loosely (not the full discriminated union — this
 * merge only needs the 4 fields common across `ImportRowPlanEntry`/`DocumentImportRowPlanEntry`/
 * `RequirementImportRowPlanEntry`, never re-validates row content). */
interface PlanEntryShape {
  rowNumber: number;
  action: string;
  reason?: string;
  field?: string;
}

function parsePlanNdjson(content: string): PlanEntryShape[] {
  return content
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as PlanEntryShape);
}

/** Pure merge, no I/O — `planContent` is the raw NDJSON string already fetched from S3,
 * `outcomes` the `ImportRowOutcome` rows already queried from DynamoDB for this job. Sorted by
 * `rowNumber` — the plan is already written in row order (`import-parse-service.ts` sorts before
 * serializing), but this never trusts that invariant blindly. */
export function mergeImportRowResults(planContent: string, outcomes: ImportRowOutcome[]): ImportRowResult[] {
  const outcomeByRow = new Map(outcomes.map((o) => [o.rowNumber, o]));
  const entries = parsePlanNdjson(planContent);

  const results: ImportRowResult[] = entries.map((entry) => {
    if (entry.action === "REJECT") {
      return { rowNumber: entry.rowNumber, status: "REJECTED", reason: entry.reason, field: entry.field };
    }
    if (entry.action === "SKIP_DUPLICATE") {
      return { rowNumber: entry.rowNumber, status: "SKIPPED", reason: entry.reason };
    }
    // Every other action is a CREATE_* variant (CREATE_SUBJECT/CREATE_DOCUMENT/
    // CREATE_REQUIREMENT) - the one thing they share is "this row was actually attempted by the
    // commit worker", so its fate lives in ImportRowOutcome, never in the plan itself.
    const outcome = outcomeByRow.get(entry.rowNumber);
    if (!outcome) return { rowNumber: entry.rowNumber, status: "PENDING" };
    if (outcome.outcome === "COMMITTED") return { rowNumber: entry.rowNumber, status: "COMMITTED", entityId: outcome.entityId };
    return { rowNumber: entry.rowNumber, status: "FAILED", reason: outcome.failureReason };
  });

  return results.sort((a, b) => a.rowNumber - b.rowNumber);
}

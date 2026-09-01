/**
 * DocumentRequestSeries — D-143 Decision 8 (`estado-final-consolidado.md`, D-147), Nucleus 2
 * entity 3/3, the final piece of Nucleus 2. A series is a recurring request DEFINITION (e.g.
 * "renew this Requirement's evidence every 90 days"); each time it comes due it materializes
 * one CYCLE, identified by a deterministic `occurrenceId` derived from `seriesId` + the cycle's
 * `currentCycleStartAt` — computing it twice for the same cycle always yields the same id, so a
 * duplicate scheduler tick can never double-materialize a cycle (the property
 * `computeSeriesOccurrenceId` exists to guarantee).
 *
 * Within one cycle, `materializeAttempt` (application layer) may be called more than once (a
 * resend/retry of the same request) — each call creates one `DocumentRequest` "attempt"
 * (`attemptIndex` incrementing from 1) whose `parentRequestId` always points to the
 * IMMEDIATELY PREVIOUS attempt of the SAME cycle. `occurrenceId` stays stable across every
 * attempt of a cycle; `advanceCycle` is the only operation that changes it (moving to the next
 * due date resets `latestAttemptIndex`/`latestRequestId` and recomputes `currentCycleStartAt`).
 *
 * Co-located under the owning Subject's partition, same convention as `requirement.ts`
 * (`TENANT#t#SUBJECT#s`/`SERIES#<seriesId>`) — a series' lifecycle is owned by the Subject, not
 * by the Requirement it renews evidence for (mirrors why Requirement isn't co-located under
 * Document either).
 *
 * Index: GSI1 (document-archive's own — GSI3/GSI4/GSI6 are off-limits, restricted to
 * reminder/chasing per D-143 Decision 2's GSI exclusivity rule, confirmed by grep: no writer
 * under `src/modules/document-archive/` ever sets `GSI3PK`). GSI1 already hosts two
 * prefix-discriminated namespaces (`DOCSTATUS`/`REQSTATUS`, `document.ts`/`requirement.ts`) —
 * this adds a third, `SERIESDUE`, following the exact same discrimination-by-prefix convention
 * rather than colliding with either existing one or reaching for GSI5 (already carrying its own
 * two sparse namespaces, review-queue and version-lookup, which this access pattern doesn't
 * share the "sparse, removed on transition" shape of).
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import { stableHash } from "../../reminder/domain/reminder-occurrence.js";

export type DocumentRequestSeriesStatus = "ACTIVE" | "CANCELLED";

export interface DocumentRequestSeriesCadence {
  intervalDays: number;
}

export interface DocumentRequestSeries extends EntityKey {
  entityType: "DocumentRequestSeries";
  seriesId: string;
  tenantId: string;
  subjectId: string;
  requirementId: string;
  cadence: DocumentRequestSeriesCadence;
  status: DocumentRequestSeriesStatus;
  /** The current cycle's canonical start instant — the exact input (together with `seriesId`)
   * `computeSeriesOccurrenceId` hashes. Changed only by `advanceCycle`. */
  currentCycleStartAt: string;
  /** When the current cycle's first attempt is due to be materialized (>= `currentCycleStartAt`,
   * equal to it in this increment — a future catch-up/pause feature could diverge them, out of
   * scope per `estado-final-consolidado.md`'s "fora de escopo" list: "timezone/pausa/catch-up de
   * recorrência"). */
  nextDueAt: string;
  /** How many attempts have been materialized in the CURRENT cycle — `0` means no attempt yet
   * (the series is due but `materializeAttempt` has not run for this cycle). Reset to `0` by
   * `advanceCycle`. */
  latestAttemptIndex: number;
  /** The most recently materialized `DocumentRequest.documentRequestId` of the current cycle —
   * the next `materializeAttempt` call's `parentRequestId`. Absent when `latestAttemptIndex=0`
   * (no attempt yet) and reset to absent by `advanceCycle`. */
  latestRequestId?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  GSI1PK: string;
  GSI1SK: string;
}

export function documentRequestSeriesKey(tenantId: string, subjectId: string, seriesId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#SUBJECT#${subjectId}`, SK: `SERIES#${seriesId}` };
}

export const DOCUMENT_REQUEST_SERIES_SK_PREFIX = "SERIES#";

/**
 * GSI1 SERIESDUE namespace — a third prefix-discriminated namespace on the same physical GSI1
 * `document.ts`/`requirement.ts` already use, ordered ascending by `nextDueAt` so the producer's
 * "what's due" query (`document-request-recurrence-producer.ts`) is a single bounded Query
 * against a status-scoped partition, same shape as `reviewQueueGsi5Keys`'s access pattern.
 */
export function documentRequestSeriesGsi1Keys(tenantId: string, status: DocumentRequestSeriesStatus, nextDueAt: string, seriesId: string): { GSI1PK: string; GSI1SK: string } {
  return {
    GSI1PK: `TENANT#${tenantId}#SERIESDUE#${status}`,
    GSI1SK: `DUE#${nextDueAt}#SERIES#${seriesId}`,
  };
}

/**
 * Deterministic per-cycle id — SAME `seriesId` + SAME `cycleStartAt` ALWAYS yields the SAME
 * `occurrenceId`, independent of when/how many times it is computed (D-147/Decision 8: this is
 * exactly the property that makes a duplicate scheduler tick for the same due cycle safe —
 * recomputing it never mints a second identity for the cycle). Reuses `stableHash` from
 * `reminder/domain/reminder-occurrence.ts` (same non-cryptographic stable-hash primitive
 * `document-chasing.ts`'s `chasingGsi3Keys` already reuses) rather than a fresh random id —
 * pure function of its two inputs, no I/O, no randomness.
 */
export function computeSeriesOccurrenceId(seriesId: string, cycleStartAt: string): string {
  return `OCC-${stableHash(`${seriesId}#${cycleStartAt}`)}`;
}

export interface CreateDocumentRequestSeriesInput {
  subjectId: string;
  requirementId: string;
  cadence: DocumentRequestSeriesCadence;
  /** First due date; defaults to "now" (immediately due) when omitted. */
  firstDueAt?: string;
}

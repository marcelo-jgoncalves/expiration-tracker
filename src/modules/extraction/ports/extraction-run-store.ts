/** DynamoDB surface the Extraction module needs — same port pattern as DocumentStore/
 * ReminderStore (AGENTS.md §6). */
export type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export interface ExtractionRunStore {
  /** Idempotent create — the actual idempotency mechanism for the whole run
   * (deriveExtractionRunId() already makes the key deterministic; this is what turns a
   * duplicate S3 event / SQS redelivery into a no-op instead of a second run). */
  putIfAbsent<T extends EntityKey>(item: T): Promise<boolean>;

  /** Standalone OCC status transition, used ONLY for the DISCARDED outcome (M7 item 7,
   * `ExtractionValidationTaskHandler`) — the concurrent-discard race is detected too late for
   * any `ExtractedField` row to still be meaningful, so there is nothing to commit
   * transactionally alongside it (contrast `ExtractedFieldStore.commitRunOutcome`, which
   * updates this same run's status atomically together with the fields it writes for the
   * COMPLETED/FAILED outcomes). Returns `false` on an OCC conflict (stale `expectedVersion`) —
   * the caller treats that as "someone else already finalized this run", never retries blindly. */
  updateStatus(key: EntityKey, tenantId: string, expectedVersion: number, status: "DISCARDED", completedAt: string): Promise<boolean>;
}

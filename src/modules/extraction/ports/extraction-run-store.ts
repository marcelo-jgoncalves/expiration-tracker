/** DynamoDB surface the Extraction module needs — same port pattern as DocumentStore/
 * ReminderStore (AGENTS.md §6). */
export type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export interface ExtractionRunStore {
  /** Idempotent create — the actual idempotency mechanism for the whole run
   * (deriveExtractionRunId() already makes the key deterministic; this is what turns a
   * duplicate S3 event / SQS redelivery into a no-op instead of a second run). */
  putIfAbsent<T extends EntityKey>(item: T): Promise<boolean>;
}

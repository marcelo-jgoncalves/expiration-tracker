/**
 * Narrow port for WhatsAppDigestFlushWorker (D-347 §3.5) — discovers due `DigestEntry` windows
 * via GSI8 (`GSI8PK=WORK#WHATSAPP_DIGEST`, `GSI8SK=<flushAt>#TENANT#<tenantId>#<recipientUserId>`,
 * KEYS_ONLY), same shape as `scheduled-reports/candidate-source.ts`. GSI8 is discovery-only,
 * never a source of eligibility — the worker always re-fetches the full `DigestEntry` fresh
 * before acting, same posture every other GSI8 consumer holds.
 */
import type { EntityKey } from "../../shared/dynamodb/occ.js";

export interface WhatsAppDigestGsi8Candidate extends EntityKey {
  flushAtIso: string;
  tenantId: string;
  recipientUserId: string;
  windowDate: string;
}

export interface WhatsAppDigestGsi8Page {
  items: WhatsAppDigestGsi8Candidate[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface WhatsAppDigestCandidateSource {
  /** `Query GSI8PK = "WORK#WHATSAPP_DIGEST" AND GSI8SK < :before`, ordered by flush time.
   * `tenantId`/`recipientUserId`/`windowDate` are parsed from the base table's own `PK`
   * (`digestEntryKey()`'s shape), never re-derived from `GSI8SK` - `KEYS_ONLY` already returns
   * the row's own PK for free. */
  queryDue(input: { before: string; exclusiveStartKey?: Record<string, unknown> }): Promise<WhatsAppDigestGsi8Page>;
}

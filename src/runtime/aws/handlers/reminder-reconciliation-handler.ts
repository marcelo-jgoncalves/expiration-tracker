/** Real handler for ReminderReconciliation (EventBridge Scheduler, `mode` field), replacing
 * the 501 placeholder. Two schedules invoke the same Lambda with different `mode`
 * (m3.5-runtime-design.md §"Reconciliação"): CLAIMS (every 5 min) and DST (daily). Also one
 * of exactly two roles granted gsi6Read() - see infra/lib/dynamo-table.ts.
 *
 * EventBridge Scheduler's Lambda target does NOT wrap the payload in a `detail` envelope
 * the way legacy EventBridge Rules do - the event IS whatever `input` the schedule sets
 * (infra/lib/reminder-schedule.ts: `{mode, scheduledTime}` at the top level), never
 * `event.detail.mode` (bug found by Codex implementation review - event.detail was always
 * undefined, both schedules would throw on every invocation). */
import { randomUUID } from "node:crypto";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildReconciliationDeps } from "../composition/reminder.js";
import { runReconciliation, type DstReconciliationCandidate as FullDstCandidate } from "../../../workers/reminder-reconciliation/reconciliation.js";
import { itemKey } from "../../../modules/expiration/domain/expiration-item.js";
import { policyKey, type ReminderPolicy } from "../../../modules/reminder/domain/reminder-policy.js";
import { defaultShardConfig } from "../../../modules/reminder/domain/shard-config.js";
import type { ReminderOccurrence } from "../../../modules/reminder/domain/reminder-occurrence.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const envTableName = process.env["TABLE_NAME"];
if (!envTableName) throw new Error("TABLE_NAME env var is required.");
const tableName: string = envTableName;
const { store, candidateSource, now } = buildReconciliationDeps(client, tableName);
const shardConfig = defaultShardConfig();
const logger = new SecureLogger({ baseContext: { service: "reminder-reconciliation" } });

export interface ReminderReconciliationEvent {
  mode: "CLAIMS" | "DST";
  scheduledTime: string;
}

/** Hard cap on pages drained per invocation - matches the design's "página lógica máx. 200"
 * per page with a bounded number of pages, so a pathological backlog can't make a single
 * invocation run indefinitely; anything beyond this is picked up by the NEXT scheduled
 * run (every 5 min for claims, daily for DST) rather than blocking this one. */
const MAX_PAGES = 25;

export async function handler(event: ReminderReconciliationEvent): Promise<void> {
  // m5-observability-design.md #2: EventBridge Scheduler producer, no upstream request to
  // inherit a correlationId from - new UUID per invocation.
  await runWithContext({ correlationId: randomUUID() }, () => handleReconciliation(event));
}

async function handleReconciliation(event: ReminderReconciliationEvent): Promise<void> {
  const mode = event.mode;

  const expiredClaimCandidates: ReminderOccurrence[] = [];
  const dstCandidates: FullDstCandidate[] = [];

  if (mode === "CLAIMS") {
    // GSI6 is ALL-projected - each candidate row already IS the full ReminderOccurrence
    // item (see ExpiredClaimCandidate's doc comment), so no extra fetch is needed.
    // Pagination is drained (bug found by Codex implementation review: the first version
    // only ever read page 1, silently leaving any backlog over one page unprocessed).
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await candidateSource.listExpiredClaims({ before: now(), cursor });
      expiredClaimCandidates.push(...(result.items as unknown as ReminderOccurrence[]));
      if (!result.cursor) break;
      cursor = result.cursor;
    }
  }

  if (mode === "DST") {
    // ReminderMaterializer (M3.5) writes a WORKSTATE#DST_PENDING GSI6 pointer whenever a
    // trigger's schedule was computed at an ambiguous/nonexistent local time, OR whose
    // timeZone observes DST at all (see reminder-materializer.ts - broadened per Codex
    // implementation review: a non-ambiguous 09:00 reminder in a DST-observing zone can
    // still need re-evaluation after an offset change, not just literally-ambiguous ones).
    // This query finds those candidates; occurrences in a fixed-offset timeZone never
    // appear here at all.
    const windowStart = now();
    const windowEnd = new Date(Date.parse(windowStart) + 7 * 24 * 60 * 60_000).toISOString();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await candidateSource.listDstCandidates({ window: { start: windowStart, end: windowEnd }, cursor });
      for (const light of result.items) {
        const policy = await store.get<ReminderPolicy>(policyKey(light.tenantId, light.policyId));
        if (!policy) continue;
        const item = await store.get<{ PK: string; SK: string; dueDate: string; version: number }>(itemKey(light.tenantId, light.itemId));
        if (!item) continue;
        dstCandidates.push({
          tenantId: light.tenantId,
          itemId: light.itemId,
          itemVersion: item.version,
          itemDueDate: item.dueDate,
          policy,
        });
      }
      if (!result.cursor) break;
      cursor = result.cursor;
    }
  }

  const result = await runReconciliation({ store, tableName, now, shardConfig }, { expiredClaimCandidates, dstCandidates });
  logger.info("reminder-reconciliation complete", { mode, scheduledTime: event.scheduledTime, ...result });
}

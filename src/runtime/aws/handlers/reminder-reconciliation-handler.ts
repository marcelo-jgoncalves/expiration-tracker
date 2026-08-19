/** Real handler for ReminderReconciliation (EventBridge Scheduler, `mode` field), replacing
 * the 501 placeholder. Two schedules invoke the same Lambda with different `detail.mode`
 * (m3.5-runtime-design.md §"Reconciliação"): CLAIMS (every 5 min) and DST (daily). Also one
 * of exactly two roles granted gsi6Read() - see infra/lib/dynamo-table.ts. */
import type { ScheduledEvent } from "aws-lambda";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildReconciliationDeps } from "../composition/reminder.js";
import { runReconciliation, type DstReconciliationCandidate as FullDstCandidate } from "../../../workers/reminder-reconciliation/reconciliation.js";
import { itemKey } from "../../../modules/expiration/domain/expiration-item.js";
import { policyKey, type ReminderPolicy } from "../../../modules/reminder/domain/reminder-policy.js";
import { defaultShardConfig } from "../../../modules/reminder/domain/shard-config.js";
import type { ReminderOccurrence } from "../../../modules/reminder/domain/reminder-occurrence.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const envTableName = process.env["TABLE_NAME"];
if (!envTableName) throw new Error("TABLE_NAME env var is required.");
const tableName: string = envTableName;
const { store, candidateSource, now } = buildReconciliationDeps(client, tableName);
const shardConfig = defaultShardConfig();
const logger = new SecureLogger({ baseContext: { service: "reminder-reconciliation" } });

interface ReconciliationEventDetail {
  mode: "CLAIMS" | "DST";
}

export async function handler(event: ScheduledEvent<ReconciliationEventDetail>): Promise<void> {
  const mode = event.detail.mode;

  let expiredClaimCandidates: ReminderOccurrence[] = [];
  const dstCandidates: FullDstCandidate[] = [];

  if (mode === "CLAIMS") {
    // GSI6 is ALL-projected - each candidate row already IS the full ReminderOccurrence
    // item (see ExpiredClaimCandidate's doc comment), so no extra fetch is needed.
    const page = await candidateSource.listExpiredClaims({ before: now() });
    expiredClaimCandidates = page.items as unknown as ReminderOccurrence[];
  }

  if (mode === "DST") {
    // ReminderMaterializer (M3.5) writes a WORKSTATE#DST_PENDING GSI6 pointer whenever a
    // trigger's schedule was computed at an ambiguous/nonexistent local time (dstKind !==
    // "NORMAL") - see reminder-materializer.ts. This query finds those candidates for
    // re-evaluation; occurrences that were never DST-ambiguous never appear here.
    const windowStart = now();
    const windowEnd = new Date(Date.parse(windowStart) + 7 * 24 * 60 * 60_000).toISOString();
    const page = await candidateSource.listDstCandidates({ window: { start: windowStart, end: windowEnd } });
    for (const light of page.items) {
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
  }

  const result = await runReconciliation({ store, tableName, now, shardConfig }, { expiredClaimCandidates, dstCandidates });
  logger.info("reminder-reconciliation complete", { mode, ...result });
}

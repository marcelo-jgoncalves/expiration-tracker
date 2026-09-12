/**
 * P0.4 (ReminderPolicy 1:1 uniqueness fix - `docs/architecture/decisions-log.md` D-280,
 * Claude<->Codex protocol APPROVED 9.2/10, docs/engineering/reviews/reminder-policy-p0-4-*
 * transcripts). Before this migration, `createPolicy` never checked for an existing
 * ITEM-scoped policy before writing a new one - 2+ live policies could coexist for the
 * same item, each independently materializing reminders (duplicate reminders, a real
 * reachable bug, not hypothetical). This script retires every duplicate down to exactly
 * one live policy per item, backed by the new fixed-SK discovery pointer
 * (`activePolicyPointerKey`, `reminder-policy.ts`) that `createPolicy`/`updatePolicy` now
 * enforce going forward, and cleans up the legacy per-policy `POLICYREF#<policyId>`
 * pointer rows the fixed pointer replaces.
 *
 * PRE-CONDITION (protocol Round 6 "passo 0" - a runbook step, not a code check this
 * script can enforce): run this ONLY after the deploy that ships `activePolicyPointerKey`
 * writes is fully live in `dev` - confirm the CD run for that deploy completed before
 * invoking this script. No older Lambda version may still be writing the legacy pointer
 * format while this runs.
 *
 * Algorithm (protocol Rounds 4-6, full transcript in the decision log):
 *  Phase 1 - ONE paginated `Scan` (ConsistentRead:true on every page), matching BOTH
 *    `entityType=ReminderPolicy` and `entityType=ReminderPolicyRef`, accumulated into two
 *    complete in-memory maps keyed by itemId BEFORE any decision is made (never decided
 *    per-page - a duplicate pair split across two scan pages must still be seen together):
 *      Map A (live): scope=ITEM, deletedAt absent.
 *      Map B (legacy pointers): SK begins with "POLICYREF#" (old per-policy format only -
 *        the new fixed "POLICYREF" SK is deliberately excluded, it can only be a row this
 *        very migration or a self-healing edit already wrote).
 *  Phase 2 - per itemId (union of both maps' keys), a strongly-consistent re-read of the
 *    fixed pointer (if any) and the policy it targets - closes the "a legitimate policy
 *    was created after Phase 1's scan observed this item" race without an operational
 *    freeze (protocol Round 5/6).
 *  Phase 3 - decide and write:
 *    - 0 live: no retirement transaction. If the fixed pointer nonetheless exists (only
 *      possible if it's stale/orphaned, since a valid one would have joined the live set),
 *      it is deleted too, conditioned on the exact value observed.
 *    - >=1 live, <=25 (cap - see below): one `TransactWriteItems` per item - tombstone
 *      every live policy that is NOT the winner (`deletedAt`+`enabled:false`+GSI8 pointer,
 *      atomically - the first real writer of `ReminderPolicy.deletedAt`, see
 *      `core-user-data-gsi8.ts`'s own doc comment anticipating exactly this), one
 *      `reminder.policy-changed.v1` retirement event per loser (`itemId:null,
 *      previousItemId:loser.itemId` - the worker then cancels its occurrences), a version
 *      fence on the winner, and an upsert/repair of the fixed pointer (create if absent,
 *      fence if already valid, repair-in-place if it exists but is wrong - never left
 *      unresolved, never reported as migrated without actually pointing at the winner).
 *    - >25 live: skipped and reported for manual review, never processed partially.
 *    Legacy pointer rows for the item are ALWAYS deleted in a separate, unbounded,
 *    uncapped pass - decoupled from the retirement transaction's cap on purpose (protocol
 *    Round 5/6): no code reads this format after this deploy, so each delete is
 *    independently safe regardless of the retirement outcome.
 *
 * --dry-run reports every decision (winner/losers/pointer action/legacy cleanup count)
 * without writing anything - always run this first against a real table.
 */
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { ScanCommand, GetCommand, DeleteCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createDocumentClient } from "../src/shared/dynamodb/client.js";
import { isConditionalCheckFailed } from "../src/shared/dynamodb/sdk-errors.js";
import { buildVersionConditionCheck, buildVersionedUpdate, buildConditionalPut, type TransactWriteEntry } from "../src/shared/dynamodb/occ.js";
import { deriveCoreUserDataMaintenanceDue, coreUserDataGsi8Keys } from "../src/shared/core-user-data-gsi8.js";
import { appendToTransaction } from "../src/shared/outbox/outbox.js";
import type { DomainEvent } from "../src/shared/contracts/events.js";
import { policyKey, activePolicyPointerKey, POLICY_REF_SK_PREFIX, type ReminderPolicy, type PolicyRef } from "../src/modules/reminder/domain/reminder-policy.js";

const POLICY_CHANGED = "reminder.policy-changed.v1";
const MAX_LIVE_PER_GROUP = 25; // 1 (winner fence) + 2*losers + 1 (pointer action) <= 100 TransactWriteItems limit, confirmed against AWS docs.
const ITEM_PARTITION_RE = /^TENANT#(.+)#ITEM#(.+)$/;

interface Args {
  table: string;
  dryRun: boolean;
}

export function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const table = get("--table");
  if (!table) throw new Error("--table <TableName> is required.");
  return { table, dryRun: argv.includes("--dry-run") };
}

interface LegacyPointer {
  PK: string;
  SK: string;
  policyId: string;
  tenantId: string;
}

interface ScanResult {
  liveByItemId: Map<string, ReminderPolicy[]>;
  legacyByItemId: Map<string, LegacyPointer[]>;
  /**
   * itemIds that own an EXISTING fixed pointer (`SK="POLICYREF"` exactly, never the legacy
   * `#`-suffixed form) but have no live policy of their own kind in this map - membership
   * only, never the row's content (decideGroup always re-reads the fixed pointer itself
   * fresh). Without this, an item whose ONLY signal in the whole table is an orphaned
   * fixed pointer (no live policy, no legacy pointer) would never enter the itemId
   * universe `run()` evaluates at all, and that orphan would never be cleaned up - the
   * same class of "universe of discovery incomplete" gap Codex's Round 5 finding raised
   * for legacy pointers, here for the fixed-pointer format. Maps to the tenantId parsed
   * off the same row's PK (needed to even issue the fixed-pointer re-read in Phase 2,
   * since neither Map A nor Map B may have anything to supply it from for this itemId).
   */
  fixedPointerItemIds: Map<string, string>;
}

/** Phase 1: one full, paginated, strongly-consistent scan - never decides per page. */
export async function scanAll(client: DynamoDBDocumentClient, table: string): Promise<ScanResult> {
  const liveByItemId = new Map<string, ReminderPolicy[]>();
  const legacyByItemId = new Map<string, LegacyPointer[]>();
  const fixedPointerItemIds = new Map<string, string>();

  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const result = await client.send(
      new ScanCommand({
        TableName: table,
        FilterExpression: "entityType = :rp OR entityType = :ref",
        ExpressionAttributeValues: { ":rp": "ReminderPolicy", ":ref": "ReminderPolicyRef" },
        ConsistentRead: true,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    for (const raw of result.Items ?? []) {
      if (raw["entityType"] === "ReminderPolicy") {
        const policy = raw as ReminderPolicy;
        if (policy.scope !== "ITEM" || !policy.itemId || policy.deletedAt) continue;
        const bucket = liveByItemId.get(policy.itemId) ?? [];
        bucket.push(policy);
        liveByItemId.set(policy.itemId, bucket);
      } else if (raw["entityType"] === "ReminderPolicyRef" && typeof raw["SK"] === "string") {
        const sk = raw["SK"] as string;
        const match = ITEM_PARTITION_RE.exec(raw["PK"] as string);
        if (!match) continue;
        const itemId = match[2]!;
        if (sk.startsWith(POLICY_REF_SK_PREFIX)) {
          const bucket = legacyByItemId.get(itemId) ?? [];
          bucket.push(raw as LegacyPointer);
          legacyByItemId.set(itemId, bucket);
        } else if (sk === "POLICYREF") {
          fixedPointerItemIds.set(itemId, match[1]!);
        }
      }
    }
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return { liveByItemId, legacyByItemId, fixedPointerItemIds };
}

export type GroupDecision =
  | { action: "NONE" }
  | { action: "SKIP_CAP"; liveCount: number }
  | {
      action: "RETIRE";
      tenantId: string;
      itemId: string;
      winner: ReminderPolicy;
      losers: ReminderPolicy[];
      pointerAction: "FENCE_ONLY" | "CREATE" | "REPAIR";
      /** Only set for REPAIR - the exact stale value the repair Put is conditioned on. */
      observedStalePolicyId?: string;
    }
  | { action: "DELETE_ORPHAN_FIXED_POINTER"; tenantId: string; itemId: string; observedPolicyId: string };

/** Phase 2+3 decision for one itemId - re-reads the fixed pointer fresh (never trusts Phase 1's scan for it) before deciding. */
export async function decideGroup(
  client: DynamoDBDocumentClient,
  table: string,
  tenantId: string,
  itemId: string,
  scannedLive: ReminderPolicy[],
): Promise<GroupDecision> {
  const pointerResult = await client.send(new GetCommand({ TableName: table, Key: activePolicyPointerKey(tenantId, itemId), ConsistentRead: true }));
  const fixedPointer = pointerResult.Item as PolicyRef | undefined;

  let pointerTarget: ReminderPolicy | undefined;
  if (fixedPointer) {
    const targetResult = await client.send(new GetCommand({ TableName: table, Key: policyKey(tenantId, fixedPointer.policyId), ConsistentRead: true }));
    const candidate = targetResult.Item as ReminderPolicy | undefined;
    if (candidate && !candidate.deletedAt && candidate.tenantId === tenantId && candidate.scope === "ITEM" && candidate.itemId === itemId) {
      pointerTarget = candidate;
    }
  }

  const liveById = new Map<string, ReminderPolicy>(scannedLive.map((p) => [p.policyId, p]));
  if (pointerTarget) liveById.set(pointerTarget.policyId, pointerTarget);
  const live = [...liveById.values()];

  if (live.length === 0) {
    if (fixedPointer) return { action: "DELETE_ORPHAN_FIXED_POINTER", tenantId, itemId, observedPolicyId: fixedPointer.policyId };
    return { action: "NONE" };
  }

  if (live.length > MAX_LIVE_PER_GROUP) return { action: "SKIP_CAP", liveCount: live.length };

  const winner =
    pointerTarget && liveById.has(pointerTarget.policyId)
      ? pointerTarget
      : [...live].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.policyId < b.policyId ? -1 : 1))[0]!;
  const losers = live.filter((p) => p.policyId !== winner.policyId);

  let pointerAction: "FENCE_ONLY" | "CREATE" | "REPAIR";
  let observedStalePolicyId: string | undefined;
  if (!fixedPointer) {
    pointerAction = "CREATE";
  } else if (fixedPointer.policyId === winner.policyId) {
    pointerAction = "FENCE_ONLY";
  } else {
    pointerAction = "REPAIR";
    observedStalePolicyId = fixedPointer.policyId;
  }

  return { action: "RETIRE", tenantId, itemId, winner, losers, pointerAction, observedStalePolicyId };
}

/** Builds the one TransactWriteItems for a RETIRE decision - never called for any other decision kind. */
export function buildRetireTransaction(
  table: string,
  decision: Extract<GroupDecision, { action: "RETIRE" }>,
  now: string,
): TransactWriteEntry[] {
  const entries: TransactWriteEntry[] = [
    buildVersionConditionCheck({ tableName: table, key: policyKey(decision.tenantId, decision.winner.policyId), expectedVersion: decision.winner.version }),
  ];

  const correlationId = randomUUID();
  for (const loser of decision.losers) {
    const due = deriveCoreUserDataMaintenanceDue({ deletedAt: now });
    const gsi8 = due.dueAtIso
      ? coreUserDataGsi8Keys({ dueAtIso: due.dueAtIso, tenantId: decision.tenantId, entityType: "ReminderPolicy", sk: policyKey(decision.tenantId, loser.policyId).SK })
      : undefined;
    entries.push({
      Update: buildVersionedUpdate({
        tableName: table,
        key: policyKey(decision.tenantId, loser.policyId),
        tenantId: decision.tenantId,
        expectedVersion: loser.version,
        now,
        set: { deletedAt: now, enabled: false, ...gsi8 },
      }),
    });

    const event: DomainEvent = {
      specVersion: "1.0",
      eventId: randomUUID(),
      eventType: POLICY_CHANGED,
      source: "expiration-tracker.reminder",
      occurredAt: now,
      correlationId,
      tenantId: decision.tenantId,
      actor: { type: "SYSTEM" },
      aggregate: { type: "ReminderPolicy", id: loser.policyId, version: loser.version + 1 },
      data: { policyId: loser.policyId, itemId: null, previousItemId: loser.itemId },
    };
    appendToTransaction(entries, table, event, "SQS_REMINDER_MATERIALIZATION_TRIGGER_V1");
  }

  const pointerItem = { ...activePolicyPointerKey(decision.tenantId, decision.itemId), entityType: "ReminderPolicyRef" as const, policyId: decision.winner.policyId, tenantId: decision.tenantId };
  if (decision.pointerAction === "CREATE") {
    entries.push({ Put: buildConditionalPut({ tableName: table, item: pointerItem, conditionExpression: "attribute_not_exists(PK)" }) });
  } else if (decision.pointerAction === "FENCE_ONLY") {
    entries.push({
      ConditionCheck: {
        TableName: table,
        Key: activePolicyPointerKey(decision.tenantId, decision.itemId),
        ConditionExpression: "attribute_exists(PK) AND policyId = :policyId",
        ExpressionAttributeValues: { ":policyId": decision.winner.policyId },
      },
    });
  } else {
    entries.push({
      Put: buildConditionalPut({
        tableName: table,
        item: pointerItem,
        conditionExpression: "policyId = :observedStalePolicyId",
        values: { ":observedStalePolicyId": decision.observedStalePolicyId },
      }),
    });
  }

  return entries;
}

interface RunSummary {
  itemsScanned: number;
  retired: number;
  policiesTombstoned: number;
  pointersRepaired: number;
  pointersCreated: number;
  orphanFixedPointersDeleted: number;
  legacyPointersDeleted: number;
  skippedOverCap: number;
}

export async function run(client: DynamoDBDocumentClient, table: string, dryRun: boolean): Promise<RunSummary> {
  console.log(`[migrate-reminder-policy-uniqueness] table=${table} dryRun=${dryRun} - scanning...`);
  const { liveByItemId, legacyByItemId, fixedPointerItemIds } = await scanAll(client, table);

  const allItemIds = new Set<string>([...liveByItemId.keys(), ...legacyByItemId.keys(), ...fixedPointerItemIds.keys()]);
  console.log(`[migrate-reminder-policy-uniqueness] scan complete: ${liveByItemId.size} item(s) with live ITEM-scoped policies, ${legacyByItemId.size} item(s) with legacy pointers, ${allItemIds.size} total to evaluate.`);

  const summary: RunSummary = {
    itemsScanned: allItemIds.size,
    retired: 0,
    policiesTombstoned: 0,
    pointersRepaired: 0,
    pointersCreated: 0,
    orphanFixedPointersDeleted: 0,
    legacyPointersDeleted: 0,
    skippedOverCap: 0,
  };

  for (const itemId of allItemIds) {
    const scannedLive = liveByItemId.get(itemId) ?? [];
    const legacyRefs = legacyByItemId.get(itemId) ?? [];
    const tenantId = scannedLive[0]?.tenantId ?? legacyRefs[0]?.tenantId ?? fixedPointerItemIds.get(itemId);
    if (!tenantId) continue;

    const decision = await decideGroup(client, table, tenantId, itemId, scannedLive);

    if (decision.action === "SKIP_CAP") {
      console.warn(`[migrate-reminder-policy-uniqueness] SKIPPED itemId=${itemId}: ${decision.liveCount} live policies exceed the ${MAX_LIVE_PER_GROUP} cap - manual review required.`);
      summary.skippedOverCap += 1;
      continue;
    }

    if (decision.action === "DELETE_ORPHAN_FIXED_POINTER") {
      console.log(`[migrate-reminder-policy-uniqueness] itemId=${itemId}: 0 live policies, deleting orphaned fixed pointer -> ${decision.observedPolicyId}${dryRun ? " (dry-run)" : ""}`);
      if (!dryRun) {
        try {
          await client.send(
            new DeleteCommand({
              TableName: table,
              Key: activePolicyPointerKey(tenantId, itemId),
              ConditionExpression: "policyId = :observedPolicyId",
              ExpressionAttributeValues: { ":observedPolicyId": decision.observedPolicyId },
            }),
          );
          summary.orphanFixedPointersDeleted += 1;
        } catch (err) {
          if (!isConditionalCheckFailed(err)) throw err;
        }
      } else {
        summary.orphanFixedPointersDeleted += 1;
      }
    }

    if (decision.action === "RETIRE") {
      console.log(
        `[migrate-reminder-policy-uniqueness] itemId=${itemId}: winner=${decision.winner.policyId} losers=[${decision.losers.map((l) => l.policyId).join(", ")}] pointerAction=${decision.pointerAction}${dryRun ? " (dry-run)" : ""}`,
      );
      if (!dryRun) {
        const entries = buildRetireTransaction(table, decision, new Date().toISOString());
        await client.send(new TransactWriteCommand({ TransactItems: entries as unknown as ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"] }));
      }
      summary.retired += 1;
      summary.policiesTombstoned += decision.losers.length;
      if (decision.pointerAction === "CREATE") summary.pointersCreated += 1;
      if (decision.pointerAction === "REPAIR") summary.pointersRepaired += 1;
    }

    // Legacy pointer cleanup - decoupled, unbounded, always safe (protocol Round 5/6):
    // never rolled into the retirement transaction's cap, never gated on its outcome.
    for (const ref of legacyRefs) {
      console.log(`[migrate-reminder-policy-uniqueness] itemId=${itemId}: deleting legacy pointer ${ref.SK}${dryRun ? " (dry-run)" : ""}`);
      if (!dryRun) {
        await client.send(new DeleteCommand({ TableName: table, Key: { PK: ref.PK, SK: ref.SK } }));
      }
      summary.legacyPointersDeleted += 1;
    }
  }

  return summary;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const client = createDocumentClient();
  const summary = await run(client, args.table, args.dryRun);
  console.log(`[migrate-reminder-policy-uniqueness] DONE: ${JSON.stringify(summary)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error("[migrate-reminder-policy-uniqueness] FAILED:", err);
    process.exitCode = 1;
  });
}

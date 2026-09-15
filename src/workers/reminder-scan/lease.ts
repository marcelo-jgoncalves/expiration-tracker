/**
 * ReminderScanLease state machine - D-300
 * (`docs/architecture/reviews/reminder-producer-implementation-plan-scoping/DECISION.md` §2/§4),
 * the fully-approved (Claude/Codex 9.3/9.3) implementation plan for PERF-12 (reminder-producer
 * permanently losing occurrences under burst load). This module builds the exact
 * TransactWriteItems for each of the three lease transitions (acquire, reclaim, checkpoint) -
 * ONE `TransactWriteItems` per transition containing the lease write plus (except at COMPLETED)
 * an `appendToTransaction` for `SQS_REMINDER_SCAN_CONTINUATION_V1`, per the DECISION table.
 *
 * Reuses the main table (no new table) - PK: `SCAN#<shardFnVersion>#<shardId>#<minuteISO>`,
 * SK: `LEASE`. All writes go through `occ.ts` (`buildConditionalPut`/
 * `buildUnscopedVersionedUpdate`) - never a raw `UpdateItem`/`PutItem`.
 */
import { buildConditionalPut, buildUnscopedVersionedUpdate, type EntityKey, type TransactWriteEntry } from "../../shared/dynamodb/occ.js";
import { appendToTransaction, type OutboxDestination } from "../../shared/outbox/outbox.js";
import type { DomainEvent, SqsCommandEnvelope } from "../../shared/contracts/events.js";
import { SYSTEM_TENANT_SENTINEL } from "../../shared/contracts/events.js";
import { serializeCanonicalKey } from "../../shared/dynamodb/canonical-key.js";
import { GSI6PK_SCANLEASE_IN_PROGRESS } from "../../modules/reminder/ports/reconciliation-candidate-source.js";

const SCAN_CONTINUATION_DESTINATION: OutboxDestination = "SQS_REMINDER_SCAN_CONTINUATION_V1";

/** GSI6PK constant for lease-in-progress detection by `reminder-reconciliation`'s 3rd pass
 * (DECISION.md §7) - present ONLY while IN_PROGRESS, removed at COMPLETED. Re-exported here
 * (single source of truth lives in reconciliation-candidate-source.ts, a ports module) so every
 * existing import site of this constant from lease.ts keeps working unchanged. */
export { GSI6PK_SCANLEASE_IN_PROGRESS };

export interface ReminderScanLease extends Record<string, unknown>, EntityKey {
  SK: "LEASE";
  entityType: "ReminderScanLease";
  status: "IN_PROGRESS" | "COMPLETED";
  ownerToken: string;
  leaseUntil: string;
  /** Canonical-serialized `ExclusiveStartKey` (see canonical-key.ts) - absent on page 1. */
  lastEvaluatedKey?: string;
  pagesProcessed: number;
  candidatesPublished: number;
  version: number;
  purgeAfterTtl: number;
  GSI6PK?: typeof GSI6PK_SCANLEASE_IN_PROGRESS;
  GSI6SK?: string;
}

export interface ShardMinuteRef {
  shardFnVersion: number;
  shardId: number;
  /** ISO instant, floored to the minute. */
  minuteISO: string;
}

export function leaseKey(ref: ShardMinuteRef): { PK: string; SK: "LEASE" } {
  return { PK: `SCAN#${ref.shardFnVersion}#${ref.shardId}#${ref.minuteISO}`, SK: "LEASE" };
}

/** Inverse of `leaseKey()` - D-300 §7: `reminder-reconciliation`'s SCANLEASE pass discovers stuck
 * leases via GSI6 (a row that only carries PK/SK/ownerToken/leaseUntil/version, per
 * `StuckScanLeaseCandidate`'s ALL-projection shape - never shardFnVersion/shardId/minuteISO as
 * separate stored fields, DECISION.md §2's item schema doesn't duplicate them) and must
 * reconstruct the `ShardMinuteRef` those fields require to call `buildReclaimLeaseTransaction`.
 * Throws on a PK that doesn't match this module's own `leaseKey()` format - a malformed PK here
 * would mean a GSI6 row that isn't actually a ReminderScanLease at all, which must never be
 * silently reclaimed as one. */
export function parseLeaseKey(pk: string): ShardMinuteRef {
  const match = /^SCAN#(\d+)#(\d+)#(.+)$/.exec(pk);
  if (!match) {
    throw new Error(`parseLeaseKey: malformed ReminderScanLease PK: ${pk}`);
  }
  return { shardFnVersion: Number(match[1]), shardId: Number(match[2]), minuteISO: match[3] as string };
}

function leaseGsi6Sk(leaseUntil: string, ref: ShardMinuteRef): string {
  return `${leaseUntil}#${ref.shardFnVersion}#${ref.shardId}#${ref.minuteISO}`;
}

/** 7 days, in seconds - DECISION.md §2: `purgeAfterTtl` is `leaseUntil + 7d`, the real TTL
 * attribute on the table. */
const PURGE_AFTER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function purgeAfterTtlEpochSeconds(leaseUntil: string): number {
  return Math.floor((Date.parse(leaseUntil) + PURGE_AFTER_TTL_MS) / 1000);
}

/** Full `SqsCommandEnvelope` for the scan continuation message - DECISION.md §4: the relay does
 * NOT wrap `event.data`, so the envelope must already be fully formed here, mirroring
 * `DispatchCommand` in `producer.ts:246-284`. `rolloutEpoch` is mandatory (DECISION.md §8's
 * roll-forward fencing mechanism). */
export interface ReminderScanContinuationCommand extends SqsCommandEnvelope<{
  shardFnVersion: number;
  shardId: number;
  minuteISO: string;
  ownerToken: string;
  /** Canonical-serialized `ExclusiveStartKey` to resume from - absent for a fresh start (page 1). */
  lastEvaluatedKey?: string;
  rolloutEpoch: number;
}> {
  commandType: "reminder.scan-continuation.v1";
}

export interface LeaseTransitionDeps {
  tableName: string;
  now: () => string;
  newEventId: () => string;
  correlationId: () => string;
  /** DECISION.md §8: SCAN_MODE_EPOCH, fences stale continuation messages from before a
   * rollback/roll-forward cycle. */
  rolloutEpoch: number;
}

function buildContinuationCommand(deps: LeaseTransitionDeps, ref: ShardMinuteRef, ownerToken: string, lastEvaluatedKey: string | undefined): ReminderScanContinuationCommand {
  const now = deps.now();
  return {
    messageVersion: 1,
    messageId: deps.newEventId(),
    commandType: "reminder.scan-continuation.v1",
    createdAt: now,
    correlationId: deps.correlationId(),
    tenantId: SYSTEM_TENANT_SENTINEL,
    deduplicationKey: `${ref.shardFnVersion}|${ref.shardId}|${ref.minuteISO}|${ownerToken}`,
    data: { shardFnVersion: ref.shardFnVersion, shardId: ref.shardId, minuteISO: ref.minuteISO, ownerToken, lastEvaluatedKey, rolloutEpoch: deps.rolloutEpoch },
  };
}

/**
 * Real bug found live during D-300 revalidation (2026-09-15, 10k dev burst): this originally
 * hardcoded `aggregate.version: 0`, but `domain-event-envelope.v1.json` requires
 * `aggregateVersion >= 1` - every scan-continuation outbox record failed the relay's own schema
 * validation (`dispatch-outbox-relay schema-invalid OutboxEvent image`, `/aggregateVersion must
 * be >= 1`), forever, so no continuation message EVER reached the real scan queue and every lease
 * just kept getting reclaimed by the next enumeration tick without ever being worked - a
 * reproduction of PERF-12's exact symptom (occurrences never claimed) via a NEW defect, not the
 * old cause. Fixed by threading through the REAL version the lease item is being written at in
 * this same transaction (never a placeholder) - `leaseVersion` is the caller's responsibility,
 * since only the caller knows whether this is a fresh version:1 write (acquire/reclaim) or a
 * checkpoint's `expectedVersion + 1`.
 */
function appendContinuationOutbox(tx: TransactWriteEntry[], deps: LeaseTransitionDeps, ref: ShardMinuteRef, command: ReminderScanContinuationCommand, leaseVersion: number): void {
  const now = deps.now();
  const event: DomainEvent = {
    specVersion: "1.0",
    eventId: deps.newEventId(),
    eventType: "ReminderScanContinuationRequested",
    source: "expiration-tracker.reminder-producer",
    occurredAt: now,
    correlationId: command.correlationId,
    tenantId: SYSTEM_TENANT_SENTINEL,
    actor: { type: "SYSTEM" },
    aggregate: { type: "ReminderScanLease", id: `${ref.shardFnVersion}#${ref.shardId}#${ref.minuteISO}`, version: leaseVersion },
    data: command as unknown as Record<string, unknown>,
  };
  appendToTransaction(tx, deps.tableName, event, SCAN_CONTINUATION_DESTINATION);
}

export interface AcquireOrReclaimResult {
  tx: TransactWriteEntry[];
  ownerToken: string;
}

/** Acquire a fresh lease - DECISION.md §2 row 1: `buildConditionalPut`, `version: 1`,
 * `pagesProcessed: 0`, condition `attribute_not_exists(PK)`. Always followed by a continuation
 * outbox event with no `lastEvaluatedKey` (start, page 1). */
export function buildAcquireLeaseTransaction(deps: LeaseTransitionDeps, ref: ShardMinuteRef, ownerToken: string, leaseDurationMs: number): AcquireOrReclaimResult {
  const now = deps.now();
  const leaseUntil = new Date(Date.parse(now) + leaseDurationMs).toISOString();
  const item: ReminderScanLease = {
    ...leaseKey(ref),
    entityType: "ReminderScanLease",
    status: "IN_PROGRESS",
    ownerToken,
    leaseUntil,
    pagesProcessed: 0,
    candidatesPublished: 0,
    version: 1,
    purgeAfterTtl: purgeAfterTtlEpochSeconds(leaseUntil),
    GSI6PK: GSI6PK_SCANLEASE_IN_PROGRESS,
    GSI6SK: leaseGsi6Sk(leaseUntil, ref),
  };
  const tx: TransactWriteEntry[] = [{ Put: buildConditionalPut({ tableName: deps.tableName, item, conditionExpression: "attribute_not_exists(PK)" }) }];
  const command = buildContinuationCommand(deps, ref, ownerToken, undefined);
  appendContinuationOutbox(tx, deps, ref, command, item.version);
  return { tx, ownerToken };
}

/** Reclaim a stale lease (previous owner's invocation died without checkpointing before
 * `leaseUntil`) - DECISION.md §2 row 2: `buildConditionalPut` (full overwrite - version/counters
 * reset, new `ownerToken`), condition `status = :inProgress AND leaseUntil < :leaseNow`.
 * Followed by a fresh continuation outbox event (start, page 1) - the reclaiming invocation
 * always restarts scanning this (shard, minute) from the beginning, never resumes the dead
 * owner's `lastEvaluatedKey` (DECISION.md §2/§8: no state from a stale owner is trusted). */
export function buildReclaimLeaseTransaction(deps: LeaseTransitionDeps, ref: ShardMinuteRef, newOwnerToken: string, leaseDurationMs: number): AcquireOrReclaimResult {
  const now = deps.now();
  const leaseNow = now;
  const leaseUntil = new Date(Date.parse(now) + leaseDurationMs).toISOString();
  const item: ReminderScanLease = {
    ...leaseKey(ref),
    entityType: "ReminderScanLease",
    status: "IN_PROGRESS",
    ownerToken: newOwnerToken,
    leaseUntil,
    pagesProcessed: 0,
    candidatesPublished: 0,
    version: 1,
    purgeAfterTtl: purgeAfterTtlEpochSeconds(leaseUntil),
    GSI6PK: GSI6PK_SCANLEASE_IN_PROGRESS,
    GSI6SK: leaseGsi6Sk(leaseUntil, ref),
  };
  const tx: TransactWriteEntry[] = [
    {
      Put: buildConditionalPut({
        tableName: deps.tableName,
        item,
        conditionExpression: "#status = :inProgress AND #leaseUntil < :leaseNow",
        names: { "#status": "status", "#leaseUntil": "leaseUntil" },
        values: { ":inProgress": "IN_PROGRESS", ":leaseNow": leaseNow },
      }),
    },
  ];
  const command = buildContinuationCommand(deps, ref, newOwnerToken, undefined);
  appendContinuationOutbox(tx, deps, ref, command, item.version);
  return { tx, ownerToken: newOwnerToken };
}

export interface CheckpointInput {
  ref: ShardMinuteRef;
  ownerToken: string;
  expectedVersion: number;
  /** The `lastEvaluatedKey` this invocation started from (undefined if it was invoked as page
   * 1) - used to pick the correct condition branch (DECISION.md §2: "dois branches de código
   * distintos, nunca um OR"). Already canonical-serialized. */
  startedFromLastEvaluatedKey: string | undefined;
  /** The `lastEvaluatedKey` DynamoDB returned for THIS page - `undefined` means this was the
   * final page (no more work), which routes to the COMPLETED branch. Already canonical-serialized
   * by the caller via `serializeCanonicalKey`. */
  nextLastEvaluatedKey: string | undefined;
  pagesProcessedTotal: number;
  candidatesPublishedTotal: number;
  leaseDurationMs: number;
}

/**
 * Checkpoint transition - DECISION.md §2 rows 3/4: same `buildUnscopedVersionedUpdate` builder
 * for both "more pages" and "last page", differing only in `set`/`remove` and whether a
 * continuation outbox event is appended. Condition (both branches):
 * `ownerToken = :myToken AND leaseUntil >= :leaseNow AND` + EITHER
 * `attribute_not_exists(lastEvaluatedKey)` (this invocation was page 1) OR
 * `lastEvaluatedKey = :myStartKey` (this invocation was a continuation) - never an OR of the two,
 * per the DECISION's explicit "dois branches de código distintos".
 */
export function buildCheckpointLeaseTransaction(deps: LeaseTransitionDeps, input: CheckpointInput): TransactWriteEntry[] {
  const now = deps.now();
  // `:leaseNow`, never `:now` - `:now` is occ.ts's own reserved placeholder for `updatedAt`.
  const leaseNow = now;
  const isCompleting = input.nextLastEvaluatedKey === undefined;

  const names: Record<string, string> = { "#ownerToken": "ownerToken", "#leaseUntil": "leaseUntil" };
  const values: Record<string, unknown> = { ":myToken": input.ownerToken, ":leaseNow": leaseNow };
  let positionClause: string;
  if (input.startedFromLastEvaluatedKey === undefined) {
    positionClause = "attribute_not_exists(#lastEvaluatedKey)";
    names["#lastEvaluatedKey"] = "lastEvaluatedKey";
  } else {
    positionClause = "#lastEvaluatedKey = :myStartKey";
    names["#lastEvaluatedKey"] = "lastEvaluatedKey";
    values[":myStartKey"] = input.startedFromLastEvaluatedKey;
  }

  const set: Record<string, unknown> = {
    pagesProcessed: input.pagesProcessedTotal,
    candidatesPublished: input.candidatesPublishedTotal,
  };
  const remove: string[] = [];
  if (isCompleting) {
    set["status"] = "COMPLETED";
    remove.push("GSI6PK", "GSI6SK");
  } else {
    set["lastEvaluatedKey"] = input.nextLastEvaluatedKey;
    const leaseUntil = new Date(Date.parse(now) + input.leaseDurationMs).toISOString();
    set["leaseUntil"] = leaseUntil;
    set["GSI6SK"] = leaseGsi6Sk(leaseUntil, input.ref);
  }

  const update = buildUnscopedVersionedUpdate({
    tableName: deps.tableName,
    key: leaseKey(input.ref),
    expectedVersion: input.expectedVersion,
    set,
    remove,
    now,
    extraConditions: [{ expression: `#ownerToken = :myToken AND #leaseUntil >= :leaseNow AND ${positionClause}`, names, values }],
  });

  const tx: TransactWriteEntry[] = [{ Update: update }];
  if (!isCompleting) {
    const command = buildContinuationCommand(deps, input.ref, input.ownerToken, input.nextLastEvaluatedKey);
    // The Update above increments `version` by exactly 1 (occ.ts's own "#version = #version +
    // :one" - see buildUnscopedVersionedUpdate) - the outbox event's aggregate.version must
    // match the ACTUAL post-write version, never the pre-write expectedVersion.
    appendContinuationOutbox(tx, deps, input.ref, command, input.expectedVersion + 1);
  }
  return tx;
}

export { serializeCanonicalKey };

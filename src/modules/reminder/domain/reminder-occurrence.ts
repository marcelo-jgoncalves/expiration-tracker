/**
 * ReminderOccurrence — data-model.md §2 (`TENANT#t#ITEM#i` / `OCC#<scheduledAt>#<occurrenceId>`,
 * co-located under the parent ExpirationItem's partition) and §3's GSI3 scheduler index
 * (the documented global-PK exception, ratified in data-model.md §3 and
 * implementation-blueprint.md §9.2/§23.3 item 10).
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export type ReminderOccurrenceStatus = "SCHEDULED" | "CLAIMED" | "CANCELLED" | "TRIGGERED" | "ACKED";

export interface ReminderOccurrence extends EntityKey {
  entityType: "ReminderOccurrence";
  occurrenceId: string;
  tenantId: string;
  itemId: string;
  policyId: string;
  triggerId: string;
  scheduledAt: string; // UTC ISO-8601 instant
  localScheduledAt: string; // "YYYY-MM-DDTHH:mm:ss", no offset - the wall clock this was computed from
  timeZone: string;
  originalRule: { offset: string; localTime: string };
  itemVersion: number;
  policyVersion: number;
  shard: string; // zero-padded shard number, string form as used in GSI3PK
  shardFnVersion: number;
  status: ReminderOccurrenceStatus;
  claimedAt?: string;
  claimExpiresAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  GSI3PK?: string; // present only while status === SCHEDULED (or CLAIMED, see note in materializer) - removed once TRIGGERED/CANCELLED so the scheduler index only ever contains live work
  GSI3SK?: string;
}

export function occurrenceKey(tenantId: string, itemId: string, scheduledAt: string, occurrenceId: string): { PK: string; SK: string } {
  return { PK: `TENANT#${tenantId}#ITEM#${itemId}`, SK: `OCC#${scheduledAt}#${occurrenceId}` };
}

/**
 * shard = stableHash(occurrenceId) mod N (implementation-blueprint.md §9.2). FNV-1a 32-bit
 * - deterministic, dependency-free, uniform enough for shard fan-out (not a security hash).
 */
export function stableHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function shardOf(occurrenceId: string, shardCount: number): number {
  return stableHash(occurrenceId) % shardCount;
}

function minuteBucket(scheduledAtUtcIso: string): string {
  // "2026-09-10T12:03:00.000Z" -> "202609101203"
  const d = new Date(scheduledAtUtcIso);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`
  );
}

/**
 * Builds the GSI3 keys for a materialized occurrence. `shardCount`/`shardFnVersion` are
 * the ACTIVE shard configuration at materialization time (versioned per §9.2's reshard
 * runbook - see shard-config.ts).
 */
export function gsi3Keys(input: {
  tenantId: string;
  occurrenceId: string;
  scheduledAt: string;
  shardCount: number;
}): { GSI3PK: string; GSI3SK: string; shard: string } {
  const shardNum = shardOf(input.occurrenceId, input.shardCount);
  const shard = String(shardNum).padStart(2, "0");
  return {
    GSI3PK: `DUE#${minuteBucket(input.scheduledAt)}#${shard}`,
    GSI3SK: `TENANT#${input.tenantId}#OCCURRENCE#${input.occurrenceId}`,
    shard,
  };
}

/** Enumerates the GSI3PK values to query for a given UTC minute across all shards of a given generation - used by both the producer (current minute + lookback) and reconciliation. */
export function gsi3PartitionsForMinute(minuteUtc: Date, shardCount: number): string[] {
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const bucket =
    `${minuteUtc.getUTCFullYear()}${pad(minuteUtc.getUTCMonth() + 1)}${pad(minuteUtc.getUTCDate())}` +
    `${pad(minuteUtc.getUTCHours())}${pad(minuteUtc.getUTCMinutes())}`;
  const partitions: string[] = [];
  for (let s = 0; s < shardCount; s++) {
    partitions.push(`DUE#${bucket}#${String(s).padStart(2, "0")}`);
  }
  return partitions;
}

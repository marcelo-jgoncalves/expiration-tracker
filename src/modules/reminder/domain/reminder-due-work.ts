import type { EntityKey } from "../../../shared/dynamodb/occ.js";

// ADR-0016 Decision A (2026-09-25) retired the "CHASING" kind (document-chasing feature, fully
// removed) - this due-work queue is once again reminder-only.
export type ReminderDueWorkKind = "REMINDER";

export interface ReminderDueWorkItem extends EntityKey {
  entityType: "REMINDER_DUE_WORK";
  entityKind: ReminderDueWorkKind;
  tenantId: string;
  occurrenceId: string;
  occurrencePK: string;
  occurrenceSK: string;
  scheduledAt: string;
  shardFnVersion: number;
  shardId: number;
  createdAt: string;
  updatedAt: string;
  purgeAfterTtl: number;
}

function assertIsoInstant(value: string, field: string): void {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${field} must be a canonical ISO-8601 UTC instant`);
  }
}

export function dueWorkPartition(input: { shardFnVersion: number; shardId: number; scheduledAt: string }): string {
  assertIsoInstant(input.scheduledAt, "scheduledAt");
  const minute = new Date(Math.floor(Date.parse(input.scheduledAt) / 60_000) * 60_000).toISOString();
  return `DUE#v${input.shardFnVersion}#s${input.shardId}#m${minute}`;
}

export function dueWorkSortKey(input: {
  scheduledAt: string;
  entityKind: ReminderDueWorkKind;
  tenantId: string;
  occurrenceId: string;
}): string {
  assertIsoInstant(input.scheduledAt, "scheduledAt");
  return `AT#${input.scheduledAt}#K#${input.entityKind}#T#${input.tenantId}#I#${input.occurrenceId}`;
}

export function dueWorkUpperBound(observedNow: string): string {
  assertIsoInstant(observedNow, "observedNow");
  return `AT#${observedNow}#\uffff`;
}

export function buildReminderDueWorkItem(input: {
  entityKind: ReminderDueWorkKind;
  tenantId: string;
  occurrenceId: string;
  occurrenceKey: EntityKey;
  scheduledAt: string;
  shardFnVersion: number;
  shardId: number;
  now: string;
  purgeAfterTtl: number;
}): ReminderDueWorkItem {
  assertIsoInstant(input.now, "now");
  return {
    PK: dueWorkPartition(input),
    SK: dueWorkSortKey(input),
    entityType: "REMINDER_DUE_WORK",
    entityKind: input.entityKind,
    tenantId: input.tenantId,
    occurrenceId: input.occurrenceId,
    occurrencePK: input.occurrenceKey.PK,
    occurrenceSK: input.occurrenceKey.SK,
    scheduledAt: input.scheduledAt,
    shardFnVersion: input.shardFnVersion,
    shardId: input.shardId,
    createdAt: input.now,
    updatedAt: input.now,
    purgeAfterTtl: input.purgeAfterTtl,
  };
}

export function dueWorkKeyForOccurrence(input: {
  entityKind: ReminderDueWorkKind;
  tenantId: string;
  occurrenceId: string;
  scheduledAt: string;
  shardFnVersion: number;
  shardId: number;
}): EntityKey {
  return {
    PK: dueWorkPartition(input),
    SK: dueWorkSortKey(input),
  };
}

/**
 * DomainEvent envelope type - mirrors schemas/events/domain-event-envelope.v1.json
 * (implementation-blueprint.md #6.1). Keep this in sync with the JSON schema by hand for
 * now; test/contract/schemas.test.ts cross-checks example fixtures against the schema so
 * drift is caught even without codegen.
 */

export type Actor = { type: "SYSTEM" } | { type: "USER"; userId: string };

/**
 * D-300 (`reminder-producer-implementation-plan-scoping/DECISION.md` §4): sentinel `tenantId`
 * for the one event/command family that is genuinely not tenant-owned - the
 * `ReminderScanLease` continuation message (`SQS_REMINDER_SCAN_CONTINUATION_V1`), which
 * coordinates a system-level scan across ALL tenants sharing one (shard, minute), not any single
 * tenant's own work. Formalized here (not just a magic string at the call site) precisely so any
 * tenant-partitioning/authorization logic that pattern-matches `tenantId` has one place to
 * special-case it, and so `"SYSTEM"` is never mistaken for - or confused with - a real
 * (fabricated or otherwise) tenant id. Never consumable by per-tenant business logic.
 */
export const SYSTEM_TENANT_SENTINEL = "SYSTEM";

export interface AggregateRef {
  type: string;
  id: string;
  version: number;
}

export interface DomainEvent<TData extends Record<string, unknown> = Record<string, unknown>> {
  specVersion: "1.0";
  eventId: string;
  eventType: string;
  source: string;
  occurredAt: string;
  correlationId: string;
  causationId?: string;
  tenantId: string;
  actor: Actor;
  aggregate: AggregateRef;
  data: TData;
}

export interface SqsCommandEnvelope<TData extends Record<string, unknown> = Record<string, unknown>> {
  messageVersion: 1;
  messageId: string;
  commandType: string;
  createdAt: string;
  correlationId: string;
  causationId?: string;
  tenantId: string;
  deduplicationKey: string;
  data: TData;
}

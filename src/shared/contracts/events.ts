/**
 * DomainEvent envelope type - mirrors schemas/events/domain-event-envelope.v1.json
 * (implementation-blueprint.md #6.1). Keep this in sync with the JSON schema by hand for
 * now; test/contract/schemas.test.ts cross-checks example fixtures against the schema so
 * drift is caught even without codegen.
 */

export type Actor = { type: "SYSTEM" } | { type: "USER"; userId: string };

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

/**
 * Request-scoped correlation context via AsyncLocalStorage (m5-observability-design.md #2).
 * runWithContext is called once per record for batch handlers (SQS, DynamoDB Streams, sweeper) -
 * never once per invocation for those - so context never leaks across records in the same batch.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  correlationId: string;
  tenantId?: string;
  requestId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * m5-observability-design.md #2: correlationId for an SQS record whose sender (relay/
 * sweeper's composition-root senders, src/runtime/aws/composition/*.ts) propagates the
 * original business correlationId via this exact MessageAttribute name - see
 * outboxRecordCorrelationId (src/shared/outbox/outbox.ts) for the sender side of this same
 * contract. Falls back to the SQS messageId only for a message that never got the
 * attribute (pre-M5 in-flight, or a queue whose producer has no upstream correlationId to
 * propagate, e.g. SES/SNS-sourced messages) - pulled out as its own pure function so the
 * extraction itself is unit-testable without a handler module's side-effecting top-level
 * AWS client construction.
 */
export function correlationIdFromSqsRecord(record: { messageAttributes?: Record<string, { stringValue?: string }>; messageId: string }): string {
  return record.messageAttributes?.["correlationId"]?.stringValue ?? record.messageId;
}

/** ID generation port - same pattern as identity's IdGenerator (resolve-request-context.ts): injected so application logic stays unit-testable with deterministic IDs. */
export interface ExpirationIdGenerator {
  newItemId(): string;
  newAuditEventId(): string;
  newEventId(): string;
  /** renewItem's ReminderPolicy-copy (reminder-delivery-pipeline.md §8, Marcelo's decision
   * 2026-08-25) mints new ReminderPolicy rows directly inside completeRenewal's own
   * transaction, so it needs a policy-id generator of its own rather than depending on the
   * reminder module's application layer. */
  newPolicyId(): string;
}

/** ID generation port - same pattern as identity's IdGenerator (resolve-request-context.ts): injected so application logic stays unit-testable with deterministic IDs. */
export interface ExpirationIdGenerator {
  newItemId(): string;
  newAuditEventId(): string;
  newEventId(): string;
}

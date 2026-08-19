/** ID generation port - same pattern as expiration/application/id-generator.ts. */
export interface ReminderIdGenerator {
  newPolicyId(): string;
  newTriggerId(): string;
  newEventId(): string;
  newIntentId(): string;
}

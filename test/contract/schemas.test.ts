import { describe, expect, it } from "vitest";
import { SchemaRegistry } from "../../src/shared/contracts/schema-validator.js";

describe("schemas/ contract validation (implementation-blueprint.md #6.3)", () => {
  const registry = new SchemaRegistry();

  it("loads every schema under schemas/ without $ref resolution errors", () => {
    expect(() => new SchemaRegistry()).not.toThrow();
  });

  it("accepts a valid domain event envelope", () => {
    const { valid, errors } = registry.validate(
      "https://expiration-tracker/schemas/events/domain-event-envelope.v1.json",
      {
        specVersion: "1.0",
        eventId: "evt_01",
        eventType: "expiration.item-due-date-changed.v1",
        source: "expiration-tracker.expiration",
        occurredAt: "2026-08-19T14:03:22.481Z",
        correlationId: "cor_01",
        tenantId: "t_01",
        actor: { type: "SYSTEM" },
        aggregate: { type: "ExpirationItem", id: "item_01", version: 8 },
        data: {},
      },
    );
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects a domain event envelope missing tenantId", () => {
    const { valid } = registry.validate(
      "https://expiration-tracker/schemas/events/domain-event-envelope.v1.json",
      {
        specVersion: "1.0",
        eventId: "evt_01",
        eventType: "expiration.item-due-date-changed.v1",
        source: "expiration-tracker.expiration",
        occurredAt: "2026-08-19T14:03:22.481Z",
        correlationId: "cor_01",
        actor: { type: "SYSTEM" },
        aggregate: { type: "ExpirationItem", id: "item_01", version: 8 },
        data: {},
      },
    );
    expect(valid).toBe(false);
  });

  it("rejects an eventType that doesn't match the versioned dotted pattern", () => {
    const { valid } = registry.validate(
      "https://expiration-tracker/schemas/events/domain-event-envelope.v1.json",
      {
        specVersion: "1.0",
        eventId: "evt_01",
        eventType: "not-a-valid-event-type",
        source: "s",
        occurredAt: "2026-08-19T14:03:22.481Z",
        correlationId: "cor_01",
        tenantId: "t_01",
        actor: { type: "SYSTEM" },
        aggregate: { type: "ExpirationItem", id: "item_01", version: 8 },
        data: {},
      },
    );
    expect(valid).toBe(false);
  });

  it("accepts a valid SQS command envelope", () => {
    const { valid, errors } = registry.validate(
      "https://expiration-tracker/schemas/queues/command-envelope.v1.json",
      {
        messageVersion: 1,
        messageId: "msg_01",
        commandType: "reminder.dispatch.v1",
        createdAt: "2026-08-19T14:04:00.000Z",
        correlationId: "cor_01",
        tenantId: "t_01",
        deduplicationKey: "t_01|occ_01|3",
        data: {},
      },
    );
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects a command envelope with additional undeclared top-level properties", () => {
    const { valid } = registry.validate(
      "https://expiration-tracker/schemas/queues/command-envelope.v1.json",
      {
        messageVersion: 1,
        messageId: "msg_01",
        commandType: "reminder.dispatch.v1",
        createdAt: "2026-08-19T14:04:00.000Z",
        correlationId: "cor_01",
        tenantId: "t_01",
        deduplicationKey: "t_01|occ_01|3",
        data: {},
        tenantIdOverride: "malicious",
      },
    );
    expect(valid).toBe(false);
  });

  it("accepts a valid notification.intent-created.v1 event with the real example from #10.1", () => {
    const { valid, errors } = registry.validate(
      "https://expiration-tracker/schemas/events/notification-intent-created.v1.json",
      {
        specVersion: "1.0",
        eventId: "evt_int_01",
        eventType: "notification.intent-created.v1",
        source: "expiration-tracker.reminder",
        occurredAt: "2026-09-10T12:00:01.120Z",
        correlationId: "cor_01",
        causationId: "occ_01",
        tenantId: "t_01",
        actor: { type: "SYSTEM" },
        aggregate: { type: "NotificationIntent", id: "int_01", version: 1 },
        data: {
          intentId: "int_01",
          kind: "EXPIRATION_REMINDER",
          itemId: "item_01",
          occurrenceId: "occ_01",
          itemVersion: 8,
          policyId: "policy_01",
          policyVersion: 4,
          scheduledAt: "2026-09-10T12:00:00.000Z",
          requestedChannels: ["EMAIL"],
          status: "PENDING",
          supersedesIntentId: null,
          correctionReason: null,
        },
      },
    );
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects a notification intent event carrying a forbidden field like email", () => {
    const { valid } = registry.validate(
      "https://expiration-tracker/schemas/events/notification-intent-created.v1.json",
      {
        specVersion: "1.0",
        eventId: "evt_int_01",
        eventType: "notification.intent-created.v1",
        source: "expiration-tracker.reminder",
        occurredAt: "2026-09-10T12:00:01.120Z",
        correlationId: "cor_01",
        tenantId: "t_01",
        actor: { type: "SYSTEM" },
        aggregate: { type: "NotificationIntent", id: "int_01", version: 1 },
        data: {
          intentId: "int_01",
          kind: "EXPIRATION_REMINDER",
          itemId: "item_01",
          occurrenceId: "occ_01",
          itemVersion: 8,
          policyId: "policy_01",
          policyVersion: 4,
          scheduledAt: "2026-09-10T12:00:00.000Z",
          requestedChannels: ["EMAIL"],
          status: "PENDING",
          supersedesIntentId: null,
          correctionReason: null,
          email: "leak@example.com",
        },
      },
    );
    expect(valid).toBe(false);
  });

  it("accepts a valid reminder.dispatch.v1 command (M3's ReminderProducer -> ReminderDispatch envelope)", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/queues/reminder-dispatch.v1.json", {
      messageVersion: 1,
      messageId: "msg_01",
      commandType: "reminder.dispatch.v1",
      createdAt: "2026-09-03T12:00:05.000Z",
      correlationId: "cor_01",
      tenantId: "t_01",
      deduplicationKey: "t_01|occ_01|2",
      data: {
        itemId: "item_01",
        occurrenceId: "occ_01",
        occurrenceVersion: 2,
        scheduledAt: "2026-09-03T12:00:00.000Z",
        itemVersion: 8,
        policyVersion: 4,
      },
    });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects a reminder.dispatch.v1 command missing occurrenceId", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/queues/reminder-dispatch.v1.json", {
      messageVersion: 1,
      messageId: "msg_01",
      commandType: "reminder.dispatch.v1",
      createdAt: "2026-09-03T12:00:05.000Z",
      correlationId: "cor_01",
      tenantId: "t_01",
      deduplicationKey: "t_01|occ_01|2",
      data: {
        itemId: "item_01",
        occurrenceVersion: 2,
        scheduledAt: "2026-09-03T12:00:00.000Z",
        itemVersion: 8,
        policyVersion: 4,
      },
    });
    expect(valid).toBe(false);
  });

  it("accepts a valid WebhookInbox record", () => {
    const { valid, errors } = registry.validate(
      "https://expiration-tracker/schemas/api/webhook-inbox.v1.json",
      {
        entityType: "WebhookInbox",
        provider: "provider_a",
        providerAccountId: "acct_01",
        providerEventId: "provider_event_987",
        eventKind: "DELIVERY_STATUS",
        signatureVerified: true,
        signatureTimestamp: "2026-09-10T12:01:00Z",
        nonceHash: "sha256:" + "a".repeat(64),
        receivedAt: "2026-09-10T12:01:02Z",
        payloadObjectKey: null,
        normalizedPayload: {
          providerMessageId: "pm_01",
          status: "DELIVERED",
          occurredAt: "2026-09-10T12:00:58Z",
          failureCode: null,
        },
        processingStatus: "PENDING",
        version: 1,
      },
    );
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("accepts a valid expiration.item-due-date-changed.v1 event (M2's outbox event)", () => {
    const { valid, errors } = registry.validate(
      "https://expiration-tracker/schemas/events/item-due-date-changed.v1.json",
      {
        specVersion: "1.0",
        eventId: "evt_01",
        eventType: "expiration.item-due-date-changed.v1",
        source: "expiration-tracker.expiration",
        occurredAt: "2026-08-19T14:03:22.481Z",
        correlationId: "cor_01",
        tenantId: "t_01",
        actor: { type: "USER", userId: "usr_01" },
        aggregate: { type: "ExpirationItem", id: "item_01", version: 8 },
        data: {
          itemId: "item_01",
          previousDueDate: "2026-09-10T00:00:00.000Z",
          newDueDate: "2026-09-17T00:00:00.000Z",
          itemVersion: 8,
        },
      },
    );
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects an item-due-date-changed event missing itemVersion", () => {
    const { valid } = registry.validate(
      "https://expiration-tracker/schemas/events/item-due-date-changed.v1.json",
      {
        specVersion: "1.0",
        eventId: "evt_01",
        eventType: "expiration.item-due-date-changed.v1",
        source: "expiration-tracker.expiration",
        occurredAt: "2026-08-19T14:03:22.481Z",
        correlationId: "cor_01",
        tenantId: "t_01",
        actor: { type: "USER", userId: "usr_01" },
        aggregate: { type: "ExpirationItem", id: "item_01", version: 8 },
        data: {
          itemId: "item_01",
          previousDueDate: null,
          newDueDate: "2026-09-17T00:00:00.000Z",
        },
      },
    );
    expect(valid).toBe(false);
  });

  it("rejects a WebhookInbox record with signatureVerified=false (must never be persisted unverified)", () => {
    const { valid } = registry.validate(
      "https://expiration-tracker/schemas/api/webhook-inbox.v1.json",
      {
        entityType: "WebhookInbox",
        provider: "provider_a",
        providerAccountId: "acct_01",
        providerEventId: "provider_event_987",
        eventKind: "DELIVERY_STATUS",
        signatureVerified: false,
        signatureTimestamp: "2026-09-10T12:01:00Z",
        nonceHash: "sha256:" + "a".repeat(64),
        receivedAt: "2026-09-10T12:01:02Z",
        normalizedPayload: {
          providerMessageId: "pm_01",
          status: "DELIVERED",
          occurredAt: "2026-09-10T12:00:58Z",
          failureCode: null,
        },
        processingStatus: "PENDING",
        version: 1,
      },
    );
    expect(valid).toBe(false);
  });
});

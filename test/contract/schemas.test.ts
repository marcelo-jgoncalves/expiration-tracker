import { describe, expect, it } from "vitest";
import { loadAllSchemasFromDisk } from "../../src/shared/contracts/schema-registry-disk.js";

describe("schemas/ contract validation (implementation-blueprint.md #6.3)", () => {
  const registry = loadAllSchemasFromDisk();

  it("loads every schema under schemas/ without $ref resolution errors", () => {
    expect(() => loadAllSchemasFromDisk()).not.toThrow();
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

  it("accepts a valid document-chasing.dispatch.v1 command (M10 cluster 4, D-039/D-046/D-048)", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/queues/document-chasing-dispatch.v1.json", {
      messageVersion: 1,
      messageId: "msg_02",
      commandType: "document-chasing.dispatch.v1",
      createdAt: "2026-09-03T12:00:05.000Z",
      correlationId: "cor_02",
      tenantId: "t_01",
      deduplicationKey: "t_01|chase_01|2",
      data: {
        subjectId: "subject_01",
        assignmentId: "assignment_01",
        documentRequestId: "docreq_01",
        occurrenceId: "chase_01",
        occurrenceVersion: 2,
        tier: "T7",
        scheduledAt: "2026-09-03T12:00:00.000Z",
        documentRequestVersion: 1,
      },
    });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects a document-chasing.dispatch.v1 command with an invalid tier", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/queues/document-chasing-dispatch.v1.json", {
      messageVersion: 1,
      messageId: "msg_02",
      commandType: "document-chasing.dispatch.v1",
      createdAt: "2026-09-03T12:00:05.000Z",
      correlationId: "cor_02",
      tenantId: "t_01",
      deduplicationKey: "t_01|chase_01|2",
      data: {
        subjectId: "subject_01",
        assignmentId: "assignment_01",
        documentRequestId: "docreq_01",
        occurrenceId: "chase_01",
        occurrenceVersion: 2,
        tier: "T30", // invalid - only T7/T3/EXPIRED exist
        scheduledAt: "2026-09-03T12:00:00.000Z",
        documentRequestVersion: 1,
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

  it("accepts a valid expiration.item-deactivated.v1 event (BLOCKER-B: archive/delete/renewal-old-side)", () => {
    const { valid, errors } = registry.validate(
      "https://expiration-tracker/schemas/events/item-deactivated.v1.json",
      {
        specVersion: "1.0",
        eventId: "evt_01",
        eventType: "expiration.item-deactivated.v1",
        source: "expiration-tracker.expiration",
        occurredAt: "2026-08-19T14:03:22.481Z",
        correlationId: "cor_01",
        tenantId: "t_01",
        actor: { type: "USER", userId: "usr_01" },
        aggregate: { type: "ExpirationItem", id: "item_01", version: 3 },
        data: { itemId: "item_01", itemVersion: 3 },
      },
    );
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects an item-deactivated event missing itemVersion", () => {
    const { valid } = registry.validate(
      "https://expiration-tracker/schemas/events/item-deactivated.v1.json",
      {
        specVersion: "1.0",
        eventId: "evt_01",
        eventType: "expiration.item-deactivated.v1",
        source: "expiration-tracker.expiration",
        occurredAt: "2026-08-19T14:03:22.481Z",
        correlationId: "cor_01",
        tenantId: "t_01",
        actor: { type: "USER", userId: "usr_01" },
        aggregate: { type: "ExpirationItem", id: "item_01", version: 3 },
        data: { itemId: "item_01" },
      },
    );
    expect(valid).toBe(false);
  });

  it("accepts a valid reminder.policy-changed.v1 event with itemId set and previousItemId null (BLOCKER-B: plain ITEM-scoped create)", () => {
    const { valid, errors } = registry.validate(
      "https://expiration-tracker/schemas/events/reminder-policy-changed.v1.json",
      {
        specVersion: "1.0",
        eventId: "evt_01",
        eventType: "reminder.policy-changed.v1",
        source: "expiration-tracker.reminder",
        occurredAt: "2026-08-19T14:03:22.481Z",
        correlationId: "cor_01",
        tenantId: "t_01",
        actor: { type: "USER", userId: "usr_01" },
        aggregate: { type: "ReminderPolicy", id: "policy_01", version: 1 },
        data: { policyId: "policy_01", itemId: "item_01", previousItemId: null },
      },
    );
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("accepts a valid reminder.policy-changed.v1 event with both itemId and previousItemId set (a policy move)", () => {
    const { valid, errors } = registry.validate(
      "https://expiration-tracker/schemas/events/reminder-policy-changed.v1.json",
      {
        specVersion: "1.0",
        eventId: "evt_01",
        eventType: "reminder.policy-changed.v1",
        source: "expiration-tracker.reminder",
        occurredAt: "2026-08-19T14:03:22.481Z",
        correlationId: "cor_01",
        tenantId: "t_01",
        actor: { type: "USER", userId: "usr_01" },
        aggregate: { type: "ReminderPolicy", id: "policy_01", version: 2 },
        data: { policyId: "policy_01", itemId: "item_02", previousItemId: "item_01" },
      },
    );
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("accepts a valid reminder.policy-changed.v1 event with itemId null (TEMPLATE scope)", () => {
    const { valid, errors } = registry.validate(
      "https://expiration-tracker/schemas/events/reminder-policy-changed.v1.json",
      {
        specVersion: "1.0",
        eventId: "evt_01",
        eventType: "reminder.policy-changed.v1",
        source: "expiration-tracker.reminder",
        occurredAt: "2026-08-19T14:03:22.481Z",
        correlationId: "cor_01",
        tenantId: "t_01",
        actor: { type: "USER", userId: "usr_01" },
        aggregate: { type: "ReminderPolicy", id: "policy_01", version: 1 },
        data: { policyId: "policy_01", itemId: null, previousItemId: null },
      },
    );
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects a reminder.policy-changed.v1 event missing previousItemId entirely (must be present, even if null)", () => {
    const { valid } = registry.validate(
      "https://expiration-tracker/schemas/events/reminder-policy-changed.v1.json",
      {
        specVersion: "1.0",
        eventId: "evt_01",
        eventType: "reminder.policy-changed.v1",
        source: "expiration-tracker.reminder",
        occurredAt: "2026-08-19T14:03:22.481Z",
        correlationId: "cor_01",
        tenantId: "t_01",
        actor: { type: "USER", userId: "usr_01" },
        aggregate: { type: "ReminderPolicy", id: "policy_01", version: 1 },
        data: { policyId: "policy_01", itemId: "item_01" },
      },
    );
    expect(valid).toBe(false);
  });

  it("accepts a valid reminder-materialization-trigger.v1 SQS message (BLOCKER-B)", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/queues/reminder-materialization-trigger.v1.json", {
      eventType: "expiration.item-due-date-changed.v1",
      tenantId: "t_01",
      data: { itemId: "item_01", previousDueDate: null, newDueDate: "2026-09-17T00:00:00.000Z", itemVersion: 1 },
    });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects a reminder-materialization-trigger.v1 message with an unrecognized eventType", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/queues/reminder-materialization-trigger.v1.json", {
      eventType: "not-a-real-event",
      tenantId: "t_01",
      data: {},
    });
    expect(valid).toBe(false);
  });

  it("rejects a reminder-materialization-trigger.v1 message missing tenantId", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/queues/reminder-materialization-trigger.v1.json", {
      eventType: "expiration.item-deactivated.v1",
      data: { itemId: "item_01", itemVersion: 1 },
    });
    expect(valid).toBe(false);
  });

  // Codex implementation-review finding (real gap): the queue schema previously accepted
  // ANY object as `data` regardless of `eventType`, so a malformed/empty `data` passed
  // handler-level validation and was only caught (if at all) by an unchecked `as string`
  // cast inside parseTriggerEvent(). `data` is now conditionally validated (if/then $ref
  // into each event schema's own `data` sub-schema) - these prove it actually rejects.
  it("rejects a reminder-materialization-trigger.v1 message whose data is empty for eventType item-deactivated.v1 (missing itemId/itemVersion)", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/queues/reminder-materialization-trigger.v1.json", {
      eventType: "expiration.item-deactivated.v1",
      tenantId: "t_01",
      data: {},
    });
    expect(valid).toBe(false);
  });

  it("rejects a reminder-materialization-trigger.v1 message whose data doesn't match eventType item-due-date-changed.v1 (missing previousDueDate/newDueDate/itemVersion)", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/queues/reminder-materialization-trigger.v1.json", {
      eventType: "expiration.item-due-date-changed.v1",
      tenantId: "t_01",
      data: { itemId: "item_01" },
    });
    expect(valid).toBe(false);
  });

  it("rejects a reminder-materialization-trigger.v1 message whose data doesn't match eventType reminder.policy-changed.v1 (missing previousItemId - required-but-nullable)", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/queues/reminder-materialization-trigger.v1.json", {
      eventType: "reminder.policy-changed.v1",
      tenantId: "t_01",
      data: { policyId: "policy_01", itemId: "item_01" },
    });
    expect(valid).toBe(false);
  });

  it("accepts a reminder-materialization-trigger.v1 message for each eventType with the exact matching data shape", () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["expiration.item-deactivated.v1", { itemId: "item_01", itemVersion: 2 }],
      ["expiration.item-due-date-changed.v1", { itemId: "item_01", previousDueDate: null, newDueDate: "2026-09-17T00:00:00.000Z", itemVersion: 2 }],
      ["reminder.policy-changed.v1", { policyId: "policy_01", itemId: "item_01", previousItemId: null }],
    ];
    for (const [eventType, data] of cases) {
      const { valid, errors } = registry.validate("https://expiration-tracker/schemas/queues/reminder-materialization-trigger.v1.json", {
        eventType,
        tenantId: "t_01",
        data,
      });
      expect(errors).toEqual([]);
      expect(valid).toBe(true);
    }
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

  it("accepts a valid update-notification-preferences-request (PUT /notifications/preferences)", () => {
    const { valid, errors } = registry.validate(
      "https://expiration-tracker/schemas/api/update-notification-preferences-request.v1.json",
      {
        emailEnabled: true,
        locale: "pt-BR",
        quietHours: { enabled: true, startLocal: "22:00", endLocal: "07:00", timeZone: "America/Sao_Paulo" },
      },
    );
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("accepts quietHours: null (opting out of quiet hours entirely)", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/update-notification-preferences-request.v1.json", {
      emailEnabled: true,
      locale: "pt-BR",
      quietHours: null,
    });
    expect(valid).toBe(true);
  });

  it("rejects an update-notification-preferences-request missing locale", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/update-notification-preferences-request.v1.json", {
      emailEnabled: true,
      quietHours: null,
    });
    expect(valid).toBe(false);
  });

  it("rejects an update-notification-preferences-request with an incomplete quietHours object", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/update-notification-preferences-request.v1.json", {
      emailEnabled: true,
      locale: "pt-BR",
      quietHours: { enabled: true, startLocal: "22:00" },
    });
    expect(valid).toBe(false);
  });

  it("accepts a valid update-document-request-delivery-preference-request (PUT /subjects/document-request-delivery-preference, M10 cluster 4, D-049)", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/api/update-document-request-delivery-preference-request.v1.json", {
      initialInviteDeliveryDefault: "EMAIL",
    });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects an update-document-request-delivery-preference-request with an invalid mode", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/update-document-request-delivery-preference-request.v1.json", {
      initialInviteDeliveryDefault: "AUTOMATIC", // only MANUAL/EMAIL exist
    });
    expect(valid).toBe(false);
  });

  it("rejects an update-document-request-delivery-preference-request missing the required field", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/update-document-request-delivery-preference-request.v1.json", {});
    expect(valid).toBe(false);
  });

  it("accepts a valid import-commit.v1 command (M11, D-042)", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/queues/import-commit.v1.json", {
      messageVersion: 1,
      messageId: "msg_03",
      commandType: "import.commit.v1",
      createdAt: "2026-09-03T12:00:05.000Z",
      correlationId: "cor_03",
      tenantId: "t_01",
      deduplicationKey: "t_01|importjob_01|2",
      data: { jobId: "importjob_01" },
    });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects an import-commit.v1 command missing jobId", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/queues/import-commit.v1.json", {
      messageVersion: 1,
      messageId: "msg_03",
      commandType: "import.commit.v1",
      createdAt: "2026-09-03T12:00:05.000Z",
      correlationId: "cor_03",
      tenantId: "t_01",
      deduplicationKey: "t_01|importjob_01|2",
      data: {},
    });
    expect(valid).toBe(false);
  });

  // M11 (D-042) - schema novo do modulo import.

  it("accepts a valid reserve-import-request (POST /imports, M11, D-042)", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/api/reserve-import-request.v1.json", {
      contentLength: 1024,
      checksumSha256: "a".repeat(64),
    });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects a reserve-import-request over the 5 MiB file size limit", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/reserve-import-request.v1.json", {
      contentLength: 5 * 1024 * 1024 + 1,
      checksumSha256: "a".repeat(64),
    });
    expect(valid).toBe(false);
  });

  it("rejects a reserve-import-request with a malformed checksumSha256", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/reserve-import-request.v1.json", {
      contentLength: 1024,
      checksumSha256: "not-hex",
    });
    expect(valid).toBe(false);
  });

  // Evolucao estrategica do roadmap (M9, D-036) - schemas novos do modulo subject.

  it("accepts a valid create-subject-request", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/api/create-subject-request.v1.json", {
      type: "VENDOR",
      displayName: "ACME Seguros",
      tags: ["seguro", "sp"],
    });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects a create-subject-request with an unknown type", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/create-subject-request.v1.json", {
      type: "NOT_A_REAL_TYPE",
      displayName: "ACME Seguros",
    });
    expect(valid).toBe(false);
  });

  it("accepts a valid update-subject-request", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/api/update-subject-request.v1.json", {
      notes: "Contato principal: financeiro@acme.com",
    });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects an update-subject-request with an additional undeclared property", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/update-subject-request.v1.json", {
      displayName: "ACME",
      ownerUserId: "user_01",
    });
    expect(valid).toBe(false);
  });

  it("accepts a valid assign-requirement-request", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/api/assign-requirement-request.v1.json", {
      requirementName: "Seguro RC",
    });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects an assign-requirement-request missing requirementName", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/assign-requirement-request.v1.json", {
      notes: "sem nome",
    });
    expect(valid).toBe(false);
  });

  it("accepts a valid update-requirement-assignment-request", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/api/update-requirement-assignment-request.v1.json", {
      requirementName: "Seguro RC atualizado",
    });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects an update-requirement-assignment-request carrying status directly (status is never client-settable)", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/update-requirement-assignment-request.v1.json", {
      status: "SATISFIED",
    });
    expect(valid).toBe(false);
  });

  it("accepts a valid link-requirement-item-request", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/api/link-requirement-item-request.v1.json", {
      itemId: "item_01",
    });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects a link-requirement-item-request missing itemId", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/link-requirement-item-request.v1.json", {});
    expect(valid).toBe(false);
  });

  // M7 (extração/OCR, D-035) - schema novo da fila de conclusão do Textract (COMPLETE_OCR).

  it("accepts a valid textract.completion.v1 SNS-wrapped message", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/queues/textract-completion.v1.json", {
      Type: "Notification",
      MessageId: "sns-msg-01",
      TopicArn: "arn:aws:sns:sa-east-1:123456789012:textract-job-completion",
      Timestamp: "2026-08-26T12:00:00.000Z",
      Message: JSON.stringify({ JobId: "job_01", Status: "SUCCEEDED", API: "StartDocumentTextDetection", JobTag: "run_01" }),
    });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects a textract.completion.v1 message with the wrong Type", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/queues/textract-completion.v1.json", {
      Type: "SubscriptionConfirmation",
      MessageId: "sns-msg-01",
      TopicArn: "arn:aws:sns:sa-east-1:123456789012:textract-job-completion",
      Message: "{}",
    });
    expect(valid).toBe(false);
  });

  it("rejects a textract.completion.v1 message missing Message", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/queues/textract-completion.v1.json", {
      Type: "Notification",
      MessageId: "sns-msg-01",
      TopicArn: "arn:aws:sns:sa-east-1:123456789012:textract-job-completion",
    });
    expect(valid).toBe(false);
  });

  it("rejects a textract.completion.v1 message with an undeclared top-level property", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/queues/textract-completion.v1.json", {
      Type: "Notification",
      MessageId: "sns-msg-01",
      TopicArn: "arn:aws:sns:sa-east-1:123456789012:textract-job-completion",
      Message: "{}",
      SignatureVersion: "1",
    });
    expect(valid).toBe(false);
  });

  // M7 item 8 (§1.7) - confirm/reject ExtractedField HTTP routes.

  it("accepts a valid confirm-extracted-field-request.v1", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/api/confirm-extracted-field-request.v1.json", {
      expectedItemVersion: 12,
      expectedDocumentVersion: 3,
      expectedRunVersion: 2,
      expectedFieldVersion: 1,
      confirmedValue: "2027-03-31",
    });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects a confirm-extracted-field-request.v1 missing expectedItemVersion", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/confirm-extracted-field-request.v1.json", {
      expectedDocumentVersion: 3,
      expectedRunVersion: 2,
      expectedFieldVersion: 1,
      confirmedValue: "2027-03-31",
    });
    expect(valid).toBe(false);
  });

  it("rejects a confirm-extracted-field-request.v1 with an undeclared property (never arbitrary item attributes)", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/confirm-extracted-field-request.v1.json", {
      expectedItemVersion: 12,
      expectedDocumentVersion: 3,
      expectedRunVersion: 2,
      expectedFieldVersion: 1,
      confirmedValue: "2027-03-31",
      name: "Sneaky item rename",
    });
    expect(valid).toBe(false);
  });

  it("accepts a valid reject-extracted-field-request.v1", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/api/reject-extracted-field-request.v1.json", {
      expectedDocumentVersion: 3,
      expectedRunVersion: 2,
      expectedFieldVersion: 1,
      correctionReason: "Wrong date read from the OCR text.",
    });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("accepts a reject-extracted-field-request.v1 without an optional correctionReason", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/reject-extracted-field-request.v1.json", {
      expectedDocumentVersion: 3,
      expectedRunVersion: 2,
      expectedFieldVersion: 1,
    });
    expect(valid).toBe(true);
  });

  it("rejects a reject-extracted-field-request.v1 carrying expectedItemVersion (reject never touches ExpirationItem)", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/reject-extracted-field-request.v1.json", {
      expectedItemVersion: 12,
      expectedDocumentVersion: 3,
      expectedRunVersion: 2,
      expectedFieldVersion: 1,
    });
    expect(valid).toBe(false);
  });

  // Wave B2B-8 (Invitations/Team, D-099) - schemas novos do módulo organization.

  it("accepts a valid create-invitation-request.v1", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/api/create-invitation-request.v1.json", {
      email: "new.member@example.com",
      role: "MEMBER",
    });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects a create-invitation-request.v1 with an unknown role", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/create-invitation-request.v1.json", {
      email: "new.member@example.com",
      role: "SUPERADMIN",
    });
    expect(valid).toBe(false);
  });

  it("accepts a valid change-membership-role-request.v1", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/api/change-membership-role-request.v1.json", { role: "ADMIN" });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects a change-membership-role-request.v1 missing role", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/change-membership-role-request.v1.json", {});
    expect(valid).toBe(false);
  });

  it("accepts a valid accept-invitation-request.v1", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/api/accept-invitation-request.v1.json", { token: "abcdef0123456789abcdef0123456789.abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects an accept-invitation-request.v1 with an empty token", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/accept-invitation-request.v1.json", { token: "" });
    expect(valid).toBe(false);
  });

  // D-143 Nucleus 1 (Document Archive domain).
  it("accepts a valid docarchive-create-request.v1", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/api/docarchive-create-request.v1.json", {
      subjectId: "subject-1",
      documentType: "ALVARA",
      hasValidity: true,
    });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects a docarchive-create-request.v1 missing hasValidity", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/docarchive-create-request.v1.json", {
      subjectId: "subject-1",
      documentType: "ALVARA",
    });
    expect(valid).toBe(false);
  });

  it("accepts a valid docarchive-reserve-upload-request.v1", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/api/docarchive-reserve-upload-request.v1.json", { origin: "MANUAL_UPLOAD" });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects a docarchive-reserve-upload-request.v1 with an unknown origin", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/docarchive-reserve-upload-request.v1.json", { origin: "TELEPATHY" });
    expect(valid).toBe(false);
  });

  it("accepts a valid docarchive-commit-upload-request.v1", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/api/docarchive-commit-upload-request.v1.json", { expectedVersion: 1 });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects a docarchive-commit-upload-request.v1 with a non-integer expectedVersion", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/docarchive-commit-upload-request.v1.json", { expectedVersion: 1.5 });
    expect(valid).toBe(false);
  });

  it("accepts a valid docarchive-claim-review-request.v1", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/api/docarchive-claim-review-request.v1.json", { expectedVersion: 2 });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects a docarchive-claim-review-request.v1 missing expectedVersion", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/docarchive-claim-review-request.v1.json", {});
    expect(valid).toBe(false);
  });

  it("accepts a valid docarchive-accept-version-request.v1", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/api/docarchive-accept-version-request.v1.json", {
      expectedVersion: 3,
      clientRequestToken: "req-token-1",
    });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects a docarchive-accept-version-request.v1 missing clientRequestToken (no idempotency guarantee otherwise)", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/docarchive-accept-version-request.v1.json", { expectedVersion: 3 });
    expect(valid).toBe(false);
  });

  it("accepts a valid docarchive-reject-version-request.v1", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/api/docarchive-reject-version-request.v1.json", {
      expectedVersion: 1,
      reason: "ILLEGIBLE",
    });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects a docarchive-reject-version-request.v1 with a reason outside the closed taxonomy", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/docarchive-reject-version-request.v1.json", {
      expectedVersion: 1,
      reason: "I_DONT_LIKE_IT",
    });
    expect(valid).toBe(false);
  });

  // D-143 Nucleus 2, Requirement (Decision 5 / D-145).
  it("accepts a valid docarchive-requirement-create-request.v1", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/api/docarchive-requirement-create-request.v1.json", {
      subjectId: "subject-1",
      name: "Alvará de funcionamento",
      applicability: "APPLICABLE",
    });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects a docarchive-requirement-create-request.v1 with an applicability outside the closed enum", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/docarchive-requirement-create-request.v1.json", {
      subjectId: "subject-1",
      name: "Alvará",
      applicability: "MAYBE",
    });
    expect(valid).toBe(false);
  });

  it("accepts a valid docarchive-requirement-update-request.v1", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/api/docarchive-requirement-update-request.v1.json", {
      expectedVersion: 1,
      applicability: "NOT_APPLICABLE",
    });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects a docarchive-requirement-update-request.v1 missing expectedVersion (no OCC guard otherwise)", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/docarchive-requirement-update-request.v1.json", { name: "renamed" });
    expect(valid).toBe(false);
  });

  it("accepts a valid docarchive-requirement-link-evidence-request.v1", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/api/docarchive-requirement-link-evidence-request.v1.json", {
      expectedVersion: 1,
      documentId: "doc-1",
      versionId: "ver-1",
    });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects a docarchive-requirement-link-evidence-request.v1 missing documentId", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/docarchive-requirement-link-evidence-request.v1.json", {
      expectedVersion: 1,
      versionId: "ver-1",
    });
    expect(valid).toBe(false);
  });

  it("accepts a valid docarchive-requirement-unlink-evidence-request.v1", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/api/docarchive-requirement-unlink-evidence-request.v1.json", { expectedVersion: 2 });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects a docarchive-requirement-unlink-evidence-request.v1 with a non-integer expectedVersion", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/docarchive-requirement-unlink-evidence-request.v1.json", { expectedVersion: 2.5 });
    expect(valid).toBe(false);
  });

  it("accepts a valid docarchive-requirement-delete-request.v1", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/api/docarchive-requirement-delete-request.v1.json", { expectedVersion: 1 });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects a docarchive-requirement-delete-request.v1 with an additional unknown property", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/docarchive-requirement-delete-request.v1.json", { expectedVersion: 1, force: true });
    expect(valid).toBe(false);
  });

  // D-143 Decision 4, guest access (D-146).
  it("accepts a valid docarchive-guest-submit-evidence-request.v1", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/api/docarchive-guest-submit-evidence-request.v1.json", {
      fileName: "certidao.pdf",
      documentType: "CERTIDAO",
      idempotencyKey: "idem-1",
    });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects a docarchive-guest-submit-evidence-request.v1 missing idempotencyKey", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/docarchive-guest-submit-evidence-request.v1.json", { fileName: "certidao.pdf" });
    expect(valid).toBe(false);
  });

  it("rejects a docarchive-guest-submit-evidence-request.v1 with an additional unknown property", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/docarchive-guest-submit-evidence-request.v1.json", {
      fileName: "certidao.pdf",
      idempotencyKey: "idem-1",
      extra: true,
    });
    expect(valid).toBe(false);
  });

  // D-143 Nucleus 2, entity 3/3, recurrence (Decision 8 / D-147).
  it("accepts a valid docarchive-series-create-request.v1", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/api/docarchive-series-create-request.v1.json", {
      subjectId: "subject-1",
      requirementId: "req-1",
      cadence: { intervalDays: 90 },
    });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects a docarchive-series-create-request.v1 with a non-integer intervalDays", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/docarchive-series-create-request.v1.json", {
      subjectId: "subject-1",
      requirementId: "req-1",
      cadence: { intervalDays: 90.5 },
    });
    expect(valid).toBe(false);
  });

  it("accepts a valid docarchive-series-cancel-request.v1", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/api/docarchive-series-cancel-request.v1.json", { expectedVersion: 1 });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects a docarchive-series-cancel-request.v1 missing expectedVersion", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/docarchive-series-cancel-request.v1.json", {});
    expect(valid).toBe(false);
  });

  it("accepts a valid docarchive-series-materialize-request.v1", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/api/docarchive-series-materialize-request.v1.json", { expectedVersion: 1 });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects a docarchive-series-materialize-request.v1 with an additional unknown property", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/docarchive-series-materialize-request.v1.json", { expectedVersion: 1, force: true });
    expect(valid).toBe(false);
  });

  // D-149 (Admin Activity/Audit Log view) - GET /activity's query-parameter schema.
  it("accepts an empty list-activity-request.v1 (every field optional)", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/api/list-activity-request.v1.json", {});
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("accepts a fully-populated list-activity-request.v1", () => {
    const { valid, errors } = registry.validate("https://expiration-tracker/schemas/api/list-activity-request.v1.json", {
      month: "202609",
      resourceType: "ExpirationItem",
      limit: "25",
      cursor: "abc123",
    });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects a list-activity-request.v1 month that isn't 6 digits", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/list-activity-request.v1.json", { month: "2026-09" });
    expect(valid).toBe(false);
  });

  it("rejects a list-activity-request.v1 non-numeric limit", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/list-activity-request.v1.json", { limit: "abc" });
    expect(valid).toBe(false);
  });

  it("rejects a list-activity-request.v1 with an additional unknown property", () => {
    const { valid } = registry.validate("https://expiration-tracker/schemas/api/list-activity-request.v1.json", { bogus: "x" });
    expect(valid).toBe(false);
  });
});

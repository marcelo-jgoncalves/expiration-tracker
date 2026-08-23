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
});

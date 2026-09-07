import { describe, expect, it } from "vitest";
import { buildWhatsAppOutboxRecord } from "../../../src/modules/notification/application/whatsapp-outbox.js";
import { notificationAttemptKey, type NotificationAttempt } from "../../../src/modules/notification/domain/notification-attempt.js";
import type { NotificationIntent } from "../../../src/modules/reminder/domain/notification-intent.js";
import { defaultSchemaRegistry } from "../../../src/shared/contracts/schema-validator.js";

const NOW = "2026-09-10T12:00:00.000Z";
const TENANT = "t1";

function makeIntent(): NotificationIntent {
  return {
    PK: `TENANT#${TENANT}#INTENT#intent1`,
    SK: "META",
    entityType: "NotificationIntent",
    intentId: "intent1",
    tenantId: TENANT,
    kind: "EXPIRATION_REMINDER",
    itemId: "item1",
    occurrenceId: "occ1",
    itemVersion: 3,
    policyId: "policy1",
    policyVersion: 1,
    scheduledAt: NOW,
    requestedChannels: ["WHATSAPP"],
    status: "DISPATCHED",
    supersedesIntentId: null,
    correctionReason: null,
    recipientUserId: "user1",
    version: 2,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeAttempt(): NotificationAttempt {
  return {
    ...notificationAttemptKey(TENANT, "intent1", 1, "attempt1"),
    entityType: "NotificationAttempt",
    tenantId: TENANT,
    intentId: "intent1",
    attemptId: "attempt1",
    attemptNumber: 1,
    redriveGeneration: 0,
    channel: "WHATSAPP",
    provider: "META_CLOUD_API",
    providerAccountId: "default",
    status: "PREPARED",
    expectedItemVersion: 3,
    commandMessageId: "attempt1",
    destinationHash: "",
    templateId: "expiration-reminder",
    templateVersion: 1,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("buildWhatsAppOutboxRecord (D-9)", () => {
  it("targets the dedicated WhatsApp destination, never the email queue's destination (ADR-0008)", () => {
    const record = buildWhatsAppOutboxRecord(makeIntent(), makeAttempt(), NOW, NOW);
    expect(record["destination"]).toBe("SQS_NOTIFICATION_WHATSAPP_V1");
    expect(record["destination"]).not.toBe("SQS_NOTIFICATION_EMAIL_V1");
  });

  it("produces a payload that validates against notification-whatsapp-deliver.v1.json", () => {
    const record = buildWhatsAppOutboxRecord(makeIntent(), makeAttempt(), NOW, NOW);
    const payload = record["payload"];
    const { valid, errors } = defaultSchemaRegistry.validate("https://expiration-tracker/schemas/queues/notification-whatsapp-deliver.v1.json", payload);
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it("falls back to `now` for deliverNotBefore when undefined", () => {
    const record = buildWhatsAppOutboxRecord(makeIntent(), makeAttempt(), undefined, NOW);
    const payload = record["payload"] as { data: { deliverNotBefore: string } };
    expect(payload.data.deliverNotBefore).toBe(NOW);
  });

  it("deduplicationKey is scoped to WHATSAPP, distinct from an equivalent EMAIL record for the same intent/attempt", () => {
    const record = buildWhatsAppOutboxRecord(makeIntent(), makeAttempt(), NOW, NOW);
    const payload = record["payload"] as { deduplicationKey: string };
    expect(payload.deduplicationKey).toContain("WHATSAPP");
    expect(payload.deduplicationKey).not.toContain("EMAIL");
  });
});

import { describe, expect, it } from "vitest";
import { processReportSubscriptionDelivery, type ReportSubscriptionDeliveryCommand, type ReportSubscriptionDeliveryDeps } from "../../../src/workers/report-subscription-delivery/delivery.js";
import { InMemoryReportSubscriptionStore, activeLifecycleRecord } from "./in-memory-store.js";
import { reportSubscriptionGsi1Keys, reportSubscriptionGsi8Keys, reportSubscriptionKey, type ReportSubscription } from "../../../src/modules/reports/domain/report-subscription.js";
import { reportSubscriptionRunKey, type ReportSubscriptionRun } from "../../../src/modules/reports/domain/report-subscription-run.js";
import { reportDeliveryAttemptKey, type ReportDeliveryAttempt } from "../../../src/modules/reports/domain/report-delivery-attempt.js";
import type { NotificationRecipientResolver, ResolvedRecipient } from "../../../src/modules/notification/ports/recipient-resolver.js";
import { EmailSendError, type EmailProviderAdapter, type EmailSendInput } from "../../../src/modules/notification/ports/email-provider.js";
import type { ReportExportStore } from "../../../src/modules/reports/ports/report-export-store.js";
import type { EntityKey } from "../../../src/shared/dynamodb/occ.js";

const TABLE = "test-table";
const TENANT = "tenant-1";
const NOW = "2026-09-06T10:00:00.000Z";

function makeSubscription(overrides: Partial<ReportSubscription> = {}): ReportSubscription {
  const subscriptionId = overrides.subscriptionId ?? "sub-1";
  const tenantId = overrides.tenantId ?? TENANT;
  const nextRunAt = overrides.nextRunAt ?? "2026-09-06T09:00:00.000Z";
  return {
    ...reportSubscriptionKey(tenantId, subscriptionId),
    entityType: "ReportSubscription",
    subscriptionId,
    tenantId,
    reportTypes: ["EXPIRED_ITEMS", "MISSING_REQUIREMENTS"],
    cadence: "WEEKLY",
    dayOfWeek: 1,
    localTime: "09:00",
    timeZone: "UTC",
    recipientUserIds: ["user-1", "user-2"],
    createdBy: "user-1",
    nextRunAt,
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...reportSubscriptionGsi8Keys({ dueAtIso: nextRunAt, tenantId, subscriptionId }),
    ...reportSubscriptionGsi1Keys({ tenantId, createdAt: "2026-01-01T00:00:00.000Z", subscriptionId }),
    ...overrides,
  };
}

function makeCommand(overrides: Partial<ReportSubscriptionDeliveryCommand> = {}): ReportSubscriptionDeliveryCommand {
  return { tenantId: TENANT, subscriptionId: "sub-1", runId: "run-1", scheduledFor: "2026-09-06T09:00:00.000Z", ...overrides };
}

function fakeRecipients(eligible: Record<string, { email: string } | false>): NotificationRecipientResolver {
  return {
    async resolve(input): Promise<ResolvedRecipient | undefined> {
      const entry = eligible[input.candidateUserId];
      if (!entry) return { userId: input.candidateUserId, tenantId: input.tenantId, active: false };
      return { userId: input.candidateUserId, tenantId: input.tenantId, active: true, email: entry.email };
    },
  };
}

function makeExportStore(): ReportExportStore & { uploads: { tenantId: string; subscriptionId: string; runId: string; body: string }[] } {
  const uploads: { tenantId: string; subscriptionId: string; runId: string; body: string }[] = [];
  return {
    uploads,
    async putCsv(input) {
      uploads.push(input);
      return { key: `tenants/${input.tenantId}/report-subscriptions/${input.subscriptionId}/runs/${input.runId}.csv` };
    },
    async presignDownload() {
      return "https://example.com/presigned";
    },
  };
}

function makeDeps(input: {
  store: InMemoryReportSubscriptionStore;
  recipients?: NotificationRecipientResolver;
  emailProvider?: EmailProviderAdapter;
  exportStore?: ReturnType<typeof makeExportStore>;
  reportsOverride?: (reportType: string) => { csv: string; truncated: boolean };
}): ReportSubscriptionDeliveryDeps {
  const exportStore = input.exportStore ?? makeExportStore();
  return {
    store: input.store,
    tableName: TABLE,
    reports: { generateReportCsv: async (_tenantId, reportType) => (input.reportsOverride ?? (() => ({ csv: `csv-for-${reportType}\n`, truncated: false })))(reportType) },
    exportStore,
    recipients: input.recipients ?? fakeRecipients({ "user-1": { email: "user1@example.com" }, "user-2": { email: "user2@example.com" } }),
    emailProvider: input.emailProvider ?? { send: async () => ({ providerMessageId: "ses-1" }) },
    downloadBaseUrl: "https://api.example.com",
    now: () => NOW,
  };
}

function seed(...items: (ReportSubscription | ReportSubscriptionRun | ReportDeliveryAttempt)[]): InMemoryReportSubscriptionStore {
  return new InMemoryReportSubscriptionStore([activeLifecycleRecord(TENANT), ...items] as unknown as (Record<string, unknown> & EntityKey)[]);
}

describe("processReportSubscriptionDelivery", () => {
  it("happy path: creates the run, generates a combined CSV per subscribed reportType, uploads once, sends to every eligible recipient", async () => {
    const store = seed(makeSubscription());
    const exportStore = makeExportStore();
    const sendCalls: EmailSendInput[] = [];
    const deps = makeDeps({ store, exportStore, emailProvider: { send: async (input) => (sendCalls.push(input), { providerMessageId: "ses-1" }) } });

    const result = await processReportSubscriptionDelivery(deps, makeCommand());

    expect(result.kind).toBe("PROCESSED");
    if (result.kind !== "PROCESSED") throw new Error("unreachable");
    expect(result.truncated).toBe(false);
    expect(result.recipients).toEqual([
      { recipientUserId: "user-1", outcome: "SENT" },
      { recipientUserId: "user-2", outcome: "SENT" },
    ]);

    expect(exportStore.uploads).toHaveLength(1);
    expect(exportStore.uploads[0]!.body).toContain("csv-for-EXPIRED_ITEMS");
    expect(exportStore.uploads[0]!.body).toContain("csv-for-MISSING_REQUIREMENTS");

    expect(sendCalls).toHaveLength(2);
    expect(sendCalls.map((c) => c.to).sort()).toEqual(["user1@example.com", "user2@example.com"]);
    expect(sendCalls[0]!.templateId).toBe("scheduled-report-delivery");
    expect(sendCalls[0]!.renderContext["downloadLink"]).toBe("https://api.example.com/reports/subscriptions/sub-1/runs/run-1/download");

    const run = await store.get<ReportSubscriptionRun>(reportSubscriptionRunKey(TENANT, "sub-1", "run-1"));
    expect(run?.reportTypes).toEqual(["EXPIRED_ITEMS", "MISSING_REQUIREMENTS"]);
    expect(run?.recipientUserIds).toEqual(["user-1", "user-2"]);

    const attempt1 = await store.get<ReportDeliveryAttempt>(reportDeliveryAttemptKey(TENANT, "sub-1", "run-1", "user-1"));
    expect(attempt1?.status).toBe("ACCEPTED");
    expect(attempt1?.providerMessageId).toBe("ses-1");
  });

  it("subscription deleted before this message's first processing attempt -> SUBSCRIPTION_AND_RUN_NOT_FOUND, nothing frozen/uploaded", async () => {
    const store = seed(); // no subscription, no prior run
    const exportStore = makeExportStore();
    const deps = makeDeps({ store, exportStore });

    const result = await processReportSubscriptionDelivery(deps, makeCommand());

    expect(result).toEqual({ kind: "SUBSCRIPTION_AND_RUN_NOT_FOUND" });
    expect(exportStore.uploads).toHaveLength(0);
  });

  it("redelivery after the run already exists reuses the FROZEN reportTypes/recipientUserIds, never the (possibly since-changed) subscription", async () => {
    const frozenRun: ReportSubscriptionRun = {
      ...reportSubscriptionRunKey(TENANT, "sub-1", "run-1"),
      entityType: "ReportSubscriptionRun",
      runId: "run-1",
      subscriptionId: "sub-1",
      tenantId: TENANT,
      scheduledFor: "2026-09-06T09:00:00.000Z",
      reportTypes: ["RENEWED_ITEMS"],
      recipientUserIds: ["user-9"],
      createdAt: "2026-09-06T09:00:01.000Z",
      purgeAfterTtl: Math.floor(Date.parse("2026-09-06T09:00:01.000Z") / 1000) + 30 * 24 * 60 * 60,
    };
    // Subscription (if re-read) would disagree with the frozen run - proves the frozen row wins.
    const store = seed(makeSubscription({ reportTypes: ["EXPIRED_ITEMS"], recipientUserIds: ["user-1"] }), frozenRun);
    const exportStore = makeExportStore();
    const deps = makeDeps({ store, exportStore, recipients: fakeRecipients({ "user-9": { email: "user9@example.com" } }) });

    const result = await processReportSubscriptionDelivery(deps, makeCommand());

    expect(result.kind).toBe("PROCESSED");
    if (result.kind !== "PROCESSED") throw new Error("unreachable");
    expect(result.recipients).toEqual([{ recipientUserId: "user-9", outcome: "SENT" }]);
    expect(exportStore.uploads[0]!.body).toContain("csv-for-RENEWED_ITEMS");
    expect(exportStore.uploads[0]!.body).not.toContain("csv-for-EXPIRED_ITEMS");
  });

  it("recipient fails fresh eligibility revalidation -> SKIPPED_INELIGIBLE, attempt FAILED_TERMINAL with skippedReason, other recipients unaffected", async () => {
    const store = seed(makeSubscription({ recipientUserIds: ["user-1", "user-2"] }));
    const deps = makeDeps({ store, recipients: fakeRecipients({ "user-2": { email: "user2@example.com" } }) }); // user-1 not eligible

    const result = await processReportSubscriptionDelivery(deps, makeCommand());

    expect(result.kind).toBe("PROCESSED");
    if (result.kind !== "PROCESSED") throw new Error("unreachable");
    expect(result.recipients).toEqual([
      { recipientUserId: "user-1", outcome: "SKIPPED_INELIGIBLE" },
      { recipientUserId: "user-2", outcome: "SENT" },
    ]);
    const attempt1 = await store.get<ReportDeliveryAttempt>(reportDeliveryAttemptKey(TENANT, "sub-1", "run-1", "user-1"));
    expect(attempt1?.status).toBe("FAILED_TERMINAL");
    expect(attempt1?.skippedReason).toBe("RECIPIENT_NOT_ELIGIBLE");
  });

  it("attempt already ACCEPTED (redelivered SQS message) -> SKIPPED_ALREADY_RESOLVED, never calls SES a second time", async () => {
    const store = seed(makeSubscription({ recipientUserIds: ["user-1"] }));
    const alreadyAccepted: ReportDeliveryAttempt = {
      ...reportDeliveryAttemptKey(TENANT, "sub-1", "run-1", "user-1"),
      entityType: "ReportDeliveryAttempt",
      tenantId: TENANT,
      subscriptionId: "sub-1",
      runId: "run-1",
      recipientUserId: "user-1",
      status: "ACCEPTED",
      providerMessageId: "ses-original",
      version: 2,
      createdAt: NOW,
      updatedAt: NOW,
      purgeAfterTtl: Math.floor(Date.parse(NOW) / 1000) + 30 * 24 * 60 * 60,
    };
    await store.transactWrite([{ Put: { TableName: TABLE, Item: alreadyAccepted as unknown as Record<string, unknown> & EntityKey, ConditionExpression: "attribute_not_exists(PK)" } }]);
    let sendCount = 0;
    const deps = makeDeps({ store, emailProvider: { send: async () => (sendCount++, { providerMessageId: "ses-should-not-happen" }) } });

    const result = await processReportSubscriptionDelivery(deps, makeCommand());

    expect(result.kind).toBe("PROCESSED");
    if (result.kind !== "PROCESSED") throw new Error("unreachable");
    expect(result.recipients).toEqual([{ recipientUserId: "user-1", outcome: "SKIPPED_ALREADY_RESOLVED" }]);
    expect(sendCount).toBe(0);
  });

  it("tenant is DELETING at SUBMITTING-claim time -> SKIPPED_TENANT_NOT_ACTIVE, no SES call ever attempted", async () => {
    const deletingLifecycleRecord = { ...activeLifecycleRecord(TENANT), status: "DELETING" };
    const store = new InMemoryReportSubscriptionStore([deletingLifecycleRecord, makeSubscription({ recipientUserIds: ["user-1"] }) as unknown as Record<string, unknown> & EntityKey]);
    let sendCount = 0;
    const deps = makeDeps({ store, emailProvider: { send: async () => (sendCount++, { providerMessageId: "should-not-happen" }) } });

    const result = await processReportSubscriptionDelivery(deps, makeCommand());

    expect(result.kind).toBe("PROCESSED");
    if (result.kind !== "PROCESSED") throw new Error("unreachable");
    expect(result.recipients).toEqual([{ recipientUserId: "user-1", outcome: "SKIPPED_TENANT_NOT_ACTIVE" }]);
    expect(sendCount).toBe(0);
  });

  it("SES rejects conclusively (terminal) -> attempt FAILED_TERMINAL, outcome SEND_FAILED, never thrown out of the batch", async () => {
    const store = seed(makeSubscription({ recipientUserIds: ["user-1"] }));
    const deps = makeDeps({
      store,
      emailProvider: {
        send: async () => {
          throw new EmailSendError("rejected", "CONCLUSIVE_TERMINAL");
        },
      },
    });

    const result = await processReportSubscriptionDelivery(deps, makeCommand());

    expect(result.kind).toBe("PROCESSED");
    if (result.kind !== "PROCESSED") throw new Error("unreachable");
    expect(result.recipients).toEqual([{ recipientUserId: "user-1", outcome: "SEND_FAILED" }]);
    const attempt = await store.get<ReportDeliveryAttempt>(reportDeliveryAttemptKey(TENANT, "sub-1", "run-1", "user-1"));
    expect(attempt?.status).toBe("FAILED_TERMINAL");
  });

  it("truncated: true on any subscribed reportType surfaces truncated: true on the overall result and in the e-mail context", async () => {
    const store = seed(makeSubscription({ reportTypes: ["EXPIRED_ITEMS", "MISSING_REQUIREMENTS"], recipientUserIds: ["user-1"] }));
    const sendCalls: EmailSendInput[] = [];
    const deps = makeDeps({
      store,
      emailProvider: { send: async (input) => (sendCalls.push(input), { providerMessageId: "ses-1" }) },
      reportsOverride: (reportType) => ({ csv: `csv-for-${reportType}\n`, truncated: reportType === "MISSING_REQUIREMENTS" }),
    });

    const result = await processReportSubscriptionDelivery(deps, makeCommand());

    expect(result.kind).toBe("PROCESSED");
    if (result.kind !== "PROCESSED") throw new Error("unreachable");
    expect(result.truncated).toBe(true);
    expect(sendCalls[0]!.renderContext["truncated"]).toBe(true);
  });
});

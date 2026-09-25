import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { SQSClient } from "@aws-sdk/client-sqs";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOutboxRelayDeps, buildDispatchOutboxRelayDepsFromEnv, buildOutboxSweeperDepsFromEnv, buildReminderDispatchOutboxOnlyRelayDepsFromEnv, buildReminderClaimConsumerDeps, buildReconciliationDeps } from "../../../src/runtime/aws/composition/reminder.js";
import { OUTBOX_DESTINATION_OWNERSHIP, type OutboxDestination } from "../../../src/shared/outbox/outbox.js";
import type { DestinationSenders } from "../../../src/workers/dispatch-outbox-relay/relay.js";

// D-300 4th-bug incident (2026-09-16, reminder-producer-implementation-plan-scoping/DECISION.md
// §8 second rollback): dispatch-outbox-relay-handler.ts and outbox-sweeper-handler.ts each built
// their real deps from `process.env` inline, and both silently omitted
// REMINDER_SCAN_CONTINUATION_QUEUE_URL when D-300 added SQS_REMINDER_SCAN_CONTINUATION_V1 -
// tsc could not catch it (a missing trailing optional argument / missing object key is
// structurally valid), and no prior test exercised either handler's real env-to-deps
// composition (only buildOutboxRelayDeps, the always-correct low-level helper, would have been a
// candidate, and it can't detect a caller that simply never reaches its 13th parameter). These
// tests exercise the REAL composition functions the two handlers actually call at import time.

const fakeClient = {} as DynamoDBDocumentClient;

function fakeSqsClient() {
  const send = vi.fn().mockResolvedValue({});
  return { client: { send } as unknown as SQSClient, send };
}

const FULL_RELAY_ENV: Record<string, string> = {
  TABLE_NAME: "t",
  DISPATCH_QUEUE_URL: "https://sqs.example/dispatch",
  IMPORT_COMMIT_QUEUE_URL: "https://sqs.example/import-commit",
  REMINDER_MATERIALIZATION_TRIGGER_QUEUE_URL: "https://sqs.example/materialization",
  IMPORT_PARSE_QUEUE_URL: "https://sqs.example/import-parse",
  REQUIREMENT_EVIDENCE_REFRESH_QUEUE_URL: "https://sqs.example/req-evidence",
  REPORT_SUBSCRIPTION_DELIVERY_QUEUE_URL: "https://sqs.example/report-sub",
  DOSSIER_EXPORT_QUEUE_URL: "https://sqs.example/dossier",
  GUEST_CREDENTIAL_ISSUANCE_QUEUE_URL: "https://sqs.example/guest-cred",
  REMINDER_SCAN_CONTINUATION_QUEUE_URL: "https://sqs.example/reminder-scan",
};

const FULL_SWEEPER_ENV: Record<string, string> = {
  ...FULL_RELAY_ENV,
  EMAIL_DELIVER_QUEUE_URL: "https://sqs.example/email",
  WHATSAPP_DELIVER_QUEUE_URL: "https://sqs.example/whatsapp",
};

describe("buildDispatchOutboxRelayDepsFromEnv (relay real env-to-deps composition)", () => {
  it("wires SQS_REMINDER_SCAN_CONTINUATION_V1 to the configured queue URL - the exact regression this incident was about", async () => {
    const { client, send } = fakeSqsClient();
    const deps = buildDispatchOutboxRelayDepsFromEnv(FULL_RELAY_ENV, fakeClient, client);
    expect(deps.senders["SQS_REMINDER_SCAN_CONTINUATION_V1"]).toBeDefined();

    await deps.senders["SQS_REMINDER_SCAN_CONTINUATION_V1"]?.({ some: "payload" }, "corr-1");

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0]?.[0] as SendMessageCommand;
    expect(command).toBeInstanceOf(SendMessageCommand);
    expect(command.input.QueueUrl).toBe("https://sqs.example/reminder-scan");
  });

  it("throws when REMINDER_SCAN_CONTINUATION_QUEUE_URL is missing - proves the validation actually runs, not just that tsc allows the call", () => {
    const { client } = fakeSqsClient();
    const envWithoutIt = { ...FULL_RELAY_ENV };
    delete envWithoutIt.REMINDER_SCAN_CONTINUATION_QUEUE_URL;
    expect(() => buildDispatchOutboxRelayDepsFromEnv(envWithoutIt, fakeClient, client)).toThrow(/REMINDER_SCAN_CONTINUATION_QUEUE_URL/);
  });
});

describe("buildOutboxSweeperDepsFromEnv (sweeper real env-to-deps composition)", () => {
  it("wires SQS_REMINDER_SCAN_CONTINUATION_V1 to the configured queue URL - the sweeper's own copy of this incident's bug", async () => {
    const { client, send } = fakeSqsClient();
    const deps = buildOutboxSweeperDepsFromEnv(FULL_SWEEPER_ENV, fakeClient, client);
    expect(deps.senders["SQS_REMINDER_SCAN_CONTINUATION_V1"]).toBeDefined();

    await deps.senders["SQS_REMINDER_SCAN_CONTINUATION_V1"]?.({ some: "payload" }, "corr-1");

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0]?.[0] as SendMessageCommand;
    expect(command.input.QueueUrl).toBe("https://sqs.example/reminder-scan");
  });

  it("throws when REMINDER_SCAN_CONTINUATION_QUEUE_URL is missing", () => {
    const { client } = fakeSqsClient();
    const envWithoutIt = { ...FULL_SWEEPER_ENV };
    delete envWithoutIt.REMINDER_SCAN_CONTINUATION_QUEUE_URL;
    expect(() => buildOutboxSweeperDepsFromEnv(envWithoutIt, fakeClient, client)).toThrow(/REMINDER_SCAN_CONTINUATION_QUEUE_URL/);
  });
});

describe("buildOutboxRelayDeps (low-level helper) - documents its always-correct optional-omission behavior", () => {
  it("omits SQS_REMINDER_SCAN_CONTINUATION_V1 from senders when the optional URL isn't passed", () => {
    const { client } = fakeSqsClient();
    const deps = buildOutboxRelayDeps(fakeClient, "t", "https://sqs.example/dispatch", client);
    expect(deps.senders["SQS_REMINDER_SCAN_CONTINUATION_V1"]).toBeUndefined();
  });

  it("includes it when the URL is passed as the 12th argument", () => {
    const { client } = fakeSqsClient();
    const deps = buildOutboxRelayDeps(fakeClient, "t", "https://sqs.example/dispatch", client, undefined, undefined, undefined, undefined, undefined, undefined, undefined, "https://sqs.example/reminder-scan");
    expect(deps.senders["SQS_REMINDER_SCAN_CONTINUATION_V1"]).toBeDefined();
  });
});

describe("buildReminderDispatchOutboxOnlyRelayDepsFromEnv (D-303 dedicated relay/sweeper composition)", () => {
  // G-V3: reusing buildOutboxRelayDeps's full 11-destination sender map here (like the shared
  // relay does) instead of hardcoding only SQS_REMINDER_DISPATCH_V1 would make Object.keys have
  // more than one entry, failing the toEqual assertion below.
  it("wires exactly one sender (SQS_REMINDER_DISPATCH_V1) - proves this is deliberately narrower than the shared relay/sweeper, not an accidental subset", async () => {
    const { client, send } = fakeSqsClient();
    const deps = buildReminderDispatchOutboxOnlyRelayDepsFromEnv({ TABLE_NAME: "reminder-dispatch-outbox", DISPATCH_QUEUE_URL: "https://sqs.example/dispatch" }, fakeClient, client);
    expect(Object.keys(deps.senders)).toEqual(["SQS_REMINDER_DISPATCH_V1"]);

    await deps.senders["SQS_REMINDER_DISPATCH_V1"]?.({ some: "payload" }, "corr-1");
    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0]?.[0] as SendMessageCommand;
    expect(command.input.QueueUrl).toBe("https://sqs.example/dispatch");
  });

  // G-V3: replacing the `if (!TABLE_NAME) throw` guard with a bare `env.TABLE_NAME as string`
  // cast (letting undefined flow through silently, the exact D-303 review Finding B) would make
  // this test pass without throwing.
  it("throws when TABLE_NAME is missing - proves the dedicated table is never silently defaulted to the shared main table", () => {
    const { client } = fakeSqsClient();
    expect(() => buildReminderDispatchOutboxOnlyRelayDepsFromEnv({ DISPATCH_QUEUE_URL: "https://sqs.example/dispatch" }, fakeClient, client)).toThrow(/TABLE_NAME/);
  });

  // G-V3: same class of mutation as the TABLE_NAME test above, applied to DISPATCH_QUEUE_URL's
  // own guard - removing/weakening it would make this pass without throwing.
  it("throws when DISPATCH_QUEUE_URL is missing", () => {
    const { client } = fakeSqsClient();
    expect(() => buildReminderDispatchOutboxOnlyRelayDepsFromEnv({ TABLE_NAME: "reminder-dispatch-outbox" }, fakeClient, client)).toThrow(/DISPATCH_QUEUE_URL/);
  });
});

describe("OUTBOX_DESTINATION_OWNERSHIP matrix vs. the REAL constructed sender maps", () => {
  // G-V3: adding a new destination to buildDispatchOutboxRelayDepsFromEnv/buildOutboxSweeperDepsFromEnv's
  // senders without updating OUTBOX_DESTINATION_OWNERSHIP to match (or vice versa) would make one
  // of the inRelay/inSweeper expectations fail here - the exact under/over-routing drift class of
  // bug the D-303 change was at risk of introducing.
  it("matches exactly what each handler's real composition function wires - catches both under-routing and over-routing", () => {
    const { client: relayClient } = fakeSqsClient();
    const { client: sweeperClient } = fakeSqsClient();
    const relaySenders = buildDispatchOutboxRelayDepsFromEnv(FULL_RELAY_ENV, fakeClient, relayClient).senders as DestinationSenders;
    const sweeperSenders = buildOutboxSweeperDepsFromEnv(FULL_SWEEPER_ENV, fakeClient, sweeperClient).senders as DestinationSenders;

    for (const [destination, owner] of Object.entries(OUTBOX_DESTINATION_OWNERSHIP) as [OutboxDestination, "relay" | "sweeper" | "both"][]) {
      const inRelay = relaySenders[destination] !== undefined;
      const inSweeper = sweeperSenders[destination] !== undefined;
      const expectedInRelay = owner === "relay" || owner === "both";
      const expectedInSweeper = owner === "sweeper" || owner === "both";
      expect(inRelay, `${destination}: expected relay=${expectedInRelay}, got ${inRelay}`).toBe(expectedInRelay);
      expect(inSweeper, `${destination}: expected sweeper=${expectedInSweeper}, got ${inSweeper}`).toBe(expectedInSweeper);
    }
  });

  // G-V3: this is a runtime companion to the compile-time `satisfies` check on
  // OUTBOX_DESTINATION_OWNERSHIP - deleting an entry from that object while leaving it in
  // allDestinations here (a scenario `satisfies` alone wouldn't re-check at runtime after a type
  // assertion bypass) would fail the toBeDefined/sort-equality assertions below.
  it("covers every OutboxDestination union member (satisfies already enforces this at compile time - this is the runtime companion check)", () => {
    const allDestinations: OutboxDestination[] = [
      "SQS_REMINDER_DISPATCH_V1",
      "SQS_NOTIFICATION_EMAIL_V1",
      "SQS_IMPORT_COMMIT_V1",
      "SQS_REMINDER_MATERIALIZATION_TRIGGER_V1",
      "SQS_IMPORT_PARSE_V1",
      "SQS_REQUIREMENT_EVIDENCE_REFRESH_V1",
      "SQS_REPORT_SUBSCRIPTION_DELIVERY_V1",
      "SQS_DOSSIER_EXPORT_V1",
      "SQS_DOCUMENT_REQUEST_CREDENTIAL_ISSUANCE_V1",
      "SQS_NOTIFICATION_WHATSAPP_V1",
      "SQS_REMINDER_SCAN_CONTINUATION_V1",
    ];
    for (const destination of allDestinations) {
      expect(OUTBOX_DESTINATION_OWNERSHIP[destination]).toBeDefined();
    }
    expect(Object.keys(OUTBOX_DESTINATION_OWNERSHIP).sort()).toEqual([...allDestinations].sort());
  });
});

describe("buildReminderClaimConsumerDeps / buildReconciliationDeps (D-303 addendum: required env var, no silent fallback)", () => {
  const ORIGINAL = process.env["REMINDER_DISPATCH_OUTBOX_TABLE_NAME"];
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env["REMINDER_DISPATCH_OUTBOX_TABLE_NAME"];
    else process.env["REMINDER_DISPATCH_OUTBOX_TABLE_NAME"] = ORIGINAL;
  });

  // G-V3: reverting the `if (!dispatchOutboxTableName) throw` check back to a bare
  // `process.env[...]` read (undefined silently flowing through) would make this pass again.
  it("buildReminderClaimConsumerDeps throws when REMINDER_DISPATCH_OUTBOX_TABLE_NAME is missing - proves the dedicated table is never silently defaulted", () => {
    delete process.env["REMINDER_DISPATCH_OUTBOX_TABLE_NAME"];
    expect(() => buildReminderClaimConsumerDeps(fakeClient, "t")).toThrow(/REMINDER_DISPATCH_OUTBOX_TABLE_NAME/);
  });

  // G-V3: same mutation class as buildReminderClaimConsumerDeps above, applied to
  // buildReconciliationDeps's own copy of the required-field guard.
  it("buildReconciliationDeps throws when REMINDER_DISPATCH_OUTBOX_TABLE_NAME is missing - same guarantee for the SCANLEASE expired-claim recovery path", () => {
    delete process.env["REMINDER_DISPATCH_OUTBOX_TABLE_NAME"];
    expect(() => buildReconciliationDeps(fakeClient, "t")).toThrow(/REMINDER_DISPATCH_OUTBOX_TABLE_NAME/);
  });
});

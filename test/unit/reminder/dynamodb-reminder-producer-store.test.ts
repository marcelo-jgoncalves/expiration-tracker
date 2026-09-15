import { describe, expect, it, vi } from "vitest";
import { DynamoDbReminderProducerStore } from "../../../src/modules/reminder/persistence/dynamodb-reminder-producer-store.js";
import * as securityAudit from "../../../src/shared/observability/security-audit.js";

function fakeClient(responses: unknown[]): { send: ReturnType<typeof vi.fn> } {
  const send = vi.fn();
  for (const r of responses) send.mockResolvedValueOnce(r);
  return { send };
}

describe("DynamoDbReminderProducerStore.queryGsi3 — security audit trail", () => {
  it("emits exactly one security.global_index_access event per logical call, even across multiple pages", async () => {
    const accessSpy = vi.spyOn(securityAudit, "auditGlobalIndexAccess");
    const client = fakeClient([
      { Items: [{ a: 1 }], LastEvaluatedKey: { k: 1 } },
      { Items: [{ a: 2 }, { a: 3 }], LastEvaluatedKey: undefined },
    ]);
    const store = new DynamoDbReminderProducerStore(client as never, "table");

    const items = await store.queryGsi3({ gsi3pk: "DUE#..." });

    expect(items).toHaveLength(3);
    expect(accessSpy).toHaveBeenCalledTimes(1);
    expect(accessSpy).toHaveBeenCalledWith({ indexName: "GSI3", operation: "Query", component: "reminder-producer", pageCount: 2, resultCount: 3 });
    accessSpy.mockRestore();
  });

  it("emits exactly one security.global_index_access_denied event on AccessDeniedException, and still rethrows", async () => {
    const deniedSpy = vi.spyOn(securityAudit, "auditGlobalIndexAccessDenied");
    const accessSpy = vi.spyOn(securityAudit, "auditGlobalIndexAccess");
    const err = Object.assign(new Error("denied"), { name: "AccessDeniedException" });
    const client = { send: vi.fn().mockRejectedValueOnce(err) };
    const store = new DynamoDbReminderProducerStore(client as never, "table");

    await expect(store.queryGsi3({ gsi3pk: "DUE#..." })).rejects.toThrow();

    expect(deniedSpy).toHaveBeenCalledTimes(1);
    expect(deniedSpy).toHaveBeenCalledWith({ indexName: "GSI3", operation: "Query", component: "reminder-producer", awsErrorCode: "AccessDeniedException" });
    expect(accessSpy).not.toHaveBeenCalled();
    deniedSpy.mockRestore();
    accessSpy.mockRestore();
  });

  it("does not misclassify an unrelated DynamoDB error as a security denial", async () => {
    const deniedSpy = vi.spyOn(securityAudit, "auditGlobalIndexAccessDenied");
    const err = Object.assign(new Error("throttled"), { name: "ThrottlingException" });
    const client = { send: vi.fn().mockRejectedValueOnce(err) };
    const store = new DynamoDbReminderProducerStore(client as never, "table");

    await expect(store.queryGsi3({ gsi3pk: "DUE#..." })).rejects.toThrow();

    expect(deniedSpy).not.toHaveBeenCalled();
    deniedSpy.mockRestore();
  });
});

describe("DynamoDbReminderProducerStore.queryGsi3Page (D-300 §2/§3) — single page, no internal auto-pagination", () => {
  it("returns exactly one page's items/lastEvaluatedKey, passing Limit/ExclusiveStartKey straight through", async () => {
    const accessSpy = vi.spyOn(securityAudit, "auditGlobalIndexAccess");
    const client = fakeClient([{ Items: [{ a: 1 }, { a: 2 }], LastEvaluatedKey: { k: 2 } }]);
    const store = new DynamoDbReminderProducerStore(client as never, "table");

    const page = await store.queryGsi3Page({ gsi3pk: "DUE#...", exclusiveStartKey: { k: 1 }, limit: 200 });

    expect(page.items).toHaveLength(2);
    expect(page.lastEvaluatedKey).toEqual({ k: 2 });
    // Only ONE client.send call - never the do/while loop queryGsi3 uses.
    expect(client.send).toHaveBeenCalledTimes(1);
    const sentCommand = client.send.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(sentCommand.input["Limit"]).toBe(200);
    expect(sentCommand.input["ExclusiveStartKey"]).toEqual({ k: 1 });
    expect(accessSpy).toHaveBeenCalledWith({ indexName: "GSI3", operation: "Query", component: "reminder-producer", pageCount: 1, resultCount: 2 });
    accessSpy.mockRestore();
  });

  it("returns undefined lastEvaluatedKey on the final page", async () => {
    const client = fakeClient([{ Items: [{ a: 1 }], LastEvaluatedKey: undefined }]);
    const store = new DynamoDbReminderProducerStore(client as never, "table");

    const page = await store.queryGsi3Page({ gsi3pk: "DUE#...", limit: 200 });

    expect(page.lastEvaluatedKey).toBeUndefined();
  });

  it("emits access-denied audit and rethrows on AccessDeniedException", async () => {
    const deniedSpy = vi.spyOn(securityAudit, "auditGlobalIndexAccessDenied");
    const err = Object.assign(new Error("denied"), { name: "AccessDeniedException" });
    const client = { send: vi.fn().mockRejectedValueOnce(err) };
    const store = new DynamoDbReminderProducerStore(client as never, "table");

    await expect(store.queryGsi3Page({ gsi3pk: "DUE#...", limit: 200 })).rejects.toThrow();

    expect(deniedSpy).toHaveBeenCalledTimes(1);
    deniedSpy.mockRestore();
  });
});

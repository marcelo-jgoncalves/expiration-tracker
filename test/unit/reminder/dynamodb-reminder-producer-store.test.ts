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

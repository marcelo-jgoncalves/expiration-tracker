import { describe, expect, it, vi } from "vitest";
import { DynamoDbOutboxRelayStore } from "../../src/shared/outbox/persistence/dynamodb-outbox-relay-store.js";
import * as securityAudit from "../../src/shared/observability/security-audit.js";

describe("DynamoDbOutboxRelayStore.listPendingReminderDispatch — security audit trail", () => {
  it("emits exactly one security.global_index_access event per logical call, even across multiple pages", async () => {
    const accessSpy = vi.spyOn(securityAudit, "auditGlobalIndexAccess");
    const client = {
      send: vi
        .fn()
        .mockResolvedValueOnce({ Items: [{ a: 1 }], LastEvaluatedKey: { k: 1 } })
        .mockResolvedValueOnce({ Items: [{ a: 2 }], LastEvaluatedKey: undefined }),
    };
    const store = new DynamoDbOutboxRelayStore(client as never, "table");

    const items = await store.listPendingReminderDispatch({ destination: "SQS_REMINDER_DISPATCH_V1", olderThan: "2026-01-01T00:00:00.000Z" });

    expect(items).toHaveLength(2);
    expect(accessSpy).toHaveBeenCalledTimes(1);
    expect(accessSpy).toHaveBeenCalledWith({ indexName: "GSI6", operation: "Query", component: "outbox-sweeper-reminder-dispatch", pageCount: 2, resultCount: 2 });
    accessSpy.mockRestore();
  });

  it("emits exactly one security.global_index_access_denied event on AccessDeniedException and rethrows, without altering the error mapping path", async () => {
    const deniedSpy = vi.spyOn(securityAudit, "auditGlobalIndexAccessDenied");
    const err = Object.assign(new Error("denied"), { name: "AccessDeniedException" });
    const client = { send: vi.fn().mockRejectedValueOnce(err) };
    const store = new DynamoDbOutboxRelayStore(client as never, "table");

    await expect(store.listPendingReminderDispatch({ destination: "SQS_REMINDER_DISPATCH_V1", olderThan: "2026-01-01T00:00:00.000Z" })).rejects.toThrow();

    expect(deniedSpy).toHaveBeenCalledTimes(1);
    expect(deniedSpy).toHaveBeenCalledWith({ indexName: "GSI6", operation: "Query", component: "outbox-sweeper-reminder-dispatch", awsErrorCode: "AccessDeniedException" });
    deniedSpy.mockRestore();
  });
});

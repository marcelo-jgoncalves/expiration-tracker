import { describe, expect, it, vi } from "vitest";
import { DynamoDbReminderReconciliationCandidateSource } from "../../../src/modules/reminder/persistence/dynamodb-reconciliation-candidate-source.js";
import * as securityAudit from "../../../src/shared/observability/security-audit.js";

describe("DynamoDbReminderReconciliationCandidateSource — security audit trail", () => {
  it("listExpiredClaims emits exactly one security.global_index_access event with pageCount 1 (single page per call)", async () => {
    const accessSpy = vi.spyOn(securityAudit, "auditGlobalIndexAccess");
    const client = { send: vi.fn().mockResolvedValueOnce({ Items: [{ a: 1 }, { a: 2 }], LastEvaluatedKey: undefined }) };
    const source = new DynamoDbReminderReconciliationCandidateSource(client as never, "table");

    const page = await source.listExpiredClaims({ before: "2026-01-01T00:00:00.000Z" });

    expect(page.items).toHaveLength(2);
    expect(accessSpy).toHaveBeenCalledTimes(1);
    expect(accessSpy).toHaveBeenCalledWith({ indexName: "GSI6", operation: "Query", component: "reminder-reconciliation", pageCount: 1, resultCount: 2 });
    accessSpy.mockRestore();
  });

  it("listExpiredClaims emits exactly one security.global_index_access_denied event on AccessDeniedException and rethrows", async () => {
    const deniedSpy = vi.spyOn(securityAudit, "auditGlobalIndexAccessDenied");
    const err = Object.assign(new Error("denied"), { name: "AccessDeniedException" });
    const client = { send: vi.fn().mockRejectedValueOnce(err) };
    const source = new DynamoDbReminderReconciliationCandidateSource(client as never, "table");

    await expect(source.listExpiredClaims({ before: "2026-01-01T00:00:00.000Z" })).rejects.toThrow();

    expect(deniedSpy).toHaveBeenCalledTimes(1);
    expect(deniedSpy).toHaveBeenCalledWith({ indexName: "GSI6", operation: "Query", component: "reminder-reconciliation", awsErrorCode: "AccessDeniedException" });
    deniedSpy.mockRestore();
  });

  it("listDstCandidates emits exactly one security.global_index_access event", async () => {
    const accessSpy = vi.spyOn(securityAudit, "auditGlobalIndexAccess");
    const client = { send: vi.fn().mockResolvedValueOnce({ Items: [{ a: 1 }], LastEvaluatedKey: undefined }) };
    const source = new DynamoDbReminderReconciliationCandidateSource(client as never, "table");

    const page = await source.listDstCandidates({ window: { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T01:00:00.000Z" } });

    expect(page.items).toHaveLength(1);
    expect(accessSpy).toHaveBeenCalledTimes(1);
    expect(accessSpy).toHaveBeenCalledWith({ indexName: "GSI6", operation: "Query", component: "reminder-reconciliation", pageCount: 1, resultCount: 1 });
    accessSpy.mockRestore();
  });
});

import { describe, expect, it, vi } from "vitest";
import { runWithContext } from "../../src/shared/observability/context.js";
import { logger } from "../../src/shared/observability/logger.js";
import { auditAuthorizationDenied, auditGlobalIndexAccess, auditGlobalIndexAccessDenied, isAccessDeniedError } from "../../src/shared/observability/security-audit.js";

describe("security-audit", () => {
  it("auditAuthorizationDenied emits exactly the closed shape, with correlationId/tenantId from context", () => {
    const spy = vi.spyOn(logger, "warn");
    runWithContext({ correlationId: "corr-1", tenantId: "tenant-1" }, () => {
      auditAuthorizationDenied({ reason: "TENANT_MISMATCH", action: "item:read" });
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [event, context] = spy.mock.calls[0]!;
    expect(event).toBe("security.authorization_denied");
    expect(context).toEqual({ reason: "TENANT_MISMATCH", action: "item:read" });
    spy.mockRestore();
  });

  it("auditAuthorizationDenied never carries resource/tenant identifiers, payloads or tokens", () => {
    const spy = vi.spyOn(logger, "warn");
    auditAuthorizationDenied({ reason: "INSUFFICIENT_ROLE", action: "item:delete" });
    const [, context] = spy.mock.calls[0]!;
    expect(Object.keys(context as object).sort()).toEqual(["action", "reason"]);
    spy.mockRestore();
  });

  it("auditGlobalIndexAccess emits exactly the closed shape for a successful query", () => {
    const spy = vi.spyOn(logger, "info");
    auditGlobalIndexAccess({
      indexName: "GSI3",
      operation: "Query",
      component: "reminder-producer",
      pageCount: 2,
      resultCount: 34,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [event, context] = spy.mock.calls[0]!;
    expect(event).toBe("security.global_index_access");
    expect(context).toEqual({ indexName: "GSI3", operation: "Query", component: "reminder-producer", pageCount: 2, resultCount: 34 });
    spy.mockRestore();
  });

  it("auditGlobalIndexAccessDenied emits exactly the closed shape without leaking the raw error", () => {
    const spy = vi.spyOn(logger, "warn");
    auditGlobalIndexAccessDenied({
      indexName: "GSI6",
      operation: "Query",
      component: "reminder-reconciliation",
      awsErrorCode: "AccessDeniedException",
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [event, context] = spy.mock.calls[0]!;
    expect(event).toBe("security.global_index_access_denied");
    expect(context).toEqual({ indexName: "GSI6", operation: "Query", component: "reminder-reconciliation", awsErrorCode: "AccessDeniedException" });
    spy.mockRestore();
  });

  it("isAccessDeniedError recognizes only the exact AWS error name, not other errors", () => {
    const accessDenied = Object.assign(new Error("denied"), { name: "AccessDeniedException" });
    const throttling = Object.assign(new Error("slow down"), { name: "ThrottlingException" });
    expect(isAccessDeniedError(accessDenied)).toBe(true);
    expect(isAccessDeniedError(throttling)).toBe(false);
    expect(isAccessDeniedError(new Error("generic"))).toBe(false);
    expect(isAccessDeniedError("not an error")).toBe(false);
    expect(isAccessDeniedError(null)).toBe(false);
  });
});

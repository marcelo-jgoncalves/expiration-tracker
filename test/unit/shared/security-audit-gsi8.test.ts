import { describe, expect, it } from "vitest";
import { deriveSecurityAuditMaintenanceDue, securityAuditGsi8Keys, SECURITY_AUDIT_PURGE_WORK_TYPE, SECURITY_AUDIT_RETENTION_DAYS } from "../../../src/shared/security-audit-gsi8.js";

describe("deriveSecurityAuditMaintenanceDue (D-179/D-187)", () => {
  it("computes occurredAt + 365 days, never undefined (append-only, no terminal state)", () => {
    const due = deriveSecurityAuditMaintenanceDue({ occurredAt: "2025-01-01T00:00:00.000Z" });
    expect(due.dueAtIso).toBe(new Date(Date.parse("2025-01-01T00:00:00.000Z") + SECURITY_AUDIT_RETENTION_DAYS * 86400000).toISOString());
  });
});

describe("securityAuditGsi8Keys (D-179/D-187)", () => {
  it("builds GSI8PK=WORK#SECURITY_AUDIT and embeds tenantId/entityType/sk into GSI8SK", () => {
    const keys = securityAuditGsi8Keys({ dueAtIso: "2026-01-01T00:00:00.000Z", tenantId: "tenant-1", entityType: "AuditEvent", sk: "EVT#2025-01-01T00:00:00.000Z#evt-1" });
    expect(keys.GSI8PK).toBe(`WORK#${SECURITY_AUDIT_PURGE_WORK_TYPE}`);
    expect(keys.GSI8SK).toBe("2026-01-01T00:00:00.000Z#TENANT#tenant-1#AuditEvent#EVT#2025-01-01T00:00:00.000Z#evt-1");
  });
});

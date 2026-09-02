/**
 * D-179/D-187: proves the GSI8 pointer is written EXACTLY ONCE, at creation, by each of the 4
 * `AuditEvent`-family `build*Event()` functions themselves — never a separate write, never
 * missing. Mirrors D-180/D-182's own "pointer written at the right write path" tests, adapted:
 * here there is exactly ONE write path per entity (the pure `build*Event()`), not several
 * application-layer call sites, since every call site funnels through it.
 */
import { describe, expect, it } from "vitest";
import { buildAuditEvent } from "../../../src/modules/expiration/domain/audit-event.js";
import { buildMembershipAuditEvent } from "../../../src/modules/organization/domain/audit-event.js";
import { buildSubjectAuditEvent } from "../../../src/modules/subject/domain/audit-event.js";
import { buildTenantAuditEvent } from "../../../src/modules/activity/domain/tenant-audit-event.js";
import { deriveSecurityAuditMaintenanceDue } from "../../../src/shared/security-audit-gsi8.js";

const OCCURRED_AT = "2025-07-01T00:00:00.000Z";
const EXPECTED_DUE = deriveSecurityAuditMaintenanceDue({ occurredAt: OCCURRED_AT }).dueAtIso;

describe("GSI8 pointer written at creation for every AuditEvent-family entity (D-179/D-187)", () => {
  it("buildAuditEvent stamps GSI8PK=WORK#SECURITY_AUDIT and a due-ordered GSI8SK keyed by tenantId", () => {
    const event = buildAuditEvent({
      auditEventId: "evt-1",
      tenantId: "tenant-1",
      itemId: "item-1",
      action: "CREATE",
      actor: { type: "USER", userId: "user-1" },
      newVersion: 1,
      changes: {},
      occurredAt: OCCURRED_AT,
      correlationId: "corr-1",
    });
    expect(event.GSI8PK).toBe("WORK#SECURITY_AUDIT");
    expect(event.GSI8SK).toBe(`${EXPECTED_DUE}#TENANT#tenant-1#AuditEvent#${event.SK}`);
  });

  it("buildMembershipAuditEvent normalizes organizationId into the GSI8SK's tenant segment", () => {
    const event = buildMembershipAuditEvent({
      auditEventId: "evt-2",
      organizationId: "org-1",
      resourceType: "Membership",
      resourceId: "membership-1",
      action: "MEMBER_REMOVED",
      actor: { type: "USER", userId: "user-1" },
      newVersion: 1,
      changes: {},
      occurredAt: OCCURRED_AT,
      correlationId: "corr-2",
    });
    expect(event.GSI8PK).toBe("WORK#SECURITY_AUDIT");
    expect(event.GSI8SK).toBe(`${EXPECTED_DUE}#TENANT#org-1#MembershipAuditEvent#${event.SK}`);
  });

  it("buildSubjectAuditEvent stamps the pointer", () => {
    const event = buildSubjectAuditEvent({
      auditEventId: "evt-3",
      tenantId: "tenant-1",
      resourceType: "TrackedSubject",
      resourceId: "subject-1",
      subjectId: "subject-1",
      action: "CREATE",
      actor: { type: "USER", userId: "user-1" },
      newVersion: 1,
      changes: {},
      occurredAt: OCCURRED_AT,
      correlationId: "corr-3",
    });
    expect(event.GSI8PK).toBe("WORK#SECURITY_AUDIT");
    expect(event.GSI8SK).toBe(`${EXPECTED_DUE}#TENANT#tenant-1#SubjectAuditEvent#${event.SK}`);
  });

  it("buildTenantAuditEvent stamps the pointer", () => {
    const event = buildTenantAuditEvent({
      auditEventId: "evt-4",
      tenantId: "tenant-1",
      resourceType: "ExpirationExport",
      action: "EXPORT",
      actor: { type: "USER", userId: "user-1" },
      changes: { exportedCount: 5 },
      occurredAt: OCCURRED_AT,
      correlationId: "corr-4",
    });
    expect(event.GSI8PK).toBe("WORK#SECURITY_AUDIT");
    expect(event.GSI8SK).toBe(`${EXPECTED_DUE}#TENANT#tenant-1#TenantAuditEvent#${event.SK}`);
  });
});

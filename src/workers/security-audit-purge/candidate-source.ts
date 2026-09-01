/**
 * Narrow port for the SecurityAuditPurgeWorker (D-153, `docs/architecture/reviews/
 * quarantine-retention-scoping/estado-final-consolidado.md` Prioridade 3 — `SECURITY_AUDIT` =
 * "AuditEvent/logs redigidos, MembershipAuditEvent" per `privacy-lgpd.md` §4 line 43, verified by
 * reading the actual code to be exactly the 4 `AuditEvent`-family entities:
 * `AuditEvent` (`src/modules/expiration/domain/audit-event.ts`),
 * `MembershipAuditEvent` (`src/modules/organization/domain/audit-event.ts`),
 * `SubjectAuditEvent` (`src/modules/subject/domain/audit-event.ts`), and
 * `TenantAuditEvent` (`src/modules/activity/domain/tenant-audit-event.ts`, the 4th sibling added
 * by D-149 to close the export-audit gap) — the SAME 4 partitions `GET /activity`'s
 * `ActivityService` k-way-merges (`src/modules/activity/domain/merge.ts`'s `AUDIT_PARTITIONS`).
 *
 * **No `version` field** (unlike `DELIVERY_RECORD`/`CORE_USER_DATA`'s candidates): every
 * `AuditEvent`-family row is append-only by construction — each domain file's own header says so
 * explicitly ("There is deliberately no update()/delete() exported anywhere for this entity") —
 * so there is no OCC counter to re-assert at delete time. `occurredAt` is re-asserted instead
 * (`purge.ts`'s `buildConditionalDelete` call) as the sole "hasn't changed since scan" fence —
 * sufficient here specifically because these rows are never mutated in place, so there is no
 * "did some OTHER field change" case a version check would additionally catch.
 *
 * **`occurredAt` IS the age clock for all 4**, never a separate `createdAt` — confirmed by
 * reading every domain file: none of the 4 declares a `createdAt` field at all.
 * `TenantAuditEvent`'s own header makes this explicit for the record: "para esta entidade
 * imutável, occurredAt É o relógio canônico equivalente a createdAt".
 *
 * **Tenant scoping**: 3 of the 4 (`AuditEvent`/`SubjectAuditEvent`/`TenantAuditEvent`) declare
 * `tenantId` directly; `MembershipAuditEvent` declares `organizationId` instead (never
 * `tenantId`) — but `organizationId` IS the tenant id in this codebase (its own partition key,
 * `membershipAuditKey()`, uses the exact same `TENANT#<organizationId>#...` prefix as every other
 * tenant-scoped partition). The candidate shape below normalizes both into one `tenantId` field
 * so `purge.ts`'s ACTIVE-tenant fence stays entity-agnostic; `dynamodb-candidate-source.ts` is
 * the one place that performs the `organizationId` -> `tenantId` mapping for this specific type.
 *
 * Same deliberate full-table `Scan` tradeoff as `core-user-data-purge`/`delivery-record-purge`'s
 * candidate sources (see their doc comments) — filtered by `entityType`/`attribute_exists
 * (occurredAt)`, not a GSI6 worklist: none of the 4 entities has an external side-effect (S3
 * object, lease) to protect with a claim state, and adding a consumer to GSI6's closed isolation
 * boundary (`data-model.md` §3, `infra/tests/stack.tftest.hcl`) for a class with no such need
 * would widen it for no reason.
 */
import type { DynamoDeleteCommandInput, EntityKey } from "../../shared/dynamodb/occ.js";

export type SecurityAuditEntityType = "AuditEvent" | "MembershipAuditEvent" | "SubjectAuditEvent" | "TenantAuditEvent";

export interface SecurityAuditPurgeCandidate extends EntityKey {
  entityType: SecurityAuditEntityType;
  /** Normalized owner-tenant id — `organizationId` for `MembershipAuditEvent`, `tenantId` for
   * the other 3 (see file header). Always the real `TENANT#<id>#...` value from the row's own
   * PK, never re-derived. */
  tenantId: string;
  occurredAt: string;
}

export interface SecurityAuditScanPage {
  items: SecurityAuditPurgeCandidate[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface SecurityAuditPurgeCandidateSource {
  /** `Scan` with `FilterExpression: (entityType IN the 4 AuditEvent-family values) AND
   * attribute_exists(occurredAt)` — see file header for the cost tradeoff this accepts. */
  scanCandidates(exclusiveStartKey?: Record<string, unknown>): Promise<SecurityAuditScanPage>;
  /** Single conditioned `DeleteItem` (`buildConditionalDelete`, not `buildVersionedDelete` — see
   * file header on why there is no `version` to check). Throws the SDK's real
   * `ConditionalCheckFailedException` (recognized via `occ.ts#isConditionalCheckFailed`) when the
   * condition doesn't hold. */
  deleteCandidate(input: DynamoDeleteCommandInput): Promise<void>;
}

/**
 * Same ACTIVE-tenant fence as `core-user-data-purge`/`delivery-record-purge`'s
 * `TenantLifecycleStatusSource` — a tenant mid-closure is the tenant-purge pipeline's job, never
 * this worker's. Deliberately the same narrow shape (not re-exported/shared), mirroring the
 * precedents' own choice to keep each purge worker's port surface independently readable.
 */
export interface TenantLifecycleStatusSource {
  getStatus(tenantId: string): Promise<string | undefined>;
}

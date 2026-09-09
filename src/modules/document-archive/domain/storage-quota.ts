/**
 * TenantStorageQuota — storage-quota-scoping (2026-09-09, D-2xx, see decisions-log.md).
 * Marcelo identified a real, previously-unplanned gap: tenants have a right to some storage
 * quota, not unlimited S3 usage, and nothing tracked storage bytes per tenant. Full billing
 * (M12) is blocked by D-052 (unrelated vendor decision) — this entity is deliberately decoupled
 * from it, same "local entitlement minimum, no external billing provider" shape
 * `subject/domain/entitlement.ts` (D-038) already established for `TenantEntitlement`.
 *
 * NOT folded into `TenantEntitlement` itself (round-1 Claude proposal) — reconciled away in
 * favor of Codex's independent finding (`docs/architecture/reviews/storage-quota-scoping/
 * reconciliation.md`): `document-archive` reaching into `subject`'s domain to extend that row
 * would invert module ownership and create unrelated OCC contention between upload bursts and
 * subject mutations sharing one row. This entity lives in `document-archive`, where the bytes
 * it counts are actually produced.
 *
 * Three-state accounting (`usedBytes` + `reservedBytes`, not `usedBytes` alone) closes a real
 * oversubscription gap Codex's independent proposal caught: without a `reservedBytes` capacity
 * hold taken transactionally at `reserveFiles()` time, N concurrent reservations against a
 * near-full quota could each read the same stale `usedBytes` and all pass, together exceeding
 * `limitBytes`. `confirmFileScanClean()` (`apply-file-scan-result.ts`) moves bytes from
 * `reservedBytes` to `usedBytes` (net zero to the committed total); the REJECTED/UNSUPPORTED/
 * TIMEOUT terminal paths release `reservedBytes` back without ever touching `usedBytes`.
 *
 * Decrement-on-delete is explicitly NOT implemented here — no `DocumentFile`/`Document`
 * hard-delete lifecycle exists anywhere in this codebase today to hook into (verified by both
 * the Claude and Codex proposals independently). The field/counter shape is forward-compatible
 * with adding it once a deletion feature ships.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { AuthorizedTenantId } from "../../identity/domain/authorization.js";

/** Confirmed by Marcelo (2026-09-09) after market research on storage-quota practices in direct
 * and adjacent competitors, US and Brazil (docs/architecture/reviews/storage-quota-scoping/
 * market-research-storage-limits-2026-09-09.md) — 8GB sits above the "standard tier" range
 * observed there, deliberately generous since this niche treats storage as a non-differentiator
 * rather than a visible commercial limit. Implemented as a named, documented, overridable
 * constant so the exact number is a one-line change, never hardcoded per tenant. */
export const DEFAULT_STORAGE_QUOTA_BYTES = 8 * 1024 * 1024 * 1024; // 8 GiB

/** Google Workspace's own cited warning threshold (80% -> "Storage low", see
 * docs/architecture/reviews/storage-quota-scoping/{claude-proposal,codex-proposal}.md) — chosen
 * deliberately over GitHub LFS's 90%/100% split (also cited) for a longer operational runway,
 * not because 80% is the only industry value observed. */
export const STORAGE_QUOTA_WARNING_THRESHOLD = 0.8;
export const STORAGE_QUOTA_CRITICAL_THRESHOLD = 0.95;

export interface TenantStorageQuota extends EntityKey {
  SK: "QUOTA";
  entityType: "TenantStorageQuota";
  tenantId: string;
  limitBytes: number;
  usedBytes: number;
  reservedBytes: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function storageQuotaKey(tenantId: AuthorizedTenantId): { PK: string; SK: "QUOTA" } {
  return { PK: `TENANT#${tenantId}#STORAGE`, SK: "QUOTA" };
}

export function defaultStorageQuota(tenantId: AuthorizedTenantId, now: string): TenantStorageQuota {
  return {
    ...storageQuotaKey(tenantId),
    entityType: "TenantStorageQuota",
    tenantId,
    limitBytes: DEFAULT_STORAGE_QUOTA_BYTES,
    usedBytes: 0,
    reservedBytes: 0,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

export interface StorageQuotaUsage {
  limitBytes: number;
  usedBytes: number;
  reservedBytes: number;
  availableBytes: number;
  usedPercent: number;
  warningLevel: "OK" | "WARNING" | "CRITICAL" | "OVER";
}

/** Pure projection — no I/O, reused verbatim by both the read route and (for the enforcement
 * decision) `reserveFiles()`, same "single source of truth" discipline other pure derivation
 * functions in this codebase follow (e.g. `deriveDocumentFileMaintenanceDue`). */
export function projectStorageQuotaUsage(quota: Pick<TenantStorageQuota, "limitBytes" | "usedBytes" | "reservedBytes">): StorageQuotaUsage {
  const committed = quota.usedBytes + quota.reservedBytes;
  const availableBytes = Math.max(0, quota.limitBytes - committed);
  const usedPercent = quota.limitBytes > 0 ? committed / quota.limitBytes : 1;
  let warningLevel: StorageQuotaUsage["warningLevel"] = "OK";
  if (committed >= quota.limitBytes) warningLevel = "OVER";
  else if (usedPercent >= STORAGE_QUOTA_CRITICAL_THRESHOLD) warningLevel = "CRITICAL";
  else if (usedPercent >= STORAGE_QUOTA_WARNING_THRESHOLD) warningLevel = "WARNING";
  return {
    limitBytes: quota.limitBytes,
    usedBytes: quota.usedBytes,
    reservedBytes: quota.reservedBytes,
    availableBytes,
    usedPercent,
    warningLevel,
  };
}

/** Whether committing `requestedBytes` more (a `reserveFiles()` batch) would push the tenant
 * over `limitBytes` — the exact fail-closed check both proposals converged on. */
export function wouldExceedStorageQuota(quota: Pick<TenantStorageQuota, "limitBytes" | "usedBytes" | "reservedBytes">, requestedBytes: number): boolean {
  return quota.usedBytes + quota.reservedBytes + requestedBytes > quota.limitBytes;
}

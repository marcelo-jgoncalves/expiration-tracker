/**
 * MaintenanceDueIndex (GSI8) pure helpers for `transient-purge` (D-156/D-179/D-188, 7th of 9
 * workers). Lives in `src/shared/` (not `modules/document/domain/` or `modules/notification/`)
 * because the two entities this worker covers — `WebhookInbox` (notification module) and
 * `UploadSlot` (document module) — span two different modules; a shared, module-agnostic home
 * avoids picking one as an arbitrary owner of a cross-module concern, same reasoning as
 * `shared/security-audit-gsi8.ts`. Never imports from `src/modules/**` (only string/date
 * primitives + `computeUploadSlotPurgeAfter`, which itself is a pure domain function with no
 * further module dependency — mirrors the existing `import` already present in `purge.ts`), so
 * `dependency-cruiser`'s `shared-must-not-reach-modules` rule holds trivially once that one
 * pure-function import is allowed (same as every other shared/*-gsi8.ts sibling).
 *
 * Two DIFFERENT dynamics, unlike every append-only sibling this GSI8 slice migrated so far:
 *   - `WebhookInbox` — create-once, immutable (D-187/quota-telemetry-purge shape): the pointer is
 *     written exactly once, at creation, `createdAt + 7d` always.
 *   - `UploadSlot` — real status transitions (D-182/invitation-purge shape): `RESERVED` (never a
 *     candidate — `deriveUploadSlotMaintenanceDue` returns `undefined`) -> `CONSUMED` (7d) or
 *     `EXPIRED`/`RELEASED` (24h, same "incomplete" window). Every writer that changes `status` off
 *     RESERVED must refresh the pointer in the SAME conditional write as the transition — see
 *     `advance-after-evidence.ts#appendSlotConsumption` and
 *     `upload-slot-reconciliation/reconciliation.ts#processOneSlot`.
 *
 * Deliberately does NOT import `computeUploadSlotPurgeAfter()`/`UploadSlotStatus` from
 * `modules/document/domain/**` — `dependency-cruiser`'s `shared-must-not-reach-modules` rule
 * forbids `src/shared/**` depending back on `src/modules/**` (verified real, not theoretical: this
 * file originally did import them and `test/architecture/tenant-fence-boundary.test.ts` caught it).
 * The retention formula (`reservedAt + 7d` if ever `CONSUMED`, `+24h` otherwise) is duplicated here
 * verbatim instead — it is `privacy-lgpd.md` §4's own definition, small and stable enough that a
 * literal one-line reimplementation is the correct trade-off over inverting the module boundary.
 */
export const TRANSIENT_PURGE_WORK_TYPE = "TRANSIENT";
export const WEBHOOK_INBOX_RETENTION_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type TransientGsi8EntityType = "WebhookInbox" | "UploadSlot";

/** Mirrors `modules/document/domain/upload-slot.ts`'s `UploadSlotStatus` union exactly — declared
 * separately (not imported) per this file's module-boundary note above. */
export type TransientUploadSlotStatus = "RESERVED" | "CONSUMED" | "EXPIRED" | "RELEASED";

/** `createdAt + 7d`, always — `WebhookInbox` is create-once/immutable, no terminal-state
 * branching (same shape as `deriveSecurityAuditMaintenanceDue`). */
export function deriveWebhookInboxMaintenanceDue(input: { createdAt: string }): { dueAtIso: string } {
  return { dueAtIso: new Date(Date.parse(input.createdAt) + WEBHOOK_INBOX_RETENTION_DAYS * MS_PER_DAY).toISOString() };
}

/** `undefined` while `RESERVED` (never a purge candidate — still an active, in-flight
 * reservation); otherwise mirrors `computeUploadSlotPurgeAfter()`'s formula (the existing,
 * already-approved M6 retention rule — `modules/document/domain/retention.ts`, duplicated here
 * per this file's module-boundary note above) with `wasConfirmed = status === "CONSUMED"` —
 * `EXPIRED` and `RELEASED` both follow the shorter "incomplete" 24h window, same as `purge.ts`'s
 * pre-GSI8 eligibility function. */
export function deriveUploadSlotMaintenanceDue(input: { status: TransientUploadSlotStatus; reservedAt: string }): { dueAtIso: string } | undefined {
  if (input.status === "RESERVED") return undefined;
  const wasConfirmed = input.status === "CONSUMED";
  const days = wasConfirmed ? 7 : 1;
  return { dueAtIso: new Date(Date.parse(input.reservedAt) + days * MS_PER_DAY).toISOString() };
}

/** `GSI8PK=WORK#TRANSIENT` / `GSI8SK=<dueAtIso>#TENANT#<tenantId>#<entityType>#<sk>` — same shape
 * as `securityAuditGsi8Keys()`: neither entity has an id usable on its own as a unique GSI8SK
 * suffix independent of its `SK` (WebhookInbox's `SK` is `EVENT#<snsMessageId>`, UploadSlot's is
 * `SLOT#<uploadSlotId>`), so the row's own `SK` is embedded verbatim to keep the pointer unique
 * per row and the `KEYS_ONLY` projection self-sufficient. */
export function transientPurgeGsi8Keys(input: {
  dueAtIso: string;
  tenantId: string;
  entityType: TransientGsi8EntityType;
  sk: string;
}): { GSI8PK: string; GSI8SK: string } {
  return {
    GSI8PK: `WORK#${TRANSIENT_PURGE_WORK_TYPE}`,
    GSI8SK: `${input.dueAtIso}#TENANT#${input.tenantId}#${input.entityType}#${input.sk}`,
  };
}

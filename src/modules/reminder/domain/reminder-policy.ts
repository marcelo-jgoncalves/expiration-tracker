/**
 * ReminderPolicy — data-model.md §2 (`TENANT#t#POLICY#p` / `META`): scope (TEMPLATE/ITEM),
 * itemId?, gatilhos relativos, recorrência, timezone, quiet hours, canais, opt-outs,
 * enabled, version. implementation-blueprint.md §9.1's `ReminderRule` interface.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import { ValidationError } from "../../../shared/errors/app-error.js";

export type ReminderPolicyScope = "TEMPLATE" | "ITEM";
export type NotificationChannelKind = "EMAIL" | "WHATSAPP";

/** A single relative trigger: `offsetIso` days from the item's dueDate (e.g. "-P7D" = 7
 * days before), fired at `localTime` in the policy's IANA timeZone. */
export interface ReminderTrigger {
  triggerId: string;
  offsetIso: string; // restricted ISO-8601 duration, see recurrence.ts parseDayOffset
  localTime: string; // "HH:mm"
}

/** If a trigger's local time falls within [startLocalTime, endLocalTime), it is pushed to
 * endLocalTime on the same calendar day (implementation-blueprint.md §9.1 "quiet hours"). */
export interface QuietHours {
  startLocalTime: string;
  endLocalTime: string;
}

export interface ReminderRule {
  name: string;
  triggers: ReminderTrigger[];
  timeZone: string; // IANA
  quietHours?: QuietHours;
  channels: NotificationChannelKind[];
  optOutChannels?: NotificationChannelKind[];
}

export interface ReminderPolicy extends EntityKey, ReminderRule {
  SK: "META";
  entityType: "ReminderPolicy";
  policyId: string;
  tenantId: string;
  scope: ReminderPolicyScope;
  itemId?: string;
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export function policyKey(tenantId: string, policyId: string): { PK: string; SK: "META" } {
  return { PK: `TENANT#${tenantId}#POLICY#${policyId}`, SK: "META" };
}

/**
 * BLOCKER-B item->policy discovery pointer (reminder-delivery-pipeline.md §5) - a
 * denormalized row under the ITEM's own partition, not the policy's, purely so the
 * materialization-trigger worker can discover "which ITEM-scoped policies target this
 * item" without a table scan or new GSI. Discovery-only, never authoritative: the row
 * holds nothing but the policyId itself (no `enabled`, no version - both would just be
 * one more place to go stale) - every reader must dereference the real `ReminderPolicy`
 * row before acting on it.
 */
export function policyRefKey(tenantId: string, itemId: string, policyId: string): { PK: string; SK: string } {
  return { PK: `TENANT#${tenantId}#ITEM#${itemId}`, SK: `POLICYREF#${policyId}` };
}

export const POLICY_REF_SK_PREFIX = "POLICYREF#";

export interface PolicyRef extends EntityKey {
  entityType: "ReminderPolicyRef";
  policyId: string;
  tenantId: string;
}

export interface PutPolicyInput {
  scope: ReminderPolicyScope;
  itemId?: string;
  rule: ReminderRule;
  enabled?: boolean;
}

/**
 * Domain invariant (reminder-delivery-pipeline.md §5, Codex Round B/F finding): `scope:
 * "ITEM"` requires `itemId`; `scope: "TEMPLATE"` forbids it. Neither the domain type nor
 * the JSON schema enforced this before BLOCKER-B - enforced here as the single point every
 * caller (create/update) must pass through.
 */
export function validatePolicyScope(input: Pick<PutPolicyInput, "scope" | "itemId">): void {
  if (input.scope === "ITEM" && !input.itemId) {
    throw new ValidationError("ReminderPolicy scope 'ITEM' requires itemId.", { scope: input.scope });
  }
  if (input.scope === "TEMPLATE" && input.itemId) {
    throw new ValidationError("ReminderPolicy scope 'TEMPLATE' forbids itemId.", { scope: input.scope, itemId: input.itemId });
  }
}

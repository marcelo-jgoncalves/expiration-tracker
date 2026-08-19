/**
 * ReminderPolicy — data-model.md §2 (`TENANT#t#POLICY#p` / `META`): scope (TEMPLATE/ITEM),
 * itemId?, gatilhos relativos, recorrência, timezone, quiet hours, canais, opt-outs,
 * enabled, version. implementation-blueprint.md §9.1's `ReminderRule` interface.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

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

export interface PutPolicyInput {
  scope: ReminderPolicyScope;
  itemId?: string;
  rule: ReminderRule;
  enabled?: boolean;
}

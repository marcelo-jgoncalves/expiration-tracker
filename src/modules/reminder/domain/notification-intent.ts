/**
 * NotificationIntent — data-model.md §2 (`TENANT#t#INTENT#n` / `META`). M3 only creates
 * this entity deterministically (implementation-blueprint.md M3 exit criterion: "sem
 * delivery externo") - the Notification module (M4) owns routing/delivery/attempts.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export type NotificationIntentStatus = "PENDING" | "CANCELLED" | "DISPATCHED" | "CORRECTIVE";
export type NotificationIntentKind = "EXPIRATION_REMINDER" | "CORRECTIVE";

export interface NotificationIntent extends EntityKey {
  SK: "META";
  entityType: "NotificationIntent";
  intentId: string;
  tenantId: string;
  kind: NotificationIntentKind;
  itemId: string;
  occurrenceId: string;
  itemVersion: number;
  policyId: string;
  policyVersion: number;
  scheduledAt: string;
  requestedChannels: ("EMAIL" | "WHATSAPP")[];
  status: NotificationIntentStatus;
  supersedesIntentId: string | null;
  correctionReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function intentKey(tenantId: string, intentId: string): { PK: string; SK: "META" } {
  return { PK: `TENANT#${tenantId}#INTENT#${intentId}`, SK: "META" };
}

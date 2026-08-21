/**
 * NotificationIntent — data-model.md §2 (`TENANT#t#INTENT#n` / `META`). M3 only creates
 * this entity deterministically (implementation-blueprint.md M3 exit criterion: "sem
 * delivery externo") - the Notification module (M4) owns routing/delivery/attempts.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export type NotificationIntentStatus = "PENDING" | "CANCELLED" | "DISPATCHED" | "CORRECTIVE";
/**
 * M4 (docs/architecture/m4-notification-engine-design.md, fechamento de rodada 3) splits
 * the single "CORRECTIVE" kind in two, predicated on whether the external delivery limit
 * could have been crossed for the stale intent being superseded (see
 * corrective-intent-service.ts): REPLACEMENT when nothing could have gone out yet,
 * CORRECTIVE when a stale delivery is possible or proven.
 */
export type NotificationIntentKind = "EXPIRATION_REMINDER" | "REPLACEMENT" | "CORRECTIVE";

export type NotificationChannel = "EMAIL" | "WHATSAPP";

/** M4 router cancellation reasons (docs/architecture/reviews/m4-notification-engine-design/codex-proposal-round1.md §3.1) - never silent, always auditable. */
export type NotificationChannelCancellationReason =
  | "ITEM_INACTIVE"
  | "STALE_ITEM_VERSION"
  | "POLICY_DISABLED"
  | "POLICY_VERSION_CHANGED"
  | "RECIPIENT_NOT_FOUND"
  | "RECIPIENT_NOT_ELIGIBLE"
  | "OPTED_OUT"
  | "NOT_ENTITLED"
  | "CHANNEL_UNAVAILABLE";

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
  requestedChannels: NotificationChannel[];
  status: NotificationIntentStatus;
  supersedesIntentId: string | null;
  correctionReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** M4: resolved by NotificationRecipientResolver, never written by the M3 dispatch worker. */
  recipientUserId?: string;
  /** M4: channels actually routed to the outbox after the router's fail-closed/fail-open matrix. */
  routedChannels?: NotificationChannel[];
  /** M4: per-channel reason a requested channel was NOT routed - auditable, never silent. */
  cancelledChannels?: { channel: NotificationChannel; reason: NotificationChannelCancellationReason }[];
  routedAt?: string;
}

export function intentKey(tenantId: string, intentId: string): { PK: string; SK: "META" } {
  return { PK: `TENANT#${tenantId}#INTENT#${intentId}`, SK: "META" };
}

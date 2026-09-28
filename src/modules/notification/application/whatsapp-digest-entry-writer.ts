/**
 * `buildDigestEntryWriteEntry` (D-347 §3.5) — the single TransactWriteItems entry
 * `notification-router-workflow.ts`'s `applyRoutedDecision` appends when a WHATSAPP channel's
 * delivery is decided as DIGEST rather than immediate. Put-if-absent for a brand-new window,
 * versioned Update (same OCC discipline as every other entity in this codebase) when the window
 * already exists — the caller supplies `existing` (a consistent read done just before building
 * this transaction, same pattern `routeNotificationIntent` already uses for item/policy/
 * entitlements/preferences) so this stays a pure builder, no store access of its own.
 */
import { buildVersionedUpdate } from "../../../shared/dynamodb/occ.js";
import type { TransactWriteEntry } from "../ports/notification-store.js";
import { appendDigestEntryItem, digestEntryGsi8Keys, digestEntryKey, type DigestEntry, type DigestEntryItem } from "../domain/digest-entry.js";

export function buildDigestEntryWriteEntry(input: {
  tableName: string;
  tenantId: string;
  recipientUserId: string;
  windowDate: string;
  existing: DigestEntry | undefined;
  newItem: DigestEntryItem;
  now: string;
}): TransactWriteEntry {
  const next = appendDigestEntryItem(input.existing, {
    tenantId: input.tenantId,
    recipientUserId: input.recipientUserId,
    channel: "WHATSAPP",
    windowDate: input.windowDate,
    newItem: input.newItem,
    now: input.now,
  });
  const gsi8 = digestEntryGsi8Keys({ tenantId: input.tenantId, recipientUserId: input.recipientUserId, flushAt: next.flushAt });

  if (!input.existing) {
    return {
      Put: {
        TableName: input.tableName,
        Item: { ...next, ...gsi8 },
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      },
    };
  }

  return {
    Update: buildVersionedUpdate({
      tableName: input.tableName,
      key: digestEntryKey(input.tenantId, input.recipientUserId, "WHATSAPP", input.windowDate),
      tenantId: input.tenantId,
      expectedVersion: input.existing.version,
      now: input.now,
      set: { items: next.items, ...gsi8 },
    }),
  };
}

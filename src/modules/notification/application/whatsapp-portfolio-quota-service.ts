/**
 * WhatsAppPortfolioQuotaService — D-8 (fatia 4/5, `whatsapp-portfolio-quota.ts` for the physical
 * shape/decision function). Sits in `WhatsAppDeliveryWorker`'s admission path, right after a
 * recipient phone is resolved and right before the real Cloud API `send()` call — the same
 * "admit before the external call, never after" discipline the SUBMITTING lease claim already
 * follows in `whatsapp-delivery-workflow.ts`.
 *
 * Fail-closed on any read error (design's explicit requirement, `estado-final-consolidado.md`
 * D-8): a DynamoDB read failure here is treated exactly like TIER_LIMIT_REACHED — the send is
 * refused, never silently allowed just because we could not verify the portfolio's real
 * consumption. This differs from `TenantQuotaService.consumeEphemeralTelemetry`'s deliberate
 * fail-OPEN for pure rate-limiting telemetry (identity/application/quota.ts) — this quota gates
 * a real external send against a hard third-party ceiling, not telemetry, so the two failure
 * postures are intentionally different, not an inconsistency.
 */
import type { NotificationStore } from "../ports/notification-store.js";
import {
  buildWhatsAppPortfolioQuotaEntry,
  evaluateWhatsAppPortfolioQuota,
  whatsAppPortfolioQuotaWindowEndSk,
  whatsAppPortfolioQuotaWindowStartSk,
  type WhatsAppPortfolioQuotaEntry,
} from "../domain/whatsapp-portfolio-quota.js";

export type WhatsAppPortfolioQuotaCheckResult =
  | { allowed: true }
  | { allowed: false; reason: "TIER_LIMIT_REACHED" | "READ_FAILURE" };

export interface WhatsAppPortfolioQuotaDeps {
  store: NotificationStore;
  /** Meta's own tier ceiling for this portfolio's phone number, in unique recipients/24h
   * (250/2.000/10.000/100.000) — operator-configured, never hardcoded (the tier is a Meta
   * account property that can change independently of a deploy). */
  tierLimit: number;
  now: () => string;
}

/**
 * Reads the rolling-24h window, decides admission, and — only when admitted — records `to` as a
 * new consumption entry (`putIfAbsent`, so a retried call for the identical millisecond+phone
 * never double-writes; a genuinely new attempt gets a new `sentAt`, so this is not meant to be,
 * nor needs to be, idempotent across distinct send attempts for the same recipient — each real
 * send legitimately adds one entry, same as SES's per-send audit trail has no dedupe either).
 */
export async function checkAndRecordWhatsAppPortfolioQuota(
  deps: WhatsAppPortfolioQuotaDeps,
  to: string,
): Promise<WhatsAppPortfolioQuotaCheckResult> {
  const now = deps.now();
  let windowEntries: WhatsAppPortfolioQuotaEntry[];
  try {
    windowEntries = await deps.store.queryWhatsAppPortfolioQuotaWindow<WhatsAppPortfolioQuotaEntry>(
      whatsAppPortfolioQuotaWindowStartSk(now),
      whatsAppPortfolioQuotaWindowEndSk(now),
    );
  } catch {
    return { allowed: false, reason: "READ_FAILURE" };
  }

  const distinctPhonesInWindow = new Set(windowEntries.map((entry) => entry.phoneE164));
  const decision = evaluateWhatsAppPortfolioQuota({ distinctPhonesInWindow, to, tierLimit: deps.tierLimit });
  if (!decision.allowed) return { allowed: false, reason: decision.reason };

  await deps.store.putIfAbsent(buildWhatsAppPortfolioQuotaEntry({ sentAtIso: now, phoneE164: to }));
  return { allowed: true };
}

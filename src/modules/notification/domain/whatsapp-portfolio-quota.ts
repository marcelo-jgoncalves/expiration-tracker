/**
 * WhatsAppPortfolioQuota — D-8 of `docs/architecture/reviews/whatsapp-channel-scoping/
 * estado-final-consolidado.md` (fatia 4/5). Meta's Cloud API messaging-limits tiers
 * (250/2.000/10.000/100.000/Unlimited, `round1-claude-proposal.md` lines 26-29) are measured in
 * UNIQUE phone numbers reached by business-initiated ("Utility", D-4) messages in a rolling
 * 24h window, aggregated across the WHOLE Meta portfolio shared by every tenant of this
 * SaaS — never a per-tenant quota. `TenantQuotaService` (identity/application/quota.ts) was
 * evaluated and rejected for this (D-197 achado 1): it counts calls per tenant in a
 * fixed window, not distinct recipients in a moving window shared cross-tenant.
 *
 * Physical shape is deliberately a BASE-table item, not a GSI (round3-claude-revision.md
 * criterio 3: "chave de índice time-ordered, consultável por range real"): `PK=WHATSAPP#
 * PORTFOLIO`, `SK=SENT#<sentAtIso>#<phoneE164>` — time FIRST in the SK (a v2 draft had this
 * inverted, a real Codex finding that made range Query invalid) so a single `Query` with a
 * `SK BETWEEN` condition returns exactly the rolling-window candidates, time-ordered.
 * `purgeAfterTtl` set to sentAt+25h (1h grace past the 24h window so a query issued at the very
 * edge of the window never races the native TTL sweep, which is best-effort/not latency-bound).
 *
 * Deliberately tenantless (no `AuthorizedTenantId` in this key builder, `AGENTS.md`'s D-237-240
 * discipline does not apply here): the whole point of this entity is that it is NOT scoped to
 * any one tenant — it is the aggregate consumption of a portfolio resource shared by all
 * tenants, the same reason `WebhookInbox` WhatsApp (D-231, D-7) is account-scoped rather than
 * tenant-scoped. IAM isolation is `dynamodb:LeadingKeys=["WHATSAPP#PORTFOLIO"]`
 * (`infra/modules/dynamo-table/main.tf`), attached ONLY to `WhatsAppDeliveryWorker`'s role.
 *
 * Named, accepted risk (round3-claude-revision.md lines 50-58): every tenant's send writes to
 * the SAME physical partition — a documented hot-partition risk, proportional to the project's
 * current stage (no real users, Meta's own tier ceiling starting at 250-2.000/24h is orders of
 * magnitude below any real DynamoDB partition throughput ceiling). Sharding by hour bucket
 * (`WHATSAPP#PORTFOLIO#<YYYYMMDDHH>`) is the named trigger for later, not built now.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export const WHATSAPP_PORTFOLIO_QUOTA_PK = "WHATSAPP#PORTFOLIO";

/** 25h, not 24h — see the module docstring's TTL grace-window rationale. */
const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;
const QUOTA_TTL_GRACE_MS = 60 * 60 * 1000;

export interface WhatsAppPortfolioQuotaEntry extends EntityKey {
  entityType: "WhatsAppPortfolioQuotaEntry";
  phoneE164: string;
  sentAt: string;
  /** Epoch seconds — native DynamoDB TTL attribute (`infra/modules/dynamo-table/main.tf`). */
  purgeAfterTtl: number;
}

export function whatsAppPortfolioQuotaKey(sentAtIso: string, phoneE164: string): EntityKey {
  return { PK: WHATSAPP_PORTFOLIO_QUOTA_PK, SK: `SENT#${sentAtIso}#${phoneE164}` };
}

/** Lower bound (inclusive) of the rolling 24h window's `SK` range, as of `nowIso` — pass to a
 * `SK >= :windowStart` Query condition against `PK=WHATSAPP#PORTFOLIO`. Deliberately has no
 * trailing phone segment (unbounded on that axis) — the range condition only needs to bound
 * time, `begins_with`/upper-bound on phone is never meaningful here. */
export function whatsAppPortfolioQuotaWindowStartSk(nowIso: string): string {
  return `SENT#${new Date(Date.parse(nowIso) - QUOTA_WINDOW_MS).toISOString()}`;
}

/** Upper bound (inclusive) of the range — `"SENT#" + nowIso + "￿"` sorts after every real
 * phone suffix for a `sentAt` timestamp equal to `nowIso` itself, so an entry recorded in the
 * same millisecond as the read is never missed by an off-by-one exclusive bound. */
export function whatsAppPortfolioQuotaWindowEndSk(nowIso: string): string {
  return `SENT#${nowIso}￿`;
}

export function buildWhatsAppPortfolioQuotaEntry(input: { sentAtIso: string; phoneE164: string }): WhatsAppPortfolioQuotaEntry {
  return {
    ...whatsAppPortfolioQuotaKey(input.sentAtIso, input.phoneE164),
    entityType: "WhatsAppPortfolioQuotaEntry",
    phoneE164: input.phoneE164,
    sentAt: input.sentAtIso,
    purgeAfterTtl: Math.floor((Date.parse(input.sentAtIso) + QUOTA_WINDOW_MS + QUOTA_TTL_GRACE_MS) / 1000),
  };
}

export type WhatsAppPortfolioQuotaDecision =
  | { allowed: true }
  | { allowed: false; reason: "TIER_LIMIT_REACHED" };

/**
 * Pure decision, no I/O: given the set of distinct phone numbers already reached in the rolling
 * window and the tier's ceiling, decide whether `to` may be admitted. A phone already present in
 * the window is always allowed (it was already counted against the tier — sending it again
 * doesn't consume a NEW unique-recipient slot, matching Meta's own "unique numbers reached"
 * metric, not a raw message count). A phone not yet present is only allowed while the window's
 * distinct-recipient count is still under the tier limit.
 */
export function evaluateWhatsAppPortfolioQuota(input: {
  distinctPhonesInWindow: ReadonlySet<string>;
  to: string;
  tierLimit: number;
}): WhatsAppPortfolioQuotaDecision {
  if (input.distinctPhonesInWindow.has(input.to)) return { allowed: true };
  if (input.distinctPhonesInWindow.size >= input.tierLimit) return { allowed: false, reason: "TIER_LIMIT_REACHED" };
  return { allowed: true };
}

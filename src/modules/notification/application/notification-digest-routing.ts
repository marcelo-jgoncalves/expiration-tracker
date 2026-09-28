/**
 * D-347 §3.5 / `docs/architecture/roadmap-evolution/07-domain-model-escalation-watchers-digest.md`:
 * pure decision of whether a routed channel's delivery for this intent goes into the daily
 * WhatsApp digest or bypasses it as an immediate send. Pure and dependency-free by design (no
 * store access) — same "decide first, write second" split `notification-router.ts`'s own
 * `decideRouting` already established, so this is unit-testable without any fake store.
 */
import type { NotificationChannel, NotificationIntent } from "../../reminder/domain/notification-intent.js";
import { deriveValidityStateFromExpiry } from "../../../shared/domain/validity-state.js";

export type DigestRoutingDecision = "BYPASS_IMMEDIATE" | "DIGEST";

/**
 * Only WHATSAPP is ever digestible — EMAIL's marginal cost is negligible (§3.5: "o WhatsApp de
 * SAÍDA é consolidado", never email), so digesting it would only add customer-facing delay for
 * no real cost benefit. Within WHATSAPP, bypass (send immediately, never delayed) whenever:
 *   - the item is already VENCIDO (overdue) — reuses the domain's own existing "VENCIDO"
 *     vocabulary (`deriveValidityStateFromExpiry`, `shared/domain/validity-state.ts`), never a
 *     new threshold invented for this decision; or
 *   - the intent's audience is MANAGER (D-201 escalation) — an escalation trigger is by
 *     construction a critical/late signal (fires only when the assignee's own window has
 *     already passed), matching §3.5's "escalonamento crítico" bypass criterion.
 * Every other WHATSAPP intent (ASSIGNEE/WATCHER, item not yet overdue) is digestible.
 */
export function decideDigestRouting(input: {
  channel: NotificationChannel;
  targetKind: NotificationIntent["targetKind"];
  itemDueDate: string | undefined;
  now: string;
}): DigestRoutingDecision {
  if (input.channel !== "WHATSAPP") return "BYPASS_IMMEDIATE";
  if (input.targetKind === "MANAGER") return "BYPASS_IMMEDIATE";
  const validity = deriveValidityStateFromExpiry(input.itemDueDate, new Date(input.now));
  return validity === "VENCIDO" ? "BYPASS_IMMEDIATE" : "DIGEST";
}

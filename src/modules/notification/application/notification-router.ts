/**
 * NotificationRouter decision logic (M4). Pure function - no AWS SDK, no I/O - the Lambda
 * composition root loads every entity with consistent reads first, then calls this to
 * decide what happens, then translates the result into a single TransactWriteItems.
 *
 * Implements the fail-closed/fail-open matrix from
 * docs/architecture/reviews/m4-notification-engine-design/codex-proposal-round1.md §5.2,
 * in the deliberate order from §5.1:
 *   tenant/resource validation -> item status/version -> policy status/version
 *   -> recipient status -> entitlement -> opt-out -> channel/provider config
 *   -> quiet hours -> transactional route
 * Quiet hours never hides a definitive cancellation - it only applies once every other
 * check has already passed.
 */
import type { NotificationChannel, NotificationChannelCancellationReason } from "../../reminder/domain/notification-intent.js";
import { decideCorrectiveIntentKind } from "./corrective-intent-service.js";
import type { NotificationAttemptStatus } from "../domain/notification-attempt.js";
import { computeDeliverNotBefore, type QuietHoursConfig } from "./quiet-hours.js";

export interface RouterItemState {
  version: number;
  status: "ACTIVE" | "ARCHIVED" | "DELETED";
}

export interface RouterPolicyState {
  version: number;
  enabled: boolean;
  requiresCommunication: boolean;
}

export interface RouterRecipientState {
  /** undefined = resolver could not find/validate a recipient for the candidate userId
   * (RECIPIENT_NOT_FOUND if no user exists at all, RECIPIENT_NOT_ELIGIBLE if it exists but
   * fails the tenant-membership/active check - both fail-closed, never a silent fallback). */
  resolved: { userId: string; active: boolean } | undefined;
  candidateWasEmpty: boolean;
}

export interface RouterEntitlementState {
  /** undefined = entitlement record technically unavailable (storage error) - fail-closed
   * WITH RETRY, distinct from `enabled: false` (plan genuinely denies the channel). */
  emailEnabled: boolean | undefined;
  /** D-197 fatia 5/5: mirrors `emailEnabled` but for the WHATSAPP channel
   * (`NotificationEntitlements.whatsapp.enabled` - a field that has existed on the entity
   * since the design's Rodada 1 but had no reader until this fatia). Optional (not
   * `boolean | undefined` like emailEnabled) so every EMAIL-only fixture/call site that
   * predates WhatsApp keeps compiling unchanged - `undefined`/absent is treated the same as
   * `false` (not entitled), never fail-open, since a missing entitlement record already fails
   * the whole intent closed via the EMAIL branch below whenever EMAIL is also requested; when
   * WHATSAPP is the ONLY requested channel this per-channel check is what fails it closed. */
  whatsappEnabled?: boolean;
}

export interface RouterPreferenceState {
  /** undefined = NotificationPreferences record itself is missing/corrupt (distinct from
   * "record exists, emailEnabled: false", which is a real opt-out). Treated fail-closed
   * WITH RETRY - a technical gap, not evidence of consent withdrawal (onboarding is
   * expected to have created this record; a missing one is an operational anomaly to
   * surface, not silently interpreted either way). */
  emailEnabled: boolean | undefined;
  quietHours: QuietHoursConfig | undefined;
}

export interface RouterInput {
  intent: {
    itemVersion: number;
    policyVersion: number;
    requestedChannels: NotificationChannel[];
  };
  item: RouterItemState | undefined;
  policy: RouterPolicyState | undefined;
  recipient: RouterRecipientState;
  entitlement: RouterEntitlementState;
  preference: RouterPreferenceState;
  /** Status of the most recent NotificationAttempt against the SAME stale intent being
   * evaluated for staleness - only consulted when item/policy version mismatches, to decide
   * REPLACEMENT vs CORRECTIVE via corrective-intent-service.ts. */
  latestAttemptStatus?: NotificationAttemptStatus;
  /** D-197 fatia 5/5: `isWhatsAppChannelEnabled(flags)` (`whatsapp-activation.ts`) - the
   * `WHATSAPP` kill-switch flag, evaluated by the composition root once per batch and passed
   * in here so this function stays pure/I-O-free. `false` (including the default when the
   * caller omits it) means WHATSAPP is never routable regardless of entitlement - the
   * kill-switch gate is checked BEFORE entitlement, same "flag off = mechanism fully inert"
   * discipline as `document-archive-activation.ts` (D-193 slice 8/9). */
  whatsappChannelEnabled?: boolean;
  now: string;
}

export type RouterDecision =
  | { kind: "STALE"; correctiveKind: "REPLACEMENT" | "CORRECTIVE" }
  | { kind: "CANCELLED_ALL"; reason: NotificationChannelCancellationReason }
  | { kind: "RETRY"; cause: string }
  | {
      kind: "ROUTED";
      routedChannels: NotificationChannel[];
      cancelledChannels: { channel: NotificationChannel; reason: NotificationChannelCancellationReason }[];
      deliverNotBefore?: string;
    };

/** D-197 fatia 5/5: EMAIL is unconditionally supported once steps 2-6 above already passed
 * (those steps gate the EMAIL-specific entitlement/preference records that predate WhatsApp).
 * WHATSAPP requires BOTH the kill switch (`whatsappChannelEnabled`) AND its own entitlement
 * flag (`entitlement.whatsappEnabled`) - a tenant whose plan denies WhatsApp never routes to
 * it even with the global kill switch on, same per-tenant-plan semantics EMAIL already has via
 * `entitlement.emailEnabled` above. WhatsApp consent itself (`WhatsAppOptIn`, D-5) is checked
 * downstream by the delivery worker's `resolveRecipientPhone` (D-8/fatia 2-4), never here -
 * the router only decides CHANNEL availability, not per-recipient consent. */
function isChannelRoutable(channel: NotificationChannel, input: RouterInput): boolean {
  if (channel === "EMAIL") return true;
  return input.whatsappChannelEnabled === true && input.entitlement.whatsappEnabled === true;
}

export function decideRouting(input: RouterInput): RouterDecision {
  // 1. Tenant/resource validation is the composition root's job (it only loads entities
  // after confirming they share the intent's tenantId) - by the time this function runs,
  // any tenant mismatch has already produced a RETRY/security event upstream, never reaches
  // here as a distinct branch.

  // 2. Item status/version.
  if (!input.item || input.item.status !== "ACTIVE") {
    return { kind: "CANCELLED_ALL", reason: "ITEM_INACTIVE" };
  }
  if (input.item.version !== input.intent.itemVersion) {
    const { kind } = decideCorrectiveIntentKind(input.latestAttemptStatus);
    return { kind: "STALE", correctiveKind: kind };
  }

  // 3. Policy status/version.
  if (!input.policy || !input.policy.enabled) {
    return { kind: "CANCELLED_ALL", reason: "POLICY_DISABLED" };
  }
  if (input.policy.version !== input.intent.policyVersion) {
    if (!input.policy.requiresCommunication) {
      return { kind: "CANCELLED_ALL", reason: "POLICY_VERSION_CHANGED" };
    }
    const { kind } = decideCorrectiveIntentKind(input.latestAttemptStatus);
    return { kind: "STALE", correctiveKind: kind };
  }

  // 4. Recipient status.
  if (input.recipient.candidateWasEmpty) {
    return { kind: "CANCELLED_ALL", reason: "RECIPIENT_NOT_FOUND" };
  }
  if (!input.recipient.resolved) {
    return { kind: "CANCELLED_ALL", reason: "RECIPIENT_NOT_FOUND" };
  }
  if (!input.recipient.resolved.active) {
    return { kind: "CANCELLED_ALL", reason: "RECIPIENT_NOT_ELIGIBLE" };
  }

  // 5. Entitlement - storage failure is fail-closed WITH RETRY, never silently cancelled.
  if (input.entitlement.emailEnabled === undefined) {
    return { kind: "RETRY", cause: "ENTITLEMENT_UNAVAILABLE" };
  }
  if (!input.entitlement.emailEnabled) {
    return { kind: "CANCELLED_ALL", reason: "NOT_ENTITLED" };
  }

  // 6. Opt-out - a missing preference record is a technical gap (fail-closed WITH RETRY),
  // never interpreted as consent either way.
  if (input.preference.emailEnabled === undefined) {
    return { kind: "RETRY", cause: "PREFERENCE_UNAVAILABLE" };
  }
  if (!input.preference.emailEnabled) {
    return { kind: "CANCELLED_ALL", reason: "OPTED_OUT" };
  }

  // Per-channel: EMAIL always routable past this point; WHATSAPP only when the kill switch AND
  // its own entitlement flag both pass. Any other requested channel is cancelled individually
  // (CHANNEL_UNAVAILABLE), never blocking a sibling channel in the same intent.
  const cancelledChannels: { channel: NotificationChannel; reason: NotificationChannelCancellationReason }[] = [];
  const routedChannels: NotificationChannel[] = [];
  for (const channel of input.intent.requestedChannels) {
    if (isChannelRoutable(channel, input)) {
      routedChannels.push(channel);
    } else {
      cancelledChannels.push({ channel, reason: "CHANNEL_UNAVAILABLE" });
    }
  }
  if (routedChannels.length === 0) {
    return { kind: "CANCELLED_ALL", reason: "CHANNEL_UNAVAILABLE" };
  }

  // 7/8. Quiet hours - evaluated last, deliberately: it can only DEFER, never override a
  // cancellation already decided above. A failure to evaluate quiet hours (missing/invalid
  // timezone data) must not silently assume "can send now" - callers should treat an
  // exception thrown by computeDeliverNotBefore as a RETRY, not swallow it here.
  const deliverNotBefore = input.preference.quietHours ? computeDeliverNotBefore(input.now, input.preference.quietHours) : undefined;

  return { kind: "ROUTED", routedChannels, cancelledChannels, deliverNotBefore };
}

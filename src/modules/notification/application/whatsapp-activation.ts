/**
 * D-197 fatia 3/5 (D-10, `whatsapp-channel-scoping/estado-final-consolidado.md`) - the
 * mandatory-order two-flag activation gate for WhatsApp delivery, same mechanism as
 * `extraction/application/document-archive-activation.ts` (D-193 slice 8/9): `WHATSAPP` alone
 * being on does not authorize an actual send - `WHATSAPP_DELIVERY_WORKER_ENABLED` must ALSO be
 * on. This mirrors that file's own "closes the window BY CONSTRUCTION" reasoning: the delivery
 * worker (`whatsapp-delivery-handler.ts`) gates its real `send()` call on THIS function, never on
 * the raw `WHATSAPP_DELIVERY_WORKER_ENABLED` value alone, so turning the worker flag on while
 * `WHATSAPP` itself is off can never authorize a send.
 */
import type { FeatureFlags } from "../../extraction/ports/feature-flags-reader.js";

/** `WHATSAPP` alone gates whether the channel is considered available at all (opt-in flows,
 * router visibility - the router itself is not wired yet, D-197's fatia 5/5). No dependency on
 * the delivery-worker flag - a channel can be "on" for opt-in purposes while the worker that
 * actually sends stays off. */
export function isWhatsAppChannelEnabled(flags: FeatureFlags): boolean {
  return flags.WHATSAPP === true;
}

/** The delivery worker may only actually call `WhatsAppProviderAdapter.send()` when BOTH flags
 * are on, `WHATSAPP` included - the mandatory-order mechanism itself. While this returns `false`
 * (the default, both flags off), `whatsapp-delivery-handler.ts` must treat every SQS message on
 * `whatsapp-deliver-queue` as dropped-without-side-effect (logged, batch item NOT marked failed -
 * same "kill switch off = no-op, not a retry loop" posture the queue's own DLQ/redrive policy
 * assumes), never partially processed. */
export function isWhatsAppDeliveryWorkerEnabled(flags: FeatureFlags): boolean {
  return flags.WHATSAPP === true && flags.WHATSAPP_DELIVERY_WORKER_ENABLED === true;
}

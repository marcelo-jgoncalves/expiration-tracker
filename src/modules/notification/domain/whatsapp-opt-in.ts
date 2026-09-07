/**
 * WhatsAppOptIn — D-5 of `docs/architecture/reviews/whatsapp-channel-scoping/
 * estado-final-consolidado.md`. Fatia 1 of the 5-slice implementation program (D-1 widening +
 * D-5/D-6 new entities, no HTTP exposed yet — see `decisions-log.md` D-1 for this fatia's
 * exact boundary).
 *
 * The key deliberately embeds the phone number (`SK=WHATSAPP_OPTIN#<phoneE164>`), not just the
 * user: a phone number change is a NEW opt-in record, not a mutation of the old one. This makes
 * "consent is scoped to the CURRENT phone" true by construction — a future router checking
 * `WHATSAPP_OPTIN#<GlobalUser.phoneE164 at read time>` automatically finds nothing for a
 * superseded number, with no separate invalidation step and no risk of forgetting one (the
 * failure mode a mutable "optedIn: boolean" field on a single row would have). This is the
 * design's stated mechanism (D-5), not an incidental choice.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import { isValidE164 } from "../../../shared/text/phone-e164.js";
import { ValidationError } from "../../../shared/errors/app-error.js";

/** How consent was captured. `USER_SETTINGS` is the only source fatia 1 wires a caller for;
 * the union stays open (mirrors `NotificationConsentSource`) so a future guest/onboarding path
 * doesn't require a breaking rename. */
export type WhatsAppOptInSource = "USER_SETTINGS";

export interface WhatsAppOptIn extends EntityKey {
  // PK = TENANT#<tenantId>#USER#<userId>, SK = WHATSAPP_OPTIN#<phoneE164>
  entityType: "WhatsAppOptIn";
  tenantId: string;
  userId: string;
  phoneE164: string;
  source: WhatsAppOptInSource;
  optedInAt: string;
  createdAt: string;
}

export function whatsAppOptInKey(tenantId: string, userId: string, phoneE164: string): EntityKey {
  return { PK: `TENANT#${tenantId}#USER#${userId}`, SK: `WHATSAPP_OPTIN#${phoneE164}` };
}

/**
 * Builds the row to `putIfAbsent` (create-once — opting in twice for the same tenant/user/phone
 * is idempotent no-op, never a second row or an overwrite of `optedInAt`). Throws
 * synchronously, before any I/O, on a malformed phone number — the same "fail before writing
 * anything" discipline `updateDocumentMetadataValues`/other D-2xx mutations follow, rather than
 * letting a bad value reach DynamoDB and surface as an opaque failure downstream.
 */
export function buildWhatsAppOptIn(input: {
  tenantId: string;
  userId: string;
  phoneE164: string;
  source: WhatsAppOptInSource;
  now: string;
}): WhatsAppOptIn {
  if (!isValidE164(input.phoneE164)) {
    throw new ValidationError(`Invalid E.164 phone number: ${input.phoneE164}`, { phoneE164: input.phoneE164 });
  }
  return {
    ...whatsAppOptInKey(input.tenantId, input.userId, input.phoneE164),
    entityType: "WhatsAppOptIn",
    tenantId: input.tenantId,
    userId: input.userId,
    phoneE164: input.phoneE164,
    source: input.source,
    optedInAt: input.now,
    createdAt: input.now,
  };
}

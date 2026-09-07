/**
 * E.164 phone number format validation — shared between `GlobalUser.phoneE164` (identity
 * module, D-6 of `docs/architecture/reviews/whatsapp-channel-scoping/estado-final-consolidado.md`)
 * and `WhatsAppOptIn` (notification module, D-5 of the same design), same "shared/text is the
 * only common ground" convention `normalizeDisplayName` already established (`.dependency-
 * cruiser.cjs` forbids a module-to-module import for this).
 *
 * E.164 itself (ITU-T): a leading `+`, no leading zero after it, 1-15 digits total (country
 * code + subscriber number). Deliberately does NOT attempt country-specific length/prefix
 * validation (no such catalog exists in this codebase, and Meta's Cloud API itself only
 * requires E.164 shape at submission time — a stricter local check would reject numbers this
 * code cannot actually know are invalid).
 */
const E164_PATTERN = /^\+[1-9]\d{1,14}$/;

export function isValidE164(value: string): boolean {
  return E164_PATTERN.test(value);
}

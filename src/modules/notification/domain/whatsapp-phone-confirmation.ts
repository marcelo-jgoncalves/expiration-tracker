/**
 * WhatsAppPhoneConfirmation — closes the gap named in NEXT_SESSION_PROMPT.md item 26 (2026-09-23,
 * Marcelo): `WhatsAppOptInService.recordOptIn()` used to persist any self-declared E.164 number
 * with zero proof of possession, unlike e-mail (`VerifyEmail.tsx` + Cognito confirmation code).
 * Two real risks that made this a blocker for `WHATSAPP_DELIVERY_WORKER_ENABLED` going live with
 * real users (alongside the separate legal gate, E-019): (1) a mistyped or someone-else's number
 * would start receiving another organization's due-date reminders; (2) the Meta WhatsApp Business
 * Platform policy requires verifiable consent — messaging a never-confirmed number is exactly the
 * pattern that can get a WABA suspended on audit.
 *
 * Deliberately a NEW sibling entity, not a status field bolted onto `WhatsAppOptIn`: `WhatsAppOptIn`
 * is only ever created (via `WhatsAppOptInService.recordOptIn()`) AFTER `confirmPhone()` below
 * succeeds — never before. This means `WhatsAppOptIn`'s own create-once/idempotent semantics,
 * `notification-router.ts`'s consent check, and the delivery workflow's `resolveRecipientPhone`
 * never need to change: every `WhatsAppOptIn` row that exists today, or is created from now on, was
 * already possession-confirmed by construction. No migration, no backfill, no new status enum to
 * thread through three other files.
 *
 * Simpler than `invitation-token.ts`'s selector/secret split: that pattern exists because a token
 * is resolved by an anonymous caller who doesn't yet have tenant/user context (the token itself IS
 * the lookup key). Here the caller is always an authenticated user inside their own tenant — the
 * lookup key (`tenantId`+`userId`+`phoneE164`) is already known, so the code itself only needs to be
 * HMAC-hashed (never stored raw), not split into a separate selector.
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import { isValidE164 } from "../../../shared/text/phone-e164.js";
import { ValidationError } from "../../../shared/errors/app-error.js";

/** Short-lived by design (a code sent over WhatsApp, re-typed by hand) — nowhere near
 * `INVITATION_TOKEN_TTL_SECONDS`'s 14 days. */
export const WHATSAPP_PHONE_CONFIRMATION_TTL_SECONDS = 10 * 60;

/** Wrong-code guesses allowed before the caller must request a fresh code — mirrors the order of
 * magnitude Cognito itself enforces on its own confirmation codes, never unlimited guesses against
 * a 6-digit (1-in-a-million) space. */
export const WHATSAPP_PHONE_CONFIRMATION_MAX_ATTEMPTS = 5;

/** Minimum time between two code requests for the SAME tenant/user/phone — without this, an
 * authenticated user could repeatedly trigger real WhatsApp sends to an arbitrary third-party
 * number just by mistyping/retyping it on this screen (a spam vector against a stranger, not just
 * an abuse-of-quota concern). */
export const WHATSAPP_PHONE_CONFIRMATION_RESEND_COOLDOWN_SECONDS = 60;

export interface WhatsAppPhoneConfirmation extends EntityKey {
  // PK = TENANT#<tenantId>#USER#<userId>, SK = WHATSAPP_PHONE_CONFIRMATION#<phoneE164>
  entityType: "WhatsAppPhoneConfirmation";
  tenantId: string;
  userId: string;
  phoneE164: string;
  /** HMAC-SHA256(pepper, code) — the raw 6-digit code is never persisted. */
  codeHash: string;
  attemptCount: number;
  createdAt: string;
  expiresAt: string;
  /** Physical DynamoDB TTL attribute — same "read by app code, not itself a live invariant"
   * caveat as `invitation-token.ts`'s `purgeAfterTtl`. */
  purgeAfterTtl: number;
  /** Written only once `confirmPhone()` verifies a match — never set by a bare read. */
  confirmedAt?: string;
}

export function whatsAppPhoneConfirmationKey(tenantId: string, userId: string, phoneE164: string): EntityKey {
  return { PK: `TENANT#${tenantId}#USER#${userId}`, SK: `WHATSAPP_PHONE_CONFIRMATION#${phoneE164}` };
}

/** Pepper sourced from config/Secrets Manager at the composition root, never hardcoded — same
 * discipline as `invitation-token.ts`'s `InvitationTokenCrypto`. */
export interface WhatsAppPhoneConfirmationCrypto {
  hash(pepper: string, code: string): string;
}

export const hmacWhatsAppPhoneConfirmationCrypto: WhatsAppPhoneConfirmationCrypto = {
  hash(pepper: string, code: string): string {
    return createHmac("sha256", pepper).update(code).digest("hex");
  },
};

/** Uniform random 6-digit code, zero-padded (`"000000"`–`"999999"`) — `randomInt` is
 * cryptographically strong (Node's `crypto`, not `Math.random()`). */
export function generateWhatsAppConfirmationCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function buildWhatsAppPhoneConfirmation(input: {
  tenantId: string;
  userId: string;
  phoneE164: string;
  code: string;
  pepper: string;
  now: string;
  crypto?: WhatsAppPhoneConfirmationCrypto;
}): WhatsAppPhoneConfirmation {
  if (!isValidE164(input.phoneE164)) {
    throw new ValidationError(`Invalid E.164 phone number: ${input.phoneE164}`, { phoneE164: input.phoneE164 });
  }
  const crypto = input.crypto ?? hmacWhatsAppPhoneConfirmationCrypto;
  const expiresAtMs = Date.parse(input.now) + WHATSAPP_PHONE_CONFIRMATION_TTL_SECONDS * 1000;
  const expiresAt = new Date(expiresAtMs).toISOString();
  return {
    ...whatsAppPhoneConfirmationKey(input.tenantId, input.userId, input.phoneE164),
    entityType: "WhatsAppPhoneConfirmation",
    tenantId: input.tenantId,
    userId: input.userId,
    phoneE164: input.phoneE164,
    codeHash: crypto.hash(input.pepper, input.code),
    attemptCount: 0,
    createdAt: input.now,
    expiresAt,
    purgeAfterTtl: Math.floor(expiresAtMs / 1000),
  };
}

/** `timingSafeEqual` comparison — never `===` on a value derived from a secret, same discipline
 * as `invitation-token.ts`'s `invitationSecretMatches`. */
export function whatsAppConfirmationCodeMatches(
  pepper: string,
  code: string,
  expectedCodeHash: string,
  crypto: WhatsAppPhoneConfirmationCrypto = hmacWhatsAppPhoneConfirmationCrypto,
): boolean {
  const actual = Buffer.from(crypto.hash(pepper, code), "hex");
  const expected = Buffer.from(expectedCodeHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function isWhatsAppPhoneConfirmationExpired(confirmation: WhatsAppPhoneConfirmation, nowIso: string): boolean {
  return Date.parse(confirmation.expiresAt) <= Date.parse(nowIso);
}

export function isWhatsAppPhoneConfirmationInCooldown(confirmation: WhatsAppPhoneConfirmation, nowIso: string): boolean {
  const elapsedSeconds = (Date.parse(nowIso) - Date.parse(confirmation.createdAt)) / 1000;
  return elapsedSeconds < WHATSAPP_PHONE_CONFIRMATION_RESEND_COOLDOWN_SECONDS;
}

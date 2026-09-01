/**
 * GuestSession — D-143 Decision 4 (guest access, layer 2 of 3). Short-lived (30 minutes),
 * minted ONLY by an explicit human interstitial action (`startGuestSession` in
 * `guest-document-access-service.ts`) — NEVER automatically as a side effect of resolving a
 * `RequestAccessCredential`. This is deliberate: an automated e-mail link-scanner that follows
 * the credential link would otherwise silently mint (and could exhaust/rotate) a session nobody
 * asked for; requiring a distinct, explicit action (e.g. a "Continuar" click on an interstitial
 * page) means only a real human visit ever creates one.
 *
 * Same crypto/lookup shape as `RequestAccessCredential` (HMAC+pepper+timingSafeEqual+dummy-path,
 * tenantless `DOCARCHIVEGUESTSESSION#<selectorHash>`/`POINTER` pointer) — see that file's doc
 * comment for the full reasoning, not repeated here.
 *
 * Also carries a CSRF double-submit token (`csrfTokenHash`): minting a session returns the raw
 * `csrfToken` to the caller once (set as a cookie by the HTTP layer), and every subsequent
 * mutating guest call must present the SAME value back in a header — this module only stores the
 * hash and exposes a compare function, the double-submit cookie mechanics themselves live in
 * `http/document-archive-guest-handlers.ts`.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export const GUEST_SESSION_TTL_SECONDS = 30 * 60; // 30 minutes, Decision 4.

export interface GuestSession extends EntityKey {
  SK: "POINTER";
  entityType: "GuestSession";
  selectorHash: string;
  secretHash: string;
  tenantId: string;
  subjectId: string;
  requirementId: string;
  documentRequestId: string;
  /** The credential's own `selectorHash` this session was minted from — audit trail only, never
   * used for authorization (the session is self-sufficient once minted). */
  credentialSelectorHash: string;
  csrfTokenHash: string;
  expiresAt: string;
  purgeAfterTtl: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function guestSessionKey(selectorHash: string): { PK: string; SK: "POINTER" } {
  return { PK: `DOCARCHIVEGUESTSESSION#${selectorHash}`, SK: "POINTER" };
}

export interface GuestSessionCrypto {
  hash(pepper: string, value: string): string;
}

export const hmacGuestSessionCrypto: GuestSessionCrypto = {
  hash(pepper: string, value: string): string {
    return createHmac("sha256", pepper).update(value).digest("hex");
  },
};

export interface IssuedGuestSession {
  token: string;
  selector: string;
  selectorHash: string;
  secretHash: string;
  csrfToken: string;
  csrfTokenHash: string;
}

export function issueGuestSession(pepper: string, crypto: GuestSessionCrypto = hmacGuestSessionCrypto): IssuedGuestSession {
  const selector = randomBytes(16).toString("hex");
  const secret = randomBytes(32).toString("hex");
  const csrfToken = randomBytes(32).toString("hex");
  return {
    token: `${selector}.${secret}`,
    selector,
    selectorHash: crypto.hash(pepper, selector),
    secretHash: crypto.hash(pepper, secret),
    csrfToken,
    csrfTokenHash: crypto.hash(pepper, csrfToken),
  };
}

export interface ParsedGuestSessionToken {
  selector: string;
  secret: string;
}

export function parseGuestSessionToken(raw: string): ParsedGuestSessionToken | undefined {
  const parts = raw.split(".");
  if (parts.length !== 2) return undefined;
  const [selector, secret] = parts;
  if (!selector || !secret || !/^[a-f0-9]{32}$/.test(selector) || !/^[a-f0-9]{64}$/.test(secret)) return undefined;
  return { selector, secret };
}

function timingSafeHashEquals(pepper: string, value: string, expectedHash: string, crypto: GuestSessionCrypto): boolean {
  const actual = Buffer.from(crypto.hash(pepper, value), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function guestSessionSecretMatches(pepper: string, secret: string, expectedSecretHash: string, crypto: GuestSessionCrypto = hmacGuestSessionCrypto): boolean {
  return timingSafeHashEquals(pepper, secret, expectedSecretHash, crypto);
}

/** Double-submit CSRF check: the raw `csrfToken` presented by the caller (header, matched
 * against the cookie by the HTTP layer BEFORE this is even called) is hashed and compared
 * `timingSafeEqual` against the session's stored `csrfTokenHash`. */
export function guestSessionCsrfMatches(pepper: string, csrfToken: string, expectedCsrfTokenHash: string, crypto: GuestSessionCrypto = hmacGuestSessionCrypto): boolean {
  return timingSafeHashEquals(pepper, csrfToken, expectedCsrfTokenHash, crypto);
}

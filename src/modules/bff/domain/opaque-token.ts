/**
 * Opaque selector.secret token — the exact same mechanism as
 * src/modules/subject/domain/guest-token.ts's GuestTokenPointer, generalized for the BFF's
 * two ephemeral/session tokens (LoginAttempt handle, Session handle) instead of duplicating
 * it twice. Never invent a third pattern for the same problem (AGENTS.md §4's "reuse the
 * existing pattern" principle, applied here to a pattern proven within this same session).
 *
 * `selector` is the DynamoDB lookup key (public, low-entropy-safe since it never authorizes
 * anything by itself). `secret` is verified via HMAC + timingSafeEqual and is what actually
 * proves possession of the cookie - only its hash is ever persisted, exactly like
 * GuestTokenPointer's selectorHash/secretHash split.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface TokenCrypto {
  hash(pepper: string, value: string): string;
}

export const hmacTokenCrypto: TokenCrypto = {
  hash(pepper: string, value: string): string {
    return createHmac("sha256", pepper).update(value).digest("hex");
  },
};

export interface IssuedOpaqueToken {
  /** Full cookie value - never persisted raw. */
  token: string;
  selector: string;
  selectorHash: string;
  secretHash: string;
}

export function issueOpaqueToken(pepper: string, crypto: TokenCrypto = hmacTokenCrypto): IssuedOpaqueToken {
  const selector = randomBytes(16).toString("hex");
  const secret = randomBytes(32).toString("hex");
  return {
    token: `${selector}.${secret}`,
    selector,
    selectorHash: crypto.hash(pepper, selector),
    secretHash: crypto.hash(pepper, secret),
  };
}

export interface ParsedOpaqueToken {
  selector: string;
  secret: string;
}

/** Structural parse only - never throws, returns undefined for any unexpected shape (same
 * anti-enumeration-adjacent discipline as parseGuestToken: a malformed cookie must look
 * exactly like "not found", never like a distinguishable parse error). */
export function parseOpaqueToken(raw: string): ParsedOpaqueToken | undefined {
  const parts = raw.split(".");
  if (parts.length !== 2) return undefined;
  const [selector, secret] = parts;
  if (!selector || !secret || !/^[a-f0-9]{32}$/.test(selector) || !/^[a-f0-9]{64}$/.test(secret)) return undefined;
  return { selector, secret };
}

export function opaqueTokenSecretMatches(
  pepper: string,
  secret: string,
  expectedSecretHash: string,
  crypto: TokenCrypto = hmacTokenCrypto,
): boolean {
  const actual = Buffer.from(crypto.hash(pepper, secret), "hex");
  const expected = Buffer.from(expectedSecretHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

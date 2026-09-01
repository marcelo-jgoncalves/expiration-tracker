/**
 * RequestAccessCredential — D-143 Decision 4 (guest access, layer 1 of 3). Long-duration,
 * revocable `selector.secret` pair granting an external (non-authenticated) party the right to
 * view ONE `DocumentRequest` and, via `GuestSession`, eventually upload evidence for it. TTL
 * equals the business Request's deadline (Decision 4: "TTL = prazo do Request de negócio") —
 * never a fixed literal like the older subject-module `GuestTokenPointer`'s 14 days.
 *
 * Crypto (deliberate deviation from the design doc's illustrative "Argon2id" wording, traceable
 * per D-143 Decision 4's E-014 research declaration — SIM, NIST SP 800-63B-4 §5.1.2): this
 * codebase has ZERO Argon2id anywhere (verified by grep before writing this file). Argon2id's
 * memory-hardness exists to slow an OFFLINE brute-force search against a LOW-entropy secret
 * (a human-chosen password drawn from a small effective keyspace). The `secret` half of this
 * credential is 256 bits of `randomBytes` — a high-entropy secret NIST SP 800-63B-4 §5.1.2
 * classifies as not needing a memory-hard KDF at all; a plain keyed hash already makes offline
 * guessing infeasible (2^256 search space), and Argon2id would only add real CPU/memory cost
 * to every legitimate verification for no corresponding security gain. This module therefore
 * reuses the exact HMAC-SHA256 + versioned pepper + `timingSafeEqual` + dummy-hash anti-timing
 * pattern already established and battle-tested by `src/modules/subject/domain/guest-token.ts`
 * (same architecture, same reasoning applies identically to this credential's secret shape) —
 * not a new `argon2` dependency.
 *
 * Lookup via tenantless pointer item (`DOCARCHIVEGUEST#<selectorHash>`/`POINTER`) — another
 * instance of the same documented tenantless-partition exception `guest-token.ts` names as its
 * own "third exception" (after `IdentityMapping` and GSI3): the lookup happens BEFORE `tenantId`
 * is known, so the PK cannot begin with `TENANT#<tenantId>`.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export interface RequestAccessCredential extends EntityKey {
  SK: "POINTER";
  entityType: "RequestAccessCredential";
  selectorHash: string;
  secretHash: string;
  tenantId: string;
  subjectId: string;
  requirementId: string;
  documentRequestId: string;
  tokenVersion: number;
  expiresAt: string;
  /** DynamoDB TTL attribute (epoch seconds) — same D-047/D-048 lesson `GuestTokenPointer`
   * documents: `expiresAt` alone is only ever read by application code, never triggers physical
   * deletion on its own. */
  purgeAfterTtl: number;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function requestAccessCredentialKey(selectorHash: string): { PK: string; SK: "POINTER" } {
  return { PK: `DOCARCHIVEGUEST#${selectorHash}`, SK: "POINTER" };
}

export function epochSecondsFromIso(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

/** Pepper is injected from config/Secrets Manager by the composition root — this module only
 * implements the hash/compare mechanics, same separation as `guest-token.ts`'s `GuestTokenCrypto`. */
export interface RequestAccessCrypto {
  hash(pepper: string, value: string): string;
}

export const hmacRequestAccessCrypto: RequestAccessCrypto = {
  hash(pepper: string, value: string): string {
    return createHmac("sha256", pepper).update(value).digest("hex");
  },
};

export interface IssuedRequestAccessCredential {
  /** Full `selector.secret` value embedded in the link sent to the external party — never
   * persisted raw. */
  token: string;
  selector: string;
  selectorHash: string;
  secretHash: string;
}

/** Generates a new high-entropy selector/secret pair (128/256 bits respectively — same sizing
 * as `guest-token.ts`'s `issueGuestToken`). */
export function issueRequestAccessCredential(pepper: string, crypto: RequestAccessCrypto = hmacRequestAccessCrypto): IssuedRequestAccessCredential {
  const selector = randomBytes(16).toString("hex");
  const secret = randomBytes(32).toString("hex");
  return {
    token: `${selector}.${secret}`,
    selector,
    selectorHash: crypto.hash(pepper, selector),
    secretHash: crypto.hash(pepper, secret),
  };
}

export interface ParsedRequestAccessToken {
  selector: string;
  secret: string;
}

/** Parse never throws — malformed input takes the same dummy-comparison path as every other
 * failure mode (anti-enumeration). */
export function parseRequestAccessToken(raw: string): ParsedRequestAccessToken | undefined {
  const parts = raw.split(".");
  if (parts.length !== 2) return undefined;
  const [selector, secret] = parts;
  if (!selector || !secret || !/^[a-f0-9]{32}$/.test(selector) || !/^[a-f0-9]{64}$/.test(secret)) return undefined;
  return { selector, secret };
}

/** `timingSafeEqual` comparison — never `===` on a value derived from a secret. */
export function requestAccessSecretMatches(pepper: string, secret: string, expectedSecretHash: string, crypto: RequestAccessCrypto = hmacRequestAccessCrypto): boolean {
  const actual = Buffer.from(crypto.hash(pepper, secret), "hex");
  const expected = Buffer.from(expectedSecretHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

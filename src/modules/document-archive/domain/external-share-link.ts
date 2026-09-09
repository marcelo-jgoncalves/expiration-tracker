/**
 * ExternalShareLink — D-225 (`docs/architecture/reviews/external-sharing-scoping/
 * estado-final-consolidado.md`, design `APPROVED` via 4-round Claude<->Codex protocol, Decisions
 * 1-12). Roadmap P1 backlog item 8/19 (last item of the P1 backlog).
 *
 * A "frozen copy" grant: `documentVersionId`/`documentFileId` are resolved and persisted
 * CONCRETE at creation (never "CURRENT version"), and are NEVER re-resolved later. Every
 * anonymous read revalidates ONLY `DocumentFile.scanStatus="CLEAN"` + `cleanObject` presence +
 * tenant `ACTIVE` status + `ExternalShareLink.status="ACTIVE"` + `expiresAt` in the future
 * (Decision 6) — it deliberately NEVER revalidates `DocumentVersion.state` or `Document.status`
 * again after creation (the whole point of freezing a copy: revoking the underlying document's
 * lifecycle after the fact must never retroactively invalidate a link the design says is frozen).
 *
 * Token mechanics reuse the MORE SPECIFIC `request-access-credential.ts` precedent (D-143),
 * literally (Decision 2) — NOT the generic `guest-token.ts` — with the module's OWN HMAC pepper
 * (never sharing another domain's pepper) and its own selector/secret sizing (128/256 bits).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { AuthorizedTenantId } from "../../identity/domain/authorization.js";

export type ExternalShareLinkStatus = "ACTIVE" | "REVOKED"; // EXPIRED is never persisted — always derived from expiresAt.

/** Decision 9: at most 5 active links per Document — reconciliation of naturally-expired links
 * is bounded to this same count per creation attempt, never an unbounded scan. */
export const MAX_ACTIVE_SHARE_LINKS_PER_DOCUMENT = 5;

export const DEFAULT_SHARE_LINK_TTL_DAYS = 7;
export const MAX_SHARE_LINK_TTL_DAYS = 30;
/** Decision 1: `purgeAfterTtl` = `expiresAt` + 30 days of audit margin. */
export const SHARE_LINK_AUDIT_MARGIN_DAYS = 30;
/** Decision 5: visitor-facing presign TTL. */
export const SHARE_LINK_PRESIGN_TTL_SECONDS = 300;

export interface ExternalShareLink extends EntityKey {
  SK: `SHARE#${string}`;
  entityType: "ExternalShareLink";
  tenantId: string;
  documentId: string;
  /** Copied from `DocumentType.displayName` at creation — never re-read afterward (frozen copy). */
  documentTypeNameSnapshot: string;
  documentVersionId: string;
  documentFileId: string;
  /** Frozen alongside `documentFileId` at creation — lets `resolveForAnonymousAccess` rebuild
   * `documentFileKey()` directly (own seq-padded SK segment) WITHOUT ever re-reading
   * `DocumentVersion` again (Decision 6: never revalidates `DocumentVersion.state` after
   * creation, so this must not need it merely to compute a key either). */
  documentFileSeq: number;
  /** Snapshot of `DocumentVersion.issuedAt` at creation (Decision 5's `documentIssuedDate` DTO
   * field) — frozen for the same reason `documentFileSeq` is: the visitor route must never read
   * `DocumentVersion` again. `undefined` when the version carried no `issuedAt`. */
  documentIssuedDateSnapshot?: string;
  selectorHash: string;
  secretHash: string;
  status: ExternalShareLinkStatus;
  createdByUserId: string;
  expiresAt: string;
  purgeAfterTtl: number;
  revokedAt?: string;
  /** Absent when revocation was a lazy reconciliation of a naturally-expired link (Decision 9),
   * present only for an explicit human-initiated revoke (Decision 7). */
  revokedByUserId?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  GSI1PK: string;
  GSI1SK: string;
}

export function externalShareLinkKey(tenantId: AuthorizedTenantId, documentId: string, shareId: string): { PK: string; SK: `SHARE#${string}` } {
  return { PK: `TENANT#${tenantId}#DOCUMENT#${documentId}`, SK: `SHARE#${shareId}` };
}

/** GSI1 (same physically-shared index as Document/Requirement's own status namespaces,
 * discriminated by prefix — never a new index, per D-225's infra guidance): active-links-by-
 * Document, used both by cap reconciliation (Decision 9, `limit: 5`) and by the admin listing
 * (Decision 12). */
export function externalShareLinkGsi1Keys(
  tenantId: AuthorizedTenantId,
  documentId: string,
  status: ExternalShareLinkStatus,
  createdAt: string,
  shareId: string,
): { GSI1PK: string; GSI1SK: string } {
  return {
    GSI1PK: `TENANT#${tenantId}#DOCSHARE#${documentId}#STATUS#${status}`,
    GSI1SK: `CREATED#${createdAt}#SHARE#${shareId}`,
  };
}

/** Tenantless pointer (3rd documented exception, same shape as `GuestTokenPointer`/
 * `RequestAccessCredential`) — the ONLY authority for resolving a raw token to a tenant/document/
 * share triple. The `{shareId}` embedded in the public route is for LOGGING ONLY; a mismatch
 * between the route's shareId and the pointer's own `shareId` collapses into the same generic
 * error as every other anti-enumeration failure mode (never a distinct "wrong shareId" signal). */
export function externalShareLinkPointerKey(selectorHash: string): { PK: string; SK: "POINTER" } {
  return { PK: `SHARELINK#${selectorHash}`, SK: "POINTER" };
}

export interface ExternalShareLinkPointer extends EntityKey {
  SK: "POINTER";
  entityType: "ExternalShareLinkPointer";
  tenantId: string;
  documentId: string;
  shareId: string;
  selectorHash: string;
  secretHash: string;
  purgeAfterTtl: number;
}

export function epochSecondsFromIso(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

export function addDaysIso(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 24 * 60 * 60 * 1000).toISOString();
}

/** Crypto adapter shape mirrors `RequestAccessCrypto` — kept as its own interface (not imported)
 * so this module never shares a pepper/crypto instance across domains by accident. */
export interface ExternalShareLinkCrypto {
  hash(pepper: string, value: string): string;
}

export const hmacExternalShareLinkCrypto: ExternalShareLinkCrypto = {
  hash(pepper: string, value: string): string {
    return createHmac("sha256", pepper).update(value).digest("hex");
  },
};

export interface IssuedExternalShareLinkToken {
  /** Full `selector.secret` value embedded in the URL PATH — never the query string (Decision 3)
   * — and never persisted raw. */
  token: string;
  selector: string;
  selectorHash: string;
  secretHash: string;
}

/** 128/256-bit selector/secret — identical sizing to `issueRequestAccessCredential`. */
export function issueExternalShareLinkToken(pepper: string, crypto: ExternalShareLinkCrypto = hmacExternalShareLinkCrypto): IssuedExternalShareLinkToken {
  const selector = randomBytes(16).toString("hex");
  const secret = randomBytes(32).toString("hex");
  return {
    token: `${selector}.${secret}`,
    selector,
    selectorHash: crypto.hash(pepper, selector),
    secretHash: crypto.hash(pepper, secret),
  };
}

export interface ParsedExternalShareLinkToken {
  selector: string;
  secret: string;
}

/** Never throws — malformed input takes the same dummy-comparison path as every other failure
 * mode (anti-enumeration, Decision 1/5). */
export function parseExternalShareLinkToken(raw: string): ParsedExternalShareLinkToken | undefined {
  const parts = raw.split(".");
  if (parts.length !== 2) return undefined;
  const [selector, secret] = parts;
  if (!selector || !secret || !/^[a-f0-9]{32}$/.test(selector) || !/^[a-f0-9]{64}$/.test(secret)) return undefined;
  return { selector, secret };
}

/** `timingSafeEqual` comparison — never `===` on a value derived from a secret. */
export function externalShareLinkSecretMatches(
  pepper: string,
  secret: string,
  expectedSecretHash: string,
  crypto: ExternalShareLinkCrypto = hmacExternalShareLinkCrypto,
): boolean {
  const actual = Buffer.from(crypto.hash(pepper, secret), "hex");
  const expected = Buffer.from(expectedSecretHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/**
 * Guest token — 04-domain-model-guest-upload.md (D-037). Token opaco `selector.secret`: o
 * `selector` é público (usado só para lookup), o `secret` só é mostrado uma vez ao emitir o
 * link. Persistidos apenas os hashes (nunca o valor bruto), com pepper versionado.
 *
 * Lookup via item ponteiro na tabela base (`GUESTTOKEN#<selectorHash>`/`POINTER`) — MESMO
 * padrão de `IdentityMapping` (`src/modules/identity/persistence/identity-mapping-repository.ts`,
 * `IDENTITY#cognitoSub#<sub>`/`MAP`), nunca GSI novo. **Terceira exceção tenantless
 * documentada** (depois de `IdentityMapping` e GSI3) — a chave não pode começar com
 * `TENANT#tenantId` porque o lookup acontece ANTES de `tenantId` ser conhecido, mesmo motivo
 * estrutural das outras duas exceções.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export const GUEST_TOKEN_TTL_SECONDS = 14 * 24 * 60 * 60; // 14 dias (04-domain-model-guest-upload.md).

export interface GuestTokenPointer extends EntityKey {
  SK: "POINTER";
  entityType: "GuestTokenPointer";
  selectorHash: string;
  secretHash: string;
  tenantId: string;
  subjectId: string;
  assignmentId: string;
  documentRequestId: string;
  tokenVersion: number;
  expiresAt: string;
  /** TTL físico real da tabela (`infra/modules/dynamo-table/main.tf`'s `ttl.attribute_name`) —
   * achado real de D-047/D-048: `expiresAt` sozinho é só um campo lido por `resolveToken()`,
   * nunca aciona a exclusão física do DynamoDB. Sem este campo, cada `GuestTokenPointer`
   * (inclusive cada rotação de chasing, D-048) seria uma linha permanente. */
  purgeAfterTtl: number;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function guestTokenPointerKey(selectorHash: string): { PK: string; SK: "POINTER" } {
  return { PK: `GUESTTOKEN#${selectorHash}`, SK: "POINTER" };
}

/** DynamoDB TTL exige epoch seconds numérico, nunca a string ISO — achado real de D-048. */
export function epochSecondsFromIso(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

/** Pepper vem de config/Secrets Manager no composition root (nunca hardcoded aqui) — este
 * módulo só implementa a mecânica de hash/comparação, nunca decide onde o pepper vive. */
export interface GuestTokenCrypto {
  hash(pepper: string, value: string): string;
}

export const hmacGuestTokenCrypto: GuestTokenCrypto = {
  hash(pepper: string, value: string): string {
    return createHmac("sha256", pepper).update(value).digest("hex");
  },
};

export interface IssuedGuestToken {
  /** Valor completo a ser embutido no link enviado ao convidado — nunca persistido bruto. */
  token: string;
  selector: string;
  selectorHash: string;
  secretHash: string;
}

/** Gera um novo par selector.secret de alta entropia (256 bits cada). */
export function issueGuestToken(pepper: string, crypto: GuestTokenCrypto = hmacGuestTokenCrypto): IssuedGuestToken {
  const selector = randomBytes(16).toString("hex");
  const secret = randomBytes(32).toString("hex");
  return {
    token: `${selector}.${secret}`,
    selector,
    selectorHash: crypto.hash(pepper, selector),
    secretHash: crypto.hash(pepper, secret),
  };
}

export interface ParsedGuestToken {
  selector: string;
  secret: string;
}

/** Parse estrutural — nunca lança, retorna undefined para qualquer formato inesperado (caminho dummy anti-enumeration). */
export function parseGuestToken(raw: string): ParsedGuestToken | undefined {
  const parts = raw.split(".");
  if (parts.length !== 2) return undefined;
  const [selector, secret] = parts;
  if (!selector || !secret || !/^[a-f0-9]{32}$/.test(selector) || !/^[a-f0-9]{64}$/.test(secret)) return undefined;
  return { selector, secret };
}

/** Comparação `timingSafeEqual` — nunca `===` em valor derivado de segredo (04-domain-model-guest-upload.md). */
export function secretMatches(pepper: string, secret: string, expectedSecretHash: string, crypto: GuestTokenCrypto = hmacGuestTokenCrypto): boolean {
  const actual = Buffer.from(crypto.hash(pepper, secret), "hex");
  const expected = Buffer.from(expectedSecretHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

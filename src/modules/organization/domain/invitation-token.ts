/**
 * Invitation token — família `GuestTokenPointer` (`subject/domain/guest-token.ts`), mesma
 * mecânica `selector.secret` HMAC/timing-safe, mas implementação PARALELA — nunca reaproveita a
 * classe `GuestTokenPointer` diretamente (physical model §7 texto literal: "família
 * GuestTokenPointer... nunca reaproveita GuestTokenPointer diretamente"; check-boundaries
 * também impediria `organization` de importar de `subject`).
 *
 * Tenantless (quem resolve o token ainda não tem contexto de organização, mesmo motivo
 * estrutural de `IdentityMapping`/`GuestTokenPointer`/GSI3 — três exceções já documentadas,
 * esta é a quarta). Consumo one-time real: `consumedAt` é escrito DENTRO da mesma transação do
 * aceite (`AcceptInvitationService`), nunca só verificado numa leitura prévia — fecha anti-
 * replay (physical model §121 Q14) estruturalmente, achado real da Rodada 1/2 do debate de
 * escopo de B2B-8 (docs/architecture/reviews/multi-user-b2b-wave-b2b8-scoping/).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export const INVITATION_TOKEN_TTL_SECONDS = 14 * 24 * 60 * 60; // 14 dias, mesmo padrão de guest-token.ts.

export interface InvitationTokenPointer extends EntityKey {
  SK: "POINTER";
  entityType: "InvitationTokenPointer";
  selectorHash: string;
  secretHash: string;
  organizationId: string;
  invitationId: string;
  expiresAt: string;
  /** TTL físico real da tabela — mesmo achado real de D-047/D-048 (guest-token.ts): `expiresAt`
   * sozinho é só um campo lido pela resolução, nunca aciona exclusão física do DynamoDB. */
  purgeAfterTtl: number;
  /** Escrito DENTRO da transação de aceite (`AcceptInvitationService`), condicionado a
   * `attribute_not_exists(consumedAt)` — nunca setado por uma leitura solta antes da decisão. */
  consumedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function invitationTokenPointerKey(selectorHash: string): { PK: string; SK: "POINTER" } {
  return { PK: `INVITATION_TOKEN#${selectorHash}`, SK: "POINTER" };
}

export function epochSecondsFromIso(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

/** Pepper vem de config/Secrets Manager no composition root, nunca hardcoded aqui — mesma
 * disciplina de `guest-token.ts`. */
export interface InvitationTokenCrypto {
  hash(pepper: string, value: string): string;
}

export const hmacInvitationTokenCrypto: InvitationTokenCrypto = {
  hash(pepper: string, value: string): string {
    return createHmac("sha256", pepper).update(value).digest("hex");
  },
};

export interface IssuedInvitationToken {
  /** Valor completo a ser embutido no link enviado ao convidado — nunca persistido bruto. */
  token: string;
  selector: string;
  selectorHash: string;
  secretHash: string;
}

/** Gera um novo par selector.secret de alta entropia (256 bits cada) — mesma forma de
 * `issueGuestToken`. */
export function issueInvitationToken(pepper: string, crypto: InvitationTokenCrypto = hmacInvitationTokenCrypto): IssuedInvitationToken {
  const selector = randomBytes(16).toString("hex");
  const secret = randomBytes(32).toString("hex");
  return {
    token: `${selector}.${secret}`,
    selector,
    selectorHash: crypto.hash(pepper, selector),
    secretHash: crypto.hash(pepper, secret),
  };
}

export interface ParsedInvitationToken {
  selector: string;
  secret: string;
}

/** Parse estrutural — nunca lança, retorna undefined para qualquer formato inesperado (caminho
 * dummy anti-enumeration, mesma forma de `parseGuestToken`). */
export function parseInvitationToken(raw: string): ParsedInvitationToken | undefined {
  const parts = raw.split(".");
  if (parts.length !== 2) return undefined;
  const [selector, secret] = parts;
  if (!selector || !secret || !/^[a-f0-9]{32}$/.test(selector) || !/^[a-f0-9]{64}$/.test(secret)) return undefined;
  return { selector, secret };
}

/** Comparação `timingSafeEqual` — nunca `===` em valor derivado de segredo. */
export function invitationSecretMatches(
  pepper: string,
  secret: string,
  expectedSecretHash: string,
  crypto: InvitationTokenCrypto = hmacInvitationTokenCrypto,
): boolean {
  const actual = Buffer.from(crypto.hash(pepper, secret), "hex");
  const expected = Buffer.from(expectedSecretHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

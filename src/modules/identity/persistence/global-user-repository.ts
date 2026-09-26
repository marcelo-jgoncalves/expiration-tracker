/**
 * GlobalUser repository — Multi-User B2B (docs/architecture/multi-user-b2b-physical-model.md
 * §1/§10), `PK=USER#<userId>`, `SK=PROFILE`: the tenant-independent identity. Wave B2B-2/D-087
 * introduced this row additively (nothing read it yet); Wave B2B-5/D-095 makes it the ONLY
 * identity-level record `IdentityBootstrapService.bootstrapUser()` creates — the legacy
 * tenant-scoped `UserProfile` was no longer auto-created at login from that wave on, and later
 * removed entirely (D-160 — zero real reader, fields duplicated from this entity/`IdentityMapping`).
 * `entityType: "GlobalUser"` (not `"User"`, historically used by the removed `UserProfile`) still
 * lets the two coexist without ambiguity for any pre-cutover row still around in `dev`.
 *
 * `DeviceSession` and the two logout operations move here from `user-repository.ts` in the same
 * wave (physical model §10: "DeviceSession migra para o User global, logoutAll fica
 * user-global") — both are properties of the global identity now, not of a tenant-scoped
 * profile. `logoutAll` sets `GlobalUser.globalLogoutAfter` (was `UserProfile.globalLogoutAfter`)
 * — a **mudança de contrato observável, não só relocação de schema** (physical model §10):
 * revoking a token now revokes it everywhere the user is a member, always, never scoped to
 * whichever Organization happened to be active when the call was made. Evaluated and accepted
 * as the correct security/product choice in the approved design — credential-compromise
 * containment is `Membership` revocation's job, not session logout's.
 */
import type { EntityKey, IdentityStore } from "../ports/identity-store.js";
import { isValidE164 } from "../../../shared/text/phone-e164.js";
import { ValidationError, NotFoundError, DependencyUnavailableError } from "../../../shared/errors/app-error.js";
import { buildUnscopedVersionedUpdate, isTransactionCanceled } from "../../../shared/dynamodb/occ.js";

export interface GlobalUser {
  PK: string;
  SK: "PROFILE";
  entityType: "GlobalUser";
  userId: string;
  emailNormalized: string;
  identityStatus: "ACTIVE" | "SUSPENDED";
  /** Set by `logoutAll` — RequestContextResolver rejects any token with `issuedAt` before this
   * watermark. User-global (physical model §10), not per-Organization. */
  globalLogoutAfter?: string;
  /** Wave B2B-5 (D-095, Codex Rodada 3 achado 1): set exactly once, transactionally, the first
   * time this user creates an Organization via `POST /bff/organizations` — a temporary cap on
   * self-service org creation (not a general "has a usable Membership" signal, and never
   * reusable as one by B2B-6/B2B-8) that keeps the "at most 1 ACTIVE Membership" invariant
   * `RequestContextResolver`/`resolveActiveMembership` rely on true by construction, not by
   * best-effort check-then-act. Written via `buildAttributeOnceUpdate` in the SAME
   * `TransactWriteItems` as the Organization/Membership/TenantLifecycleRecord/TenantEntitlement
   * creation (`CreateOrganizationService.buildCreateEntries()` + this one extra entry) — never
   * check-then-act. */
  hasCreatedOrganization?: boolean;
  /** D-6 (WhatsApp program, `docs/architecture/reviews/whatsapp-channel-scoping/
   * estado-final-consolidado.md`): the user's current WhatsApp-reachable number, E.164 format,
   * validated by `setPhoneNumber()` below before persisting — never written any other way in
   * this codebase. Absent means "no number on file", never inferred from any other field.
   * D-5's `WhatsAppOptIn` deliberately keys consent to a specific phone value, not to this
   * field directly — a future router (fatia 2+) must always re-read this field fresh and check
   * consent against ITS current value, never trust a stale copy. */
  phoneE164?: string;
  /** #15 (2026-09-21): the display name to resolve for `assigneeUserId` in item/requirement UIs
   * instead of showing a raw userId. Set only on first-login `bootstrapUser()` creation (same
   * "first-login only, never backfilled" contract `emailNormalized` already has above), from the
   * OIDC `name` claim (`profile` scope) - absent when the identity provider never sent one, or
   * for identities created before this field existed. Never inferred/derived (e.g. from email
   * local-part) - an absent value must read as "no name on file", not a guess. */
  displayName?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function globalUserKey(userId: string): EntityKey {
  return { PK: `USER#${userId}`, SK: "PROFILE" };
}

export interface DeviceSession {
  PK: string;
  SK: string; // SESSION#<deviceId>
  entityType: "DeviceSession";
  userId: string;
  deviceId: string;
  sessionId: string;
  refreshFamilyId: string;
  deviceLogoutAfter?: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  status: "ACTIVE" | "REVOKED";
}

/** `PK=USER#<userId>` — never `TENANT#`-prefixed, so W3-07's purge scan (which filters by
 * `begins_with(PK, "TENANT#<tenantId>")`) cannot reach it by construction, same invariant the
 * physical model documents for `User`/`GlobalUser` itself (§121 Q11). */
export function deviceSessionKey(userId: string, deviceId: string): EntityKey {
  return { PK: `USER#${userId}`, SK: `SESSION#${deviceId}` };
}

export class GlobalUserRepository {
  constructor(
    private readonly store: IdentityStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async get(userId: string): Promise<GlobalUser | undefined> {
    return this.store.get<GlobalUser>(globalUserKey(userId));
  }

  async getDeviceSession(userId: string, deviceId: string): Promise<DeviceSession | undefined> {
    return this.store.get<DeviceSession>(deviceSessionKey(userId, deviceId));
  }

  async upsertDeviceSession(session: DeviceSession): Promise<void> {
    await this.store.update(session);
  }

  /** Logout by device — revokes only this device's refresh family. */
  async logoutDevice(userId: string, deviceId: string): Promise<void> {
    const session = await this.getDeviceSession(userId, deviceId);
    if (!session) return;
    await this.store.update({ ...session, status: "REVOKED", deviceLogoutAfter: this.now() });
  }

  /** Logout global — implementation-blueprint.md §4.2: revokes every token issued before now,
   * across every Organization this user belongs to (physical model §10 — user-global by
   * construction, not scoped to whichever Organization was active).
   *
   * D-332 revisão adversarial (achado real Média do Codex, D-328): mesmo `IdentityStore.update()`
   * (PutItem incondicional do objeto INTEIRO lido antes) que motivou a correção de
   * `setPhoneNumber()` abaixo - a direção REAL que o Codex apontou (não `logoutDevice()`, que
   * escreve `SESSION#<deviceId>`, um item DIFERENTE - incluí-lo como concorrente de `GlobalUser`
   * na Rodada 2 foi um erro meu, corrigido aqui): `logoutAll()` podia ler o telefone A/versão 1,
   * esperar `setPhoneNumber()` confirmar B/versão 2, e depois sobrescrever de volta para A/versão 1
   * - um telefone anterior com opt-in real podia voltar a ser o destinatário de lembretes.
   * Corrigido com o mesmo `buildUnscopedVersionedUpdate()` (SET só em `globalLogoutAfter`, nunca
   * `phoneE164`/qualquer outro campo) + retry limitado: logout deve sempre eventualmente suceder
   * (nunca falhar por perder uma corrida OCC pontual), então em vez de propagar
   * `TransactionCanceledException` ao chamador, relê o estado fresco e tenta de novo.
   *
   * D-332 Rodada 3 (2 achados reais Alta do Codex, reproduzidos com interleaving real):
   * (1) o laço de retry anterior podia esgotar as 5 tentativas e retornar SUCESSO mesmo sem
   * nenhuma escrita ter realmente persistido `globalLogoutAfter` - o BFF então prosseguia como se
   * a revogação global tivesse acontecido. Corrigido: esgotar as tentativas agora lança
   * `DependencyUnavailableError` (retryable), nunca retorna silenciosamente.
   * (2) o `now` era capturado UMA VEZ no início e reusado em toda tentativa de retry - um logout A
   * mais antigo podia perder a corrida, reler um watermark mais NOVO gravado por um logout B
   * concorrente, e ainda assim retentar escrevendo o `now` mais ANTIGO de A por cima, retrocedendo
   * o watermark de segurança (`resolve-request-context.ts`'s comparação `issuedAt <
   * globalLogoutAfter` passaria a aceitar tokens que deveriam ter sido revogados). Corrigido:
   * cada tentativa preserva o MAIOR valor entre o watermark já persistido e o solicitado - nunca
   * escreve um valor mais antigo que o que já está lá, e se o watermark existente já é >= `now`,
   * a intenção de segurança já está satisfeita e a função retorna sem escrever nada. */
  async logoutAll(userId: string, tableName: string): Promise<void> {
    let user = await this.get(userId);
    if (!user) return;
    const now = this.now();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (user.globalLogoutAfter && user.globalLogoutAfter >= now) return; // already at least as strict
      const update = buildUnscopedVersionedUpdate({
        tableName,
        key: { PK: user.PK, SK: user.SK },
        expectedVersion: user.version,
        set: { globalLogoutAfter: now },
        now,
      });
      try {
        await this.store.transactWrite([{ Update: update }]);
        return;
      } catch (err) {
        if (!isTransactionCanceled(err)) throw err;
        const fresh = await this.get(userId);
        if (!fresh) return; // user disappeared between read and write - nothing left to log out
        user = fresh;
      }
    }
    throw new DependencyUnavailableError("Não foi possível revogar todas as sessões agora - tente novamente.", { userId });
  }

  /**
   * D-6: validates E.164 shape BEFORE any read/write — a malformed value never reaches
   * DynamoDB. D-332 revisão adversarial (achado real Alta do Codex, D-328): esta rota permaneceu
   * `IdentityStore.update()` (PutItem incondicional do objeto INTEIRO) enquanto era dead code
   * (fatia 1 domain-only) — inofensivo porque nada a chamava de verdade. Ao tornar este writer
   * alcançável (D-328's `confirmPhone()`), o mesmo `update()` passou a competir de verdade com
   * `logoutAll()` (outro escritor de `GlobalUser`, mesmo item `PROFILE` - `logoutDevice()` escreve
   * `SESSION#<deviceId>`, um item DIFERENTE, nunca concorrente deste) — um `PutItem` do objeto
   * inteiro lido antes podia apagar um `globalLogoutAfter` gravado por um logout concorrente.
   * Corrigido com `buildUnscopedVersionedUpdate()` (occ.ts - mesmo builder já usado
   * por `WebhookInbox`/`ReminderScanLease`, entidades sem `tenantId` como `GlobalUser`): `SET`
   * só em `phoneE164` (+ `version`/`updatedAt` automáticos do builder), condicionado ao `version`
   * já lido - nunca reescreve o item inteiro, nunca pisa em nenhum outro campo, e lança
   * `TransactionCanceledException` (capturável via `isTransactionCanceled()`) se outro escritor
   * incrementou `version` no meio, em vez de sobrescrever silenciosamente. `tableName` é passado
   * pelo chamador (não guardado no construtor - único método desta classe que precisa de
   * `transactWrite`, evita adicionar `tableName` ao construtor só por causa dele, o que quebraria
   * os ~20 call sites existentes que só passam `store`).
   */
  async setPhoneNumber(userId: string, phoneE164: string, tableName: string): Promise<GlobalUser> {
    if (!isValidE164(phoneE164)) {
      throw new ValidationError(`Invalid E.164 phone number: ${phoneE164}`, { phoneE164 });
    }
    const user = await this.get(userId);
    if (!user) throw new NotFoundError(`GlobalUser not found: ${userId}`, { userId });
    const now = this.now();
    const update = buildUnscopedVersionedUpdate({
      tableName,
      key: { PK: user.PK, SK: user.SK },
      expectedVersion: user.version,
      set: { phoneE164 },
      now,
    });
    await this.store.transactWrite([{ Update: update }]);
    return { ...user, phoneE164, version: user.version + 1, updatedAt: now };
  }
}

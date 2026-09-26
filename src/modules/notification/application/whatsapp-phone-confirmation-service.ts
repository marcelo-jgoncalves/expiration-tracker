/**
 * WhatsAppPhoneConfirmationService — see `domain/whatsapp-phone-confirmation.ts`'s header for the
 * full rationale (NEXT_SESSION_PROMPT.md item 26, 2026-09-23). Two entry points, mirroring the
 * shape of the Cognito e-mail flow (`bff-auth-service.ts`'s `confirmSignUp`/`resendConfirmationCode`)
 * without reusing it — Cognito has no notion of a phone number:
 *
 *  - `requestConfirmation`: generates a 6-digit code, persists only its hash, sends it over
 *    WhatsApp via `WhatsAppProviderAdapter.send()` directly (bypassing the reminder-delivery
 *    outbox/intent/attempt machinery entirely — that pipeline exists for scheduled, item-based
 *    reminder sends, not a synchronous transactional code). Gated on `isWhatsAppChannelEnabled()`,
 *    same flag `notification-router.ts` already uses to decide whether the channel is available at
 *    all — while it is off (true in every environment today, pending E-019), this fails loudly with
 *    a `DEPENDENCY_UNAVAILABLE` rather than silently pretending to send.
 *  - `confirmPhone`: verifies the code (`timingSafeEqual`, never a raw `===`) and, only on success,
 *    calls `WhatsAppOptInService.recordOptIn()` — the ONLY caller of `recordOptIn()` this program
 *    wires for a real end user, so a `WhatsAppOptIn` row now only ever exists post-confirmation.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "../../identity/domain/request-context.js";
import { authorize } from "../../identity/domain/authorization.js";
import { ValidationError, DependencyUnavailableError } from "../../../shared/errors/app-error.js";
import { buildUnscopedVersionedUpdate, isTransactionCanceled, type EntityKey } from "../../../shared/dynamodb/occ.js";
import {
  buildWhatsAppPhoneConfirmation,
  generateWhatsAppConfirmationCode,
  isWhatsAppPhoneConfirmationExpired,
  isWhatsAppPhoneConfirmationInCooldown,
  whatsAppConfirmationCodeMatches,
  whatsAppPhoneConfirmationKey,
  WHATSAPP_PHONE_CONFIRMATION_MAX_ATTEMPTS,
  type WhatsAppPhoneConfirmation,
} from "../domain/whatsapp-phone-confirmation.js";
import type { WhatsAppOptIn } from "../domain/whatsapp-opt-in.js";
import type { WhatsAppOptInService } from "./whatsapp-opt-in-service.js";
import type { NotificationStore } from "../ports/notification-store.js";
import type { WhatsAppProviderAdapter } from "../ports/whatsapp-provider.js";
import type { GlobalUserRepository } from "../../identity/persistence/global-user-repository.js";
import { isValidE164 } from "../../../shared/text/phone-e164.js";

/** Same fixed catalog entry name/language convention as `renderWhatsAppTemplate()`
 * (`runtime/aws/composition/notification.ts`) - D-3: pre-provisioned in Meta Business Manager,
 * never created via the API by this repo. **Real send is unreachable until that template exists
 * AND `isWhatsAppChannelEnabled()` is true** - both independent of this code shipping. */
export const WHATSAPP_PHONE_CONFIRMATION_TEMPLATE_NAME = "phone_confirmation_code";
export const WHATSAPP_PHONE_CONFIRMATION_TEMPLATE_LANGUAGE = "pt_BR";

export interface WhatsAppPhoneConfirmationServiceDeps {
  store: NotificationStore;
  whatsAppOptIn: WhatsAppOptInService;
  /** D-332 revisão adversarial (achado real, Codex Rodada 1): a entrega real de WhatsApp lê o
   * número de `GlobalUser.phoneE164` (`DynamoDbNotificationRecipientResolver.resolve()`), nunca
   * de `WhatsAppOptIn.phoneE164` - antes desta correção, `confirmPhone()` só chamava
   * `recordOptIn()`, e `GlobalUserRepository.setPhoneNumber()` nunca era chamado por NENHUMA rota
   * real (o próprio comentário do método já dizia isso: "fatia 1 is domain-only... a future
   * fatia adds the route"). Resultado: mesmo depois de confirmar a posse do número com sucesso,
   * `resolveRecipientPhone` continuaria retornando `undefined` para sempre - o pipeline de
   * entrega real do WhatsApp nunca teria um número para onde mandar, mesmo após E-019 liberar o
   * canal. */
  globalUsers: Pick<GlobalUserRepository, "setPhoneNumber">;
  /** `GlobalUserRepository.setPhoneNumber()`'s 3rd argument (D-332 revisão adversarial) - a
   * targeted attribute-only `transactWrite`, não um `IdentityStore`-scoped `update()`, então
   * precisa do nome da tabela explicitamente aqui, não implícito num `store` já construído. */
  tableName: string;
  whatsAppProvider: WhatsAppProviderAdapter;
  /** HMAC pepper — reuses `GUEST_TOKEN_PEPPER` at the composition root, same "no cross-family
   * confusion, a brand new Secrets Manager secret would be disproportionate" rationale
   * `organization.ts`'s `invitationTokenPepper` already documents for its own reuse. */
  pepper: string;
  /** Evaluated lazily, only when `requestConfirmation()` is actually called — never pre-checked
   * for every request this Lambda serves (`GET/PUT /notifications/preferences` have nothing to do
   * with WhatsApp). `Promise<boolean>` because the real implementation reads AppConfig. */
  isWhatsAppChannelEnabled: () => Promise<boolean>;
  now?: () => string;
  newId?: () => string;
}

/** D-328 revisão adversarial (achado real Média, Codex Rodada 6, R6-1): comparar `challengeId`
 * only AFTER a version conflict (the `catch` blocks below) isn't enough on its own - DynamoDB TTL
 * deletion is asynchronous (can take hours), so a paused writer's `expectedVersion` (read from a
 * challenge that then gets physically deleted) can coincidentally match a BRAND NEW challenge's
 * `version` at the same key (both start at 1, since `nextVersion = (current?.version ?? 0) + 1`
 * with `current` null on a from-scratch create) - the conditioned write would then SUCCEED against
 * the wrong generation, never even reaching the `catch` block that checks `challengeId`. Folding
 * `challengeId` into the SAME atomic ConditionExpression (not just the version) closes this: the
 * write can only ever succeed against the exact generation it was computed from, version coincidence
 * or not. */
function challengeIdFenceCondition(expectedChallengeId: string): { expression: string; names: Record<string, string>; values: Record<string, unknown> } {
  // Placeholder names/values share the same suffix (`#challengeIdFence`/`:challengeIdFence`) -
  // same convention `buildScopedVersionedUpdate()` itself uses for its own `#tenantId`/`:tenantId`
  // and `#accountId`/`:accountId` scope fences, which both this file's test double and any other
  // generic equality-clause evaluator can rely on without parsing the expression string.
  return {
    expression: "#challengeIdFence = :challengeIdFence",
    names: { "#challengeIdFence": "challengeId" },
    values: { ":challengeIdFence": expectedChallengeId },
  };
}

export class WhatsAppPhoneConfirmationService {
  private readonly store: NotificationStore;
  private readonly whatsAppOptIn: WhatsAppOptInService;
  private readonly globalUsers: Pick<GlobalUserRepository, "setPhoneNumber">;
  private readonly tableName: string;
  private readonly whatsAppProvider: WhatsAppProviderAdapter;
  private readonly pepper: string;
  private readonly isWhatsAppChannelEnabled: () => Promise<boolean>;
  private readonly now: () => string;
  private readonly newId: () => string;

  constructor(deps: WhatsAppPhoneConfirmationServiceDeps) {
    this.store = deps.store;
    this.whatsAppOptIn = deps.whatsAppOptIn;
    this.globalUsers = deps.globalUsers;
    this.tableName = deps.tableName;
    this.whatsAppProvider = deps.whatsAppProvider;
    this.pepper = deps.pepper;
    this.isWhatsAppChannelEnabled = deps.isWhatsAppChannelEnabled;
    this.now = deps.now ?? (() => new Date().toISOString());
    this.newId = deps.newId ?? randomUUID;
  }

  /** Generates and sends a fresh 6-digit code, overwriting any previous unconsumed one for the
   * same tenant/user/phone (re-requesting is always allowed once the cooldown has passed - unlike
   * `WhatsAppOptIn`, this is a mutable, always-overwritable row by design). */
  async requestConfirmation(ctx: RequestContext, phoneE164: string): Promise<{ expiresAt: string }> {
    authorize({ context: ctx, action: "notification:configure", resource: { tenantId: ctx.tenant.tenantId } });

    if (!(await this.isWhatsAppChannelEnabled())) {
      throw new DependencyUnavailableError("Canal WhatsApp ainda não está disponível.", undefined, undefined, false);
    }

    // D-332 achado real Baixa (Codex Rodada 4): a validação do formato E.164 vivia dentro de
    // `buildWhatsAppPhoneConfirmation()`, chamada só DEPOIS do `send()` abaixo - um telefone
    // malformado ainda disparava uma mensagem real pelo provider antes de falhar. Corrigido:
    // validado aqui, antes de qualquer I/O (mesma disciplina "falha antes de qualquer efeito
    // colateral" que o resto do serviço já documentava, só não estava sendo seguida de verdade
    // neste método). A rota HTTP real já validava isso via schema antes de chamar o serviço
    // (`preferences-handlers.ts`), então isto nunca foi um bypass alcançável por HTTP - só uma
    // garantia que o próprio serviço afirmava e não cumpria quando chamado diretamente.
    if (!isValidE164(phoneE164)) {
      throw new ValidationError(`Invalid E.164 phone number: ${phoneE164}`, { phoneE164 });
    }

    const key = whatsAppPhoneConfirmationKey(ctx.tenant.tenantId, ctx.principal.userId, phoneE164);
    const initial = await this.store.get<WhatsAppPhoneConfirmation>(key, true);
    const now = this.now();
    if (initial && !initial.confirmedAt && isWhatsAppPhoneConfirmationInCooldown(initial, now)) {
      throw new ValidationError("Aguarde um minuto antes de solicitar um novo código.");
    }

    const code = generateWhatsAppConfirmationCode();

    try {
      await this.whatsAppProvider.send({
        to: phoneE164,
        templateName: WHATSAPP_PHONE_CONFIRMATION_TEMPLATE_NAME,
        templateLanguage: WHATSAPP_PHONE_CONFIRMATION_TEMPLATE_LANGUAGE,
        templateParams: [code],
        // Opaque correlation tags only (`whatsapp-provider.ts`'s own contract) - this send has no
        // real NotificationIntent/Attempt behind it, so these ids exist solely to satisfy the
        // port's shape and correlate a later webhook, never read back by this service.
        tags: { attemptId: this.newId(), intentId: this.newId(), tenantId: ctx.tenant.tenantId, correlationId: ctx.correlationId },
      });
    } catch (err) {
      throw new DependencyUnavailableError("Não foi possível enviar o código de confirmação pelo WhatsApp.", undefined, err);
    }

    // D-332 achado real Alta (Codex Rodada 3): a Rodada 2 calculava `(existing?.version ?? 0) + 1`
    // mas ainda escrevia com um `store.update()` INCONDICIONAL - o Codex reproduziu a corrida real:
    // reenvio lê A/v1 e pausa antes de gravar; uma tentativa errada avança A para v2; um
    // `confirmPhone(A)` pendente lê v2 e pausa antes de sua própria escrita; o reenvio grava B/v2
    // (calculado a partir da leitura ANTIGA, v1+1=2 - coincide por acidente com o v2 real); a
    // confirmação pendente de A encontra a versão que esperava e confirma B com o código de A.
    // Calcular o próximo `version` em memória nunca bastava - só uma ESCRITA CONDICIONADA (nunca
    // um `Put` cego) fecha isso de verdade. Corrigido: cada tentativa gera o código sobre o estado
    // FRESCO mais recente e escreve condicionado a ele - se perder a corrida, relê e tenta de novo
    // com um `version` genuinamente atual, nunca calculado sobre uma leitura obsoleta.
    //
    // D-332 achado real Média (Codex Rodada 4): o retry acima ainda podia reescrever com o `now`/
    // `code` ORIGINAIS (capturados antes do laço) mesmo quando a releitura mostrava que outro
    // REENVIO concorrente já tinha vencido a corrida - isso fazia `createdAt` retroceder (o
    // perdedor sobrescrevia o vencedor com seu próprio timestamp mais antigo), o que por sua vez
    // reabria a janela de cooldown e permitia outro reenvio imediato. Corrigido: se o estado fresco
    // mostra um `challengeId` DIFERENTE do que existia quando este resend começou, um reenvio
    // concorrente genuinamente diferente já venceu - adota o vencedor (retorna o `expiresAt` dele)
    // em vez de tentar sobrescrevê-lo com o código já enviado e agora obsoleto deste chamador. Uma
    // divergência de `challengeId` SEM isso (ex. só uma tentativa errada incrementou `attemptCount`
    // no desafio original) continua segura para sobrescrever - é o mesmo desafio, só mais
    // tentativas registradas nele.
    //
    // D-328 revisão adversarial (achado real Baixa, Codex Rodada 5, residual R5-1): esta checagem
    // comparava `codeHash`, não uma identidade de geração - dois reenvios concorrentes que
    // sorteassem o MESMO código de 6 dígitos (1/1.000.000, sob corrida real) produziam o mesmo
    // `codeHash` mesmo sendo desafios genuinamente diferentes, então o perdedor não se reconhecia
    // como perdedor e sobrescrevia o vencedor (regredindo `createdAt`, reabrindo o cooldown).
    // Corrigido: compara `challengeId` (um UUID novo por geração, nunca colide por acaso), nunca o
    // segredo curto.
    //
    // D-328 revisão adversarial (achado real Média, Codex Rodada 6, R6-1): comparar `challengeId`
    // só DEPOIS do conflito de `version` (no `catch` abaixo) ainda não bastava - a exclusão física
    // do TTL do DynamoDB é assíncrona (pode levar horas), então um escritor pausado (que leu A antes
    // de A ser fisicamente apagado) podia coincidir seu `expectedVersion` com o de um desafio C
    // recriado do zero na mesma chave (ambos começam em `version=1`) - a escrita condicionada
    // SUCEDIA contra a geração errada, sem nunca chegar ao `catch` que checa `challengeId`.
    // Corrigido: `challengeId` entra na PRÓPRIA `ConditionExpression` atômica (`extraConditions`),
    // não só na checagem pós-conflito - a escrita só pode suceder contra a geração exata de onde foi
    // calculada, coincidência de `version` ou não.
    let current = initial;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const nextVersion = (current?.version ?? 0) + 1;
      const record = buildWhatsAppPhoneConfirmation({ tenantId: ctx.tenant.tenantId, userId: ctx.principal.userId, phoneE164, code, pepper: this.pepper, now, version: nextVersion, challengeId: this.newId() });
      if (!current) {
        // First-ever request for this key - create-once, same discipline as WhatsAppOptIn's
        // recordOptIn(). If lost, a concurrent first request already won - adopt IT (same
        // "never overwrite a genuinely concurrent winner with our own already-sent code" posture
        // as the resend branch below), never overwrite it with a second, redundant challenge.
        const created = await this.store.putIfAbsent(record);
        if (created) return { expiresAt: record.expiresAt };
        const won = await this.store.get<WhatsAppPhoneConfirmation>(key, true);
        return { expiresAt: won!.expiresAt };
      }
      const update = buildUnscopedVersionedUpdate({
        tableName: this.tableName,
        key,
        expectedVersion: current.version,
        set: { codeHash: record.codeHash, challengeId: record.challengeId, attemptCount: 0, createdAt: record.createdAt, expiresAt: record.expiresAt, purgeAfterTtl: record.purgeAfterTtl },
        remove: ["confirmedAt"],
        now,
        extraConditions: [challengeIdFenceCondition(current.challengeId)],
      });
      try {
        await this.store.transactWrite([{ Update: update }]);
        return { expiresAt: record.expiresAt };
      } catch (err) {
        if (!isTransactionCanceled(err)) throw err;
        const fresh = await this.store.get<WhatsAppPhoneConfirmation>(key, true);
        if (fresh && initial && fresh.challengeId !== initial.challengeId) {
          return { expiresAt: fresh.expiresAt }; // a genuinely concurrent resend already won
        }
        current = fresh;
      }
    }
    throw new DependencyUnavailableError("Não foi possível gerar um novo código agora - tente novamente.");
  }

  /**
   * Verifies the code and, only on success, records the opt-in. Idempotent: a second call after
   * the confirmation already succeeded returns the existing `WhatsAppOptIn` again rather than
   * failing, mirroring `confirmSignUp`'s own `ALREADY_CONFIRMED` no-op posture.
   */
  async confirmPhone(ctx: RequestContext, phoneE164: string, code: string): Promise<WhatsAppOptIn> {
    authorize({ context: ctx, action: "notification:configure", resource: { tenantId: ctx.tenant.tenantId } });

    const key = whatsAppPhoneConfirmationKey(ctx.tenant.tenantId, ctx.principal.userId, phoneE164);
    const existing = await this.store.get<WhatsAppPhoneConfirmation>(key, true);
    if (!existing) {
      throw new ValidationError("Código inválido ou expirado.");
    }
    const nowForShortcut = this.now();
    if (existing.confirmedAt) {
      // D-332 achado real (Codex Rodada 1, Alta): este atalho idempotente antes chamava
      // setPhoneNumber()/recordOptIn() incondicionalmente, SEM checar o código - corrigido na
      // Rodada 2 (bate o hash), mas o Codex achou (Rodada 2, Alta) que isso ainda não bastava:
      // sem checar EXPIRAÇÃO, o código certo replay-ado 24h depois (ex. um cliente que guardou o
      // código) ainda re-executava `setPhoneNumber()`/`recordOptIn()` - se um telefone B tivesse
      // sido confirmado depois, esse replay do desafio de A o desfazia, restaurando A. Corrigido
      // por completo: expiração checada aqui TAMBÉM, não só no branch de primeira confirmação
      // abaixo - `expiresAt` (10min) sempre vence muito antes do TTL físico do DynamoDB apagar a
      // linha (que pode levar dias), então isso fecha o replay tardio independente de quando a
      // limpeza física acontece.
      if (isWhatsAppPhoneConfirmationExpired(existing, nowForShortcut)) {
        throw new ValidationError("Código inválido ou expirado.");
      }
      if (!whatsAppConfirmationCodeMatches(this.pepper, code, existing.codeHash)) {
        throw new ValidationError("Código inválido ou expirado.");
      }
      await this.globalUsers.setPhoneNumber(ctx.principal.userId, phoneE164, this.tableName);
      return this.whatsAppOptIn.recordOptIn(ctx, phoneE164, "USER_SETTINGS");
    }

    if (isWhatsAppPhoneConfirmationExpired(existing, nowForShortcut) || existing.attemptCount >= WHATSAPP_PHONE_CONFIRMATION_MAX_ATTEMPTS) {
      throw new ValidationError("Código inválido ou expirado.");
    }

    const matches = whatsAppConfirmationCodeMatches(this.pepper, code, existing.codeHash);
    if (!matches) {
      // D-332 achado real (Codex Rodada 1 Média, Rodada 2 achado real: a versão anterior desistia
      // no primeiro conflito, então 20 tentativas erradas concorrentes só contabilizavam 1 - o
      // orçamento de 5 tentativas era efetivamente ilimitado sob concorrência). Corrigido com um
      // laço de retry limitado: cada tentativa relê o estado fresco e tenta incrementar A PARTIR
      // DELE, então cada chamada real consome seu próprio slot de orçamento em vez de desistir
      // silenciosamente quando perde uma corrida.
      await this.incrementAttemptCountWithRetry(key, existing);
      throw new ValidationError("Código inválido ou expirado.");
    }

    // D-332 achado real (Codex Rodada 1 Média): mesmo laço de retry do bloco acima, aplicado ao
    // caminho de sucesso - cada tentativa relê o estado fresco e tenta confirmar A PARTIR DELE.
    await this.setConfirmedAtWithRetry(key, existing);
    // D-332 achado real (Codex Rodada 1): a entrega real de WhatsApp lê `GlobalUser.phoneE164`
    // (`DynamoDbNotificationRecipientResolver.resolve()`), nunca `WhatsAppOptIn.phoneE164` - sem
    // esta chamada, `resolveRecipientPhone` nunca teria um número, mesmo com a posse confirmada e
    // o opt-in registrado. Antes desta correção, `setPhoneNumber()` nunca era chamado por
    // NENHUMA rota real em todo `src/` (só existia domain-only, D-6, ver o comentário do próprio
    // método em `global-user-repository.ts`).
    await this.globalUsers.setPhoneNumber(ctx.principal.userId, phoneE164, this.tableName);
    return this.whatsAppOptIn.recordOptIn(ctx, phoneE164, "USER_SETTINGS");
  }

  /** Bounded retry (D-332, Codex Rodada 2 achado real, orçamento reforçado na Rodada 3): a
   * primeira tentativa de incrementar `attemptCount` pode perder a corrida contra outra tentativa
   * concorrente para o MESMO desafio. Cada iteração relê o estado fresco e recomputa o incremento
   * a partir dele, garantindo que CADA chamada real consuma seu próprio slot de tentativa em vez
   * de desistir na primeira colisão.
   *
   * D-332 Rodada 3 (achado real Média, Codex reproduziu com 10 tentativas erradas concorrentes a
   * partir de `attemptCount=4`, terminando em `attemptCount=9`): o gate `attemptCount >= MAX` só
   * era checado UMA VEZ, antes de chamar este método - todas as 10 chamadas liam `attemptCount=4`
   * (< 5) simultaneamente ANTES de qualquer escrita, então todas passavam o gate e todas
   * retentavam incrementos além do orçamento nominal. Corrigido: cada iteração do retry TAMBÉM
   * checa o orçamento contra o estado fresco - se já esgotado por uma tentativa concorrente, para
   * de incrementar (o chamador já rejeita a tentativa de qualquer forma). */
  private async incrementAttemptCountWithRetry(key: EntityKey, initial: WhatsAppPhoneConfirmation): Promise<void> {
    let current = initial;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (current.attemptCount >= WHATSAPP_PHONE_CONFIRMATION_MAX_ATTEMPTS) return; // budget already exhausted by a concurrent guess
      const update = buildUnscopedVersionedUpdate({
        tableName: this.tableName,
        key,
        expectedVersion: current.version,
        set: { attemptCount: current.attemptCount + 1 },
        extraConditions: [challengeIdFenceCondition(current.challengeId)],
      });
      try {
        await this.store.transactWrite([{ Update: update }]);
        return;
      } catch (err) {
        if (!isTransactionCanceled(err)) throw err;
        const fresh = await this.store.get<WhatsAppPhoneConfirmation>(key, true);
        // The record disappeared (physical TTL cleanup) or a resend replaced it with a genuinely
        // different challenge (`challengeId` only ever changes on resend, `phoneE164` is part of
        // the key itself and can never differ - D-328 Rodada 5 residual R5-1: was `codeHash`,
        // which two different resends can coincidentally share, see the field's own doc comment)
        // - stop retrying, this specific wrong guess was already checked against a challenge that
        // no longer exists, its attempt budget doesn't carry over to whatever challenge exists now
        // (the caller still gets rejected via the ValidationError thrown by confirmPhone() regardless).
        if (!fresh || fresh.challengeId !== initial.challengeId) return;
        current = fresh;
      }
    }
  }

  /** Bounded retry (D-332, Codex Rodada 2 achado real, reforçado na Rodada 3), same base shape as
   * `incrementAttemptCountWithRetry()` - a concurrent confirmPhone() for the SAME challenge (e.g.
   * a duplicated network retry) can lose the race; each iteration re-reads and retries against the
   * fresh version instead of giving up. If a fresh read shows `confirmedAt` already set (the
   * concurrent call won), this is the same idempotent outcome, so it stops retrying too. A resend
   * swaps in a genuinely different challenge (`challengeId` changes, `version` keeps climbing
   * monotonically per `buildWhatsAppPhoneConfirmation()`'s own doc comment) - retrying against
   * THAT would confirm the wrong challenge with the old code, so this checks `challengeId` before
   * ever retrying, never just `version` (D-328 Rodada 5 residual R5-1: was `codeHash`, which two
   * different resends can coincidentally share - see the field's own doc comment).
   *
   * D-332 Rodada 3 (2 achados reais Média, Codex reproduziu ambos com interleaving real):
   * (1) uma confirmação correta que perdia a corrida contra uma 5ª tentativa errada concorrente
   * (que esgotava o orçamento) ainda retentava e confirmava mesmo assim - corrigido: cada
   * iteração TAMBÉM checa o orçamento contra o estado fresco, igual ao método acima.
   * (2) o `now` era capturado UMA VEZ fora do laço - um conflito seguido de uma espera real (ex.
   * mais de 10 minutos) ainda confirmava com um `now` congelado no passado, sem nunca revalidar
   * expiração contra o relógio ATUAL. Corrigido: `now` é recapturado a cada iteração, e a
   * expiração do estado fresco é checada contra ELE antes de qualquer retry. */
  private async setConfirmedAtWithRetry(key: EntityKey, initial: WhatsAppPhoneConfirmation): Promise<void> {
    let current = initial;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const now = this.now();
      const update = buildUnscopedVersionedUpdate({
        tableName: this.tableName,
        key,
        expectedVersion: current.version,
        set: { confirmedAt: now },
        extraConditions: [challengeIdFenceCondition(current.challengeId)],
      });
      try {
        await this.store.transactWrite([{ Update: update }]);
        return;
      } catch (err) {
        if (!isTransactionCanceled(err)) throw err;
        const fresh = await this.store.get<WhatsAppPhoneConfirmation>(key, true);
        if (!fresh || fresh.challengeId !== initial.challengeId) throw new ValidationError("Código inválido ou expirado.");
        const freshNow = this.now();
        // D-332 achado real Média (Codex Rodada 4): esta checagem de expiração ficava DEPOIS do
        // atalho `if (fresh.confirmedAt) return` - uma chamada duplicada de confirmPhone() (ex.
        // retry de rede) que perdeu a corrida contra uma confirmação legítima concorrente, e só
        // retoma depois do TTL já ter vencido de verdade, ainda retornava sucesso sem checar isso,
        // deixando o chamador (`confirmPhone()`) prosseguir para chamar `setPhoneNumber()`/
        // `recordOptIn()` de novo por uma confirmação que, na hora em que esta chamada específica
        // finalmente "sucede", já deveria ser tratada como expirada. Movida para ANTES do atalho.
        if (isWhatsAppPhoneConfirmationExpired(fresh, freshNow)) {
          throw new ValidationError("Código inválido ou expirado.");
        }
        if (fresh.confirmedAt) return; // a concurrent call already confirmed this same challenge
        if (fresh.attemptCount >= WHATSAPP_PHONE_CONFIRMATION_MAX_ATTEMPTS) {
          throw new ValidationError("Código inválido ou expirado.");
        }
        current = fresh;
      }
    }
    throw new ValidationError("Código inválido ou expirado.");
  }
}

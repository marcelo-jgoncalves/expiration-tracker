import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { InMemoryNotificationStore } from "./in-memory-store.js";
import { WhatsAppOptInService } from "../../../src/modules/notification/application/whatsapp-opt-in-service.js";
import { WhatsAppPhoneConfirmationService } from "../../../src/modules/notification/application/whatsapp-phone-confirmation-service.js";
import { whatsAppPhoneConfirmationKey, type WhatsAppPhoneConfirmation } from "../../../src/modules/notification/domain/whatsapp-phone-confirmation.js";
import { AuthorizationDeniedError } from "../../../src/modules/identity/domain/authorization.js";
import { ValidationError, DependencyUnavailableError } from "../../../src/shared/errors/app-error.js";
import type { WhatsAppProviderAdapter, WhatsAppSendInput } from "../../../src/modules/notification/ports/whatsapp-provider.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import { buildUnscopedVersionedUpdate, type EntityKey } from "../../../src/shared/dynamodb/occ.js";

const TENANT = "t1";
const USER = "u1";
const PHONE = "+15551234567";
const PEPPER = "test-pepper";

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: USER, cognitoSubject: "sub-u1", sessionId: "s1" },
    tenant: { tenantId: TENANT, roles: ["OWNER"] },
    auth: { issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), tokenId: "jti-1" },
    ...overrides,
  };
}

class FakeWhatsAppProvider implements WhatsAppProviderAdapter {
  sent: WhatsAppSendInput[] = [];
  shouldFail = false;

  async send(input: WhatsAppSendInput) {
    if (this.shouldFail) throw new Error("simulated send failure");
    this.sent.push(input);
    return { providerMessageId: "msg-1" };
  }
}

// D-332 revisão adversarial (achado real, Codex Rodada 1): a entrega real de WhatsApp lê
// `GlobalUser.phoneE164`, nunca `WhatsAppOptIn.phoneE164` - este fake prova que `confirmPhone()`
// chama `setPhoneNumber()`, o que antes desta correção NUNCA acontecia em nenhuma rota real.
class FakeGlobalUsers {
  calls: { userId: string; phoneE164: string }[] = [];
  async setPhoneNumber(userId: string, phoneE164: string) {
    this.calls.push({ userId, phoneE164 });
    return { userId } as never;
  }
}

function buildService(overrides: { now?: () => string; enabled?: boolean; provider?: FakeWhatsAppProvider; globalUsers?: FakeGlobalUsers } = {}) {
  const store = new InMemoryNotificationStore();
  const whatsAppOptIn = new WhatsAppOptInService({ store, now: overrides.now ?? (() => "2026-09-23T00:00:00.000Z") });
  const provider = overrides.provider ?? new FakeWhatsAppProvider();
  const globalUsers = overrides.globalUsers ?? new FakeGlobalUsers();
  const service = new WhatsAppPhoneConfirmationService({
    store,
    whatsAppOptIn,
    globalUsers,
    tableName: "MainTable",
    whatsAppProvider: provider,
    pepper: PEPPER,
    isWhatsAppChannelEnabled: async () => overrides.enabled ?? true,
    now: overrides.now ?? (() => "2026-09-23T00:00:00.000Z"),
    newId: (() => {
      let n = 0;
      return () => `id-${++n}`;
    })(),
  });
  return { service, store, provider, whatsAppOptIn, globalUsers };
}

async function extractSentCode(store: InMemoryNotificationStore, provider: FakeWhatsAppProvider): Promise<string> {
  void store;
  return provider.sent[provider.sent.length - 1]!.templateParams[0]!;
}

describe("WhatsAppPhoneConfirmationService.requestConfirmation", () => {
  it("sends a code over WhatsApp and persists only its hash", async () => {
    const { service, store, provider } = buildService();
    const result = await service.requestConfirmation(ctx(), PHONE);
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]!.to).toBe(PHONE);
    expect(result.expiresAt).toBeTruthy();

    const record = await store.get<WhatsAppPhoneConfirmation>(whatsAppPhoneConfirmationKey(TENANT, USER, PHONE));
    expect(record).toBeDefined();
    expect(record!.codeHash).not.toBe(provider.sent[0]!.templateParams[0]);
  });

  it("rejects while the WhatsApp channel flag is disabled, never attempting a send", async () => {
    const { service, provider } = buildService({ enabled: false });
    await expect(service.requestConfirmation(ctx(), PHONE)).rejects.toBeInstanceOf(DependencyUnavailableError);
    expect(provider.sent).toHaveLength(0);
  });

  it("enforces a resend cooldown for the same tenant/user/phone", async () => {
    const { service } = buildService();
    await service.requestConfirmation(ctx(), PHONE);
    await expect(service.requestConfirmation(ctx(), PHONE)).rejects.toBeInstanceOf(ValidationError);
  });

  it("allows a fresh request once the cooldown has passed", async () => {
    let now = "2026-09-23T00:00:00.000Z";
    const { service, provider } = buildService({ now: () => now });
    await service.requestConfirmation(ctx(), PHONE);
    now = new Date(Date.parse(now) + 61_000).toISOString();
    await service.requestConfirmation(ctx(), PHONE);
    expect(provider.sent).toHaveLength(2);
  });

  // D-332 revisão adversarial (achado real Alta, Codex Rodada 2): antes desta correção, um reenvio
  // sempre reescrevia com `version: 1` incondicionalmente - uma escrita PENDENTE de um
  // `confirmPhone()` para o desafio ANTERIOR (que já tinha validado o código velho contra o hash
  // velho, e ia escrever `confirmedAt` condicionado ao `version` que leu) podia coincidir com o
  // `version: 1` do desafio NOVO pós-reenvio e confirmar o desafio ERRADO com o código VELHO -
  // não é um problema de hash (esse já falhava antes), é um problema de identidade da CONDIÇÃO da
  // escrita. Simula a corrida diretamente: captura o `version` do desafio antigo, força um
  // reenvio, e tenta a MESMA escrita condicionada que um `confirmPhone()` pendente do desafio
  // antigo teria feito. Mutação: remover `(existing?.version ?? 0) + 1` em `requestConfirmation()`
  // (voltando a `version: 1` fixo) faria esta escrita simulada suceder em vez de falhar.
  it("a resend's version never coincides with a pending write's expectedVersion from the old challenge", async () => {
    let now = "2026-09-23T00:00:00.000Z";
    const { service, store } = buildService({ now: () => now });
    await service.requestConfirmation(ctx(), PHONE);
    const key = whatsAppPhoneConfirmationKey(TENANT, USER, PHONE);
    const oldChallenge = await store.get<WhatsAppPhoneConfirmation>(key);

    now = new Date(Date.parse(now) + 61_000).toISOString(); // past the resend cooldown
    await service.requestConfirmation(ctx(), PHONE); // resend - new challenge, same key

    // Simulates a confirmPhone() call for the OLD challenge that already validated the old code
    // against the old hash, now attempting its conditioned write using the version it read.
    const pendingWrite = buildUnscopedVersionedUpdate({
      tableName: "MainTable",
      key,
      expectedVersion: oldChallenge!.version,
      set: { confirmedAt: now },
    });
    await expect(store.transactWrite([{ Update: pendingWrite }])).rejects.toBeTruthy();
  });

  // D-332 Rodada 3 (achado real Alta, Codex): a Rodada 2's "correção" calculava o próximo version
  // em memória mas ainda escrevia via `store.update()` INCONDICIONAL - um reenvio que LÊ um
  // estado obsoleto e só grava DEPOIS (pausado por I/O real) sobrescreveria silenciosamente
  // qualquer coisa que tenha acontecido nesse meio-tempo (ex. uma confirmação legítima), incluindo
  // fazer a `version` andar PARA TRÁS. Este teste pausa a escrita do REENVIO especificamente
  // (não a do confirmPhone) logo após sua leitura obsoleta, deixa uma confirmação real e legítima
  // acontecer no meio tempo, e só então libera a escrita do reenvio - provando que ela detecta o
  // conflito (nunca sobrescreve cegamente) e re-lê o estado fresco antes de gravar de verdade.
  it("a resend paused right after its own read never overwrites a real confirmation that lands while it's paused", async () => {
    let now = "2026-09-23T00:00:00.000Z";
    const { service, store, provider } = buildService({ now: () => now });
    await service.requestConfirmation(ctx(), PHONE); // A, v1
    const codeA = await extractSentCode(store, provider);
    now = new Date(Date.parse(now) + 61_000).toISOString(); // past the resend cooldown

    // Pauses the FIRST transactWrite call (the paused resend's own conditioned write, made
    // AFTER its stale read of v1) right before it executes, then lets every later call through
    // normally (the wrong guess and the real confirmation below both need real writes to land).
    const realTransactWrite = store.transactWrite.bind(store);
    let releasePause: () => void = () => {};
    const paused = new Promise<void>((resolve) => {
      let intercepted = false;
      store.transactWrite = (async (entries) => {
        if (!intercepted) {
          intercepted = true;
          const gate = new Promise<void>((resumeIt) => {
            releasePause = resumeIt;
          });
          resolve();
          await gate;
        }
        return realTransactWrite(entries);
      }) as typeof store.transactWrite;
    });

    const pendingResend = service.requestConfirmation(ctx(), PHONE); // reads A/v1, pauses before writing
    await paused;

    // While the resend above is paused (already past its own stale read), a wrong guess and then
    // the REAL correct confirmation both land for real - the challenge is legitimately confirmed
    // (version bumps past what the paused resend's stale read ever saw).
    await service.confirmPhone(ctx(), PHONE, "000000").catch(() => {}); // A: v1 -> v2
    await service.confirmPhone(ctx(), PHONE, codeA); // A: v2 -> v3, confirmedAt set for real

    const confirmedBeforeResend = await store.get<WhatsAppPhoneConfirmation>(whatsAppPhoneConfirmationKey(TENANT, USER, PHONE));
    expect(confirmedBeforeResend?.confirmedAt).toBeTruthy();
    expect(confirmedBeforeResend?.version).toBe(3);

    // Resume the paused resend - its conditioned write (expectedVersion=1, from its stale read)
    // must conflict against the real v3, forcing its retry loop to re-read fresh and write on top
    // of the REAL current state, never silently overwriting the confirmation with a version that
    // regresses backwards to 2.
    releasePause();
    await expect(pendingResend).resolves.toBeTruthy();

    const afterResend = await store.get<WhatsAppPhoneConfirmation>(whatsAppPhoneConfirmationKey(TENANT, USER, PHONE));
    expect(afterResend?.version).toBeGreaterThan(3); // never regressed to the resend's originally-computed v2
  });

  it("wraps a provider send failure as DependencyUnavailableError, never persisting a record", async () => {
    const provider = new FakeWhatsAppProvider();
    provider.shouldFail = true;
    const { service, store } = buildService({ provider });
    await expect(service.requestConfirmation(ctx(), PHONE)).rejects.toBeInstanceOf(DependencyUnavailableError);
    expect(await store.get(whatsAppPhoneConfirmationKey(TENANT, USER, PHONE))).toBeUndefined();
  });

  it("enforces authorization (no membership => denied)", async () => {
    const { service } = buildService();
    await expect(service.requestConfirmation(ctx({ tenant: { tenantId: TENANT, roles: [] } }), PHONE)).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });

  // D-332 achado real Baixa (Codex Rodada 4): a validação E.164 vivia dentro de
  // `buildWhatsAppPhoneConfirmation()`, chamada só DEPOIS do `send()` - um telefone malformado
  // ainda disparava uma mensagem real pelo provider antes de falhar. Mutação: mover a checagem
  // `isValidE164` de volta para depois do bloco `try { await this.whatsAppProvider.send(...) }`
  // faria este teste falhar (`provider.sent` teria 1 entrada).
  it("rejects a malformed E.164 phone before ever calling the provider", async () => {
    const { service, provider } = buildService();
    await expect(service.requestConfirmation(ctx(), "not-a-phone")).rejects.toBeInstanceOf(ValidationError);
    expect(provider.sent).toHaveLength(0);
  });

  // D-332 achado real Média (Codex Rodada 4): o retry do reenvio (achado 1, corrigido) ainda podia
  // sobrescrever um reenvio concorrente que já tivesse vencido a corrida, usando o `now`/`code`
  // OBSOLETOS deste chamador - fazendo `createdAt` retroceder e reabrindo a janela de cooldown
  // para outro reenvio imediato. Este teste pausa a escrita do reenvio B logo após sua leitura,
  // deixa um reenvio C genuinamente mais novo vencer de verdade, e só então libera B - prova que B
  // adota o resultado de C em vez de sobrescrevê-lo. Mutação: remover a checagem
  // `fresh.challengeId !== initial.challengeId` (voltando a sempre sobrescrever com o `record` local)
  // faria este teste falhar (o `expiresAt` retornado por B não bateria com o de C, e `createdAt`
  // regrediria para o timestamp de B).
  it("a resend that loses its conditioned write to a genuinely newer concurrent resend adopts the winner, never regressing createdAt", async () => {
    let now = "2026-09-23T00:00:00.000Z";
    const { service, store, provider } = buildService({ now: () => now });
    await service.requestConfirmation(ctx(), PHONE); // initial challenge
    now = new Date(Date.parse(now) + 61_000).toISOString(); // past cooldown

    const realTransactWrite = store.transactWrite.bind(store);
    let releasePause: () => void = () => {};
    const paused = new Promise<void>((resolve) => {
      let intercepted = false;
      store.transactWrite = (async (entries) => {
        if (!intercepted) {
          intercepted = true;
          const gate = new Promise<void>((resumeIt) => {
            releasePause = resumeIt;
          });
          resolve();
          await gate;
        }
        return realTransactWrite(entries);
      }) as typeof store.transactWrite;
    });

    const pendingB = service.requestConfirmation(ctx(), PHONE); // reads v1, sends, pauses before writing
    await paused;

    now = new Date(Date.parse(now) + 61_000).toISOString(); // C resends later, for real
    const resultC = await service.requestConfirmation(ctx(), PHONE);

    releasePause();
    const resultB = await pendingB;

    expect(resultB.expiresAt).toBe(resultC.expiresAt); // B adopted C, never overwrote it
    const record = await store.get<WhatsAppPhoneConfirmation>(whatsAppPhoneConfirmationKey(TENANT, USER, PHONE));
    expect(record?.createdAt).not.toBe("2026-09-23T00:01:01.000Z"); // B's own stale timestamp never landed
    expect(provider.sent).toHaveLength(3); // initial + B + C all sent for real - only the DB write was arbitrated
  });

  // D-328 revisão adversarial (achado real Baixa, Codex Rodada 5, residual R5-1): o teste acima
  // prova a arbitragem quando B e C sorteiam códigos DIFERENTES - mas a checagem "isto ainda é o
  // mesmo desafio?" comparava `codeHash`, não uma identidade de geração. Dois reenvios que
  // sorteiam o MESMO código de 6 dígitos (1/1.000.000, sob corrida real) produziam o mesmo
  // `codeHash` mesmo sendo desafios genuinamente diferentes - o perdedor não se reconhecia como
  // perdedor e sobrescrevia o vencedor de qualquer forma (regredindo `createdAt`, reabrindo o
  // cooldown). Este teste força esse exato colapso sorteando o MESMO código para o desafio
  // inicial e para C. Mutação: trocar `challengeId` de volta por `codeHash` nas 3 checagens do
  // serviço faria este teste falhar (B sobrescreveria C, `createdAt` regrediria).
  it("a resend that coincidentally draws the SAME 6-digit code as a genuinely newer concurrent resend still adopts the winner (R5-1)", async () => {
    const cryptoAsMutable = crypto as unknown as { randomInt: (...args: unknown[]) => number };
    const originalRandomInt = cryptoAsMutable.randomInt;
    const codeQueue: number[] = [111111, 222222, 111111]; // initial=111111, B=222222, C=111111 (coincides with initial)
    cryptoAsMutable.randomInt = (..._args: unknown[]) => codeQueue.shift()!;
    syncBuiltinESMExports();
    try {
      let now = "2026-09-23T00:00:00.000Z";
      const { service, store, provider } = buildService({ now: () => now });
      await service.requestConfirmation(ctx(), PHONE); // initial challenge, code 111111
      now = new Date(Date.parse(now) + 61_000).toISOString(); // past cooldown

      const realTransactWrite = store.transactWrite.bind(store);
      let releasePause: () => void = () => {};
      const paused = new Promise<void>((resolve) => {
        let intercepted = false;
        store.transactWrite = (async (entries) => {
          if (!intercepted) {
            intercepted = true;
            const gate = new Promise<void>((resumeIt) => {
              releasePause = resumeIt;
            });
            resolve();
            await gate;
          }
          return realTransactWrite(entries);
        }) as typeof store.transactWrite;
      });

      const pendingB = service.requestConfirmation(ctx(), PHONE); // reads v1, draws 222222, pauses before writing
      await paused;

      now = new Date(Date.parse(now) + 61_000).toISOString(); // C resends later, for real, draws 111111 (same as initial)
      const resultC = await service.requestConfirmation(ctx(), PHONE);

      releasePause();
      const resultB = await pendingB;

      expect(resultB.expiresAt).toBe(resultC.expiresAt); // B adopted C, never overwrote it
      const record = await store.get<WhatsAppPhoneConfirmation>(whatsAppPhoneConfirmationKey(TENANT, USER, PHONE));
      expect(record?.createdAt).not.toBe("2026-09-23T00:01:01.000Z"); // B's own stale timestamp never landed
      expect(provider.sent).toHaveLength(3);
    } finally {
      cryptoAsMutable.randomInt = originalRandomInt;
      syncBuiltinESMExports();
    }
  });

  // D-328 revisão adversarial (achado real Média, Codex Rodada 6, R6-1): o teste acima prova a
  // arbitragem quando o desafio anterior ainda existe fisicamente na hora da escrita pausada -
  // mas a exclusão física do TTL do DynamoDB é assíncrona (pode levar horas). Este teste simula
  // esse caso: A é fisicamente removido ENQUANTO B está pausado (não substituído por um reenvio -
  // apagado de verdade), e C cria um desafio do ZERO na mesma chave (primeira requisição, não
  // reenvio), que também começa em `version=1`. A escrita condicionada de B (expectedVersion=1)
  // coincide com o `version=1` de C só por acidente de numeração, não porque são a mesma geração.
  // Mutação: remover `extraConditions: [challengeIdFenceCondition(...)]` das 3 escritas do serviço
  // faria este teste falhar (a condição de versão sozinha aceitaria a escrita de B contra C, sem
  // nunca cair no `catch` que checa `challengeId`).
  it("a resend paused across a physical TTL deletion never overwrites a from-scratch challenge that coincidentally reuses version=1 (R6-1)", async () => {
    let now = "2026-09-23T00:00:00.000Z";
    const { service, store, provider } = buildService({ now: () => now });
    await service.requestConfirmation(ctx(), PHONE); // A: initial challenge, version=1
    const key = whatsAppPhoneConfirmationKey(TENANT, USER, PHONE);
    now = new Date(Date.parse(now) + 61_000).toISOString(); // past cooldown

    const realTransactWrite = store.transactWrite.bind(store);
    let releasePause: () => void = () => {};
    const paused = new Promise<void>((resolve) => {
      let intercepted = false;
      store.transactWrite = (async (entries) => {
        if (!intercepted) {
          intercepted = true;
          const gate = new Promise<void>((resumeIt) => {
            releasePause = resumeIt;
          });
          resolve();
          await gate;
        }
        return realTransactWrite(entries);
      }) as typeof store.transactWrite;
    });

    const pendingB = service.requestConfirmation(ctx(), PHONE); // reads A/v1, pauses before writing
    await paused;

    store._simulateTtlDeletion(key); // A is physically gone - not replaced, genuinely deleted
    now = new Date(Date.parse(now) + 61_000).toISOString(); // C is genuinely later than B's own stale `now`
    const resultC = await service.requestConfirmation(ctx(), PHONE); // from-scratch create, version=1 again

    releasePause();
    const resultB = await pendingB;

    expect(resultB.expiresAt).toBe(resultC.expiresAt); // B recognized it lost despite the version coincidence
    const record = await store.get<WhatsAppPhoneConfirmation>(key);
    expect(record?.expiresAt).toBe(resultC.expiresAt); // C's record survived, B never overwrote it
    expect(provider.sent).toHaveLength(3); // initial + B + C
  });

  // D-328 revisão adversarial (achado real Baixa, Codex Rodada 7, R7-2): a primeira requisição
  // desta chave que perde o `putIfAbsent()` para um vencedor concorrente relia em `won!.expiresAt`
  // - se esse vencedor for fisicamente removido pelo TTL ANTES da releitura que busca seu
  // `expiresAt`, o `!` do TypeScript não protege nada em runtime e a chamada estoura. Este teste
  // força esse exato interleaving: a primeira tentativa de `putIfAbsent()` "perde" (insere um
  // registro vencedor de mentira, retorna `false`), e a releitura logo em seguida encontra esse
  // vencedor já fisicamente apagado. Mutação: trocar `if (won) return ...; continue;` de volta
  // por `return { expiresAt: won!.expiresAt };` faria este teste falhar com um TypeError não
  // tratado, em vez de retentar.
  it("a from-scratch create that loses to a putIfAbsent conflict, then finds the winner already gone (TTL), retries instead of throwing (R7-2)", async () => {
    const { service, store, provider } = buildService();
    const key = whatsAppPhoneConfirmationKey(TENANT, USER, PHONE);

    const realPutIfAbsent = store.putIfAbsent.bind(store);
    let putCalls = 0;
    store.putIfAbsent = (async (item) => {
      putCalls += 1;
      if (putCalls === 1) {
        await realPutIfAbsent(item); // stand-in "concurrent winner" row, inserted for real
        return false; // report the loss, same as a genuine concurrent putIfAbsent conflict
      }
      return realPutIfAbsent(item);
    }) as typeof store.putIfAbsent;

    const realGet = store.get.bind(store);
    let getCalls = 0;
    store.get = (async (k: EntityKey) => {
      getCalls += 1;
      if (getCalls === 2) {
        // The post-loss re-read that fetches the winner's expiresAt - simulate it having been
        // physically removed by TTL in the gap between the loss and this specific re-read.
        store._simulateTtlDeletion(k);
        return undefined;
      }
      return realGet(k);
    }) as typeof store.get;

    const result = await service.requestConfirmation(ctx(), PHONE); // never throws
    const record = await store.get<WhatsAppPhoneConfirmation>(key);
    expect(record).toBeDefined();
    expect(result.expiresAt).toBe(record!.expiresAt); // retried and succeeded on the 2nd attempt
    expect(provider.sent).toHaveLength(1); // code is drawn/sent once per call, not once per retry attempt
  });
});

describe("WhatsAppPhoneConfirmationService.confirmPhone", () => {
  it("records the opt-in only after the correct code is provided", async () => {
    const { service, store, provider, whatsAppOptIn } = buildService();
    await service.requestConfirmation(ctx(), PHONE);
    const code = await extractSentCode(store, provider);

    const optIn = await service.confirmPhone(ctx(), PHONE, code);
    expect(optIn.phoneE164).toBe(PHONE);
    expect(optIn.source).toBe("USER_SETTINGS");

    // recordOptIn's own create-once semantics still hold - a second confirmPhone call is idempotent.
    const again = await service.confirmPhone(ctx(), PHONE, code);
    expect(again.optedInAt).toBe(optIn.optedInAt);
    void whatsAppOptIn;
  });

  // D-332 revisão adversarial (achado real, Codex Rodada 1): a entrega real do WhatsApp lê
  // `GlobalUser.phoneE164` (`DynamoDbNotificationRecipientResolver.resolve()`), nunca
  // `WhatsAppOptIn.phoneE164` - antes desta correção, `confirmPhone()` só chamava `recordOptIn()`,
  // e `GlobalUserRepository.setPhoneNumber()` nunca era chamado por NENHUMA rota real (a entrega
  // nunca teria um número para onde mandar, mesmo com a posse confirmada). Mutação: remover a
  // chamada a `this.globalUsers.setPhoneNumber()` em `confirmPhone()` faria este teste falhar.
  it("sets GlobalUser.phoneE164 on successful confirmation - the field the real delivery path reads", async () => {
    const { service, store, provider, globalUsers } = buildService();
    await service.requestConfirmation(ctx(), PHONE);
    const code = await extractSentCode(store, provider);

    await service.confirmPhone(ctx(), PHONE, code);

    expect(globalUsers.calls).toEqual([{ userId: USER, phoneE164: PHONE }]);
  });

  // D-332 achado real: o mesmo deve valer no caminho de retry (confirmação já feita antes) - sem
  // isto, um usuário cuja PRIMEIRA confirmação sofreu uma falha parcial (opt-in gravado mas
  // setPhoneNumber não) nunca teria uma segunda chance de corrigir o número via um novo
  // confirmPhone() com o mesmo código já confirmado.
  it("also sets GlobalUser.phoneE164 on the already-confirmed retry path", async () => {
    const { service, store, provider, globalUsers } = buildService();
    await service.requestConfirmation(ctx(), PHONE);
    const code = await extractSentCode(store, provider);
    await service.confirmPhone(ctx(), PHONE, code);
    globalUsers.calls = [];

    await service.confirmPhone(ctx(), PHONE, code);

    expect(globalUsers.calls).toEqual([{ userId: USER, phoneE164: PHONE }]);
  });

  // D-332 achado real Média (Codex Rodada 4): `setConfirmedAtWithRetry()`'s atalho
  // `if (fresh.confirmedAt) return` (para uma chamada duplicada de `confirmPhone()`, ex. retry de
  // rede, que perdeu a corrida contra outra confirmação legítima concorrente) rodava ANTES da
  // checagem de expiração - uma chamada duplicada que só retoma depois do TTL já ter vencido de
  // verdade ainda retornava sucesso, deixando `confirmPhone()` chamar `setPhoneNumber()`/
  // `recordOptIn()` de novo por uma confirmação que já deveria ser tratada como expirada na hora
  // em que ESTA chamada específica finalmente "sucede". Mutação: mover a checagem de expiração de
  // volta para DEPOIS de `if (fresh.confirmedAt) return` faria este teste falhar
  // (`globalUsers.calls` teria 1 entrada em vez de 0).
  it("a duplicate confirmPhone() call that only resumes after expiry rejects instead of re-triggering setPhoneNumber", async () => {
    let now = "2026-09-23T00:00:00.000Z";
    const { service, store, provider, globalUsers } = buildService({ now: () => now });
    await service.requestConfirmation(ctx(), PHONE);
    const code = await extractSentCode(store, provider);

    const realTransactWrite = store.transactWrite.bind(store);
    let releasePause: () => void = () => {};
    const paused = new Promise<void>((resolve) => {
      let intercepted = false;
      store.transactWrite = (async (entries) => {
        if (!intercepted) {
          intercepted = true;
          const gate = new Promise<void>((resumeIt) => {
            releasePause = resumeIt;
          });
          resolve();
          await gate;
        }
        return realTransactWrite(entries);
      }) as typeof store.transactWrite;
    });

    const pendingFirst = service.confirmPhone(ctx(), PHONE, code); // reads v1, validates, pauses before writing
    await paused;

    await service.confirmPhone(ctx(), PHONE, code); // duplicate call - real write lands, confirms for real
    globalUsers.calls = [];
    now = new Date(Date.parse(now) + 11 * 60 * 1000).toISOString(); // past the 10-minute TTL

    releasePause();
    await expect(pendingFirst).rejects.toBeInstanceOf(ValidationError);
    expect(globalUsers.calls).toHaveLength(0); // never re-triggered setPhoneNumber after expiry
  });

  it("rejects an unknown/never-requested phone", async () => {
    const { service } = buildService();
    await expect(service.confirmPhone(ctx(), PHONE, "123456")).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a wrong code without recording an opt-in, and increments attemptCount", async () => {
    const { service, store } = buildService();
    await service.requestConfirmation(ctx(), PHONE);

    await expect(service.confirmPhone(ctx(), PHONE, "000000")).rejects.toBeInstanceOf(ValidationError);
    const record = await store.get<WhatsAppPhoneConfirmation>(whatsAppPhoneConfirmationKey(TENANT, USER, PHONE));
    expect(record!.attemptCount).toBe(1);
    expect(record!.confirmedAt).toBeUndefined();
  });

  it("rejects an expired code even if correct", async () => {
    let now = "2026-09-23T00:00:00.000Z";
    const { service, store, provider } = buildService({ now: () => now });
    await service.requestConfirmation(ctx(), PHONE);
    const code = await extractSentCode(store, provider);

    now = new Date(Date.parse(now) + 11 * 60 * 1000).toISOString(); // past the 10-minute TTL
    await expect(service.confirmPhone(ctx(), PHONE, code)).rejects.toBeInstanceOf(ValidationError);
  });

  // D-332 revisão adversarial (achado real Média, Codex Rodada 3): reproduzido pelo próprio Codex
  // com 10 tentativas erradas concorrentes a partir de `attemptCount=4`, terminando em
  // `attemptCount=9` - o retry loop da Rodada 2 não revalidava o orçamento a cada iteração, só a
  // versão. Corrigido: `incrementAttemptCountWithRetry()` agora para de incrementar assim que o
  // estado fresco mostra o orçamento esgotado. Este teste força DETERMINISTICAMENTE o cenário
  // exato do Codex - as 10 primeiras leituras retornam o mesmo snapshot congelado
  // (`attemptCount=4`), simulando 10 chamadas concorrentes que já leram o estado ANTES de
  // qualquer escrita acontecer (Promise.allSettled sozinho não garante esse interleaving exato
  // neste fake síncrono). Mutação: remover a checagem
  // `current.attemptCount >= WHATSAPP_PHONE_CONFIRMATION_MAX_ATTEMPTS` do início do laço faz este
  // teste falhar (attemptCount final ultrapassa 5) - verificado manualmente antes de submeter esta
  // revisão.
  it("respects the attempt budget even when 10 concurrent wrong guesses all read the same stale attemptCount=4 snapshot", async () => {
    const { service, store, provider } = buildService();
    await service.requestConfirmation(ctx(), PHONE);
    const realCode = await extractSentCode(store, provider);
    const key = whatsAppPhoneConfirmationKey(TENANT, USER, PHONE);
    const frozenSnapshot = { ...(await store.get<WhatsAppPhoneConfirmation>(key))!, attemptCount: 4 };

    const realGet = store.get.bind(store);
    let frozenReadsRemaining = 10;
    store.get = (async (k: typeof key) => {
      if (frozenReadsRemaining > 0 && k.PK === key.PK && k.SK === key.SK) {
        frozenReadsRemaining -= 1;
        return frozenSnapshot;
      }
      return realGet(k);
    }) as typeof store.get;

    const wrongCodes = Array.from({ length: 10 }, (_, i) => (i === 0 ? "999998" : String(100000 + i))).filter((c) => c !== realCode);
    const results = await Promise.allSettled(wrongCodes.map((code) => service.confirmPhone(ctx(), PHONE, code)));
    expect(results.every((r) => r.status === "rejected")).toBe(true);

    const record = await realGet<WhatsAppPhoneConfirmation>(key);
    expect(record!.attemptCount).toBeLessThanOrEqual(5);
  });

  it("locks out further attempts after the max wrong-guess count, even with the correct code", async () => {
    const { service, store, provider } = buildService();
    await service.requestConfirmation(ctx(), PHONE);
    const code = await extractSentCode(store, provider);

    for (let i = 0; i < 5; i++) {
      await expect(service.confirmPhone(ctx(), PHONE, "000000")).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(service.confirmPhone(ctx(), PHONE, code)).rejects.toBeInstanceOf(ValidationError);
  });

  // D-332 Rodada 3 (achado real Média, Codex): `setConfirmedAtWithRetry()`'s laço de retry
  // capturava `now` UMA VEZ fora do laço - um conflito de OCC seguido de uma espera real (mais de
  // 10 minutos) ainda confirmava usando o `now` congelado no passado, sem nunca revalidar
  // expiração contra o relógio ATUAL no momento do retry. Este teste força um conflito
  // deterministicamente (uma escrita concorrente entre a leitura e a escrita de `confirmPhone`) e
  // avança o relógio além do TTL antes do retry acontecer. Mutação: mover `const now = this.now()`
  // de volta para fora do laço `for` em `setConfirmedAtWithRetry()` faz este teste falhar (a
  // confirmação por retry sucede mesmo expirada).
  it("re-validates expiration against the CURRENT clock on each retry, not the time the first attempt started", async () => {
    let now = "2026-09-23T00:00:00.000Z";
    const { service, store, provider } = buildService({ now: () => now });
    await service.requestConfirmation(ctx(), PHONE);
    const code = await extractSentCode(store, provider);
    const key = whatsAppPhoneConfirmationKey(TENANT, USER, PHONE);

    // Forces exactly one OCC conflict on confirmPhone's first write attempt: a concurrent writer
    // (simulated directly) bumps the version between confirmPhone's read and its write.
    const realTransactWrite = store.transactWrite.bind(store);
    let firstCall = true;
    store.transactWrite = (async (entries) => {
      if (firstCall) {
        firstCall = false;
        const record = (await store.get<WhatsAppPhoneConfirmation>(key))!;
        await realTransactWrite([{ Update: buildUnscopedVersionedUpdate({ tableName: "MainTable", key, expectedVersion: record.version, set: { attemptCount: record.attemptCount } }) }]);
        // Past the 10-minute TTL by the time the retry (triggered by the conflict above) runs.
        now = new Date(Date.parse(now) + 11 * 60 * 1000).toISOString();
      }
      return realTransactWrite(entries);
    }) as typeof store.transactWrite;

    await expect(service.confirmPhone(ctx(), PHONE, code)).rejects.toBeInstanceOf(ValidationError);
    const record = await store.get<WhatsAppPhoneConfirmation>(key);
    expect(record?.confirmedAt).toBeUndefined();
  });

  // D-332 revisão adversarial (achado real Média, Codex): antes desta correção, o incremento de
  // `attemptCount` era um `store.update()` incondicional do objeto inteiro lido antes - a escrita
  // nunca checava se `version` (ou qualquer outro campo) tinha mudado. Este teste prova que a
  // escrita real (`buildUnscopedVersionedUpdate()`, condicionada ao `version` lido) rejeita uma
  // segunda escrita que ainda segura a versão antiga, em vez de aceitar silenciosamente as duas.
  // Mutação: trocar `buildUnscopedVersionedUpdate()` de volta por `store.update()` incondicional
  // em `confirmPhone()` faria o `store.transactWrite` direto abaixo (que usa o `version` real
  // pós-primeira tentativa errada) não detectar conflito nenhum.
  it("the attemptCount write is version-fenced - a stale concurrent writer is rejected, never silently overwritten", async () => {
    const { service, store } = buildService();
    await service.requestConfirmation(ctx(), PHONE);
    await service.confirmPhone(ctx(), PHONE, "000000").catch(() => {}); // version 1 -> 2 (attemptCount 0 -> 1)

    const record = await store.get<WhatsAppPhoneConfirmation>(whatsAppPhoneConfirmationKey(TENANT, USER, PHONE));
    expect(record?.version).toBe(2);
    expect(record?.attemptCount).toBe(1);

    // Simulates a second concurrent wrong-guess request that read the record at version 1
    // (before the first one committed) and only now writes its own increment.
    const staleWrite = buildUnscopedVersionedUpdate({
      tableName: "MainTable",
      key: whatsAppPhoneConfirmationKey(TENANT, USER, PHONE),
      expectedVersion: 1,
      set: { attemptCount: 1 },
    });
    await expect(store.transactWrite([{ Update: staleWrite }])).rejects.toBeTruthy();

    const reread = await store.get<WhatsAppPhoneConfirmation>(whatsAppPhoneConfirmationKey(TENANT, USER, PHONE));
    expect(reread?.attemptCount).toBe(1); // never double-applied by the stale writer
  });
});

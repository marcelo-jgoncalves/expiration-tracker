import { describe, expect, it } from "vitest";
import { InMemoryIdentityStore } from "./in-memory-store.js";
import { GlobalUserRepository, globalUserKey, type GlobalUser } from "../../../src/modules/identity/persistence/global-user-repository.js";
import { ValidationError, NotFoundError, DependencyUnavailableError } from "../../../src/shared/errors/app-error.js";
import { buildUnscopedVersionedUpdate, isTransactionCanceled } from "../../../src/shared/dynamodb/occ.js";

function seedUser(store: InMemoryIdentityStore, userId: string): GlobalUser {
  const key = globalUserKey(userId);
  const user: GlobalUser = {
    PK: key.PK,
    SK: "PROFILE",
    entityType: "GlobalUser",
    userId,
    emailNormalized: `${userId}@example.com`,
    identityStatus: "ACTIVE",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    version: 1,
  };
  store.seedRaw(user as unknown as Record<string, unknown> & { PK: string; SK: string });
  return user;
}

const TABLE = "MainTable";

describe("GlobalUserRepository.setPhoneNumber", () => {
  it("persists a valid E.164 phone number", async () => {
    const store = new InMemoryIdentityStore();
    seedUser(store, "u1");
    const repo = new GlobalUserRepository(store, () => "2026-09-07T00:00:00.000Z");

    const updated = await repo.setPhoneNumber("u1", "+15551234567", TABLE);
    expect(updated.phoneE164).toBe("+15551234567");
    expect(updated.updatedAt).toBe("2026-09-07T00:00:00.000Z");

    const reread = await repo.get("u1");
    expect(reread?.phoneE164).toBe("+15551234567");
  });

  // G-V3: a malformed number must be rejected BEFORE any read/write - never partially applied,
  // never stored in any form.
  it("rejects a malformed phone number before touching the store", async () => {
    const store = new InMemoryIdentityStore();
    seedUser(store, "u1");
    const repo = new GlobalUserRepository(store, () => "2026-09-07T00:00:00.000Z");

    await expect(repo.setPhoneNumber("u1", "555-1234", TABLE)).rejects.toBeInstanceOf(ValidationError);

    const reread = await repo.get("u1");
    expect(reread?.phoneE164).toBeUndefined();
    expect(reread?.updatedAt).toBe("2026-09-01T00:00:00.000Z"); // untouched
  });

  it("rejects setting a phone number on a nonexistent user", async () => {
    const store = new InMemoryIdentityStore();
    const repo = new GlobalUserRepository(store);
    await expect(repo.setPhoneNumber("ghost", "+15551234567", TABLE)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("overwrites a previous phone number on re-set (current-number semantics, not append)", async () => {
    const store = new InMemoryIdentityStore();
    seedUser(store, "u1");
    const repo = new GlobalUserRepository(store, () => "2026-09-07T00:00:00.000Z");

    await repo.setPhoneNumber("u1", "+15551234567", TABLE);
    const second = await repo.setPhoneNumber("u1", "+15559999999", TABLE);
    expect(second.phoneE164).toBe("+15559999999");

    const reread = await repo.get("u1");
    expect(reread?.phoneE164).toBe("+15559999999");
  });

  // D-332 revisão adversarial (achado real Alta, Codex): antes desta correção, setPhoneNumber()
  // fazia um PutItem incondicional do objeto INTEIRO lido antes - um escritor concorrente
  // (logoutAll(), que também faz um PutItem incondicional do objeto inteiro) podia apagar
  // silenciosamente o número recém-confirmado, ou vice-versa (o phone apagando o
  // globalLogoutAfter de um logout concorrente), sem nenhum sinal de conflito. A correção usa
  // `buildUnscopedVersionedUpdate()` para condicionar a escrita ao `version` lido - este teste
  // prova que essa MESMA condição (mesma chave, mesmo `version` esperado que `setPhoneNumber()`
  // acabou de usar) rejeita um segundo escritor que ainda segura uma versão obsoleta, em vez de
  // sobrescrever silenciosamente. Mutação: trocar `buildUnscopedVersionedUpdate()` de volta por
  // `this.store.update(updated)` incondicional em `setPhoneNumber()` faria a PRIMEIRA chamada
  // nunca incrementar `version` de forma condicionada - o segundo `transactWrite` abaixo (que
  // usa o `version` real pós-`setPhoneNumber()`) precisaria ser ajustado para não detectar
  // conflito nenhum, quebrando a asserção `rejects`.
  it("the version fence setPhoneNumber() writes under is real - a stale concurrent writer (e.g. logoutAll()) targeting the old version is rejected, never silently overwritten", async () => {
    const store = new InMemoryIdentityStore();
    const user = seedUser(store, "u1"); // version 1
    const repo = new GlobalUserRepository(store, () => "2026-09-07T00:00:00.000Z");

    await repo.setPhoneNumber("u1", "+15551234567", TABLE); // version 1 -> 2

    // Simulates a concurrent writer that read the user at version 1 (before setPhoneNumber ran)
    // and only now gets around to writing - e.g. logoutAll() converted to the same versioned
    // pattern in a future round. Must be rejected, not silently applied over the newer version.
    const staleWrite = buildUnscopedVersionedUpdate({
      tableName: TABLE,
      key: { PK: user.PK, SK: user.SK },
      expectedVersion: 1,
      set: { globalLogoutAfter: "2026-09-07T00:00:00.000Z" },
    });
    await expect(store.transactWrite([{ Update: staleWrite }])).rejects.toSatisfy((err: unknown) => isTransactionCanceled(err));

    const reread = await repo.get("u1");
    expect(reread?.phoneE164).toBe("+15551234567"); // never clobbered by the stale writer
    expect(reread?.globalLogoutAfter).toBeUndefined();
  });
});

describe("GlobalUserRepository.logoutAll", () => {
  // D-332 revisão adversarial (achado real Média, Codex Rodada 2): antes desta correção,
  // `logoutAll()` fazia um PutItem incondicional do objeto INTEIRO lido antes - o mesmo padrão que
  // motivou a correção de `setPhoneNumber()`, mas na direção OPOSTA: `logoutAll()` podia ler o
  // telefone A/versão 1, esperar `setPhoneNumber()` confirmar B/versão 2, e depois sobrescrever de
  // volta para A/versão 1 - restaurando um telefone anterior como destinatário real de lembretes.
  // Mutação: trocar `buildUnscopedVersionedUpdate()` de volta por `this.store.update({...user,
  // globalLogoutAfter, updatedAt})` incondicional faria este teste falhar - o `phoneE164` recém
  // confirmado seria apagado (o objeto `user` lido no início de `logoutAll()` nunca tinha esse
  // campo).
  it("never clobbers phoneE164 (or any other field) set by a concurrent writer - SET only touches globalLogoutAfter", async () => {
    const store = new InMemoryIdentityStore();
    seedUser(store, "u1");
    const repo = new GlobalUserRepository(store, () => "2026-09-07T00:00:00.000Z");

    // Simulates setPhoneNumber() having already run between logoutAll()'s conceptual read and
    // write - forceUpdate bypasses the repo entirely, same as a real concurrent writer would.
    const current = await repo.get("u1");
    store.seedRaw({ ...current, phoneE164: "+15559999999", version: 2 } as unknown as Record<string, unknown> & { PK: string; SK: string });

    await repo.logoutAll("u1", TABLE);

    const reread = await repo.get("u1");
    expect(reread?.globalLogoutAfter).toBe("2026-09-07T00:00:00.000Z");
    expect(reread?.phoneE164).toBe("+15559999999"); // never clobbered
  });

  it("retries on a version conflict instead of failing the caller - logout must always eventually succeed", async () => {
    const store = new InMemoryIdentityStore();
    seedUser(store, "u1");
    const repo = new GlobalUserRepository(store, () => "2026-09-07T00:00:00.000Z");

    const original = repo.get.bind(repo);
    let callCount = 0;
    repo.get = (async (userId: string) => {
      callCount += 1;
      const result = await original(userId);
      // First read (inside logoutAll) returns a stale version 1 snapshot; a "concurrent" writer
      // bumps the real stored record to version 2 right after, before logoutAll's write lands.
      if (callCount === 1 && result) store.seedRaw({ ...result, version: 2 } as unknown as Record<string, unknown> & { PK: string; SK: string });
      return result;
    }) as typeof repo.get;

    await expect(repo.logoutAll("u1", TABLE)).resolves.toBeUndefined();
    const reread = await original("u1");
    expect(reread?.globalLogoutAfter).toBe("2026-09-07T00:00:00.000Z");
  });

  // D-332 Rodada 3 (achado real Alta, Codex reproduziu com 5 escritas reais concorrentes de
  // setPhoneNumber causando 5 conflitos): o laço de retry da Rodada 2 esgotava as 5 tentativas e
  // retornava SUCESSO mesmo sem NENHUMA escrita ter persistido `globalLogoutAfter` - o BFF então
  // prosseguia como se a revogação global tivesse acontecido de verdade. Mutação: trocar o `throw
  // new DependencyUnavailableError(...)` final por um `return` silencioso faria este teste falhar.
  it("throws (never silently returns success) when every retry attempt loses the OCC race", async () => {
    const store = new InMemoryIdentityStore();
    seedUser(store, "u1");
    const repo = new GlobalUserRepository(store, () => "2026-09-07T00:00:00.000Z");

    store.transactWrite = (async () => {
      throw { name: "TransactionCanceledException" };
    }) as typeof store.transactWrite;

    await expect(repo.logoutAll("u1", TABLE)).rejects.toBeInstanceOf(DependencyUnavailableError);
  });

  // D-332 Rodada 3 (achado real Alta, Codex reproduziu com um logout A mais antigo perdendo a
  // corrida contra um logout B mais novo, e ainda assim retentando com o `now` congelado de A,
  // retrocedendo o watermark): `now` era capturado UMA VEZ no início - um logout mais antigo que
  // perdesse a corrida contra um watermark mais novo já persistido ainda sobrescrevia com seu
  // próprio valor mais antigo no retry, permitindo que tokens emitidos entre os dois instantes
  // voltassem a passar a checagem de `resolve-request-context.ts`. Mutação: remover a checagem
  // `if (user.globalLogoutAfter && user.globalLogoutAfter >= now) return;` do topo do laço faria
  // este teste falhar (o watermark regrediria para o valor mais antigo).
  it("never regresses the watermark - a retry that finds a newer watermark already persisted returns without overwriting it", async () => {
    const store = new InMemoryIdentityStore();
    seedUser(store, "u1");
    const repo = new GlobalUserRepository(store, () => "2026-09-07T00:00:00.000Z"); // older logout

    const original = repo.get.bind(repo);
    let callCount = 0;
    repo.get = (async (userId: string) => {
      callCount += 1;
      const result = await original(userId);
      if (callCount === 1 && result) {
        // A concurrent, NEWER logoutAll already landed with a later watermark - simulates it
        // committing between this (older) logout's initial read and its own write attempt.
        store.seedRaw({ ...result, version: 2, globalLogoutAfter: "2026-09-07T00:05:00.000Z" } as unknown as Record<string, unknown> & { PK: string; SK: string });
      }
      return result;
    }) as typeof repo.get;

    await repo.logoutAll("u1", TABLE);
    const reread = await original("u1");
    expect(reread?.globalLogoutAfter).toBe("2026-09-07T00:05:00.000Z"); // never regressed to 00:00:00
  });
});

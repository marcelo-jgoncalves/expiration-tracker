/**
 * Wave B2B-12 (multi-user-b2b-wave-b2b12-scope.md, `APPROVED` D-110) — covers the pure/testable
 * helpers of scripts/reset-dev-data.ts (allowlist guards, backoff/retry, batching, hashing,
 * manifest redaction, final-verification fail-loud). Not the real Scan/BatchWrite/SQS/Cognito
 * wiring in `main()`, which needs live AWS and is exercised manually via --dry-run against a real
 * dev account, same convention as test/unit/reminder/backfill-reminder-policies.test.ts.
 */
import { describe, expect, it, vi } from "vitest";
import {
  ALLOWED_MAIN_TABLE,
  ALLOWED_SESSION_TABLE,
  ALLOWED_BUCKET,
  EXPECTED_ACCOUNT_ID,
  assertAllEmpty,
  assertAllowedTable,
  assertExpectedAccount,
  buildManifestEntry,
  chunk,
  deleteAllItems,
  deleteBatchWithRetry,
  extractKey,
  hashItem,
  parseArgs,
  queueNames,
  type BackoffOptions,
} from "../../../scripts/reset-dev-data.js";

const NO_DELAY_BACKOFF: BackoffOptions = { retries: 5, baseMs: 1, jitterMs: 0, sleep: () => Promise.resolve() };

describe("reset-dev-data: parseArgs", () => {
  // Mutação: trocar `argv.includes("--confirm")` por `!argv.includes("--dry-run")` inverteria a
  // polaridade default-segura (confirm passaria a ser true por padrão) e este teste falharia.
  it("defaults to dry-run (confirm:false) and the allowlisted table/session-table/bucket", () => {
    const args = parseArgs([]);
    expect(args).toEqual({
      table: ALLOWED_MAIN_TABLE,
      sessionTable: ALLOWED_SESSION_TABLE,
      bucket: ALLOWED_BUCKET,
      confirm: false,
      includeCognito: false,
      userPoolId: undefined,
    });
  });

  it("parses --confirm, --include-cognito, --user-pool-id", () => {
    const args = parseArgs(["--confirm", "--include-cognito", "--user-pool-id", "us-east-1_ABC123"]);
    expect(args.confirm).toBe(true);
    expect(args.includeCognito).toBe(true);
    expect(args.userPoolId).toBe("us-east-1_ABC123");
  });

  // Mutação: remover a chamada a `assertAllowedTable` para `--table` no parseArgs faria este
  // teste (que hoje espera um throw) passar silenciosamente com uma tabela errada aceita.
  it("throws if --table is anything other than the allowlisted dev table", () => {
    expect(() => parseArgs(["--table", "some-other-table"])).toThrow(/allowed/i);
  });

  it("throws if --session-table is anything other than the allowlisted dev session table", () => {
    expect(() => parseArgs(["--session-table", "prod-sessions"])).toThrow(/allowed/i);
  });

  it("throws if --bucket is anything other than the allowlisted dev bucket", () => {
    expect(() => parseArgs(["--bucket", "some-other-bucket"])).toThrow(/allowed/i);
  });
});

describe("reset-dev-data: assertAllowedTable", () => {
  it("passes silently when the name matches", () => {
    expect(() => assertAllowedTable(ALLOWED_MAIN_TABLE, ALLOWED_MAIN_TABLE)).not.toThrow();
  });

  it("throws when the name does not match", () => {
    expect(() => assertAllowedTable("typo-table", ALLOWED_MAIN_TABLE)).toThrow(/typo-table/);
  });
});

describe("reset-dev-data: assertExpectedAccount", () => {
  // Mutação: comparar contra uma constante errada (ou omitir a comparação) faria este teste
  // (conta incorreta) deixar de lançar.
  it("throws when the caller identity account does not match the expected dev account", async () => {
    await expect(assertExpectedAccount(async () => "111111111111")).rejects.toThrow(EXPECTED_ACCOUNT_ID);
  });

  it("resolves without throwing when the account matches", async () => {
    await expect(assertExpectedAccount(async () => EXPECTED_ACCOUNT_ID)).resolves.toBeUndefined();
  });
});

describe("reset-dev-data: chunk", () => {
  // Mutação: usar `size + 1` no slice faria batches de 26 itens - acima do limite real do
  // BatchWriteItem - e este teste (exatamente 25 no primeiro lote) falharia.
  it("splits into batches of exactly the given size, remainder in the last batch", () => {
    const items = Array.from({ length: 52 }, (_, i) => i);
    const batches = chunk(items, 25);
    expect(batches.map((b) => b.length)).toEqual([25, 25, 2]);
  });

  it("returns an empty array for an empty input", () => {
    expect(chunk([], 25)).toEqual([]);
  });
});

describe("reset-dev-data: extractKey", () => {
  it("extracts only PK/SK, dropping other attributes", () => {
    expect(extractKey({ PK: "TENANT#t1", SK: "META", entityType: "Foo", extra: 123 })).toEqual({ PK: "TENANT#t1", SK: "META" });
  });

  it("throws when PK or SK is missing", () => {
    expect(() => extractKey({ SK: "META" })).toThrow(/PK\/SK/);
  });
});

describe("reset-dev-data: deleteBatchWithRetry", () => {
  // Mutação: reintroduzir a "referência a occ.ts" (proposta original, Rodada 2 do debate de
  // escopo) em vez deste retry local faria este teste não compilar/nunca convergir - o mock abaixo
  // simula exatamente 2 UnprocessedItems na 1a chamada, retentados e resolvidos na 2a.
  it("retries UnprocessedItems until DynamoDB reports none, then resolves", async () => {
    const keys = [{ PK: "A", SK: "1" }, { PK: "B", SK: "2" }];
    const batchWriteDelete = vi
      .fn()
      .mockResolvedValueOnce([keys[1]]) // 1st attempt: 1 of 2 unprocessed
      .mockResolvedValueOnce([]); // 2nd attempt (retry of just the unprocessed one): none left

    await deleteBatchWithRetry(batchWriteDelete, "MainTable", keys, NO_DELAY_BACKOFF);

    expect(batchWriteDelete).toHaveBeenCalledTimes(2);
    expect(batchWriteDelete).toHaveBeenNthCalledWith(2, "MainTable", [keys[1]]);
  });

  // Mutação: remover o `if (attempt > opts.retries) throw` faria este teste rodar para sempre em
  // vez de falhar de forma explícita quando o serviço nunca converge para zero.
  it("throws (fail-loud) instead of looping forever when UnprocessedItems never reaches zero", async () => {
    const keys = [{ PK: "A", SK: "1" }];
    const batchWriteDelete = vi.fn().mockResolvedValue(keys);

    await expect(deleteBatchWithRetry(batchWriteDelete, "MainTable", keys, NO_DELAY_BACKOFF)).rejects.toThrow(/giving up/);
  });

  it("does nothing (zero calls) for an empty key list", async () => {
    const batchWriteDelete = vi.fn();
    await deleteBatchWithRetry(batchWriteDelete, "MainTable", [], NO_DELAY_BACKOFF);
    expect(batchWriteDelete).not.toHaveBeenCalled();
  });
});

describe("reset-dev-data: deleteAllItems", () => {
  it("batches items into groups of 25 and deletes all of them", async () => {
    const items = Array.from({ length: 47 }, (_, i) => ({ PK: `P${i}`, SK: "META" }));
    const batchWriteDelete = vi.fn().mockResolvedValue([]);

    const result = await deleteAllItems(batchWriteDelete, "MainTable", items, NO_DELAY_BACKOFF);

    expect(result).toEqual({ deleted: 47, batches: 2 });
    expect(batchWriteDelete).toHaveBeenCalledTimes(2);
  });
});

describe("reset-dev-data: hashItem", () => {
  // Mutação: usar `JSON.stringify(item)` direto (sem ordenar as chaves) faria este teste falhar,
  // já que os 2 objetos abaixo têm as MESMAS chaves em ordem diferente.
  it("produces the same hash regardless of key insertion order", () => {
    const a = { PK: "P1", SK: "META", entityType: "Foo" };
    const b = { entityType: "Foo", SK: "META", PK: "P1" };
    expect(hashItem(a)).toBe(hashItem(b));
  });

  it("produces different hashes for different items", () => {
    expect(hashItem({ PK: "P1" })).not.toBe(hashItem({ PK: "P2" }));
  });
});

describe("reset-dev-data: buildManifestEntry (redaction)", () => {
  // Mutação: incluir o item bruto (ex. `items` ou um campo de valor real) no retorno em vez de só
  // hash/entityType/count faria este teste (que verifica ausência de PII) falhar.
  it("never includes a raw field value — only counts, distinct entityTypes, and hashes", () => {
    const items = [
      { PK: "USER#u1", SK: "PROFILE", entityType: "GlobalUser", emailNormalized: "real-user@example.com" },
      { PK: "USER#u2", SK: "PROFILE", entityType: "GlobalUser", emailNormalized: "other-user@example.com" },
    ];
    const manifest = buildManifestEntry("exptrk-dev-table", items);

    expect(manifest.itemCount).toBe(2);
    expect(manifest.entityTypes).toEqual(["GlobalUser"]);
    expect(manifest.hashes).toHaveLength(2);
    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toContain("real-user@example.com");
    expect(serialized).not.toContain("other-user@example.com");
  });
});

describe("reset-dev-data: assertAllEmpty (final verification, fail-loud)", () => {
  it("passes silently when every count is zero", () => {
    expect(() => assertAllEmpty({ "exptrk-dev-table": 0, "exptrk-dev-bff-session": 0 })).not.toThrow();
  });

  // Mutação: usar `.some(...)` em vez de reportar TODAS as entradas não-zero faria este teste
  // (que verifica as duas contagens residuais na mensagem) falhar.
  it("throws listing every non-zero entry, never a generic/silent failure", () => {
    expect(() => assertAllEmpty({ "exptrk-dev-table": 3, "exptrk-dev-bff-session": 0, "exptrk-dev-upload-finalizer-dlq": 1 })).toThrow(
      /exptrk-dev-table=3.*exptrk-dev-upload-finalizer-dlq=1/,
    );
  });
});

describe("reset-dev-data: queueNames", () => {
  // Mutação: esquecer o sufixo `-dlq` para metade das filas faria este teste (24 = 12*2) falhar.
  it("returns 24 names (12 base queues + their DLQs)", () => {
    const names = queueNames();
    expect(names).toHaveLength(24);
    expect(names).toContain("exptrk-dev-upload-finalizer-dlq");
    expect(names).toContain("exptrk-dev-reminder-dispatch");
  });
});

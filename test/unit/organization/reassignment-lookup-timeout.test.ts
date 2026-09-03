import { describe, expect, it } from "vitest";
import { withReassignmentTimeoutAndLogging } from "../../../src/runtime/aws/composition/organization.js";
import { ServiceUnavailableError } from "../../../src/shared/errors/app-error.js";
import { SecureLogger, type LogLevel } from "../../../src/shared/observability/logger.js";

/**
 * D-194 Fatia 2 - proves the composition-root's fail-CLOSED timeout wrapper around
 * `AssignedActiveItemsLookup`/`AssignedActiveRequirementsLookup`: a lookup that does not resolve
 * within the fixed budget must throw `ServiceUnavailableError` (retryable), never resolve with an
 * optimistic "nothing found" - and every outcome (ALLOWED/BLOCKED/TIMEOUT/ERROR) is logged via a
 * SecureLogger event of its own, never `security-audit.ts`.
 */
function capturingLogger(): { logger: SecureLogger; lines: Array<{ level: LogLevel; event: string; [key: string]: unknown }> } {
  const lines: Array<{ level: LogLevel; event: string; [key: string]: unknown }> = [];
  const logger = new SecureLogger({ sink: (level, line) => lines.push({ level, ...JSON.parse(line) }) });
  return { logger, lines };
}

describe("withReassignmentTimeoutAndLogging", () => {
  // Mutação: trocar `Promise.race` por só `await fn(...)` (sem o timeout) faria isto nunca
  // rejeitar - uma Query genuinamente travada bloquearia a remoção do membro indefinidamente em
  // vez de falhar fechado depois de 5s.
  it("throws ServiceUnavailableError (retryable) when the lookup exceeds the timeout budget", async () => {
    const { logger, lines } = capturingLogger();
    const neverResolves = () => new Promise<never>(() => {});
    const wrapped = withReassignmentTimeoutAndLogging(neverResolves, { entity: "Requirement", timeoutMs: 20, logger });

    const err = await wrapped("org-1", "user-1").catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableError);
    expect(err.retryable).toBe(true);
    const timeoutLine = lines.find((l) => l.event === "membership.reassignment_lookup.TIMEOUT");
    expect(timeoutLine).toBeDefined();
    expect(timeoutLine?.["level"]).toBe("error");
    expect(typeof timeoutLine?.["durationMs"]).toBe("number");
  });

  // Mutação: inverter a checagem de log (ALLOWED quando há itens, BLOCKED quando não há) faria os
  // eventos operacionais mentirem sobre o resultado real do lookup.
  it("logs BLOCKED with itemsEvaluated/pagesEvaluated/consumedCapacityUnits when matches are found", async () => {
    const { logger, lines } = capturingLogger();
    const fn = async (_org: string, _user: string, stats?: { pagesEvaluated: number; consumedCapacityUnits: number }) => {
      if (stats) {
        stats.pagesEvaluated = 2;
        stats.consumedCapacityUnits = 1.5;
      }
      return { itemIds: ["item-1"], totalKnown: 1, truncated: false };
    };
    const wrapped = withReassignmentTimeoutAndLogging(fn, { entity: "ExpirationItem", timeoutMs: 5000, logger });

    const result = await wrapped("org-1", "user-1");
    expect(result.totalKnown).toBe(1);
    const line = lines.find((l) => l.event === "membership.reassignment_lookup.BLOCKED");
    expect(line).toMatchObject({ level: "info", entity: "ExpirationItem", itemsEvaluated: 1, pagesEvaluated: 2, consumedCapacityUnits: 1.5 });
  });

  it("logs ALLOWED when the lookup finds nothing", async () => {
    const { logger, lines } = capturingLogger();
    const fn = async () => ({ requirementIds: [], totalKnownRequirements: 0, truncatedRequirements: false });
    const wrapped = withReassignmentTimeoutAndLogging(fn, { entity: "Requirement", timeoutMs: 5000, logger });

    await wrapped("org-1", "user-1");
    const line = lines.find((l) => l.event === "membership.reassignment_lookup.ALLOWED");
    expect(line).toMatchObject({ level: "info", entity: "Requirement", itemsEvaluated: 0 });
  });

  // Mutação: engolir o erro real (nunca relançar) faria a remoção prosseguir mesmo com o lookup
  // genuinamente falhando (não só atrasando) - fail-closed exige propagar, nunca mascarar.
  it("logs ERROR and rethrows when the underlying lookup itself rejects (not a timeout)", async () => {
    const { logger, lines } = capturingLogger();
    const boom = new Error("DynamoDB internal error");
    const fn = async () => {
      throw boom;
    };
    const wrapped = withReassignmentTimeoutAndLogging(fn, { entity: "ExpirationItem", timeoutMs: 5000, logger });

    const err = await wrapped("org-1", "user-1").catch((e) => e);
    expect(err).toBe(boom);
    const line = lines.find((l) => l.event === "membership.reassignment_lookup.ERROR");
    expect(line).toMatchObject({ level: "error", entity: "ExpirationItem", error: "DynamoDB internal error" });
  });
});

/**
 * D-147 (D-143 Decision 8, Nucleus 2 entity 3/3): DocumentRequestSeries/materializeAttempt.
 * Covers occurrenceId determinism, materializeAttempt's transactional atomicity, RBAC denial,
 * and the full create -> materialize x2 -> advanceCycle -> materialize integration flow.
 */
import { describe, expect, it } from "vitest";
import { InMemoryDocumentArchiveStore } from "./in-memory-store.js";
import { DocumentRequestRecurrenceService } from "../../../src/modules/document-archive/application/document-request-recurrence-service.js";
import { computeSeriesOccurrenceId } from "../../../src/modules/document-archive/domain/document-request-series.js";
import { AuthorizationDeniedError } from "../../../src/modules/identity/domain/authorization.js";
import type { DocumentArchiveIdGenerator } from "../../../src/modules/document-archive/application/id-generator.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    principal: { userId: "user-1", cognitoSubject: "sub-1", sessionId: "session-1" },
    tenant: { tenantId: "tenant-1", roles: ["MEMBER"] },
    requestId: "req-1",
    correlationId: "corr-1",
    ...overrides,
  } as RequestContext;
}

function makeIds(): DocumentArchiveIdGenerator {
  let n = 0;
  return {
    newDocumentId: () => `doc-${++n}`,
    newVersionId: () => `ver-${++n}`,
    newEventId: () => `evt-${++n}`,
    newRequirementId: () => `req-${++n}`,
    newSeriesId: () => `series-${++n}`,
    newDocumentRequestId: () => `docreq-${++n}`,
  };
}

function makeService(now = "2026-09-01T00:00:00.000Z") {
  const store = new InMemoryDocumentArchiveStore();
  const service = new DocumentRequestRecurrenceService({ store, tableName: "MainTable", ids: makeIds(), now: () => now });
  return { store, service };
}

describe("computeSeriesOccurrenceId — determinism", () => {
  it("same seriesId + same cycleStartAt always yields the same occurrenceId", () => {
    const a = computeSeriesOccurrenceId("series-1", "2026-09-01T00:00:00.000Z");
    const b = computeSeriesOccurrenceId("series-1", "2026-09-01T00:00:00.000Z");
    expect(a).toBe(b);
  });

  it("a different cycleStartAt (a different cycle) yields a different occurrenceId", () => {
    const a = computeSeriesOccurrenceId("series-1", "2026-09-01T00:00:00.000Z");
    const b = computeSeriesOccurrenceId("series-1", "2026-12-01T00:00:00.000Z");
    expect(a).not.toBe(b);
  });

  it("a different seriesId with the same cycleStartAt yields a different occurrenceId", () => {
    const a = computeSeriesOccurrenceId("series-1", "2026-09-01T00:00:00.000Z");
    const b = computeSeriesOccurrenceId("series-2", "2026-09-01T00:00:00.000Z");
    expect(a).not.toBe(b);
  });
});

describe("DocumentRequestRecurrenceService.createSeries", () => {
  it("creates an ACTIVE series with latestAttemptIndex=0 and no latestRequestId", async () => {
    const { service } = makeService();
    const series = await service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "req-1", cadence: { intervalDays: 90 } });
    expect(series.status).toBe("ACTIVE");
    expect(series.latestAttemptIndex).toBe(0);
    expect(series.latestRequestId).toBeUndefined();
    expect(series.currentCycleStartAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("denies a VIEWER (read-only role)", async () => {
    const { service } = makeService();
    await expect(service.createSeries(ctx({ tenant: { tenantId: "tenant-1", roles: ["VIEWER"] } }), { subjectId: "s", requirementId: "r", cadence: { intervalDays: 1 } })).rejects.toBeInstanceOf(
      AuthorizationDeniedError,
    );
  });
});

describe("DocumentRequestRecurrenceService.materializeAttempt — transactional atomicity", () => {
  it("advances latestAttemptIndex AND creates the DocumentRequest together (same transaction)", async () => {
    const { service, store } = makeService();
    const series = await service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "req-1", cadence: { intervalDays: 90 } });
    const result = await service.materializeAttempt(ctx(), "subject-1", series.seriesId, series.version);

    expect(result.request.attemptIndex).toBe(1);
    expect(result.request.parentRequestId).toBeUndefined();
    expect(result.request.seriesId).toBe(series.seriesId);
    expect(result.series.latestAttemptIndex).toBe(1);
    expect(result.series.latestRequestId).toBe(result.request.documentRequestId);

    // Both writes landed — read the series and the request back independently.
    const all = store.allItems();
    const persistedSeries = all.find((i) => i["entityType"] === "DocumentRequestSeries") as unknown as { latestAttemptIndex: number; latestRequestId: string };
    const persistedRequest = all.find((i) => i["entityType"] === "DocumentRequest") as unknown as { attemptIndex: number; documentRequestId: string };
    expect(persistedSeries.latestAttemptIndex).toBe(1);
    expect(persistedSeries.latestRequestId).toBe(persistedRequest.documentRequestId);
  });

  it("MUTATION CHECK: if the series Update and the DocumentRequest Put were not in the same transaction, a rejected Update would still leave the Put un-guarded — verified by asserting transactWrite receives exactly 2 entries for one call", async () => {
    const { service, store } = makeService();
    const series = await service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "req-1", cadence: { intervalDays: 90 } });
    let capturedEntryCount = -1;
    const originalTransactWrite = store.transactWrite.bind(store);
    store.transactWrite = async (entries) => {
      capturedEntryCount = entries.length;
      return originalTransactWrite(entries);
    };
    await service.materializeAttempt(ctx(), "subject-1", series.seriesId, series.version);
    expect(capturedEntryCount).toBe(2);
  });

  it("rejects a stale expectedVersion (OCC) without partially applying either write", async () => {
    const { service, store } = makeService();
    const series = await service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "req-1", cadence: { intervalDays: 90 } });
    await expect(service.materializeAttempt(ctx(), "subject-1", series.seriesId, series.version + 1)).rejects.toThrow();
    const all = store.allItems();
    expect(all.some((i) => i["entityType"] === "DocumentRequest")).toBe(false);
  });

  it("denies a VIEWER", async () => {
    const { service } = makeService();
    const series = await service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "req-1", cadence: { intervalDays: 90 } });
    await expect(
      service.materializeAttempt(ctx({ tenant: { tenantId: "tenant-1", roles: ["VIEWER"] } }), "subject-1", series.seriesId, series.version),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });
});

describe("DocumentRequestRecurrenceService — full cycle integration flow", () => {
  it("create -> materialize attempt 1 -> materialize attempt 2 -> advanceCycle -> materialize attempt 1 of the NEW cycle", async () => {
    const { service } = makeService();
    let series = await service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "req-1", cadence: { intervalDays: 90 } });
    const cycle1StartAt = series.currentCycleStartAt;
    const expectedOccurrenceCycle1 = computeSeriesOccurrenceId(series.seriesId, cycle1StartAt);

    const attempt1 = await service.materializeAttempt(ctx(), "subject-1", series.seriesId, series.version);
    expect(attempt1.request.attemptIndex).toBe(1);
    expect(attempt1.request.parentRequestId).toBeUndefined();
    expect(attempt1.request.occurrenceId).toBe(expectedOccurrenceCycle1);

    series = attempt1.series;
    const attempt2 = await service.materializeAttempt(ctx(), "subject-1", series.seriesId, series.version);
    expect(attempt2.request.attemptIndex).toBe(2);
    // parentRequestId always points to the immediately-previous attempt of the SAME cycle.
    expect(attempt2.request.parentRequestId).toBe(attempt1.request.documentRequestId);
    // occurrenceId stays stable within the same cycle across attempts.
    expect(attempt2.request.occurrenceId).toBe(expectedOccurrenceCycle1);

    series = attempt2.series;
    const advanced = await service.advanceCycle(ctx(), "subject-1", series.seriesId, series.version);
    expect(advanced.latestAttemptIndex).toBe(0);
    expect(advanced.latestRequestId).toBeUndefined();
    expect(advanced.currentCycleStartAt).not.toBe(cycle1StartAt);

    const attempt3 = await service.materializeAttempt(ctx(), "subject-1", advanced.seriesId, advanced.version);
    expect(attempt3.request.attemptIndex).toBe(1);
    // No parentRequestId — attempt 1 of a NEW cycle never chains back to the previous cycle's
    // last attempt (Decision 8: parentRequestId is always same-cycle only).
    expect(attempt3.request.parentRequestId).toBeUndefined();
    // occurrenceId changed across cycles.
    expect(attempt3.request.occurrenceId).not.toBe(expectedOccurrenceCycle1);
    expect(attempt3.request.occurrenceId).toBe(computeSeriesOccurrenceId(advanced.seriesId, advanced.currentCycleStartAt));
  });
});

describe("DocumentRequestRecurrenceService.cancelSeries", () => {
  it("flips status to CANCELLED", async () => {
    const { service } = makeService();
    const series = await service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "req-1", cadence: { intervalDays: 90 } });
    const cancelled = await service.cancelSeries(ctx(), "subject-1", series.seriesId, series.version);
    expect(cancelled.status).toBe("CANCELLED");
  });
});

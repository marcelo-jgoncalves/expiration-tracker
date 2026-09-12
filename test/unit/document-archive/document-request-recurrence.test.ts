/**
 * D-147 (D-143 Decision 8, Nucleus 2 entity 3/3): DocumentRequestSeries/materializeAttempt.
 * Covers occurrenceId determinism, materializeAttempt's transactional atomicity, RBAC denial,
 * and the full create -> materialize x2 -> advanceCycle -> materialize integration flow.
 */
import { describe, expect, it } from "vitest";
import { InMemoryDocumentArchiveStore, seedActiveRequirement, seedActiveTenantLifecycle, seedActiveTrackedSubject } from "./in-memory-store.js";
import { DocumentRequestRecurrenceService } from "../../../src/modules/document-archive/application/document-request-recurrence-service.js";
import { computeSeriesOccurrenceId } from "../../../src/modules/document-archive/domain/document-request-series.js";
import { AuthorizationDeniedError } from "../../../src/modules/identity/domain/authorization.js";
import { ConflictError } from "../../../src/shared/errors/app-error.js";
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
    newFileId: () => `file-${++n}`,
    newDocumentTypeId: () => `doctype-${++n}`,
  newRequirementTemplateId: () => "reqtpl_test",
  newRequirementTemplateItemId: () => `reqtplitem_${crypto.randomUUID()}`,
  newDossierExportRunId: () => `dossier_${crypto.randomUUID()}`,
  newDocumentTypeFieldId: () => `doctypefield_${crypto.randomUUID()}`,
  newDocumentTypeFieldOptionId: () => `doctypefieldopt_${crypto.randomUUID()}`,
    newShareId: () => `share_${crypto.randomUUID()}`,
  };
}

/** P0.3 (external audit 2026-09-11): `createSeries()` now fences on TenantLifecycleRecord/
 * TrackedSubject/Requirement all existing — seeded here for the default "tenant-1"/"subject-1"/
 * "req-1" combination every test in this file (except the RBAC-denial test, which never reaches
 * the fence) uses. */
function makeService(now = "2026-09-01T00:00:00.000Z") {
  const store = new InMemoryDocumentArchiveStore([
    seedActiveTenantLifecycle("tenant-1"),
    seedActiveTrackedSubject("tenant-1", "subject-1"),
    seedActiveRequirement("tenant-1", "subject-1", "req-1"),
  ]);
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

  // P0.3 (external audit 2026-09-11): createSeries fences existence/status of Subject and
  // Requirement, and enforces at most one ACTIVE series per Requirement, all in one transaction.
  describe("P0.3 fences: existence/status/uniqueness", () => {
    it("rejects creating a series for a Subject that doesn't exist", async () => {
      const { store } = makeService();
      const service = new DocumentRequestRecurrenceService({ store, tableName: "MainTable", ids: makeIds(), now: () => "2026-09-01T00:00:00.000Z" });
      await expect(service.createSeries(ctx(), { subjectId: "no-such-subject", requirementId: "req-1", cadence: { intervalDays: 90 } })).rejects.toThrow(ConflictError);
    });

    it("rejects creating a series for a Requirement that doesn't exist", async () => {
      const { service } = makeService();
      await expect(service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "no-such-requirement", cadence: { intervalDays: 90 } })).rejects.toThrow(ConflictError);
    });

    it("rejects creating a series for a Requirement that exists but belongs to a DIFFERENT Subject", async () => {
      const { store, service } = makeService();
      await store.putIfAbsent(seedActiveTrackedSubject("tenant-1", "subject-2"));
      // "req-1" only exists under subject-1's partition (seeded by makeService) - claiming it
      // belongs to subject-2 must fail, never silently succeed against the wrong partition.
      await expect(service.createSeries(ctx(), { subjectId: "subject-2", requirementId: "req-1", cadence: { intervalDays: 90 } })).rejects.toThrow(ConflictError);
    });

    it("rejects a second ACTIVE series for a Requirement that already has one", async () => {
      const { service } = makeService();
      await service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "req-1", cadence: { intervalDays: 90 } });
      await expect(service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "req-1", cadence: { intervalDays: 30 } })).rejects.toThrow(ConflictError);
    });

    it("allows a new ACTIVE series for the same Requirement after the first one is cancelled", async () => {
      const { service } = makeService();
      const first = await service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "req-1", cadence: { intervalDays: 90 } });
      await service.cancelSeries(ctx(), "subject-1", first.seriesId, first.version);
      const second = await service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "req-1", cadence: { intervalDays: 30 } });
      expect(second.status).toBe("ACTIVE");
      expect(second.seriesId).not.toBe(first.seriesId);
    });

    it("rejects cancelling an already-cancelled series", async () => {
      const { service } = makeService();
      const series = await service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "req-1", cadence: { intervalDays: 90 } });
      const cancelled = await service.cancelSeries(ctx(), "subject-1", series.seriesId, series.version);
      await expect(service.cancelSeries(ctx(), "subject-1", series.seriesId, cancelled.version)).rejects.toThrow(ConflictError);
    });
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

  it("MUTATION CHECK: if the series Update, the DocumentRequest Put, and the D-226 issuance outbox Put were not in the same transaction, a rejected Update would still leave the others un-guarded — verified by asserting transactWrite receives exactly 3 entries for one call", async () => {
    const { service, store } = makeService();
    const series = await service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "req-1", cadence: { intervalDays: 90 } });
    let capturedEntryCount = -1;
    const originalTransactWrite = store.transactWrite.bind(store);
    store.transactWrite = async (entries) => {
      capturedEntryCount = entries.length;
      return originalTransactWrite(entries);
    };
    await service.materializeAttempt(ctx(), "subject-1", series.seriesId, series.version);
    expect(capturedEntryCount).toBe(3);
  });

  it("D-226: appends a DocumentRequestCredentialIssuanceRequested outbox entry, in the same transaction, with the minimal wake-up payload", async () => {
    const { service, store } = makeService();
    const series = await service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "req-1", cadence: { intervalDays: 90 } });
    const result = await service.materializeAttempt(ctx(), "subject-1", series.seriesId, series.version);

    const all = store.allItems();
    const outboxRecord = all.find((i) => i["entityType"] === "OutboxEvent") as unknown as {
      eventType: string;
      destination: string;
      payload: { tenantId: string; subjectId: string; documentRequestId: string; issuanceGeneration: number };
    };
    expect(outboxRecord).toBeDefined();
    expect(outboxRecord.eventType).toBe("DocumentRequestCredentialIssuanceRequested");
    expect(outboxRecord.destination).toBe("SQS_DOCUMENT_REQUEST_CREDENTIAL_ISSUANCE_V1");
    expect(outboxRecord.payload).toEqual({
      tenantId: "tenant-1",
      subjectId: "subject-1",
      documentRequestId: result.request.documentRequestId,
      issuanceGeneration: 1,
    });
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

// D-230 — closes D-228's named pendency: the recurrence path had no recipient contact modeled.
describe("DocumentRequestRecurrenceService.createSeries — recipientEmail (D-230)", () => {
  it("persists a trimmed recipientEmail when provided", async () => {
    const { service } = makeService();
    const series = await service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "req-1", cadence: { intervalDays: 90 }, recipientEmail: "  guest@example.com  " });
    expect(series.recipientEmail).toBe("guest@example.com");
  });

  it("leaves recipientEmail absent when omitted — unchanged pre-D-230 behavior", async () => {
    const { service } = makeService();
    const series = await service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "req-1", cadence: { intervalDays: 90 } });
    expect(series.recipientEmail).toBeUndefined();
  });
});

describe("DocumentRequestRecurrenceService.materializeAttempt — copies series.recipientEmail (D-230)", () => {
  it("a series WITH recipientEmail produces a DocumentRequest carrying the same recipientEmail", async () => {
    const { service } = makeService();
    const series = await service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "req-1", cadence: { intervalDays: 90 }, recipientEmail: "guest@example.com" });
    const result = await service.materializeAttempt(ctx(), "subject-1", series.seriesId, series.version);
    expect(result.request.recipientEmail).toBe("guest@example.com");
  });

  it("a series WITHOUT recipientEmail produces a DocumentRequest with no recipientEmail — non-regression (delivery worker's terminal skip)", async () => {
    const { service } = makeService();
    const series = await service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "req-1", cadence: { intervalDays: 90 } });
    const result = await service.materializeAttempt(ctx(), "subject-1", series.seriesId, series.version);
    expect(result.request.recipientEmail).toBeUndefined();
  });

  it("a snapshot: changing the series' recipientEmail AFTER a request was materialized does not retroactively change that request", async () => {
    const { service } = makeService();
    let series = await service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "req-1", cadence: { intervalDays: 90 }, recipientEmail: "old@example.com" });
    const attempt1 = await service.materializeAttempt(ctx(), "subject-1", series.seriesId, series.version);
    expect(attempt1.request.recipientEmail).toBe("old@example.com");

    series = await service.updateSeriesRecipient(ctx(), "subject-1", series.seriesId, attempt1.series.version, "new@example.com");
    expect(attempt1.request.recipientEmail).toBe("old@example.com"); // unchanged snapshot

    const attempt2 = await service.materializeAttempt(ctx(), "subject-1", series.seriesId, series.version);
    expect(attempt2.request.recipientEmail).toBe("new@example.com"); // next cycle uses the new value
  });
});

describe("DocumentRequestRecurrenceService.updateSeriesRecipient (D-230)", () => {
  it("sets a recipientEmail on a series created without one", async () => {
    const { service } = makeService();
    const series = await service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "req-1", cadence: { intervalDays: 90 } });
    const updated = await service.updateSeriesRecipient(ctx(), "subject-1", series.seriesId, series.version, "guest@example.com");
    expect(updated.recipientEmail).toBe("guest@example.com");
  });

  it("trims the recipientEmail on update", async () => {
    const { service } = makeService();
    const series = await service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "req-1", cadence: { intervalDays: 90 } });
    const updated = await service.updateSeriesRecipient(ctx(), "subject-1", series.seriesId, series.version, "  guest@example.com  ");
    expect(updated.recipientEmail).toBe("guest@example.com");
  });

  it("removes recipientEmail (never persists null) when passed null", async () => {
    const { service, store } = makeService();
    const series = await service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "req-1", cadence: { intervalDays: 90 }, recipientEmail: "guest@example.com" });
    const updated = await service.updateSeriesRecipient(ctx(), "subject-1", series.seriesId, series.version, null);
    expect(updated.recipientEmail).toBeUndefined();
    const persisted = store.allItems().find((i) => i["entityType"] === "DocumentRequestSeries") as unknown as { recipientEmail?: unknown };
    expect("recipientEmail" in persisted).toBe(false);
    expect(persisted.recipientEmail).not.toBeNull();
  });

  it("rejects a stale expectedVersion (OCC)", async () => {
    const { service } = makeService();
    const series = await service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "req-1", cadence: { intervalDays: 90 } });
    await expect(service.updateSeriesRecipient(ctx(), "subject-1", series.seriesId, series.version + 1, "guest@example.com")).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects updating a CANCELLED series", async () => {
    const { service } = makeService();
    const series = await service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "req-1", cadence: { intervalDays: 90 } });
    const cancelled = await service.cancelSeries(ctx(), "subject-1", series.seriesId, series.version);
    await expect(service.updateSeriesRecipient(ctx(), "subject-1", cancelled.seriesId, cancelled.version, "guest@example.com")).rejects.toBeInstanceOf(ConflictError);
  });

  it("denies a VIEWER", async () => {
    const { service } = makeService();
    const series = await service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "req-1", cadence: { intervalDays: 90 } });
    await expect(
      service.updateSeriesRecipient(ctx({ tenant: { tenantId: "tenant-1", roles: ["VIEWER"] } }), "subject-1", series.seriesId, series.version, "guest@example.com"),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });
});

describe("DocumentRequestRecurrenceService.getSeries/listSeries — expose recipientEmail (D-230)", () => {
  it("getSeries returns the recipientEmail when present", async () => {
    const { service } = makeService();
    const created = await service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "req-1", cadence: { intervalDays: 90 }, recipientEmail: "guest@example.com" });
    const fetched = await service.getSeries(ctx(), "subject-1", created.seriesId);
    expect(fetched.recipientEmail).toBe("guest@example.com");
  });

  it("listSeries returns the recipientEmail when present", async () => {
    const { service } = makeService();
    await service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "req-1", cadence: { intervalDays: 90 }, recipientEmail: "guest@example.com" });
    const list = await service.listSeries(ctx(), "subject-1");
    expect(list[0]?.recipientEmail).toBe("guest@example.com");
  });
});

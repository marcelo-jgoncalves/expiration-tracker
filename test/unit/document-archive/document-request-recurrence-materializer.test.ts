/** D-147: the periodic "what's due" materializer worker (`scanActiveSeries` -> materialize
 * attempt 1 of any due, not-yet-attempted cycle). */
import { describe, expect, it } from "vitest";
import { InMemoryDocumentArchiveStore } from "./in-memory-store.js";
import { DocumentRequestRecurrenceService } from "../../../src/modules/document-archive/application/document-request-recurrence-service.js";
import { runDocumentRequestRecurrenceMaterializer } from "../../../src/workers/document-request-recurrence/materializer.js";
import type { DocumentArchiveIdGenerator } from "../../../src/modules/document-archive/application/id-generator.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";

function ctx(): RequestContext {
  return {
    principal: { userId: "user-1", cognitoSubject: "sub-1", sessionId: "session-1" },
    tenant: { tenantId: "tenant-1", roles: ["MEMBER"] },
    requestId: "req-1",
    correlationId: "corr-1",
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

describe("runDocumentRequestRecurrenceMaterializer", () => {
  it("materializes attempt 1 for a due series with no attempt yet, skips a not-yet-due series", async () => {
    const store = new InMemoryDocumentArchiveStore();
    const service = new DocumentRequestRecurrenceService({ store, tableName: "MainTable", ids: makeIds(), now: () => "2026-09-01T00:00:00.000Z" });

    const dueSeries = await service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "req-1", cadence: { intervalDays: 90 }, firstDueAt: "2026-08-31T00:00:00.000Z" });
    const futureSeries = await service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "req-2", cadence: { intervalDays: 90 }, firstDueAt: "2026-12-01T00:00:00.000Z" });

    const result = await runDocumentRequestRecurrenceMaterializer({ store, tableName: "MainTable", ids: makeIds(), now: () => "2026-09-01T00:00:00.000Z" });

    expect(result.materialized).toBe(1);
    expect(result.skippedNotYetDue).toBe(1);

    const all = store.allItems();
    const requests = all.filter((i) => i["entityType"] === "DocumentRequest") as unknown as { seriesId: string; attemptIndex: number }[];
    expect(requests).toHaveLength(1);
    expect(requests[0]?.seriesId).toBe(dueSeries.seriesId);
    expect(requests[0]?.attemptIndex).toBe(1);
    expect(all.some((i) => i["entityType"] === "DocumentRequestSeries" && i["seriesId"] === futureSeries.seriesId && (i as unknown as { latestAttemptIndex: number }).latestAttemptIndex === 0)).toBe(true);
  });

  it("skips a due series that already has an attempt for its current cycle (never auto-retries)", async () => {
    const store = new InMemoryDocumentArchiveStore();
    const service = new DocumentRequestRecurrenceService({ store, tableName: "MainTable", ids: makeIds(), now: () => "2026-09-01T00:00:00.000Z" });
    const series = await service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "req-1", cadence: { intervalDays: 90 } });
    await service.materializeAttempt(ctx(), "subject-1", series.seriesId, series.version);

    const result = await runDocumentRequestRecurrenceMaterializer({ store, tableName: "MainTable", ids: makeIds(), now: () => "2026-09-01T00:00:00.000Z" });
    expect(result.materialized).toBe(0);
    expect(result.skippedAlreadyAttempted).toBe(1);
  });

  it("is idempotent against a duplicate run for the same due cycle (second run materializes nothing new)", async () => {
    const store = new InMemoryDocumentArchiveStore();
    const service = new DocumentRequestRecurrenceService({ store, tableName: "MainTable", ids: makeIds(), now: () => "2026-09-01T00:00:00.000Z" });
    await service.createSeries(ctx(), { subjectId: "subject-1", requirementId: "req-1", cadence: { intervalDays: 90 } });

    const first = await runDocumentRequestRecurrenceMaterializer({ store, tableName: "MainTable", ids: makeIds(), now: () => "2026-09-01T00:00:00.000Z" });
    expect(first.materialized).toBe(1);

    const second = await runDocumentRequestRecurrenceMaterializer({ store, tableName: "MainTable", ids: makeIds(), now: () => "2026-09-01T00:00:00.000Z" });
    expect(second.materialized).toBe(0);
    expect(second.skippedAlreadyAttempted).toBe(1);

    const requests = store.allItems().filter((i) => i["entityType"] === "DocumentRequest");
    expect(requests).toHaveLength(1);
  });
});

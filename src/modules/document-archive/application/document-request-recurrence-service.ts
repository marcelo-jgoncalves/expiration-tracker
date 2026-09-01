/**
 * DocumentRequestRecurrenceService — D-143 Decision 8 (D-147), Nucleus 2 entity 3/3 (final
 * piece). Tenant-facing CRUD over `DocumentRequestSeries` plus `materializeAttempt`, the
 * transactional operation that advances a cycle's `latestAttemptIndex` pointer AND creates the
 * new `DocumentRequest` in the SAME `TransactWriteItems` — Decision 8 explicitly calls out that
 * doing these as two separate calls was a real gap found in Rodada 4 of the original design
 * protocol (partial-failure window: a crash between the two writes would leave the pointer
 * advanced with no corresponding request, or a request created that the pointer never counts).
 *
 * `buildMaterializeAttemptEntries` is exported separately (pure, no authorize/I/O beyond what
 * the caller already read) so `document-request-recurrence-producer.ts`'s periodic materializer
 * worker can reuse the EXACT same transaction shape without going through an authenticated
 * `RequestContext` — same split as `requirement-reindex/reindex.ts`, which also builds/executes
 * `buildVersionedUpdate` directly against the store rather than round-tripping through
 * `DocumentArchiveService`'s authorize-gated methods.
 */
import { buildVersionedCreate, buildVersionedUpdate, isTransactionCanceled, type EntityKey, type TransactWriteEntry } from "../../../shared/dynamodb/occ.js";
import { ConflictError, NotFoundError } from "../../../shared/errors/app-error.js";
import { authorize } from "../../identity/domain/authorization.js";
import type { RequestContext } from "../../identity/domain/request-context.js";
import type { DocumentArchiveStore } from "../ports/document-archive-store.js";
import type { DocumentArchiveIdGenerator } from "./id-generator.js";
import { documentRequestKey, type DocumentRequest } from "../domain/document-request.js";
import {
  computeSeriesOccurrenceId,
  documentRequestSeriesGsi1Keys,
  documentRequestSeriesKey,
  DOCUMENT_REQUEST_SERIES_SK_PREFIX,
  type CreateDocumentRequestSeriesInput,
  type DocumentRequestSeries,
} from "../domain/document-request-series.js";

export interface DocumentRequestRecurrenceServiceDeps {
  store: DocumentArchiveStore;
  tableName: string;
  ids: DocumentArchiveIdGenerator;
  now?: () => string;
}

export interface MaterializeAttemptResult {
  series: DocumentRequestSeries;
  request: DocumentRequest;
}

/**
 * Pure builder — computes the deterministic `occurrenceId`/`attemptIndex`/`parentRequestId` for
 * the NEXT attempt of `series`' current cycle and returns the two `TransactWriteEntry`s that
 * must commit together (Decision 8's partial-failure fix). Never touches the store itself;
 * callers execute the returned entries via `store.transactWrite`.
 */
export function buildMaterializeAttemptEntries(input: {
  tableName: string;
  series: DocumentRequestSeries;
  newRequestId: string;
  now: string;
}): { entries: TransactWriteEntry[]; request: DocumentRequest } {
  const { tableName, series, newRequestId, now } = input;
  const occurrenceId = computeSeriesOccurrenceId(series.seriesId, series.currentCycleStartAt);
  const attemptIndex = series.latestAttemptIndex + 1;
  const parentRequestId = series.latestRequestId;

  const request: DocumentRequest = {
    ...documentRequestKey(series.tenantId, series.subjectId, newRequestId),
    entityType: "DocumentRequest",
    documentRequestId: newRequestId,
    tenantId: series.tenantId,
    subjectId: series.subjectId,
    requirementId: series.requirementId,
    status: "REQUESTED",
    seriesId: series.seriesId,
    occurrenceId,
    attemptIndex,
    ...(parentRequestId !== undefined ? { parentRequestId } : {}),
    submissionCount: 0,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  const entries: TransactWriteEntry[] = [
    // 1. Advance the cycle's pointer — conditioned on the series still being at the exact
    // version the caller read (OCC), which is also what makes a duplicate scheduler tick safe:
    // a second concurrent attempt to materialize the SAME due cycle observes the same
    // pre-advance version, loses the race, and its transaction is rejected rather than
    // double-materializing.
    {
      Update: buildVersionedUpdate({
        tableName,
        key: documentRequestSeriesKey(series.tenantId, series.subjectId, series.seriesId),
        tenantId: series.tenantId,
        expectedVersion: series.version,
        set: { latestAttemptIndex: attemptIndex, latestRequestId: newRequestId },
        now,
      }),
    },
    // 2. Create the new DocumentRequest attempt — same transaction, never a separate call.
    { Put: buildVersionedCreate(tableName, request as unknown as Record<string, unknown> & EntityKey) },
  ];

  return { entries, request };
}

export class DocumentRequestRecurrenceService {
  private readonly store: DocumentArchiveStore;
  private readonly tableName: string;
  private readonly ids: DocumentArchiveIdGenerator;
  private readonly now: () => string;

  constructor(deps: DocumentRequestRecurrenceServiceDeps) {
    this.store = deps.store;
    this.tableName = deps.tableName;
    this.ids = deps.ids;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async createSeries(ctx: RequestContext, input: CreateDocumentRequestSeriesInput): Promise<DocumentRequestSeries> {
    authorize({ context: ctx, action: "docarchive:series-create", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    const seriesId = this.ids.newSeriesId();
    const now = this.now();
    const cycleStartAt = input.firstDueAt ?? now;
    const series: DocumentRequestSeries = {
      ...documentRequestSeriesKey(tenantId, input.subjectId, seriesId),
      entityType: "DocumentRequestSeries",
      seriesId,
      tenantId,
      subjectId: input.subjectId,
      requirementId: input.requirementId,
      cadence: input.cadence,
      status: "ACTIVE",
      currentCycleStartAt: cycleStartAt,
      nextDueAt: cycleStartAt,
      latestAttemptIndex: 0,
      createdAt: now,
      updatedAt: now,
      version: 1,
      ...documentRequestSeriesGsi1Keys(tenantId, "ACTIVE", cycleStartAt, seriesId),
    };
    const created = await this.store.putIfAbsent(series);
    if (!created) throw new ConflictError("DocumentRequestSeries already exists.", { seriesId });
    return series;
  }

  async getSeries(ctx: RequestContext, subjectId: string, seriesId: string): Promise<DocumentRequestSeries> {
    authorize({ context: ctx, action: "docarchive:series-read", resource: { tenantId: ctx.tenant.tenantId } });
    return this.getSeriesUnchecked(ctx.tenant.tenantId, subjectId, seriesId);
  }

  private async getSeriesUnchecked(tenantId: string, subjectId: string, seriesId: string): Promise<DocumentRequestSeries> {
    const series = await this.store.get<DocumentRequestSeries>(documentRequestSeriesKey(tenantId, subjectId, seriesId));
    if (!series) throw new NotFoundError("DocumentRequestSeries not found.", { seriesId });
    return series;
  }

  async listSeries(ctx: RequestContext, subjectId: string): Promise<DocumentRequestSeries[]> {
    authorize({ context: ctx, action: "docarchive:series-read", resource: { tenantId: ctx.tenant.tenantId } });
    return this.store.queryByPk<DocumentRequestSeries>(`TENANT#${ctx.tenant.tenantId}#SUBJECT#${subjectId}`, DOCUMENT_REQUEST_SERIES_SK_PREFIX);
  }

  async cancelSeries(ctx: RequestContext, subjectId: string, seriesId: string, expectedVersion: number): Promise<DocumentRequestSeries> {
    authorize({ context: ctx, action: "docarchive:series-cancel", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    const current = await this.getSeriesUnchecked(tenantId, subjectId, seriesId);
    const now = this.now();
    const set = { status: "CANCELLED" as const, ...documentRequestSeriesGsi1Keys(tenantId, "CANCELLED", current.nextDueAt, seriesId) };
    const update = buildVersionedUpdate({
      tableName: this.tableName,
      key: documentRequestSeriesKey(tenantId, subjectId, seriesId),
      tenantId,
      expectedVersion,
      set,
      now,
    });
    try {
      await this.store.transactWrite([{ Update: update }]);
    } catch (err) {
      if (isTransactionCanceled(err)) throw new ConflictError("DocumentRequestSeries was concurrently modified.", { seriesId });
      throw err;
    }
    return { ...current, ...set, version: expectedVersion + 1, updatedAt: now };
  }

  /** Interactive/manual-trigger entry point (authorize-gated). The periodic materializer worker
   * calls `buildMaterializeAttemptEntries` directly against the store instead (see module doc
   * comment) — this method is for a tenant caller explicitly asking to materialize the next
   * attempt right now (e.g. "resend" in the product UI), not the scheduled path. */
  async materializeAttempt(ctx: RequestContext, subjectId: string, seriesId: string, expectedVersion: number): Promise<MaterializeAttemptResult> {
    authorize({ context: ctx, action: "docarchive:series-materialize", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    const series = await this.getSeriesUnchecked(tenantId, subjectId, seriesId);
    if (series.version !== expectedVersion) throw new ConflictError("DocumentRequestSeries was concurrently modified.", { seriesId });
    const now = this.now();
    const newRequestId = this.ids.newDocumentRequestId();
    const { entries, request } = buildMaterializeAttemptEntries({ tableName: this.tableName, series, newRequestId, now });
    try {
      await this.store.transactWrite(entries);
    } catch (err) {
      if (isTransactionCanceled(err)) throw new ConflictError("DocumentRequestSeries was concurrently modified (or the attempt id collided).", { seriesId });
      throw err;
    }
    const nextSeries: DocumentRequestSeries = { ...series, latestAttemptIndex: request.attemptIndex as number, latestRequestId: newRequestId, version: expectedVersion + 1, updatedAt: now };
    return { series: nextSeries, request };
  }

  /** Moves the series to its next cycle: recomputes `currentCycleStartAt`/`nextDueAt` by
   * `cadence.intervalDays` and resets `latestAttemptIndex`/`latestRequestId` — the next
   * `materializeAttempt` call after this starts attempt 1 of a NEW cycle, with a fresh
   * `occurrenceId` (Decision 8: `occurrenceId` changes across cycles, stays stable within one). */
  async advanceCycle(ctx: RequestContext, subjectId: string, seriesId: string, expectedVersion: number): Promise<DocumentRequestSeries> {
    authorize({ context: ctx, action: "docarchive:series-update", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    const current = await this.getSeriesUnchecked(tenantId, subjectId, seriesId);
    const now = this.now();
    const nextCycleStartAt = new Date(new Date(current.currentCycleStartAt).getTime() + current.cadence.intervalDays * 24 * 60 * 60 * 1000).toISOString();
    const set: Record<string, unknown> = {
      currentCycleStartAt: nextCycleStartAt,
      nextDueAt: nextCycleStartAt,
      latestAttemptIndex: 0,
      ...documentRequestSeriesGsi1Keys(tenantId, current.status, nextCycleStartAt, seriesId),
    };
    const update = buildVersionedUpdate({
      tableName: this.tableName,
      key: documentRequestSeriesKey(tenantId, subjectId, seriesId),
      tenantId,
      expectedVersion,
      set,
      remove: ["latestRequestId"],
      now,
    });
    try {
      await this.store.transactWrite([{ Update: update }]);
    } catch (err) {
      if (isTransactionCanceled(err)) throw new ConflictError("DocumentRequestSeries was concurrently modified.", { seriesId });
      throw err;
    }
    const next = { ...current, ...set, version: expectedVersion + 1, updatedAt: now } as DocumentRequestSeries;
    delete next.latestRequestId;
    return next;
  }
}

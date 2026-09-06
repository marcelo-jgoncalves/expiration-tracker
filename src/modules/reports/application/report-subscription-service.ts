/**
 * ReportSubscriptionService — D-204 decision 1 (Roadmap P1 item 15), implemented D-213.
 * Create/get/list/delete for `ReportSubscription`, same pipeline as every other module's
 * tenant-fenced catalog (`DocumentArchiveService.createDocumentType`/`getDocumentType`/
 * `listDocumentTypes`): `authorize()` first, tenant-ACTIVE fence via
 * `executeTenantBusinessMutation` for every mutation, `NotFoundError` on a missing read.
 *
 * Deliberately narrow v1 surface (create/get/list/delete, no update) - a subscriber wanting to
 * change reportTypes/schedule/recipients deletes and recreates, same "don't invent surface the
 * approved design didn't ask for" discipline `bulk-actions-scoping`'s v1 (reassign+archive only)
 * already established. `nextRunAt` at creation is computed relative to `now` (the first real
 * occurrence of the chosen dayOfWeek/localTime/timeZone strictly after creation), reusing
 * `nextWeeklyOccurrenceUtc` - the SAME primitive the scheduler (D-212) uses to advance it on
 * every subsequent claim, so a freshly created subscription is immediately GSI8-discoverable by
 * the next scheduled tick without a separate "first run" special case.
 */
import { buildVersionedCreate, buildVersionedDelete } from "../../../shared/dynamodb/occ.js";
import { executeTenantBusinessMutation } from "../../../shared/tenant-lifecycle/tenant-business-mutation.js";
import { isTransactionCanceled } from "../../../shared/dynamodb/occ.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import { authorize } from "../../identity/domain/authorization.js";
import type { RequestContext } from "../../identity/domain/request-context.js";
import type { ReportSubscriptionStore } from "../ports/report-subscription-store.js";
import type { ReportSubscriptionIdGenerator } from "./id-generator.js";
import { nextWeeklyOccurrenceUtc } from "../domain/report-subscription-schedule.js";
import {
  reportSubscriptionGsi1Keys,
  reportSubscriptionGsi8Keys,
  reportSubscriptionKey,
  validateReportSubscriptionInput,
  type ReportSubscription,
  type ReportSubscriptionCadence,
  type ReportSubscriptionReportType,
} from "../domain/report-subscription.js";

export interface CreateReportSubscriptionInput {
  reportTypes: readonly ReportSubscriptionReportType[];
  dayOfWeek: number;
  localTime: string;
  timeZone: string;
  recipientUserIds: readonly string[];
}

export interface ReportSubscriptionServiceDeps {
  store: ReportSubscriptionStore;
  tableName: string;
  ids: ReportSubscriptionIdGenerator;
  now: () => string;
}

const CADENCE: ReportSubscriptionCadence = "WEEKLY";

/** ISO 8601 day-of-week convention (1=Monday..7=Sunday), same range check
 * `ReportSubscription.dayOfWeek`'s doc comment names explicitly. */
function isValidIsoDayOfWeek(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 7;
}

const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class ReportSubscriptionService {
  constructor(private readonly deps: ReportSubscriptionServiceDeps) {}

  private get store(): ReportSubscriptionStore {
    return this.deps.store;
  }

  async createSubscription(ctx: RequestContext, input: CreateReportSubscriptionInput): Promise<ReportSubscription> {
    authorize({ context: ctx, action: "reports:subscription-manage", resource: { tenantId: ctx.tenant.tenantId } });
    const validationError = validateReportSubscriptionInput({ reportTypes: input.reportTypes, recipientUserIds: input.recipientUserIds });
    if (validationError) throw new ValidationError(validationError);
    if (!isValidIsoDayOfWeek(input.dayOfWeek)) {
      throw new ValidationError("dayOfWeek must be an integer 1 (Monday) through 7 (Sunday).", { dayOfWeek: input.dayOfWeek });
    }
    if (!LOCAL_TIME_PATTERN.test(input.localTime)) {
      throw new ValidationError("localTime must be in HH:mm 24h format.", { localTime: input.localTime });
    }

    const tenantId = ctx.tenant.tenantId;
    const subscriptionId = this.deps.ids.newReportSubscriptionId();
    const now = this.deps.now();
    let nextRunAt: string;
    try {
      nextRunAt = nextWeeklyOccurrenceUtc(now, input.dayOfWeek, input.localTime, input.timeZone);
    } catch {
      throw new ValidationError("timeZone is not a recognized IANA time zone.", { timeZone: input.timeZone });
    }

    const subscription: ReportSubscription = {
      ...reportSubscriptionKey(tenantId, subscriptionId),
      entityType: "ReportSubscription",
      subscriptionId,
      tenantId,
      reportTypes: input.reportTypes,
      cadence: CADENCE,
      dayOfWeek: input.dayOfWeek,
      localTime: input.localTime,
      timeZone: input.timeZone,
      recipientUserIds: input.recipientUserIds,
      createdBy: ctx.principal.userId,
      nextRunAt,
      version: 1,
      createdAt: now,
      updatedAt: now,
      ...reportSubscriptionGsi8Keys({ dueAtIso: nextRunAt, tenantId, subscriptionId }),
      ...reportSubscriptionGsi1Keys({ tenantId, createdAt: now, subscriptionId }),
    };

    try {
      await executeTenantBusinessMutation({
        store: this.store,
        tableName: this.deps.tableName,
        tenantId,
        entries: [{ Put: buildVersionedCreate(this.deps.tableName, subscription as unknown as Record<string, unknown> & { PK: string; SK: string }) }],
      });
    } catch (err) {
      if (isTransactionCanceled(err)) throw new ConflictError("ReportSubscription already exists.", { subscriptionId });
      throw err;
    }
    return subscription;
  }

  async getSubscription(ctx: RequestContext, subscriptionId: string): Promise<ReportSubscription> {
    authorize({ context: ctx, action: "reports:subscription-manage", resource: { tenantId: ctx.tenant.tenantId } });
    return this.getSubscriptionUnchecked(ctx.tenant.tenantId, subscriptionId);
  }

  private async getSubscriptionUnchecked(tenantId: string, subscriptionId: string): Promise<ReportSubscription> {
    const subscription = await this.store.get<ReportSubscription>(reportSubscriptionKey(tenantId, subscriptionId));
    if (!subscription) throw new NotFoundError("ReportSubscription not found.", { subscriptionId });
    return subscription;
  }

  async listSubscriptions(ctx: RequestContext, exclusiveStartKey?: Record<string, unknown>): Promise<{ items: ReportSubscription[]; lastEvaluatedKey?: Record<string, unknown> }> {
    authorize({ context: ctx, action: "reports:subscription-manage", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    return this.store.queryGsi1Page<ReportSubscription>({ gsi1pk: `TENANT#${tenantId}#REPORTSUB`, exclusiveStartKey });
  }

  async deleteSubscription(ctx: RequestContext, subscriptionId: string, expectedVersion: number): Promise<void> {
    authorize({ context: ctx, action: "reports:subscription-manage", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    // Fresh existence check first - buildVersionedDelete's own ConditionExpression would also
    // catch a missing row, but this distinguishes NotFoundError (never existed / already
    // deleted) from ConflictError (exists but expectedVersion is stale) with a real read, same
    // "don't assert a cause the underlying error didn't reveal" posture RT-LANE-FALLBACK-01
    // established for the tenant-lifecycle fence lane.
    await this.getSubscriptionUnchecked(tenantId, subscriptionId);
    try {
      await executeTenantBusinessMutation({
        store: this.store,
        tableName: this.deps.tableName,
        tenantId,
        entries: [{ Delete: buildVersionedDelete({ tableName: this.deps.tableName, key: reportSubscriptionKey(tenantId, subscriptionId), tenantId, expectedVersion }) }],
      });
    } catch (err) {
      if (isTransactionCanceled(err)) throw new ConflictError("ReportSubscription was concurrently modified or already deleted.", { subscriptionId, expectedVersion });
      throw err;
    }
  }
}

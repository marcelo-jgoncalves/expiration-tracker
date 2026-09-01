/**
 * ActivityService — D-149 (Admin Activity/Audit Log view). Orchestrates 4 Query-by-PK
 * fetches (expiration/organization/subject/tenant AuditEvent partitions for one target
 * month, default current month, no cross-month pagination in v1 — decisão 2/4), delegates
 * the actual k-way merge + cursor bookkeeping to the pure functions in domain/merge.ts, and
 * normalizes each partition's differently-shaped row into one common ActivityEntry for the
 * HTTP layer to render as short prose (actor + action + object + timestamp — never raw JSON,
 * decisão 8).
 */
import { authorize } from "../../identity/domain/authorization.js";
import type { RequestContext } from "../../identity/domain/request-context.js";
import type { Actor } from "../../../shared/contracts/events.js";
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { AuditPartitionStore } from "../ports/audit-partition-store.js";
import { AUDIT_PARTITIONS, mergeAuditPage, computeHasMore, type AuditPartition, type FetchedAuditItem } from "../domain/merge.js";
import { encodeActivityCursor, decodeActivityCursor, type CompositeCursor } from "../domain/cursor.js";
import { ValidationError } from "../../../shared/errors/app-error.js";

export interface ActivityEntry {
  auditEventId: string;
  partition: AuditPartition;
  occurredAt: string;
  actor: Actor;
  action: string;
  resourceType: string;
  resourceId?: string;
  changes: Record<string, unknown>;
}

export interface ActivityPage {
  entries: ActivityEntry[];
  cursor?: string;
  hasMore: boolean;
}

export interface ListActivityQuery {
  /** yyyyMM, default: current month (server clock, decisão 2 — no cross-month pagination in v1). */
  month?: string;
  /** Optional filter applied AFTER merge (v1 has no per-partition-only Query optimization for
   * this — fetch batches are still 4-wide; filtering narrower than the fetch cost is a
   * documented v1 simplification, not a correctness issue). */
  resourceType?: string;
  limit?: number;
  cursor?: string;
}

const DEFAULT_PAGE_LIMIT = 25;
const MAX_PAGE_LIMIT = 100;

function monthShard(now: () => string, month?: string): string {
  if (month) {
    if (!/^\d{6}$/.test(month)) throw new ValidationError("month must be yyyyMM.");
    return month;
  }
  return now().slice(0, 7).replace("-", "");
}

function partitionPk(tenantId: string, partition: AuditPartition, month: string): string {
  switch (partition) {
    case "expiration":
      return `TENANT#${tenantId}#AUDIT#${month}`;
    case "organization":
      return `TENANT#${tenantId}#MEMBERSHIPAUDIT#${month}`;
    case "subject":
      return `TENANT#${tenantId}#SUBJECTAUDIT#${month}`;
    case "tenant":
      return `TENANT#${tenantId}#TENANTAUDIT#${month}`;
  }
}

interface RawAuditRow {
  auditEventId: string;
  actor: Actor;
  action: string;
  resourceType: string;
  resourceId?: string;
  itemId?: string;
  occurredAt: string;
  changes: Record<string, unknown>;
  PK: string;
  SK: string;
}

function toActivityEntry(partition: AuditPartition, raw: RawAuditRow): ActivityEntry {
  return {
    auditEventId: raw.auditEventId,
    partition,
    occurredAt: raw.occurredAt,
    actor: raw.actor,
    action: raw.action,
    resourceType: raw.resourceType,
    resourceId: raw.resourceId ?? raw.itemId,
    changes: raw.changes,
  };
}

export interface ActivityServiceDeps {
  store: AuditPartitionStore;
  now?: () => string;
}

export class ActivityService {
  private readonly store: AuditPartitionStore;
  private readonly now: () => string;

  constructor(deps: ActivityServiceDeps) {
    this.store = deps.store;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async listActivity(ctx: RequestContext, query: ListActivityQuery): Promise<ActivityPage> {
    authorize({ context: ctx, action: "activity:read", resource: { tenantId: ctx.tenant.tenantId } });

    const limit = Math.min(query.limit && query.limit > 0 ? query.limit : DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);
    const month = monthShard(this.now, query.month);
    const incomingCursor: CompositeCursor = query.cursor ? decodeActivityCursor(query.cursor) : {};

    const fetched: Record<AuditPartition, FetchedAuditItem<RawAuditRow>[]> = {
      expiration: [],
      organization: [],
      subject: [],
      tenant: [],
    };
    const partitionHasMoreBeyondBatch: Partial<Record<AuditPartition, boolean>> = {};

    await Promise.all(
      AUDIT_PARTITIONS.map(async (partition) => {
        const pk = partitionPk(ctx.tenant.tenantId, partition, month);
        const exclusiveStartKey = incomingCursor[partition];
        const page = await this.store.queryPage<RawAuditRow>({
          pk,
          ascending: false, // decisão 4/8: feed cronológico, mais recente primeiro.
          limit,
          exclusiveStartKey,
        });
        fetched[partition] = page.items.map((item) => ({
          key: { PK: item.PK, SK: item.SK } as EntityKey,
          occurredAt: item.occurredAt,
          auditEventId: item.auditEventId,
          raw: item,
        }));
        partitionHasMoreBeyondBatch[partition] = page.lastEvaluatedKey !== undefined;
      }),
    );

    const { page, consumedLast } = mergeAuditPage({ fetched, limit, ascending: false });
    const hasMore = computeHasMore(fetched, page, partitionHasMoreBeyondBatch);

    // Composite cursor forward-merge: a partition absent from `consumedLast` (contributed zero
    // items to this page) MUST keep its prior value unchanged — never advance, never drop.
    const outgoingCursor: CompositeCursor = { ...incomingCursor, ...consumedLast };

    let entries = page.map((item) => toActivityEntry(item.partition, item.raw));
    if (query.resourceType) {
      entries = entries.filter((entry) => entry.resourceType === query.resourceType);
    }

    return {
      entries,
      cursor: hasMore ? encodeActivityCursor(outgoingCursor) : undefined,
      hasMore,
    };
  }
}

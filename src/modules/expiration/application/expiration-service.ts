/**
 * ExpirationService — implementation-blueprint.md §8.1 interface, §8.3 due-date-change
 * transaction, data-model.md §5's load-bearing OCC/outbox sentence. Every mutation:
 *  1. reads the aggregate strongly consistent (never from a GSI);
 *  2. calls authorize() from the identity module (never reimplemented here);
 *  3. builds its write(s) via shared/dynamodb/occ.ts + shared/outbox/outbox.ts builders;
 *  4. commits the aggregate write + AuditEvent (+ outbox record, when the mutation
 *     changes dueDate) in a single TransactWriteItems - implementing data-model.md §5:
 *     "Alterar vencimento grava o item, cancela ocorrências antigas e cria o evento de
 *     outbox crítico numa única transação."
 * M2 has no ReminderOccurrence rows yet (M3 owns reminders), so "cancela ocorrências
 * antigas" is a structural no-op today - there is nothing to cancel, but the same
 * transaction is where M3's ReminderOccurrence cancellation entries will be appended.
 */
import type { RequestContext } from "../../identity/domain/request-context.js";
import { authorize } from "../../identity/domain/authorization.js";
import { ConflictError, NotFoundError } from "../../../shared/errors/app-error.js";
import { buildVersionedCreate, buildVersionedUpdate } from "../../../shared/dynamodb/occ.js";
import { appendToTransaction } from "../../../shared/outbox/outbox.js";
import type { DomainEvent } from "../../../shared/contracts/events.js";
import {
  itemKey,
  gsi1Keys,
  normalizeCategory,
  type ExpirationItem,
  type CreateItemInput,
  type UpdateItemInput,
  type RenewItemInput,
} from "../domain/expiration-item.js";
import { buildAuditEvent, appendAuditToTransaction, type AuditAction } from "../domain/audit-event.js";
import {
  isTransactionCanceled,
  type ExpirationStore,
  type TransactWriteEntry,
} from "../ports/expiration-store.js";
import type { ExpirationIdGenerator } from "./id-generator.js";
import { IdempotencyStore, type DynamoLike } from "../../../shared/idempotency/idempotency.js";

const ITEM_DUE_DATE_CHANGED = "expiration.item-due-date-changed.v1";

export interface ExpirationServiceDeps {
  store: ExpirationStore;
  tableName: string;
  ids: ExpirationIdGenerator;
  now?: () => string;
}

export interface DashboardQuery {
  status: ExpirationItem["status"];
  ascending?: boolean;
  limit?: number;
}

export class ExpirationService {
  private readonly store: ExpirationStore;
  private readonly tableName: string;
  private readonly ids: ExpirationIdGenerator;
  private readonly now: () => string;
  private readonly idempotency: IdempotencyStore;

  constructor(deps: ExpirationServiceDeps) {
    this.store = deps.store;
    this.tableName = deps.tableName;
    this.ids = deps.ids;
    this.now = deps.now ?? (() => new Date().toISOString());
    // Adapts ExpirationStore (get/putIfAbsent/update) to IdempotencyStore's DynamoLike port.
    const adapter: DynamoLike = {
      putIfAbsent: async (item) => ((await this.store.putIfAbsent(item)) ? "PUT" : "ALREADY_EXISTS"),
      get: (key) => this.store.get(key),
      update: (item) => this.store.update(item),
    };
    this.idempotency = new IdempotencyStore(adapter, this.tableName, this.now);
  }

  async createItem(ctx: RequestContext, input: CreateItemInput): Promise<ExpirationItem> {
    authorize({ context: ctx, action: "item:create", resource: { tenantId: ctx.tenant.tenantId } });

    const itemId = this.ids.newItemId();
    const now = this.now();
    const item: ExpirationItem = {
      ...itemKey(ctx.tenant.tenantId, itemId),
      entityType: "ExpirationItem",
      itemId,
      tenantId: ctx.tenant.tenantId,
      name: input.name,
      category: input.category,
      categoryNormalized: normalizeCategory(input.category),
      description: input.description,
      dueDate: input.dueDate,
      issueDate: input.issueDate,
      periodicity: input.periodicity,
      issuer: input.issuer,
      number: input.number,
      assigneeUserId: input.assigneeUserId,
      tags: input.tags ?? [],
      priority: input.priority,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
      version: 1,
      ...gsi1Keys(ctx.tenant.tenantId, "ACTIVE", input.dueDate, itemId),
    };

    const entries: TransactWriteEntry[] = [{ Put: buildVersionedCreate(this.tableName, item as unknown as Record<string, unknown> & { PK: string; SK: string }) }];
    this.appendAudit(entries, ctx, {
      itemId,
      action: "CREATE",
      previousVersion: undefined,
      newVersion: 1,
      changes: { after: item },
    });

    await this.commit(entries);
    return item;
  }

  async getItem(ctx: RequestContext, itemId: string): Promise<ExpirationItem> {
    const item = await this.readActiveItem(ctx.tenant.tenantId, itemId);
    authorize({ context: ctx, action: "item:read", resource: { tenantId: item.tenantId } });
    return item;
  }

  async updateItem(
    ctx: RequestContext,
    itemId: string,
    input: UpdateItemInput,
    expectedVersion: number,
  ): Promise<ExpirationItem> {
    const item = await this.readActiveItem(ctx.tenant.tenantId, itemId);
    authorize({ context: ctx, action: "item:update", resource: { tenantId: item.tenantId } });

    const dueDateChanged = input.dueDate !== undefined && input.dueDate !== item.dueDate;
    const nextDueDate = input.dueDate ?? item.dueDate;
    const nextCategory = input.category ?? item.category;

    const set: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const fields: (keyof UpdateItemInput)[] = [
      "name",
      "category",
      "description",
      "dueDate",
      "issueDate",
      "periodicity",
      "issuer",
      "number",
      "assigneeUserId",
      "tags",
      "priority",
    ];
    for (const field of fields) {
      const value = input[field];
      if (value !== undefined) {
        set[field] = value;
        before[field] = (item as unknown as Record<string, unknown>)[field];
        after[field] = value;
      }
    }
    if (input.category !== undefined) {
      set["categoryNormalized"] = normalizeCategory(nextCategory);
    }
    // GSI1SK always reflects the current dueDate; status is unchanged by updateItem.
    const gsi1 = gsi1Keys(item.tenantId, item.status, nextDueDate, itemId);
    set["GSI1PK"] = gsi1.GSI1PK;
    set["GSI1SK"] = gsi1.GSI1SK;

    const entries: TransactWriteEntry[] = [
      {
        Update: buildVersionedUpdate({
          tableName: this.tableName,
          key: itemKey(item.tenantId, itemId),
          tenantId: item.tenantId,
          expectedVersion,
          set,
        }),
      },
    ];

    const newVersion = expectedVersion + 1;

    if (dueDateChanged) {
      const event: DomainEvent = {
        specVersion: "1.0",
        eventId: this.ids.newEventId(),
        eventType: ITEM_DUE_DATE_CHANGED,
        source: "expiration-tracker.expiration",
        occurredAt: this.now(),
        correlationId: ctx.correlationId,
        tenantId: item.tenantId,
        actor: { type: "USER", userId: ctx.principal.userId },
        aggregate: { type: "ExpirationItem", id: itemId, version: newVersion },
        data: {
          itemId,
          previousDueDate: item.dueDate,
          newDueDate: nextDueDate,
          itemVersion: newVersion,
        },
      };
      appendToTransaction(entries, this.tableName, event);
    }

    this.appendAudit(entries, ctx, {
      itemId,
      action: "UPDATE",
      previousVersion: expectedVersion,
      newVersion,
      changes: { before, after },
    });

    await this.commit(entries);

    return { ...item, ...(set as Partial<ExpirationItem>), version: newVersion, updatedAt: this.now() };
  }

  async archiveItem(ctx: RequestContext, itemId: string, expectedVersion: number): Promise<void> {
    const item = await this.readActiveItem(ctx.tenant.tenantId, itemId);
    authorize({ context: ctx, action: "item:update", resource: { tenantId: item.tenantId } });
    await this.transitionStatus(ctx, item, expectedVersion, "ARCHIVED", "ARCHIVE");
  }

  async deleteItem(ctx: RequestContext, itemId: string, expectedVersion: number): Promise<void> {
    const item = await this.readActiveItem(ctx.tenant.tenantId, itemId);
    authorize({ context: ctx, action: "item:delete", resource: { tenantId: item.tenantId } });
    await this.transitionStatus(ctx, item, expectedVersion, "DELETED", "DELETE", { deletedAt: this.now() });
  }

  /**
   * renewItem — creates a new item (lineage successor) rather than mutating dueDate on
   * the source aggregate (implementation-blueprint.md §8, data-model.md §2
   * `renewedFromId`). Idempotent per data-model.md §4:
   * "tenantId|sourceItemId|sourceVersion|cycle".
   */
  async renewItem(
    ctx: RequestContext,
    itemId: string,
    input: RenewItemInput,
    expectedVersion: number,
    idempotencyKey?: string,
  ): Promise<ExpirationItem> {
    const source = await this.readActiveItem(ctx.tenant.tenantId, itemId);
    authorize({ context: ctx, action: "item:update", resource: { tenantId: source.tenantId } });

    // Idempotency check runs BEFORE the ACTIVE-status guard: a retried renewal of the
    // exact same request must succeed even though the source item has already
    // transitioned to RENEWED by the first (successful) attempt - that transition IS
    // the expected side effect being replayed, not a genuine conflict.
    const cycle = input.cycle ?? input.newDueDate;
    const key = idempotencyKey ?? `${itemId}|${expectedVersion}|${cycle}`;
    const operation = "expiration.renewItem";
    const requestHash = `${itemId}|${expectedVersion}|${cycle}`;
    const expiresAt = new Date(Date.parse(this.now()) + 24 * 60 * 60 * 1000).toISOString();

    const result = await this.idempotency.begin({
      tenantId: ctx.tenant.tenantId,
      operation,
      key,
      requestHash,
      expiresAt,
    });

    if (result === "COMPLETED_SAME_REQUEST") {
      const record = await this.store.get({
        PK: `TENANT#${ctx.tenant.tenantId}#IDEMPOTENCY#${operation}`,
        SK: `KEY#${key}`,
      });
      const newItemId = (record as { responseRef?: string } | undefined)?.responseRef;
      if (!newItemId) {
        throw new ConflictError("Renewal idempotency record missing responseRef.", { itemId });
      }
      return this.getItem(ctx, newItemId);
    }

    if (source.status !== "ACTIVE") {
      throw new ConflictError(`Cannot renew item in status ${source.status}.`, { itemId, status: source.status });
    }

    const newItemId = this.ids.newItemId();
    const now = this.now();
    const newVersion = expectedVersion + 1;

    const newItem: ExpirationItem = {
      ...itemKey(source.tenantId, newItemId),
      entityType: "ExpirationItem",
      itemId: newItemId,
      tenantId: source.tenantId,
      name: source.name,
      category: source.category,
      categoryNormalized: source.categoryNormalized,
      description: source.description,
      dueDate: input.newDueDate,
      issueDate: source.issueDate,
      periodicity: source.periodicity,
      issuer: source.issuer,
      number: source.number,
      assigneeUserId: source.assigneeUserId,
      tags: source.tags,
      priority: source.priority,
      status: "ACTIVE",
      renewedFromId: itemId,
      createdAt: now,
      updatedAt: now,
      version: 1,
      ...gsi1Keys(source.tenantId, "ACTIVE", input.newDueDate, newItemId),
    };

    const entries: TransactWriteEntry[] = [
      {
        Update: buildVersionedUpdate({
          tableName: this.tableName,
          key: itemKey(source.tenantId, itemId),
          tenantId: source.tenantId,
          expectedVersion,
          set: { status: "RENEWED", ...gsi1Keys(source.tenantId, "RENEWED", source.dueDate, itemId) },
        }),
      },
      { Put: buildVersionedCreate(this.tableName, newItem as unknown as Record<string, unknown> & { PK: string; SK: string }) },
    ];

    const event: DomainEvent = {
      specVersion: "1.0",
      eventId: this.ids.newEventId(),
      eventType: ITEM_DUE_DATE_CHANGED,
      source: "expiration-tracker.expiration",
      occurredAt: now,
      correlationId: ctx.correlationId,
      tenantId: source.tenantId,
      actor: { type: "USER", userId: ctx.principal.userId },
      aggregate: { type: "ExpirationItem", id: newItemId, version: 1 },
      data: { itemId: newItemId, previousDueDate: null, newDueDate: input.newDueDate, itemVersion: 1 },
    };
    appendToTransaction(entries, this.tableName, event);

    this.appendAudit(entries, ctx, {
      itemId,
      action: "RENEW",
      previousVersion: expectedVersion,
      newVersion,
      changes: { renewedFromId: itemId, newItemId, newDueDate: input.newDueDate },
    });

    await this.commit(entries);

    await this.idempotency.complete({ tenantId: ctx.tenant.tenantId, operation, key, responseRef: newItemId });

    return newItem;
  }

  /** Dashboard listing via GSI1 (implementation-blueprint.md §8.2). Eventually consistent - never used for authorization/pre-mutation decisions (data-model.md §5). */
  async listDashboard(ctx: RequestContext, query: DashboardQuery): Promise<ExpirationItem[]> {
    authorize({ context: ctx, action: "item:read", resource: { tenantId: ctx.tenant.tenantId } });
    return this.store.queryGsi1<ExpirationItem>({
      gsi1pk: `TENANT#${ctx.tenant.tenantId}#ITEMSTATUS#${query.status}`,
      ascending: query.ascending ?? true,
      limit: query.limit,
    });
  }

  private async transitionStatus(
    ctx: RequestContext,
    item: ExpirationItem,
    expectedVersion: number,
    status: ExpirationItem["status"],
    action: AuditAction,
    extraSet: Record<string, unknown> = {},
  ): Promise<void> {
    const set: Record<string, unknown> = {
      status,
      ...gsi1Keys(item.tenantId, status, item.dueDate, item.itemId),
      ...extraSet,
    };
    const entries: TransactWriteEntry[] = [
      {
        Update: buildVersionedUpdate({
          tableName: this.tableName,
          key: itemKey(item.tenantId, item.itemId),
          tenantId: item.tenantId,
          expectedVersion,
          set,
        }),
      },
    ];
    this.appendAudit(entries, ctx, {
      itemId: item.itemId,
      action,
      previousVersion: expectedVersion,
      newVersion: expectedVersion + 1,
      changes: { before: { status: item.status }, after: { status } },
    });
    await this.commit(entries);
  }

  private appendAudit(
    entries: TransactWriteEntry[],
    ctx: RequestContext,
    input: {
      itemId: string;
      action: AuditAction;
      previousVersion: number | undefined;
      newVersion: number;
      changes: Record<string, unknown>;
    },
  ): void {
    const event = buildAuditEvent({
      auditEventId: this.ids.newAuditEventId(),
      tenantId: ctx.tenant.tenantId,
      itemId: input.itemId,
      action: input.action,
      actor: { type: "USER", userId: ctx.principal.userId },
      previousVersion: input.previousVersion,
      newVersion: input.newVersion,
      changes: input.changes,
      occurredAt: this.now(),
      correlationId: ctx.correlationId,
    });
    appendAuditToTransaction(entries, this.tableName, event);
  }

  private async readActiveItem(tenantId: string, itemId: string): Promise<ExpirationItem> {
    const item = await this.store.get<ExpirationItem>(itemKey(tenantId, itemId));
    if (!item || item.status === "DELETED") {
      throw new NotFoundError("ExpirationItem not found.", { itemId });
    }
    return item;
  }

  private async commit(entries: TransactWriteEntry[]): Promise<void> {
    try {
      await this.store.transactWrite(entries);
    } catch (err) {
      if (isTransactionCanceled(err)) {
        throw new ConflictError("VERSION_CONFLICT", { cause: "transaction condition failed" });
      }
      throw err;
    }
  }
}


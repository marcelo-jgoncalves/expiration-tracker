/**
 * ItemWatchService — 07-domain-model-escalation-watchers-digest.md (D-040). Serviço
 * pequeno e deliberadamente separado de ExpirationService: nunca muta o agregado
 * ExpirationItem, só a coleção ItemWatch sob a mesma partição. Reaproveita ExpirationStore
 * (mesmo módulo) em vez de introduzir uma porta nova — a adição de `queryByPk` ao port é
 * puramente aditiva (zero mudança de comportamento existente).
 */
import type { RequestContext } from "../../identity/domain/request-context.js";
import { authorize } from "../../identity/domain/authorization.js";
import { ConflictError, NotFoundError } from "../../../shared/errors/app-error.js";
import { buildVersionedUpdate } from "../../../shared/dynamodb/occ.js";
import { itemKey } from "../domain/expiration-item.js";
import { itemWatchKey, ITEM_WATCH_SK_PREFIX, type ItemWatch } from "../domain/item-watch.js";
import { isTransactionCanceled, type ExpirationStore, type TransactWriteEntry } from "../ports/expiration-store.js";

export interface ItemWatchServiceDeps {
  store: ExpirationStore;
  tableName: string;
  now?: () => string;
}

export class ItemWatchService {
  private readonly store: ExpirationStore;
  private readonly tableName: string;
  private readonly now: () => string;

  constructor(deps: ItemWatchServiceDeps) {
    this.store = deps.store;
    this.tableName = deps.tableName;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async addWatcher(ctx: RequestContext, itemId: string, userId: string): Promise<ItemWatch> {
    await this.requireActiveItem(ctx.tenant.tenantId, itemId);
    authorize({ context: ctx, action: "item:watch", resource: { tenantId: ctx.tenant.tenantId } });

    const key = itemWatchKey(ctx.tenant.tenantId, itemId, userId);
    const existing = await this.store.get<ItemWatch>(key);
    if (existing?.status === "ACTIVE") return existing; // idempotente

    const now = this.now();
    if (!existing) {
      const watch: ItemWatch = { ...key, entityType: "ItemWatch", itemId, tenantId: ctx.tenant.tenantId, userId, status: "ACTIVE", createdAt: now, updatedAt: now, version: 1 };
      const created = await this.store.putIfAbsent(watch);
      if (created) return watch;
      // Corrida com outra criação concorrente - relê e trata como reativação abaixo.
    }
    return this.reactivate(ctx, itemId, userId, key);
  }

  /** REMOVED -> ACTIVE, ou cria se a leitura acima perdeu a corrida de criação. Idempotente. */
  private async reactivate(ctx: RequestContext, itemId: string, userId: string, key: { PK: string; SK: string }): Promise<ItemWatch> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await this.store.get<ItemWatch>(key);
      if (!current) {
        const now = this.now();
        const watch: ItemWatch = { ...key, entityType: "ItemWatch", itemId, tenantId: ctx.tenant.tenantId, userId, status: "ACTIVE", createdAt: now, updatedAt: now, version: 1 };
        if (await this.store.putIfAbsent(watch)) return watch;
        continue;
      }
      if (current.status === "ACTIVE") return current;
      const entries: TransactWriteEntry[] = [
        { Update: buildVersionedUpdate({ tableName: this.tableName, key, tenantId: ctx.tenant.tenantId, expectedVersion: current.version, set: { status: "ACTIVE" } }) },
      ];
      try {
        await this.store.transactWrite(entries);
        return { ...current, status: "ACTIVE", version: current.version + 1, updatedAt: this.now() };
      } catch (err) {
        if (isTransactionCanceled(err)) continue;
        throw err;
      }
    }
    throw new ConflictError("Could not reactivate watcher under contention.", { itemId, userId });
  }

  async removeWatcher(ctx: RequestContext, itemId: string, userId: string): Promise<void> {
    await this.requireActiveItem(ctx.tenant.tenantId, itemId);
    authorize({ context: ctx, action: "item:watch", resource: { tenantId: ctx.tenant.tenantId } });

    const key = itemWatchKey(ctx.tenant.tenantId, itemId, userId);
    const existing = await this.store.get<ItemWatch>(key);
    if (!existing || existing.status === "REMOVED") return; // idempotente

    const entries: TransactWriteEntry[] = [
      { Update: buildVersionedUpdate({ tableName: this.tableName, key, tenantId: ctx.tenant.tenantId, expectedVersion: existing.version, set: { status: "REMOVED" } }) },
    ];
    try {
      await this.store.transactWrite(entries);
    } catch (err) {
      if (isTransactionCanceled(err)) {
        throw new ConflictError("VERSION_CONFLICT", { cause: "transaction condition failed" });
      }
      throw err;
    }
  }

  /** Lista watchers ACTIVE de um item via Query(PK, begins_with(SK, WATCH#USER#)) — sem GSI novo. */
  async listWatchers(ctx: RequestContext, itemId: string): Promise<ItemWatch[]> {
    await this.requireActiveItem(ctx.tenant.tenantId, itemId);
    authorize({ context: ctx, action: "item:read", resource: { tenantId: ctx.tenant.tenantId } });

    const rows = await this.store.queryByPk<ItemWatch>(itemKey(ctx.tenant.tenantId, itemId).PK, ITEM_WATCH_SK_PREFIX);
    return rows.filter((row) => row.status === "ACTIVE");
  }

  private async requireActiveItem(tenantId: string, itemId: string): Promise<void> {
    const item = await this.store.get(itemKey(tenantId, itemId));
    if (!item || (item as { status?: string }).status === "DELETED") {
      throw new NotFoundError("ExpirationItem not found.", { itemId });
    }
  }
}

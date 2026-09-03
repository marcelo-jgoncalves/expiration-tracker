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
import { ConflictError, IneligibleAssigneeError, NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import type { MemberEligibilityChecker } from "../ports/member-eligibility.js";
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
import { buildTenantAuditEvent, appendTenantAuditToTransaction, buildExportLockItem, appendExportLockToTransaction } from "../../activity/domain/tenant-audit-event.js";
import { policyKey, policyRefKey, POLICY_REF_SK_PREFIX, type ReminderPolicy, type PolicyRef } from "../../reminder/domain/reminder-policy.js";
import { deriveCoreUserDataMaintenanceDue, coreUserDataGsi8Keys } from "../../../shared/core-user-data-gsi8.js";
import {
  isTransactionCanceled,
  type ExpirationStore,
  type TransactWriteEntry,
} from "../ports/expiration-store.js";
import type { ExpirationIdGenerator } from "./id-generator.js";
import { IdempotencyStore, transitionIdempotencyStatus, type DynamoLike } from "../../../shared/idempotency/idempotency.js";
import { createHash } from "node:crypto";
import { executeTenantBusinessMutation } from "../../../shared/tenant-lifecycle/tenant-business-mutation.js";
import { TenantNotActiveError } from "../../../shared/errors/app-error.js";

/** D-123/D-126 (CSV data export, round-3): fixed 2.000-item cap, tenant-wide across all 3
 * exported statuses combined — not per-query. Independently guarded alongside the 4 MB byte
 * cap enforced at CSV-serialization time (src/modules/expiration/http/export-handler.ts). */
export const EXPORT_ITEM_CAP = 2000;

const ITEM_DUE_DATE_CHANGED = "expiration.item-due-date-changed.v1";
/** BLOCKER-B (reminder-delivery-pipeline.md §4): fired for every terminal item transition
 * (archive, delete, renewal's old-item side) - tells the reminder-materialization-trigger
 * worker to cancel every live occurrence under this item unconditionally, no materialize. */
const ITEM_DEACTIVATED = "expiration.item-deactivated.v1";

export interface ExpirationServiceDeps {
  store: ExpirationStore;
  tableName: string;
  ids: ExpirationIdGenerator;
  members: MemberEligibilityChecker;
  now?: () => string;
}

export interface DashboardQuery {
  status: ExpirationItem["status"];
  ascending?: boolean;
  limit?: number;
  /** D-136/D-E: raw DynamoDB key (already decoded from the opaque HTTP cursor by the caller -
   * this service layer stays transport-agnostic, same as the store port). */
  exclusiveStartKey?: Record<string, unknown>;
}

export interface DashboardPage {
  items: ExpirationItem[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export class ExpirationService {
  private readonly store: ExpirationStore;
  private readonly tableName: string;
  private readonly ids: ExpirationIdGenerator;
  private readonly members: MemberEligibilityChecker;
  private readonly now: () => string;
  private readonly idempotency: IdempotencyStore;

  constructor(deps: ExpirationServiceDeps) {
    this.store = deps.store;
    this.tableName = deps.tableName;
    this.ids = deps.ids;
    this.members = deps.members;
    this.now = deps.now ?? (() => new Date().toISOString());
    // Adapts ExpirationStore (get/putIfAbsent/update/transactWrite) to IdempotencyStore's
    // DynamoLike port.
    const adapter: DynamoLike = {
      putIfAbsent: async (item) => ((await this.store.putIfAbsent(item)) ? "PUT" : "ALREADY_EXISTS"),
      get: (key) => this.store.get(key),
      update: (item) => this.store.update(item),
      transitionIfStatus: (item, expectedStatus) => transitionIdempotencyStatus(this.store, this.tableName, item, expectedStatus),
    };
    this.idempotency = new IdempotencyStore(adapter, this.tableName, this.now);
  }

  /**
   * createItem — CREATE-IDEMPOTENCY-01 (docs/frontend/interface-critical-user-journeys.md
   * §9): a retry after a client-side timeout could previously create a duplicate item,
   * since there was no way to recognize "this is the same creation request, not a new
   * one". `idempotencyKey` is optional (unlike import's mandatory key, there is no
   * pre-existing aggregate to derive a natural fallback composite key from, the way
   * renewItem derives one from `itemId|expectedVersion|cycle`) - a caller that omits it
   * gets today's unprotected behavior unchanged; a caller that sends it gets the same
   * begin/complete protection renewItem already uses.
   */
  async createItem(ctx: RequestContext, input: CreateItemInput, idempotencyKey?: string): Promise<ExpirationItem> {
    authorize({ context: ctx, action: "item:create", resource: { tenantId: ctx.tenant.tenantId } });
    // Wave B2B-11: validated BEFORE any idempotency state is created, so a rejected assignee
    // never burns an idempotency key for a request that will never succeed.
    await this.validateAssignee(ctx.tenant.tenantId, input.assigneeUserId);

    const operation = "expiration.createItem";
    let idempotencyState: { key: string } | undefined;

    if (idempotencyKey) {
      const key = idempotencyKey;
      // Canonical structured serialization + SHA-256, not delimiter-joined fields: name/category/
      // description/issuer/number/tags are free text with no character restriction, so a
      // delimiter-joined string (`${a}|${b}|...`) can collide across two genuinely different
      // payloads (e.g. a "|" inside `name` shifting every field after it) - unlike renewItem's
      // `itemId|expectedVersion|cycle` (generated id + number + ISO date, none of which can
      // contain "|") or import's `contentLength|checksumSha256` (number + fixed-length hex),
      // which have no such risk and were left unchanged.
      const requestHash = createHash("sha256")
        .update(
          JSON.stringify({
            name: input.name,
            category: input.category,
            dueDate: input.dueDate,
            description: input.description ?? null,
            issueDate: input.issueDate ?? null,
            periodicity: input.periodicity ?? null,
            issuer: input.issuer ?? null,
            number: input.number ?? null,
            assigneeUserId: input.assigneeUserId ?? null,
            tags: input.tags ?? [],
            priority: input.priority ?? null,
          }),
        )
        .digest("hex");
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
        const existingItemId = (record as { responseRef?: string } | undefined)?.responseRef;
        if (!existingItemId) {
          throw new ConflictError("Create idempotency record missing responseRef.", { idempotencyKey: key });
        }
        return this.getItem(ctx, existingItemId);
      }

      idempotencyState = { key };
    }

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

    // BLOCKER-B (reminder-delivery-pipeline.md §2/§4, Codex Round H APPROVED 9.2/10):
    // createItem previously emitted no outbox event at all, so a brand-new item with an
    // already-attached policy would never materialize a reminder even once a due-date-
    // changed consumer existed - a newly created item's due date IS "the due date changing"
    // from the reminder trigger's point of view (from nonexistent to input.dueDate), same
    // semantic renewItem's own new-item creation already uses (previousDueDate: null).
    const createdEvent: DomainEvent = {
      specVersion: "1.0",
      eventId: this.ids.newEventId(),
      eventType: ITEM_DUE_DATE_CHANGED,
      source: "expiration-tracker.expiration",
      occurredAt: now,
      correlationId: ctx.correlationId,
      tenantId: ctx.tenant.tenantId,
      actor: { type: "USER", userId: ctx.principal.userId },
      aggregate: { type: "ExpirationItem", id: itemId, version: 1 },
      data: { itemId, previousDueDate: null, newDueDate: input.dueDate, itemVersion: 1 },
    };
    appendToTransaction(entries, this.tableName, createdEvent, "SQS_REMINDER_MATERIALIZATION_TRIGGER_V1");

    this.appendAudit(entries, ctx, {
      itemId,
      action: "CREATE",
      previousVersion: undefined,
      newVersion: 1,
      changes: { after: item },
    });

    try {
      await this.commit(entries, ctx.tenant.tenantId);
    } catch (err) {
      // Idempotency liveness (docs/frontend/core-expiration-vertical-slice.md - discovered
      // via renewItem's identical failure shape, applied here defensively too): the write
      // itself failed (in practice, near-impossible for a freshly generated itemId, but not
      // provably impossible), so the lock this begin() acquired must be released - otherwise
      // every retry under the same key would hit ConcurrentOperationError forever, even
      // though the create never actually happened.
      if (idempotencyState) {
        await this.idempotency.abort({ tenantId: ctx.tenant.tenantId, operation, key: idempotencyState.key });
      }
      throw err;
    }

    if (idempotencyState) {
      await this.idempotency.complete({ tenantId: ctx.tenant.tenantId, operation, key: idempotencyState.key, responseRef: itemId });
    }

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
    // Wave B2B-11: only validated when assigneeUserId is actually being CHANGED - re-validating
    // an unchanged value on every update to unrelated fields would be pure overhead and could
    // spuriously reject an update if the assignee's eligibility lapsed after the original
    // assignment (same "admitted while ACTIVE may finish" posture as the rest of this codebase).
    if (input.assigneeUserId !== undefined) {
      await this.validateAssignee(ctx.tenant.tenantId, input.assigneeUserId);
    }

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
      appendToTransaction(entries, this.tableName, event, "SQS_REMINDER_MATERIALIZATION_TRIGGER_V1");
    }

    this.appendAudit(entries, ctx, {
      itemId,
      action: "UPDATE",
      previousVersion: expectedVersion,
      newVersion,
      changes: { before, after },
    });

    await this.commit(entries, item.tenantId);

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
    // D-190 (GSI8, 9th/last worker): the CoreUserDataPurgeWorker's discovery pointer is written
    // in the SAME transaction as the deletedAt transition itself - the only moment an
    // ExpirationItem becomes a purge candidate at all (deriveCoreUserDataMaintenanceDue()
    // returns undefined before deletedAt is set, so no pointer exists on a live row).
    const deletedAt = this.now();
    const due = deriveCoreUserDataMaintenanceDue({ deletedAt });
    const gsi8 = due.dueAtIso
      ? coreUserDataGsi8Keys({ dueAtIso: due.dueAtIso, tenantId: item.tenantId, entityType: "ExpirationItem", sk: itemKey(item.tenantId, item.itemId).SK })
      : {};
    await this.transitionStatus(ctx, item, expectedVersion, "DELETED", "DELETE", { deletedAt, ...gsi8 });
  }

  /**
   * renewItem — creates a new item (lineage successor) rather than mutating dueDate on
   * the source aggregate (implementation-blueprint.md §8, data-model.md §2
   * `renewedFromId`). Idempotent per data-model.md §4:
   * "tenantId|sourceItemId|sourceVersion|cycle".
   *
   * `copiedReminderPolicyIds` (reminder-delivery-pipeline.md §8, Marcelo's decision
   * 2026-08-25): the source item's ITEM-scoped ReminderPolicy rows are copied onto the new
   * item inside the SAME transaction as its creation - returned here (never silently) so
   * the HTTP layer/frontend can surface a notice that the copied policy may need review
   * (e.g. a renewed contract with a different notice period than its predecessor).
   */
  async renewItem(
    ctx: RequestContext,
    itemId: string,
    input: RenewItemInput,
    expectedVersion: number,
    idempotencyKey?: string,
  ): Promise<{ item: ExpirationItem; copiedReminderPolicyIds: string[] }> {
    const source = await this.readActiveItem(ctx.tenant.tenantId, itemId);
    authorize({ context: ctx, action: "item:update", resource: { tenantId: source.tenantId } });

    // Idempotency check runs BEFORE the ACTIVE-status guard: a retried renewal of the
    // exact same request must succeed even though the source item has already
    // transitioned to RENEWED by the first (successful) attempt - that transition IS
    // the expected side effect being replayed, not a genuine conflict.
    const cycle = input.cycle ?? input.newDueDate;
    const key = idempotencyKey ?? `${itemId}|${expectedVersion}|${cycle}`;
    const operation = "expiration.renewItem";
    // Real Codex Round B finding: `cycle` is an independent optional field on the wire
    // (renew-item-request.v1.json), so when a caller supplies BOTH `cycle` and `newDueDate`,
    // the previous hash (itemId|expectedVersion|cycle) never varied with newDueDate - two
    // requests differing only in newDueDate would hash identically and the second would be
    // wrongly treated as a replay of the first. newDueDate is now always part of the hash,
    // regardless of whether cycle was explicitly supplied.
    const requestHash = `${itemId}|${expectedVersion}|${input.newDueDate}|${cycle}`;
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
      const item = await this.getItem(ctx, newItemId);
      // Replay branch: the copy already happened on the original (committed) attempt - re-
      // derive the notice from the new item's own pointers rather than re-running the copy,
      // same "current state is authoritative" principle the reminder-materialization-trigger
      // worker itself uses (trigger.ts's design note §7).
      const copiedReminderPolicyIds = await this.findItemPolicyIds(ctx.tenant.tenantId, newItemId);
      return { item, copiedReminderPolicyIds };
    }

    let newItem: ExpirationItem;
    let copiedReminderPolicyIds: string[];
    try {
      if (source.status !== "ACTIVE") {
        throw new ConflictError(`Cannot renew item in status ${source.status}.`, { itemId, status: source.status });
      }
      // Only the status guard and the transactional write itself are covered by this
      // try/catch - real Codex Round B finding: the previous version wrapped completeRenewal()
      // (write + idempotency.complete()) entirely, so a commit() that SUCCEEDED but whose
      // subsequent complete() call failed would still hit this catch and call abort(),
      // discarding the idempotency record's ability to replay the real cached success on
      // retry. complete() now runs after this block, outside the abort-triggering catch - if
      // IT fails, the record is left IN_PROGRESS (the pre-existing documented residual,
      // mission §32/docs/frontend/core-expiration-vertical-slice.md §16), never silently
      // reset to ABORTED after a mutation that actually happened.
      const result = await this.completeRenewal(ctx, itemId, source, input, expectedVersion);
      newItem = result.item;
      copiedReminderPolicyIds = result.copiedReminderPolicyIds;
    } catch (err) {
      // Idempotency liveness (mission's residual, docs/frontend/core-expiration-vertical-
      // slice.md §16): without releasing the lock here, a genuine OCC conflict on the
      // aggregate write (or the status-guard above) would leave this key permanently
      // IN_PROGRESS - every retry, even after the caller re-fetches the item and supplies a
      // fresh expectedVersion, would hit ConcurrentOperationError instead of a real retry.
      await this.idempotency.abort({ tenantId: ctx.tenant.tenantId, operation, key });
      throw err;
    }

    await this.idempotency.complete({ tenantId: ctx.tenant.tenantId, operation, key, responseRef: newItem.itemId });
    return { item: newItem, copiedReminderPolicyIds };
  }

  /** Discovery read (eventually consistent, same as every other queryByPk caller in this
   * codebase) of an item's current ITEM-scoped ReminderPolicy ids via its POLICYREF#
   * pointers - informational only (used for the renewal notice on an idempotency replay,
   * never for a correctness decision), same non-authoritative status trigger.ts's pointer
   * reads always have. */
  private async findItemPolicyIds(tenantId: string, forItemId: string): Promise<string[]> {
    const pointers = await this.store.queryByPk<PolicyRef>(itemKey(tenantId, forItemId).PK, POLICY_REF_SK_PREFIX);
    return pointers.map((pointer) => pointer.policyId);
  }

  private async completeRenewal(
    ctx: RequestContext,
    itemId: string,
    source: ExpirationItem,
    input: RenewItemInput,
    expectedVersion: number,
  ): Promise<{ item: ExpirationItem; copiedReminderPolicyIds: string[] }> {
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
    appendToTransaction(entries, this.tableName, event, "SQS_REMINDER_MATERIALIZATION_TRIGGER_V1");

    // BLOCKER-B (reminder-delivery-pipeline.md §4/§8, Codex Round H APPROVED 9.2/10): the
    // OLD item transitions to RENEWED in this same transaction (above) - its own live
    // reminder occurrences must be cancelled the same way archive/delete's are, otherwise
    // a renewed item's superseded lineage keeps delivering reminders for a due date that no
    // longer applies. Round D's CRITICAL finding #1 covered this alongside archive/delete.
    this.appendItemDeactivated(entries, ctx, { itemId, itemVersion: newVersion, tenantId: source.tenantId });

    this.appendAudit(entries, ctx, {
      itemId,
      action: "RENEW",
      previousVersion: expectedVersion,
      newVersion,
      changes: { renewedFromId: itemId, newItemId, newDueDate: input.newDueDate },
    });

    // reminder-delivery-pipeline.md §8 (Marcelo's decision, 2026-08-25): copy the source
    // item's ITEM-scoped ReminderPolicy rows onto the new item, inside this SAME
    // transaction - never a separate follow-up call, so a renewal can never half-succeed
    // (item created, copy silently dropped). No item-existence ConditionCheck is needed the
    // way ReminderPolicyService.createPolicy needs one for a client-supplied itemId: newItem
    // is guaranteed to exist because THIS transaction is what creates it. The copy rides the
    // due-date-changed event already appended above - the reminder-materialization-trigger
    // worker re-reads the new item's pointers at processing time (trigger.ts's "pure
    // invalidation signal" design, §7), so no separate reminder.policy-changed.v1 is needed.
    const copiedReminderPolicyIds: string[] = [];
    const sourcePointers = await this.store.queryByPk<PolicyRef>(itemKey(source.tenantId, itemId).PK, POLICY_REF_SK_PREFIX);
    for (const pointer of sourcePointers) {
      const sourcePolicy = await this.store.get<ReminderPolicy>(policyKey(source.tenantId, pointer.policyId));
      // Orphaned/stale pointer (reminder-delivery-pipeline.md §5) - never trusted, silently
      // skipped, same defensive re-validation trigger.ts's onItemDueDateChanged performs
      // before using any pointer.
      if (!sourcePolicy || sourcePolicy.deletedAt || sourcePolicy.scope !== "ITEM" || sourcePolicy.itemId !== itemId) continue;

      const newPolicyId = this.ids.newPolicyId();
      const newPolicy: ReminderPolicy = {
        ...policyKey(source.tenantId, newPolicyId),
        entityType: "ReminderPolicy",
        policyId: newPolicyId,
        tenantId: source.tenantId,
        scope: "ITEM",
        itemId: newItemId,
        name: sourcePolicy.name,
        triggers: sourcePolicy.triggers,
        timeZone: sourcePolicy.timeZone,
        quietHours: sourcePolicy.quietHours,
        channels: sourcePolicy.channels,
        optOutChannels: sourcePolicy.optOutChannels,
        enabled: sourcePolicy.enabled,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      entries.push({ Put: buildVersionedCreate(this.tableName, newPolicy as unknown as Record<string, unknown> & { PK: string; SK: string }) });
      entries.push({
        Put: {
          TableName: this.tableName,
          Item: { ...policyRefKey(source.tenantId, newItemId, newPolicyId), entityType: "ReminderPolicyRef", policyId: newPolicyId, tenantId: source.tenantId },
          ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        },
      });
      copiedReminderPolicyIds.push(newPolicyId);
    }

    await this.commit(entries, source.tenantId);

    return { item: newItem, copiedReminderPolicyIds };
  }

  /** Dashboard listing via GSI1 (implementation-blueprint.md §8.2). Eventually consistent -
   * never used for authorization/pre-mutation decisions (data-model.md §5). D-136/D-E: one
   * physical page per call - the HTTP handler is what enforces a default/max `limit` and
   * decodes/encodes the opaque cursor; this method just passes through to the store port. */
  async listDashboard(ctx: RequestContext, query: DashboardQuery): Promise<DashboardPage> {
    authorize({ context: ctx, action: "item:read", resource: { tenantId: ctx.tenant.tenantId } });
    return this.store.queryGsi1Page<ExpirationItem>({
      gsi1pk: `TENANT#${ctx.tenant.tenantId}#ITEMSTATUS#${query.status}`,
      ascending: query.ascending ?? true,
      limit: query.limit,
      exclusiveStartKey: query.exclusiveStartKey,
    });
  }

  /**
   * D-123/D-126 (CSV data export, round-3 Achado #1, verbatim pseudocode): tenant-wide read
   * of every "actively tracked" ExpirationItem across the 3 statuses that mean that,
   * ACTIVE/ARCHIVED/RENEWED, in that fixed order for determinism. DELETED is deliberately
   * NEVER queried (round-3 Achado #4, own decision, not inherited from the dashboard's
   * requireDashboardStatus() which does accept DELETED) - a soft-deleted item is not
   * "actively tracked". Budget decreases across every physical page fetched (D-136/D-E:
   * queryGsi1Page returns one real DynamoDB page, so a status with more than one page's worth
   * of items is paginated internally here) so the 2.000-item cap is a TENANT-WIDE total, never
   * per-page. `limit: remaining + 1` asks for one more row than the remaining budget so an
   * exact-boundary overflow is detected without a separate count query. The loop continues
   * strictly on `lastEvaluatedKey` presence, never on `rows.length < EXPORT_ITEM_CAP` - a page
   * that lands EXACTLY on the cap can still carry a `lastEvaluatedKey` pointing at a real next
   * item of the SAME status (D-136/D-E Rodada 3 finding: checking remaining budget instead of
   * the cursor itself would silently drop that item from the overflow check).
   */
  async exportItems(ctx: RequestContext): Promise<ExpirationItem[]> {
    authorize({ context: ctx, action: "item:export", resource: { tenantId: ctx.tenant.tenantId } });
    const statuses: ExpirationItem["status"][] = ["ACTIVE", "ARCHIVED", "RENEWED"];
    const rows: ExpirationItem[] = [];
    for (const status of statuses) {
      let lastEvaluatedKey: Record<string, unknown> | undefined;
      do {
        const remaining = EXPORT_ITEM_CAP - rows.length;
        const page = await this.store.queryGsi1Page<ExpirationItem>({
          gsi1pk: `TENANT#${ctx.tenant.tenantId}#ITEMSTATUS#${status}`,
          ascending: true,
          limit: remaining + 1,
          exclusiveStartKey: lastEvaluatedKey,
        });
        if (page.items.length > remaining) {
          throw new ValidationError(`Export exceeds ${EXPORT_ITEM_CAP}-item cap.`, { statusWhereExceeded: status });
        }
        rows.push(...page.items);
        lastEvaluatedKey = page.lastEvaluatedKey;
      } while (lastEvaluatedKey);
    }
    return rows;
  }

  /**
   * D-149 (Admin Activity/Audit Log view, decisão 5): closes the gap confirmed by the design
   * doc — exportItems() above never wrote an AuditEvent. Caller (export-handler.ts) invokes
   * this AFTER the CSV is serialized, BEFORE the HTTP response is sent, and treats it as
   * fail-open (any error here, including the idempotent-duplicate ConflictError below, must
   * never block the CSV response — the caller wraps this whole call in try/catch and logs via
   * SecureLogger). Idempotency: `exportRequestId` is the ONLY component of the lock key (never
   * a timestamp) so a genuine infra-retry with the same key is deduped by the lock's
   * `attribute_not_exists(PK)` condition, while two independently legitimate same-day exports
   * (different exportRequestId) both succeed. `changes` carries only the aggregate count, never
   * the exported rows themselves.
   */
  async recordExportAudit(ctx: RequestContext, params: { exportedCount: number; exportRequestId: string }): Promise<void> {
    const now = this.now();
    const entries: TransactWriteEntry[] = [];
    appendExportLockToTransaction(entries, this.tableName, buildExportLockItem(ctx.tenant.tenantId, params.exportRequestId, now));
    appendTenantAuditToTransaction(
      entries,
      this.tableName,
      buildTenantAuditEvent({
        auditEventId: this.ids.newAuditEventId(),
        tenantId: ctx.tenant.tenantId,
        resourceType: "ExpirationExport",
        action: "EXPORT",
        actor: { type: "USER", userId: ctx.principal.userId },
        changes: { exportedCount: params.exportedCount },
        occurredAt: now,
        correlationId: ctx.correlationId,
      }),
    );
    await this.commit(entries, ctx.tenant.tenantId);
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
    const newVersion = expectedVersion + 1;
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

    // BLOCKER-B (reminder-delivery-pipeline.md §4/§8, Codex Round H APPROVED 9.2/10): both
    // callers of transitionStatus (archive, delete) are terminal item transitions that must
    // cancel any live reminder occurrence - previously nothing signalled this at all
    // (Round B/D CRITICAL finding #1). renewItem's own old-item RENEWED transition emits
    // the same event separately below, since it doesn't go through transitionStatus.
    this.appendItemDeactivated(entries, ctx, { itemId: item.itemId, itemVersion: newVersion });

    this.appendAudit(entries, ctx, {
      itemId: item.itemId,
      action,
      previousVersion: expectedVersion,
      newVersion: expectedVersion + 1,
      changes: { before: { status: item.status }, after: { status } },
    });
    await this.commit(entries, item.tenantId);
  }

  /** BLOCKER-B: appends `expiration.item-deactivated.v1` to `entries` - `tenantId` defaults to `ctx.tenant.tenantId` (every caller except completeRenewal, which already has `source.tenantId` on hand and can skip the extra property access). */
  private appendItemDeactivated(
    entries: TransactWriteEntry[],
    ctx: RequestContext,
    input: { itemId: string; itemVersion: number; tenantId?: string },
  ): void {
    const tenantId = input.tenantId ?? ctx.tenant.tenantId;
    const event: DomainEvent = {
      specVersion: "1.0",
      eventId: this.ids.newEventId(),
      eventType: ITEM_DEACTIVATED,
      source: "expiration-tracker.expiration",
      occurredAt: this.now(),
      correlationId: ctx.correlationId,
      tenantId,
      actor: { type: "USER", userId: ctx.principal.userId },
      aggregate: { type: "ExpirationItem", id: input.itemId, version: input.itemVersion },
      data: { itemId: input.itemId, itemVersion: input.itemVersion },
    };
    appendToTransaction(entries, this.tableName, event, "SQS_REMINDER_MATERIALIZATION_TRIGGER_V1");
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

  /** Wave B2B-11: an empty string clears the assignee (never validated as a candidate userId -
   * same "empty means no candidate" convention as `resolveCandidateUserId`), `undefined` means
   * "not provided" and never reaches here (callers already gate on `!== undefined`). Any other
   * value must be a real, eligible member of this Organization. */
  private async validateAssignee(tenantId: string, assigneeUserId: string | undefined): Promise<void> {
    if (!assigneeUserId) return;
    if (!(await this.members.isEligibleMember(tenantId, assigneeUserId))) {
      throw new IneligibleAssigneeError("assigneeUserId is not an eligible member of this organization.", { assigneeUserId });
    }
  }

  /**
   * W3-07 (D-070 continuation, largest deferred writer per `w3-07-writer-inventory.md`):
   * every mutation in this service (`createItem`/`updateItem`/`archiveItem`/`deleteItem`/
   * `renewItem`) funnels through this single choke point, so fencing it here fences all of
   * them at once via `executeTenantBusinessMutation` - same lane `TenantQuotaService.consume()`
   * and `ItemWatchService.removeWatcher` already use, appending a
   * `TenantLifecycleRecord.status = ACTIVE` `ConditionCheck` to the SAME `TransactWriteItems`
   * call. `tenantId` is now required so the fence has a partition to check against.
   *
   * Error mapping preserves existing OCC/idempotency behavior exactly: `TenantNotActiveError`
   * (the fence itself rejected the mutation - tenant is DELETING) is rethrown unchanged, never
   * folded into `ConflictError("VERSION_CONFLICT")`, so callers (and their idempotency
   * abort-on-catch blocks) can distinguish "the tenant is being deleted" from an ordinary
   * version conflict on the aggregate itself. Any other `TransactionCanceledException` (the
   * caller's own entries lost a real OCC race - `executeTenantBusinessMutation` already
   * distinguishes this via `CancellationReasons`, see that file's header) is wrapped into
   * `ConflictError("VERSION_CONFLICT")` exactly as before this migration.
   */
  private async commit(entries: TransactWriteEntry[], tenantId: string): Promise<void> {
    try {
      await executeTenantBusinessMutation({ store: this.store, tableName: this.tableName, tenantId, entries });
    } catch (err) {
      if (err instanceof TenantNotActiveError) {
        throw err;
      }
      if (isTransactionCanceled(err)) {
        throw new ConflictError("VERSION_CONFLICT", { cause: "transaction condition failed" });
      }
      throw err;
    }
  }
}


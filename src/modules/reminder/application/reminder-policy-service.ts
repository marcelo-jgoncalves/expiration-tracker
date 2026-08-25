/**
 * ReminderPolicyService — implementation-blueprint.md §9.1's `ReminderPolicyService`
 * interface. Mirrors ExpirationService's shape: authorize() (action `reminder:manage`,
 * already declared in the M1 authorization matrix), OCC via shared/dynamodb/occ.ts,
 * strongly-consistent reads.
 *
 * BLOCKER-B (reminder-delivery-pipeline.md, Codex Round H APPROVED 9.2/10): policy writes
 * now do three things beyond the plain CRUD this file used to be limited to, all inside
 * the SAME TransactWriteItems as the policy row itself:
 *  1. ITEM-scoped policies condition-check that their target item exists, is ACTIVE, and
 *     belongs to the same tenant (§5's ITEM policy integrity fix) - a policy can never
 *     reference a nonexistent/foreign/inactive item.
 *  2. The `POLICYREF#` discovery pointer under the item's own partition (§5) is
 *     created/moved/removed to match the policy's current scope/itemId - discovery-only,
 *     never authoritative (the trigger worker always dereferences the real policy row).
 *  3. `reminder.policy-changed.v1` is appended to the transactional outbox (§4) - the
 *     event that wakes the reminder-materialization-trigger worker. `previousItemId` is
 *     included only when a move/scope-change away from ITEM makes the OLD item's
 *     partition no longer discoverable via its pointer.
 */
import type { RequestContext } from "../../identity/domain/request-context.js";
import { authorize } from "../../identity/domain/authorization.js";
import { ConflictError, NotFoundError } from "../../../shared/errors/app-error.js";
import { buildExistenceConditionCheck, buildVersionedCreate, buildVersionedUpdate, isConditionalCheckFailed } from "../../../shared/dynamodb/occ.js";
import { appendToTransaction } from "../../../shared/outbox/outbox.js";
import type { DomainEvent } from "../../../shared/contracts/events.js";
import { itemKey } from "../../expiration/domain/expiration-item.js";
import { policyKey, policyRefKey, validatePolicyScope, type ReminderPolicy, type PutPolicyInput } from "../domain/reminder-policy.js";
import { isTransactionCanceled, type ReminderStore, type TransactWriteEntry } from "../ports/reminder-store.js";
import type { ReminderIdGenerator } from "./id-generator.js";

const POLICY_CHANGED = "reminder.policy-changed.v1";

export interface ReminderPolicyServiceDeps {
  store: ReminderStore;
  tableName: string;
  ids: ReminderIdGenerator;
  now?: () => string;
}

export class ReminderPolicyService {
  private readonly store: ReminderStore;
  private readonly tableName: string;
  private readonly ids: ReminderIdGenerator;
  private readonly now: () => string;

  constructor(deps: ReminderPolicyServiceDeps) {
    this.store = deps.store;
    this.tableName = deps.tableName;
    this.ids = deps.ids;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async createPolicy(ctx: RequestContext, input: PutPolicyInput): Promise<ReminderPolicy> {
    authorize({ context: ctx, action: "reminder:manage", resource: { tenantId: ctx.tenant.tenantId } });
    validatePolicyScope(input);

    const tenantId = ctx.tenant.tenantId;
    const policyId = this.ids.newPolicyId();
    const now = this.now();
    const policy: ReminderPolicy = {
      ...policyKey(tenantId, policyId),
      entityType: "ReminderPolicy",
      policyId,
      tenantId,
      scope: input.scope,
      itemId: input.itemId,
      name: input.rule.name,
      triggers: input.rule.triggers,
      timeZone: input.rule.timeZone,
      quietHours: input.rule.quietHours,
      channels: input.rule.channels,
      optOutChannels: input.rule.optOutChannels,
      enabled: input.enabled ?? true,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const entries: TransactWriteEntry[] = [{ Put: buildVersionedCreate(this.tableName, policy as unknown as Record<string, unknown> & { PK: string; SK: string }) }];
    this.appendItemLinkage(entries, { tenantId, itemId: input.itemId, scope: input.scope, policyId });
    this.appendPolicyChangedEvent(entries, ctx, { policyId, itemId: input.scope === "ITEM" ? input.itemId : undefined }, 1);

    try {
      await this.store.transactWrite(entries);
    } catch (err) {
      if (isTransactionCanceled(err)) {
        throw new ConflictError("Unable to create policy - target item may not exist, be inactive, or belong to another tenant.", { policyId, itemId: input.itemId });
      }
      throw err;
    }
    return policy;
  }

  async getPolicy(ctx: RequestContext, policyId: string): Promise<ReminderPolicy> {
    const policy = await this.readActivePolicy(ctx.tenant.tenantId, policyId);
    authorize({ context: ctx, action: "reminder:manage", resource: { tenantId: policy.tenantId } });
    return policy;
  }

  async updatePolicy(
    ctx: RequestContext,
    policyId: string,
    input: PutPolicyInput,
    expectedVersion: number,
  ): Promise<ReminderPolicy> {
    const policy = await this.readActivePolicy(ctx.tenant.tenantId, policyId);
    authorize({ context: ctx, action: "reminder:manage", resource: { tenantId: policy.tenantId } });
    validatePolicyScope(input);

    const tenantId = policy.tenantId;
    const set: Record<string, unknown> = {
      scope: input.scope,
      itemId: input.itemId,
      name: input.rule.name,
      triggers: input.rule.triggers,
      timeZone: input.rule.timeZone,
      quietHours: input.rule.quietHours,
      channels: input.rule.channels,
      optOutChannels: input.rule.optOutChannels,
      enabled: input.enabled ?? policy.enabled,
    };

    const entries: TransactWriteEntry[] = [
      {
        Update: buildVersionedUpdate({
          tableName: this.tableName,
          key: policyKey(tenantId, policyId),
          tenantId,
          expectedVersion,
          set,
        }),
      },
    ];

    // §5's pointer-move invariant: remove the OLD pointer whenever the policy stops being
    // this exact ITEM's policy (scope left ITEM, or itemId changed) - BEFORE adding a new
    // one, so a move and a plain re-save of the same itemId are told apart correctly.
    const movedAwayFromItem = policy.scope === "ITEM" && (input.scope !== "ITEM" || input.itemId !== policy.itemId);
    if (movedAwayFromItem) {
      entries.push({ Delete: { TableName: this.tableName, Key: policyRefKey(tenantId, policy.itemId!, policyId) } });
    }
    // Only write a NEW pointer when the target item actually changed (or scope just became
    // ITEM) - re-Put-ing an unchanged pointer with attribute_not_exists would otherwise
    // fail its own condition every time an unrelated field (e.g. triggers) is edited.
    const needsNewPointer = input.scope === "ITEM" && (policy.scope !== "ITEM" || input.itemId !== policy.itemId);
    this.appendItemLinkage(entries, { tenantId, itemId: needsNewPointer ? input.itemId : undefined, scope: input.scope, policyId, skipPointerWrite: !needsNewPointer });

    this.appendPolicyChangedEvent(
      entries,
      ctx,
      {
        policyId,
        itemId: input.scope === "ITEM" ? input.itemId : undefined,
        previousItemId: movedAwayFromItem ? policy.itemId : undefined,
      },
      expectedVersion + 1,
    );

    try {
      await this.store.transactWrite(entries);
    } catch (err) {
      if (isTransactionCanceled(err) || isConditionalCheckFailed(err)) {
        throw new ConflictError("VERSION_CONFLICT (or target item does not exist/is inactive/belongs to another tenant).", { policyId });
      }
      throw err;
    }

    return { ...policy, ...(set as Partial<ReminderPolicy>), version: expectedVersion + 1, updatedAt: this.now() };
  }

  async disablePolicy(ctx: RequestContext, policyId: string, expectedVersion: number): Promise<void> {
    const policy = await this.readActivePolicy(ctx.tenant.tenantId, policyId);
    authorize({ context: ctx, action: "reminder:manage", resource: { tenantId: policy.tenantId } });

    const entries: TransactWriteEntry[] = [
      {
        Update: buildVersionedUpdate({
          tableName: this.tableName,
          key: policyKey(policy.tenantId, policyId),
          tenantId: policy.tenantId,
          expectedVersion,
          set: { enabled: false },
        }),
      },
    ];
    // Pointer is intentionally left in place (§5: "a disabled policy must still be
    // reachable so its occurrences get cancelled, not orphaned") - no pointer mutation here.
    this.appendPolicyChangedEvent(
      entries,
      ctx,
      { policyId, itemId: policy.scope === "ITEM" ? policy.itemId : undefined },
      expectedVersion + 1,
    );

    try {
      await this.store.transactWrite(entries);
    } catch (err) {
      if (isTransactionCanceled(err) || isConditionalCheckFailed(err)) {
        throw new ConflictError("VERSION_CONFLICT", { policyId });
      }
      throw err;
    }
  }

  private async readActivePolicy(tenantId: string, policyId: string): Promise<ReminderPolicy> {
    const policy = await this.store.get<ReminderPolicy>(policyKey(tenantId, policyId));
    if (!policy || policy.deletedAt) {
      throw new NotFoundError("ReminderPolicy not found.", { policyId });
    }
    return policy;
  }

  /** Appends the ITEM-existence ConditionCheck + (unless `skipPointerWrite`) the new pointer Put, when `itemId` is present. */
  private appendItemLinkage(
    entries: TransactWriteEntry[],
    input: { tenantId: string; itemId: string | undefined; scope: PutPolicyInput["scope"]; policyId: string; skipPointerWrite?: boolean },
  ): void {
    if (input.scope !== "ITEM" || !input.itemId) return;
    entries.push(
      buildExistenceConditionCheck({
        tableName: this.tableName,
        key: itemKey(input.tenantId, input.itemId),
        extra: { tenantId: input.tenantId, status: "ACTIVE" },
      }),
    );
    if (!input.skipPointerWrite) {
      entries.push({
        Put: {
          TableName: this.tableName,
          Item: { ...policyRefKey(input.tenantId, input.itemId, input.policyId), entityType: "ReminderPolicyRef", policyId: input.policyId },
          ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        },
      });
    }
  }

  private appendPolicyChangedEvent(
    entries: TransactWriteEntry[],
    ctx: RequestContext,
    data: { policyId: string; itemId?: string; previousItemId?: string },
    aggregateVersion: number,
  ): void {
    const event: DomainEvent = {
      specVersion: "1.0",
      eventId: this.ids.newEventId(),
      eventType: POLICY_CHANGED,
      source: "expiration-tracker.reminder",
      occurredAt: this.now(),
      correlationId: ctx.correlationId,
      tenantId: ctx.tenant.tenantId,
      actor: { type: "USER", userId: ctx.principal.userId },
      aggregate: { type: "ReminderPolicy", id: data.policyId, version: aggregateVersion },
      // Explicit null rather than an omitted/undefined key for "not applicable" - matches
      // the ItemDueDateChanged convention (previousDueDate: null) and keeps the field
      // required-but-nullable in the schema instead of optional-and-possibly-undefined,
      // which DynamoDB marshalling and JSON Schema validation both handle more predictably.
      data: { policyId: data.policyId, itemId: data.itemId ?? null, previousItemId: data.previousItemId ?? null },
    };
    appendToTransaction(entries, this.tableName, event);
  }

  /** Marker so createPolicy can also build the first Put via the shared OCC builder if a caller needs the raw command (kept for symmetry/documentation). */
  static buildCreateCommand(tableName: string, policy: ReminderPolicy) {
    return buildVersionedCreate(tableName, policy as unknown as Record<string, unknown> & { PK: string; SK: string });
  }
}

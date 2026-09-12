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
import { authorize, authorizedTenantId, type AuthorizedTenantId } from "../../identity/domain/authorization.js";
import { ConflictError, NotFoundError } from "../../../shared/errors/app-error.js";
import { buildExistenceConditionCheck, buildVersionedCreate, buildVersionedUpdate, isConditionalCheckFailed } from "../../../shared/dynamodb/occ.js";
import { appendToTransaction } from "../../../shared/outbox/outbox.js";
import type { DomainEvent } from "../../../shared/contracts/events.js";
import { itemKey } from "../../expiration/domain/expiration-item.js";
import { policyKey, activePolicyPointerKey, POLICY_REF_SK_PREFIX, validatePolicyScope, type ReminderPolicy, type PolicyRef, type PutPolicyInput } from "../domain/reminder-policy.js";
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

    const tenantId = authorizedTenantId(ctx);
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

  /**
   * D-258: item->policy discovery. `policyId` is server-generated (ULID) and unrelated to
   * `itemId`, so a caller holding only an `itemId` (e.g. the A06 frontend screen) has no way
   * to reach `GET /reminders/policies/{policyId}` directly. Resolved via the SAME `POLICYREF#`
   * pointer row (`reminder-policy.ts`'s `policyRefKey`) the materialization-trigger worker
   * already uses to discover ITEM-scoped policies for an item - this is discovery-only
   * wiring, not a new capability: the pointer has existed since BLOCKER-B (§5), just never
   * had an HTTP route reading it. Returns `null` (never throws NotFoundError) when the item
   * has no policy yet - "no policy configured" is a legitimate, common state (A06's
   * no-policy-yet screen state), not an error.
   *
   * `reminder:read` (READ_ONLY_ROLES), never `reminder:manage` - Codex review finding (D-258
   * round 1): gating a pure read behind WRITE_ROLES locked VIEWER out of A06 entirely, even
   * though the screen itself renders a read-only view for VIEWER.
   *
   * P0.4 uniqueness fix (Claude<->Codex protocol, decisions-log.md D-XXX): the domain now
   * enforces at most one live ITEM-scoped policy per item via the fixed
   * `activePolicyPointerKey()` pointer, so the fixed pointer is tried FIRST and, once
   * valid, is authoritative-enough to return directly - no more "most recently updated
   * among candidates" ambiguity. The legacy per-policy `POLICYREF#` prefix query below is
   * a READ-ONLY fallback for the one-time migration window only (an item whose policies
   * predate this deploy and haven't been migrated yet still has only legacy pointers) -
   * every write path (`createPolicy`/`updatePolicy`) writes ONLY the fixed pointer from
   * now on, so this fallback stops being exercised for a given item the moment the P0.4
   * migration script (or any subsequent edit, which self-heals the fixed pointer) runs
   * for it. Same orphan-tolerance discipline as before: nothing here is ever trusted
   * without dereferencing and re-validating the real `ReminderPolicy` row.
   */
  async getPolicyForItem(ctx: RequestContext, itemId: string): Promise<ReminderPolicy | null> {
    const tenantId = authorizedTenantId(ctx);
    authorize({ context: ctx, action: "reminder:read", resource: { tenantId } });

    const fixedRef = await this.store.get<PolicyRef>(activePolicyPointerKey(tenantId, itemId));
    if (fixedRef) {
      const policy = await this.validItemPolicyOrUndefined(tenantId, itemId, fixedRef.policyId);
      if (policy) return policy;
      // Fixed pointer exists but is stale/orphaned - fall through to the legacy scan
      // below rather than trusting it; never returned as-is.
    }

    const refs = await this.store.queryByItem<PolicyRef>(tenantId, itemId, POLICY_REF_SK_PREFIX);
    if (refs.length === 0) return null;

    const candidates: ReminderPolicy[] = [];
    for (const ref of refs) {
      const policy = await this.validItemPolicyOrUndefined(tenantId, itemId, ref.policyId);
      if (policy) candidates.push(policy);
    }
    if (candidates.length === 0) return null;
    return candidates.reduce((latest, candidate) => (candidate.updatedAt > latest.updatedAt ? candidate : latest));
  }

  private async validItemPolicyOrUndefined(tenantId: string, itemId: string, policyId: string): Promise<ReminderPolicy | undefined> {
    const policy = await this.store.get<ReminderPolicy>(policyKey(tenantId, policyId));
    if (!policy || policy.deletedAt || policy.tenantId !== tenantId || policy.scope !== "ITEM" || policy.itemId !== itemId) {
      return undefined; // orphaned/stale pointer (§5) - never trusted, same discipline as the trigger worker.
    }
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

    const tenantId = authorizedTenantId(ctx);
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
    // P0.4: the Delete itself carries the ownership condition (`policyId = :policyId`) -
    // never a separate ConditionCheck on the same key, which TransactWriteItems forbids
    // alongside another action on that same item (Claude<->Codex protocol Round 4 finding).
    const movedAwayFromItem = policy.scope === "ITEM" && (input.scope !== "ITEM" || input.itemId !== policy.itemId);
    if (movedAwayFromItem) {
      entries.push({
        Delete: {
          TableName: this.tableName,
          Key: activePolicyPointerKey(tenantId, policy.itemId!),
          ConditionExpression: "policyId = :ownedPolicyId",
          ExpressionAttributeValues: { ":ownedPolicyId": policyId },
        },
      });
    }
    this.appendItemLinkage(entries, { tenantId, itemId: input.scope === "ITEM" ? input.itemId : undefined, scope: input.scope, policyId });

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

  /**
   * Appends the ITEM-existence ConditionCheck plus an upsert-style conditioned Put of the
   * fixed pointer, whenever `itemId` is present (P0.4 uniqueness fix, protocol Round 5-6).
   * A single Put handles every case without a separate branch:
   *  - `attribute_not_exists(PK)`: no fixed pointer exists yet for this item (first-ever
   *    policy, a move onto a previously policy-less item, or a pre-P0.4 item whose fixed
   *    pointer this same edit lazily self-heals) - creates it.
   *  - `policyId = :policyId`: a fixed pointer already exists and belongs to THIS policy
   *    (a same-item, no-move edit) - the Put is an idempotent no-op overwrite, which is
   *    also the ownership fence Codex's Round 4 review required (an edit whose pointer
   *    belongs to a DIFFERENT policyId fails this condition and the whole transaction is
   *    rejected, never silently committed over a stale/foreign pointer).
   */
  private appendItemLinkage(
    entries: TransactWriteEntry[],
    input: { tenantId: AuthorizedTenantId; itemId: string | undefined; scope: PutPolicyInput["scope"]; policyId: string },
  ): void {
    if (input.scope !== "ITEM" || !input.itemId) return;
    entries.push(
      buildExistenceConditionCheck({
        tableName: this.tableName,
        key: itemKey(input.tenantId, input.itemId),
        extra: { tenantId: input.tenantId, status: "ACTIVE" },
      }),
    );
    entries.push({
      Put: {
        TableName: this.tableName,
        Item: { ...activePolicyPointerKey(input.tenantId, input.itemId), entityType: "ReminderPolicyRef", policyId: input.policyId, tenantId: input.tenantId },
        ConditionExpression: "attribute_not_exists(PK) OR policyId = :policyId",
        ExpressionAttributeValues: { ":policyId": input.policyId },
      },
    });
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
    appendToTransaction(entries, this.tableName, event, "SQS_REMINDER_MATERIALIZATION_TRIGGER_V1");
  }

  /** Marker so createPolicy can also build the first Put via the shared OCC builder if a caller needs the raw command (kept for symmetry/documentation). */
  static buildCreateCommand(tableName: string, policy: ReminderPolicy) {
    return buildVersionedCreate(tableName, policy as unknown as Record<string, unknown> & { PK: string; SK: string });
  }
}

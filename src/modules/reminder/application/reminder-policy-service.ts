/**
 * ReminderPolicyService — implementation-blueprint.md §9.1's `ReminderPolicyService`
 * interface. Mirrors ExpirationService's shape: authorize() (action `reminder:manage`,
 * already declared in the M1 authorization matrix), OCC via shared/dynamodb/occ.ts,
 * strongly-consistent reads. Policies are their own aggregate (data-model.md §2:
 * `TENANT#t#POLICY#p`/`META`), not nested under the item, so no TransactWriteItems is
 * needed for plain CRUD (no critical outbox event is fired by a policy edit itself -
 * materialization is a separate, explicit step triggered by ReminderMaterializer, exactly
 * like the item aggregate's own dueDate-change -> outbox -> async materialize pipeline).
 */
import type { RequestContext } from "../../identity/domain/request-context.js";
import { authorize } from "../../identity/domain/authorization.js";
import { ConflictError, NotFoundError } from "../../../shared/errors/app-error.js";
import { buildVersionedCreate, buildVersionedUpdate } from "../../../shared/dynamodb/occ.js";
import { policyKey, type ReminderPolicy, type PutPolicyInput } from "../domain/reminder-policy.js";
import { isTransactionCanceled, type ReminderStore } from "../ports/reminder-store.js";
import type { ReminderIdGenerator } from "./id-generator.js";
import { isConditionalCheckFailed } from "../../../shared/dynamodb/occ.js";

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

    const policyId = this.ids.newPolicyId();
    const now = this.now();
    const policy: ReminderPolicy = {
      ...policyKey(ctx.tenant.tenantId, policyId),
      entityType: "ReminderPolicy",
      policyId,
      tenantId: ctx.tenant.tenantId,
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

    const created = await this.store.putIfAbsent(policy);
    if (!created) {
      throw new ConflictError("Policy already exists.", { policyId });
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

    try {
      await this.store.transactWrite([
        {
          Update: buildVersionedUpdate({
            tableName: this.tableName,
            key: policyKey(policy.tenantId, policyId),
            tenantId: policy.tenantId,
            expectedVersion,
            set,
          }),
        },
      ]);
    } catch (err) {
      if (isTransactionCanceled(err) || isConditionalCheckFailed(err)) {
        throw new ConflictError("VERSION_CONFLICT", { policyId });
      }
      throw err;
    }

    return { ...policy, ...(set as Partial<ReminderPolicy>), version: expectedVersion + 1, updatedAt: this.now() };
  }

  async disablePolicy(ctx: RequestContext, policyId: string, expectedVersion: number): Promise<void> {
    const policy = await this.readActivePolicy(ctx.tenant.tenantId, policyId);
    authorize({ context: ctx, action: "reminder:manage", resource: { tenantId: policy.tenantId } });
    try {
      await this.store.transactWrite([
        {
          Update: buildVersionedUpdate({
            tableName: this.tableName,
            key: policyKey(policy.tenantId, policyId),
            tenantId: policy.tenantId,
            expectedVersion,
            set: { enabled: false },
          }),
        },
      ]);
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

  /** Marker so createPolicy can also build the first Put via the shared OCC builder if a caller needs the raw command (kept for symmetry/documentation; createPolicy itself uses putIfAbsent, which is equivalent for a version=1 item since ReminderStore.putIfAbsent already encodes attribute_not_exists(PK)). */
  static buildCreateCommand(tableName: string, policy: ReminderPolicy) {
    return buildVersionedCreate(tableName, policy as unknown as Record<string, unknown> & { PK: string; SK: string });
  }
}

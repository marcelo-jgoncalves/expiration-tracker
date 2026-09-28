/**
 * TransferOwnershipService — D-348 (`docs/architecture/reviews/organization-ownership-transfer-scoping/`,
 * 5-round Claude<->Codex protocol, Claude 9.2/Codex 9.2). Atomically swaps the OWNER seat between
 * the caller (who must BE the OWNER Membership relinquishing it - never another OWNER acting on
 * their behalf) and a target member who is not currently OWNER.
 *
 * `Organization.ownerCount` is deliberately NOT touched: a pure swap has zero net change in ACTIVE
 * OWNER count (one leaves the tier, one enters it in the SAME transaction), and
 * `buildOwnerCountDeltaEntry` targets the same `organizationKey()` item for both directions -
 * calling it twice in one `TransactWriteItems` would collide on that single key
 * (`ValidationException: Transaction request cannot include multiple operations on one item`).
 * The two `ConditionExpression`s on the Membership updates below are what actually guarantee the
 * organization never has zero or two extra OWNERs mid-transaction, not a counter.
 *
 * Version pre-checks (achado real, Rodada 2): `caller.version`/`target.version` are compared to
 * the caller-supplied expected versions BEFORE building the transaction, so the `fromRole`/`toRole`
 * recorded in the audit events are guaranteed to describe the exact same read the transaction's own
 * `ConditionExpression` will re-validate - never a hypothetical newer state the condition would
 * also have accepted.
 */
import { authorize, authorizedTenantId } from "../../identity/domain/authorization.js";
import type { RequestContext } from "../../identity/domain/request-context.js";
import { getCancellationReasonCodes, isTransactionCanceled, type TransactWriteEntry } from "../../../shared/dynamodb/occ.js";
import {
  ConflictError,
  DependencyUnavailableError,
  InternalError,
  NotFoundError,
  OwnershipTransferTargetAlreadyOwnerError,
  OwnershipTransferTargetIneligibleError,
  SelfOwnershipTransferError,
} from "../../../shared/errors/app-error.js";
import { membershipKey, type Membership } from "../domain/membership.js";
import { appendMembershipAuditToTransaction, buildMembershipAuditEvent } from "../domain/audit-event.js";
import type { OrganizationStore } from "../ports/organization-store.js";
import type { OrganizationIdGenerator } from "./id-generator.js";
import type { GlobalUserRepository } from "../../identity/persistence/global-user-repository.js";

/** Real `CancellationReasons[].Code` values (AWS `TransactWriteItems` API reference) - never SDK
 * exception names (`ValidationException`/`ThrottlingException` do NOT appear here). */
const PERMANENT_REASONS = new Set(["ValidationError", "ItemCollectionSizeLimitExceeded"]);
const TRANSIENT_REASONS = new Set(["TransactionConflict", "ThrottlingError", "ProvisionedThroughputExceeded"]);
const KNOWN_REASONS = new Set(["None", "ConditionalCheckFailed", ...PERMANENT_REASONS, ...TRANSIENT_REASONS]);

/** Rodada 4/5 achado real: a razão desconhecida precisa ser detectada ANTES de qualquer ramo de
 * conflito por índice - mesmo com um `ConditionalCheckFailed` presente em outro índice, não
 * entender uma das razões é motivo para nunca oferecer um retry confiante em lugar nenhum. */
function classifyTransferCancellation(err: unknown, targetUserId: string): never {
  if (!isTransactionCanceled(err)) throw err;
  const reasons = getCancellationReasonCodes(err);

  if (!reasons || reasons.every((r) => r === "None")) {
    throw new InternalError("Transaction canceled with no identifiable reason.", { targetUserId });
  }
  if (reasons.some((r) => PERMANENT_REASONS.has(r))) {
    throw new InternalError("Transfer failed due to a non-retryable write error.", { targetUserId });
  }
  if (reasons.some((r) => !KNOWN_REASONS.has(r))) {
    throw new InternalError("Transfer failed for an unrecognized reason - not safe to retry automatically.", { targetUserId });
  }
  if (reasons[0] === "ConditionalCheckFailed") {
    throw new ConflictError("Your role changed or your version is out of date - reload and try again.", { targetUserId });
  }
  if (reasons[1] === "ConditionalCheckFailed") {
    throw new ConflictError("The target member is no longer eligible or their version changed - reload and try again.", { targetUserId });
  }
  if (reasons[2] === "ConditionalCheckFailed" || reasons[3] === "ConditionalCheckFailed") {
    throw new ConflictError("Internal audit conflict - try again.", { targetUserId });
  }
  if (reasons.some((r) => TRANSIENT_REASONS.has(r))) {
    throw new DependencyUnavailableError("The transfer could not be completed right now - try again.", { targetUserId });
  }
  throw new InternalError("Transfer failed for an unrecognized reason - not safe to retry automatically.", { targetUserId });
}

export class TransferOwnershipService {
  constructor(
    private readonly store: OrganizationStore,
    private readonly tableName: string,
    private readonly ids: OrganizationIdGenerator,
    private readonly globalUsers: GlobalUserRepository,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async transfer(ctx: RequestContext, targetUserId: string, expectedCallerVersion: number, expectedTargetVersion: number): Promise<void> {
    authorize({ context: ctx, action: "membership:transfer-ownership", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = authorizedTenantId(ctx);
    const callerUserId = ctx.principal.userId;

    if (targetUserId === callerUserId) {
      throw new SelfOwnershipTransferError();
    }

    const caller = await this.store.get<Membership>(membershipKey(tenantId, callerUserId));
    if (!caller || caller.status !== "ACTIVE" || caller.role !== "OWNER") {
      // The RBAC tier above already requires an OWNER role claim, so this is either a stale
      // token or a genuinely concurrent demotion between authorization and this read - never
      // trust the JWT claim alone for a transaction this sensitive.
      throw new NotFoundError("No active OWNER membership for the caller.", { callerUserId });
    }
    if (caller.version !== expectedCallerVersion) {
      throw new ConflictError("Your version is out of date - reload and try again.", { callerUserId });
    }

    const target = await this.store.get<Membership>(membershipKey(tenantId, targetUserId));
    if (!target || target.status !== "ACTIVE") {
      throw new NotFoundError("No active membership for this user.", { targetUserId });
    }
    if (target.version !== expectedTargetVersion) {
      throw new ConflictError("The target member's version is out of date - reload and try again.", { targetUserId });
    }
    if (target.role === "OWNER") {
      throw new OwnershipTransferTargetAlreadyOwnerError(undefined, { targetUserId });
    }

    const targetIdentity = await this.globalUsers.get(targetUserId);
    if (!targetIdentity || targetIdentity.identityStatus !== "ACTIVE") {
      throw new OwnershipTransferTargetIneligibleError(undefined, { targetUserId });
    }

    const now = this.now();
    const auditEventIdCaller = this.ids.newAuditEventId();
    const auditEventIdTarget = this.ids.newAuditEventId();

    const entries: TransactWriteEntry[] = [
      {
        Update: {
          TableName: this.tableName,
          Key: membershipKey(tenantId, callerUserId),
          UpdateExpression: "SET role = :admin, version = version + :one",
          ConditionExpression: "#status = :active AND #role = :owner AND version = :expectedCallerVersion",
          ExpressionAttributeNames: { "#status": "status", "#role": "role" },
          ExpressionAttributeValues: { ":admin": "ADMIN", ":active": "ACTIVE", ":owner": "OWNER", ":one": 1, ":expectedCallerVersion": expectedCallerVersion },
        },
      },
      {
        Update: {
          TableName: this.tableName,
          Key: membershipKey(tenantId, targetUserId),
          UpdateExpression: "SET role = :owner, version = version + :one",
          ConditionExpression: "#status = :active AND #role <> :owner AND version = :expectedTargetVersion",
          ExpressionAttributeNames: { "#status": "status", "#role": "role" },
          ExpressionAttributeValues: { ":owner": "OWNER", ":active": "ACTIVE", ":one": 1, ":expectedTargetVersion": expectedTargetVersion },
        },
      },
    ];
    appendMembershipAuditToTransaction(
      entries,
      this.tableName,
      buildMembershipAuditEvent({
        auditEventId: auditEventIdCaller,
        organizationId: tenantId,
        resourceType: "Membership",
        resourceId: caller.membershipId,
        action: "OWNERSHIP_TRANSFERRED",
        actor: { type: "USER", userId: callerUserId },
        previousVersion: expectedCallerVersion,
        newVersion: expectedCallerVersion + 1,
        changes: { fromRole: "OWNER", toRole: "ADMIN", counterpartUserId: targetUserId, direction: "RELINQUISHED" },
        occurredAt: now,
        correlationId: ctx.correlationId,
      }),
    );
    appendMembershipAuditToTransaction(
      entries,
      this.tableName,
      buildMembershipAuditEvent({
        auditEventId: auditEventIdTarget,
        organizationId: tenantId,
        resourceType: "Membership",
        resourceId: target.membershipId,
        action: "OWNERSHIP_TRANSFERRED",
        actor: { type: "USER", userId: callerUserId },
        previousVersion: expectedTargetVersion,
        newVersion: expectedTargetVersion + 1,
        changes: { fromRole: target.role, toRole: "OWNER", counterpartUserId: callerUserId, direction: "RECEIVED" },
        occurredAt: now,
        correlationId: ctx.correlationId,
      }),
    );

    try {
      await this.store.transactWrite(entries);
    } catch (err) {
      classifyTransferCancellation(err, targetUserId);
    }
  }
}

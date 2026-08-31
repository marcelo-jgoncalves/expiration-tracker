/**
 * Real DynamoDB adapters for the W3-07 purge pipeline's scan-based candidate sources
 * (`workers/tenant-purge/{dynamo-tenant-purge,session-table-tenant-purge}.ts`'s ports). Lives in
 * `shared/dynamodb/` (not a module's `persistence/`) because a tenant-wide purge is cross-module
 * by nature — see `.dependency-cruiser.cjs`'s `no-raw-dynamodb-writes-outside-lanes` rule, which
 * allows raw `@aws-sdk/lib-dynamodb` access from exactly this directory.
 *
 * Both adapters use `ScanCommand`, not `QueryCommand` — see `dynamo-tenant-purge.ts`'s file
 * header for why (no GSI keyed purely by tenantId exists on either table). A full-table Scan is
 * acceptable here specifically because tenant deletion is rare and asynchronous (not a hot path),
 * unlike every other read in this codebase, which is Query-only by design.
 */
import { ScanCommand, DeleteCommand, GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { TransactWriteEntry } from "./occ.js";
import type { SystemMutationStore } from "../tenant-lifecycle/system-mutation.js";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { isConditionalCheckFailed } from "./occ.js";
import type { TenantPurgeCandidateSource, TenantScanItem, TenantScanPage } from "../../workers/tenant-purge/dynamo-tenant-purge.js";
import type { SessionTablePurgeSource, SessionTableScanItem, SessionTableScanPage } from "../../workers/tenant-purge/session-table-tenant-purge.js";
import type { TenantLifecycleScanPage, TenantLifecycleScanSource } from "../../workers/tenant-purge/tenant-purge-sweep.js";
import type { TenantLifecycleReader } from "../../workers/tenant-purge/lifecycle-transition.js";
import { tenantLifecycleKey, type TenantLifecycleRecord } from "../tenant-lifecycle/tenant-lifecycle-record.js";

/** Main table: every tenant-owned row's PK is `TENANT#<tenantId>#...` (universal convention,
 * confirmed by exhaustive grep across `src/modules/**\/domain` — see
 * `w3-07-writer-inventory.md`/`decisions-log.md` D-076 for the same convention already relied on
 * by `TenantBusinessMutation`'s PK cross-validation). */
export class DynamoDbTenantPurgeCandidateSource implements TenantPurgeCandidateSource {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly pageLimit = 500,
  ) {}

  async scanTenantItems(tenantId: string, exclusiveStartKey?: Record<string, unknown>): Promise<TenantScanPage> {
    // W3-07 review finding (Codex round on the purge pipeline, B1, 2026-08-29): a PK-prefix-only
    // filter misses real tenant-owned entity types whose PK is NOT `TENANT#<id>#...` by design —
    // `GuestTokenPointer` (`GUESTTOKEN#<selectorHash>`) and `TextractJob` (`TEXTRACTJOB#<jobId>`)
    // are the two documented exceptions (see their domain files) that still declare `tenantId` as
    // a plain attribute. OR'ing in `tenantId = :tenantId` catches these (and any future exception
    // of the same shape) without needing a new GSI — same discipline as `findTenantMismatch`'s
    // declared-tenantId check on the business-mutation side. `IdentityMapping`
    // (`identity-mapping-repository.ts`) is tenantless since B2B-5/D-095 (no `tenantId` attribute,
    // `PK=IDENTITY#cognitoSub#<sub>`) — neither clause below returns it, so it is out of reach of
    // this scan entirely; `PURGE_DELETE`'s canonical-key guard (`system-mutation.ts`) is defense in
    // depth for a hypothetical future regression, not a defense against something this scan finds
    // today.
    //
    // Wave B2B-9 (W3-07/Privacy Reconciliation, D-104, 2026-08-30): a THIRD real exception found —
    // `InvitationTokenPointer` (`organization/domain/invitation-token.ts`, `PK=INVITATION_TOKEN#
    // <selectorHash>`, same tenantless-pointer family as `GuestTokenPointer`) declares
    // `organizationId`, not `tenantId`, as its tenant-scoping attribute. Post-B2B, "tenantId" and
    // "organizationId" name the same concept (`roadmap-evolution/17` §125.4) but not every writer
    // uses the historical name — OR'ing in `organizationId = :tenantId` closes this without forcing
    // a rename of an already-shipped field.
    const result = await this.client.send(
      new ScanCommand({
        TableName: this.tableName,
        FilterExpression: "begins_with(PK, :prefix) OR tenantId = :tenantId OR organizationId = :tenantId",
        ExpressionAttributeValues: { ":prefix": `TENANT#${tenantId}#`, ":tenantId": tenantId },
        ExclusiveStartKey: exclusiveStartKey,
        Limit: this.pageLimit,
      }),
    );
    return {
      items: (result.Items ?? []) as TenantScanItem[],
      lastEvaluatedKey: result.LastEvaluatedKey,
    };
  }
}

/** `bff-session-table`: separate physical table, no GSI, `tenantId` is a plain attribute (not
 * part of the key) on `Session` rows only — see `session-table-tenant-purge.ts`'s file header for
 * why `LoginAttempt` rows are out of reach of this adapter by design. */
export class DynamoDbSessionTablePurgeSource implements SessionTablePurgeSource {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly pageLimit = 500,
  ) {}

  async scanTenantSessions(tenantId: string, exclusiveStartKey?: Record<string, unknown>): Promise<SessionTableScanPage> {
    const result = await this.client.send(
      new ScanCommand({
        TableName: this.tableName,
        FilterExpression: "tenantId = :tenantId",
        ExpressionAttributeValues: { ":tenantId": tenantId },
        ExclusiveStartKey: exclusiveStartKey,
        Limit: this.pageLimit,
      }),
    );
    return {
      items: (result.Items ?? []) as SessionTableScanItem[],
      lastEvaluatedKey: result.LastEvaluatedKey,
    };
  }

  /**
   * Conditional delete — idempotent at the DynamoDB API level for an already-gone key
   * (`attribute_not_exists(PK)` half), and (B5 fix) re-asserts the stored `tenantId` attribute
   * still matches `expectedTenantId` server-side at commit time — this table's keys carry no
   * tenant prefix at all (unlike the main table), so this attribute-equality condition is the
   * only structural tenant-ownership guard available on the physical delete itself. Returns
   * `{ deleted: false }` on a conditional-check failure rather than throwing — the caller
   * (`session-table-tenant-purge.ts`) treats that as a safety-condition rejection, never a
   * fatal error.
   */
  async deleteSession(key: { PK: string; SK: string }, expectedTenantId: string): Promise<{ deleted: boolean }> {
    try {
      await this.client.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: key,
          ConditionExpression: "attribute_not_exists(PK) OR tenantId = :expectedTenantId",
          ExpressionAttributeValues: { ":expectedTenantId": expectedTenantId },
        }),
      );
      return { deleted: true };
    } catch (err) {
      if (isConditionalCheckFailed(err)) return { deleted: false };
      throw err;
    }
  }
}

/**
 * W3-07 purge orchestrator (D-124): the `SystemMutationStore` the purge and the lifecycle
 * transitions commit through.
 *
 * Deliberately the narrowest possible adapter — `transactWrite` and nothing else. It exists here,
 * in `shared/dynamodb/` (one of the four directories `.dependency-cruiser.cjs`'s
 * `no-raw-dynamodb-writes-outside-lanes` rule permits raw write-command imports from), rather than
 * reusing some module's store, because a tenant purge is cross-module by nature and no single
 * module's persistence adapter is the right owner of it.
 *
 * This is NOT an escape hatch around the fence: `SystemMutation` never accepts caller-supplied
 * entries — `system-mutation.ts` is the only code that turns an allowlisted operation into the
 * entries handed to this method (see that file's header for why that shape is load-bearing).
 *
 * `TransactionCanceledException` must reach the caller intact so `isTransactionCanceled()` can
 * classify it — same discipline every module store already documents; it is never wrapped.
 */
export class DynamoDbSystemMutationStore implements SystemMutationStore {
  constructor(private readonly client: DynamoDBDocumentClient) {}

  async transactWrite(entries: TransactWriteEntry[]): Promise<void> {
    await this.client.send(new TransactWriteCommand({ TransactItems: entries }));
  }
}

/**
 * W3-07 purge orchestrator (D-124): consistent point read of one tenant's `TenantLifecycleRecord`.
 *
 * `ConsistentRead: true` is not optional here and is not this codebase's general house style (most
 * reads are deliberately eventually consistent). This read produces the `expectedVersion` that the
 * OCC-fenced `transitionTenantLifecycle` write is conditioned on: an eventually-consistent read
 * could return a stale version and turn every ordinary transition into a spurious conflict, which
 * for the state machine means a retry storm rather than progress.
 */
export class DynamoDbTenantLifecycleReader implements TenantLifecycleReader {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async read(tenantId: string): Promise<TenantLifecycleRecord | undefined> {
    const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: tenantLifecycleKey(tenantId), ConsistentRead: true }));
    return result.Item as TenantLifecycleRecord | undefined;
  }
}

/**
 * W3-07 purge orchestrator (D-124): discovery source for the recurring sweeper — every
 * `TenantLifecycleRecord` in the main table, found by `SK = "LIFECYCLE"`.
 *
 * Explicit, accepted cost tradeoff (D-121 Rodada 2 Fix 5, stated rather than hidden): DynamoDB
 * bills a Scan for every item read BEFORE the FilterExpression applies, so this costs
 * proportionally to total table size, not to the far smaller number of lifecycle records. Accepted
 * at this project's scale on the same proportionality argument the purge's own Scan already makes,
 * and explicitly NOT a permanent answer — a sparse GSI keyed by lifecycle status is the named
 * upgrade path and is itself a separate level-5 decision, deferred rather than smuggled in here.
 */
export class DynamoDbTenantLifecycleScanSource implements TenantLifecycleScanSource {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly pageLimit = 500,
  ) {}

  async scanLifecycleRecords(exclusiveStartKey?: Record<string, unknown>): Promise<TenantLifecycleScanPage> {
    const result = await this.client.send(
      new ScanCommand({
        TableName: this.tableName,
        FilterExpression: "SK = :lifecycleSk",
        ExpressionAttributeValues: { ":lifecycleSk": "LIFECYCLE" },
        ExclusiveStartKey: exclusiveStartKey,
        Limit: this.pageLimit,
      }),
    );
    return { items: (result.Items ?? []) as TenantLifecycleRecord[], lastEvaluatedKey: result.LastEvaluatedKey };
  }
}

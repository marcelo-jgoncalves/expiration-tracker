/** Real DynamoDB adapter for OutboxRelayStore (M3.5). Wired into both
 * DispatchOutboxRelay and OutboxSweeperReminderDispatch composition roots - the two
 * EXACTLY-two roles with `gsi6Read()` (see infra/lib/dynamo-table.ts). */
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { EntityKey } from "../../dynamodb/occ.js";
import type { OutboxRecord } from "../outbox.js";
import type { OutboxRelayStore } from "../relay-store.js";
import { isConditionalCheckFailed, mapDynamoError } from "../../dynamodb/sdk-errors.js";
import { auditGlobalIndexAccess, auditGlobalIndexAccessDenied, isAccessDeniedError, type GlobalIndexComponent } from "../../observability/security-audit.js";

export class DynamoDbOutboxRelayStore implements OutboxRelayStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    // Real finding, 2026-09-19: this was hardcoded to one string ("outbox-sweeper-reminder-
    // dispatch") even though TWO different Lambdas share this class - the shared outbox-sweeper
    // (covers email+reminder-dispatch) and the D-303 dedicated reminder-dispatch-outbox-sweeper
    // - so the security audit trail's component field lied about which one actually made the
    // GSI6 access. Each composition root now passes its own real GlobalIndexComponent value;
    // defaults to "outbox-sweeper" (the more common caller) only as a safety net, never silent.
    private readonly component: GlobalIndexComponent = "outbox-sweeper",
  ) {}

  async tryAcquireLease(key: EntityKey, leaseOwner: string, leaseExpiresAt: string, now: string): Promise<boolean> {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: key,
          UpdateExpression: "SET leaseOwner = :owner, leaseExpiresAt = :expires",
          ConditionExpression: "#status = :pending AND (attribute_not_exists(leaseOwner) OR leaseExpiresAt < :now)",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":pending": "PENDING", ":owner": leaseOwner, ":expires": leaseExpiresAt, ":now": now },
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw mapDynamoError(err, "OutboxRelayStore.tryAcquireLease");
    }
  }

  async markPublished(key: EntityKey): Promise<void> {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: key,
          // Bug found by Codex implementation review: without also removing GSI6PK/GSI6SK,
          // published records stayed indexed under RECON#OUTBOX#PENDING forever - not a
          // duplicate-send risk when acquisition checks persisted status, but the
          // sweeper's query would keep growing to include every record ever published,
          // reading and discarding them on every run.
          UpdateExpression: "SET #status = :published REMOVE leaseOwner, leaseExpiresAt, GSI6PK, GSI6SK",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":published": "PUBLISHED" },
        }),
      );
    } catch (err) {
      throw mapDynamoError(err, "OutboxRelayStore.markPublished");
    }
  }

  async listPendingReminderDispatch(input: { olderThan: string; pageSize?: number }): Promise<OutboxRecord[]> {
    let pageCount = 0;
    try {
      const items: OutboxRecord[] = [];
      let exclusiveStartKey: Record<string, unknown> | undefined;
      do {
        const result = await this.client.send(
          new QueryCommand({
            TableName: this.tableName,
            IndexName: "GSI6",
            KeyConditionExpression: "GSI6PK = :pk AND GSI6SK < :before",
            ExpressionAttributeValues: {
              ":pk": "RECON#OUTBOX#PENDING",
              ":before": input.olderThan,
            },
            Limit: input.pageSize,
            ExclusiveStartKey: exclusiveStartKey,
          }),
        );
        pageCount += 1;
        items.push(...((result.Items ?? []) as OutboxRecord[]));
        exclusiveStartKey = result.LastEvaluatedKey;
      } while (exclusiveStartKey);
      // Security audit trail (full-audit-round1-focused-round2-summary.md, achado real): só
      // sweeper roles (gsi6Read) call this method - `component` (constructor param) identifies
      // which one - ver docs/architecture/reviews/security-audit-trail-design/.
      auditGlobalIndexAccess({ indexName: "GSI6", operation: "Query", component: this.component, pageCount, resultCount: items.length });
      return items;
    } catch (err) {
      if (isAccessDeniedError(err)) {
        auditGlobalIndexAccessDenied({ indexName: "GSI6", operation: "Query", component: this.component, awsErrorCode: "AccessDeniedException" });
      }
      throw mapDynamoError(err, "OutboxRelayStore.listPendingReminderDispatch");
    }
  }
}

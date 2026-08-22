/**
 * Real DynamoDB adapter for ReminderReconciliationCandidateSource (M3.5). Separate class,
 * only wired into the ReminderReconciliation Lambda's composition root - same isolation
 * principle as DynamoDbReminderProducerStore. Queries GSI6's global (non-tenant-prefixed)
 * WORKSTATE#CLAIMED/WORKSTATE#DST_PENDING key families - see
 * src/modules/reminder/ports/reconciliation-candidate-source.ts and
 * docs/architecture/m3.5-runtime-design.md for why these keys are global.
 */
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  GSI6PK_WORKSTATE_CLAIMED,
  GSI6PK_WORKSTATE_DST_PENDING,
  type DstReconciliationCandidate,
  type ExpiredClaimCandidate,
  type Page,
  type ReminderReconciliationCandidateSource,
} from "../ports/reconciliation-candidate-source.js";
import { mapDynamoError } from "../../../shared/dynamodb/sdk-errors.js";
import { auditGlobalIndexAccess, auditGlobalIndexAccessDenied, isAccessDeniedError } from "../../../shared/observability/security-audit.js";

const DEFAULT_PAGE_SIZE = 200;

export class DynamoDbReminderReconciliationCandidateSource implements ReminderReconciliationCandidateSource {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async listExpiredClaims(input: { before: string; pageSize?: number; cursor?: string }): Promise<Page<ExpiredClaimCandidate>> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: "GSI6",
          KeyConditionExpression: "GSI6PK = :pk AND GSI6SK < :before",
          ExpressionAttributeValues: { ":pk": GSI6PK_WORKSTATE_CLAIMED, ":before": input.before },
          Limit: input.pageSize ?? DEFAULT_PAGE_SIZE,
          ExclusiveStartKey: input.cursor ? JSON.parse(input.cursor) : undefined,
        }),
      );
      // GSI6 is ALL-projected (infra/lib/dynamo-table.ts) - each row already IS the full
      // ReminderOccurrence item, no separate fetch needed.
      const items = (result.Items ?? []) as ExpiredClaimCandidate[];
      // Security audit trail (full-audit-round1-focused-round2-summary.md, achado real): 1
      // página por chamada aqui - pageCount sempre 1, ver
      // docs/architecture/reviews/security-audit-trail-design/.
      auditGlobalIndexAccess({ indexName: "GSI6", operation: "Query", component: "reminder-reconciliation", pageCount: 1, resultCount: items.length });
      return { items, cursor: result.LastEvaluatedKey ? JSON.stringify(result.LastEvaluatedKey) : undefined };
    } catch (err) {
      if (isAccessDeniedError(err)) {
        auditGlobalIndexAccessDenied({ indexName: "GSI6", operation: "Query", component: "reminder-reconciliation", awsErrorCode: "AccessDeniedException" });
      }
      throw mapDynamoError(err, "ReminderReconciliationCandidateSource.listExpiredClaims");
    }
  }

  async listDstCandidates(input: { window: { start: string; end: string }; pageSize?: number; cursor?: string }): Promise<Page<DstReconciliationCandidate>> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: "GSI6",
          KeyConditionExpression: "GSI6PK = :pk AND GSI6SK BETWEEN :start AND :end",
          ExpressionAttributeValues: { ":pk": GSI6PK_WORKSTATE_DST_PENDING, ":start": input.window.start, ":end": input.window.end },
          Limit: input.pageSize ?? DEFAULT_PAGE_SIZE,
          ExclusiveStartKey: input.cursor ? JSON.parse(input.cursor) : undefined,
        }),
      );
      // GSI6 is ALL-projected - each row already IS the full ReminderOccurrence item.
      const items = (result.Items ?? []) as DstReconciliationCandidate[];
      auditGlobalIndexAccess({ indexName: "GSI6", operation: "Query", component: "reminder-reconciliation", pageCount: 1, resultCount: items.length });
      return { items, cursor: result.LastEvaluatedKey ? JSON.stringify(result.LastEvaluatedKey) : undefined };
    } catch (err) {
      if (isAccessDeniedError(err)) {
        auditGlobalIndexAccessDenied({ indexName: "GSI6", operation: "Query", component: "reminder-reconciliation", awsErrorCode: "AccessDeniedException" });
      }
      throw mapDynamoError(err, "ReminderReconciliationCandidateSource.listDstCandidates");
    }
  }
}

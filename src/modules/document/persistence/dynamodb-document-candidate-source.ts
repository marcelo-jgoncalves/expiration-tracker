/** Real DynamoDB adapter for UploadSlotReconciliationSource (M6) — queries GSI6's global
 * RECON#UPLOAD#PENDING key family. Separate, narrower class from DynamoDbDocumentStore, same
 * isolation principle as DynamoDbReminderReconciliationCandidateSource: only wired into the
 * UploadSlotReconciliationWorker's composition root. */
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { EntityKey, Gsi6QueryInput, Page, UploadSlotReconciliationSource } from "../ports/document-store.js";
import { mapDynamoError } from "../../../shared/dynamodb/sdk-errors.js";
import { auditGlobalIndexAccess, auditGlobalIndexAccessDenied, isAccessDeniedError } from "../../../shared/observability/security-audit.js";

const DEFAULT_PAGE_SIZE = 200;

export class DynamoDbDocumentCandidateSource implements UploadSlotReconciliationSource {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async queryExpiredSlots<T extends EntityKey = Record<string, unknown> & EntityKey>(input: Gsi6QueryInput): Promise<Page<T>> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: "GSI6",
          KeyConditionExpression: "GSI6PK = :pk AND GSI6SK < :before",
          ExpressionAttributeValues: { ":pk": input.gsi6pk, ":before": input.before },
          Limit: input.pageSize ?? DEFAULT_PAGE_SIZE,
          ExclusiveStartKey: input.cursor ? JSON.parse(input.cursor) : undefined,
        }),
      );
      const items = (result.Items ?? []) as T[];
      // Security audit trail (full-audit-round1-focused-round2-summary.md pattern, extended
      // to the new privileged consumer added by M6): 1 event per logical call, single page
      // per call here (mirrors DynamoDbReminderReconciliationCandidateSource).
      auditGlobalIndexAccess({ indexName: "GSI6", operation: "Query", component: "upload-slot-reconciliation", pageCount: 1, resultCount: items.length });
      return { items, cursor: result.LastEvaluatedKey ? JSON.stringify(result.LastEvaluatedKey) : undefined };
    } catch (err) {
      if (isAccessDeniedError(err)) {
        auditGlobalIndexAccessDenied({ indexName: "GSI6", operation: "Query", component: "upload-slot-reconciliation", awsErrorCode: "AccessDeniedException" });
      }
      throw mapDynamoError(err, "UploadSlotReconciliationSource.queryExpiredSlots");
    }
  }
}

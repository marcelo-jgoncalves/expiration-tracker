/**
 * Real DynamoDB adapter for `ScheduledReportsCandidateSource` (D-211 fatia 2, D-204 decision 3) -
 * separate class, wired only into the ScheduledReportsScheduler Lambda's composition root, same
 * pattern as `requirement-reindex/dynamodb-candidate-source.ts`. `queryDue()` is the ONLY GSI8
 * access this role's IAM policy permits (`dynamodb:LeadingKeys` scoped to
 * `WORK#REPORT_SUBSCRIPTION`/`DLQ#REPORT_SUBSCRIPTION`, `infra/modules/dynamo-table/main.tf`) -
 * this worker never touches GSI3/GSI6 either.
 */
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { mapDynamoError } from "../../shared/dynamodb/sdk-errors.js";
import { auditGlobalIndexAccess, auditGlobalIndexAccessDenied, isAccessDeniedError } from "../../shared/observability/security-audit.js";
import type { ReportSubscriptionGsi8Candidate, ReportSubscriptionGsi8Page, ScheduledReportsCandidateSource } from "./candidate-source.js";

const PER_INVOCATION_LIMIT = 100;
const GSI8PK_REPORT_SUBSCRIPTION = "WORK#REPORT_SUBSCRIPTION";

/** Base table `PK` is `TENANT#<tenantId>#REPORTSUB#<subscriptionId>` (`reportSubscriptionKey()`,
 * `modules/reports/domain/report-subscription.ts`) - parsed here, not re-exported from the
 * domain module, since only this adapter ever sees a raw GSI8 row. */
function parseTenantAndSubscriptionIdFromPk(pk: string): { tenantId: string; subscriptionId: string } {
  const match = /^TENANT#(.+)#REPORTSUB#(.+)$/.exec(pk);
  if (!match || !match[1] || !match[2]) throw new Error(`Malformed base PK for scheduled-reports: ${pk}`);
  return { tenantId: match[1], subscriptionId: match[2] };
}

export class DynamoDbScheduledReportsCandidateSource implements ScheduledReportsCandidateSource {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async queryDue(input: { before: string; exclusiveStartKey?: Record<string, unknown> }): Promise<ReportSubscriptionGsi8Page> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: "GSI8",
          KeyConditionExpression: "GSI8PK = :pk AND GSI8SK < :before",
          ExpressionAttributeValues: { ":pk": GSI8PK_REPORT_SUBSCRIPTION, ":before": input.before },
          Limit: PER_INVOCATION_LIMIT,
          ExclusiveStartKey: input.exclusiveStartKey,
        }),
      );
      const items: ReportSubscriptionGsi8Candidate[] = (result.Items ?? []).map((raw) => {
        const row = raw as { PK: string; SK: string; GSI8SK: string };
        const { tenantId, subscriptionId } = parseTenantAndSubscriptionIdFromPk(row.PK);
        return { PK: row.PK, SK: row.SK, dueAtIso: row.GSI8SK.split("#TENANT#")[0]!, tenantId, subscriptionId };
      });
      auditGlobalIndexAccess({ indexName: "GSI8", operation: "Query", component: "scheduled-reports", pageCount: 1, resultCount: items.length });
      return { items, lastEvaluatedKey: result.LastEvaluatedKey };
    } catch (err) {
      if (isAccessDeniedError(err)) {
        auditGlobalIndexAccessDenied({ indexName: "GSI8", operation: "Query", component: "scheduled-reports", awsErrorCode: "AccessDeniedException" });
      }
      throw mapDynamoError(err, "ScheduledReportsCandidateSource.queryDue");
    }
  }
}

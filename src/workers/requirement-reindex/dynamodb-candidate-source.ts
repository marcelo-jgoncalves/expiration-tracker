/**
 * Real DynamoDB adapter for `RequirementReindexCandidateSource` (D-179 slice 4) — separate class,
 * wired only into the RequirementReindexWorker Lambda's composition root, same pattern as
 * `document-file-reconciliation/dynamodb-candidate-source.ts`. `queryDue()` is the ONLY GSI8
 * access this role's IAM policy permits (`dynamodb:LeadingKeys` scoped to
 * `WORK#REQUIREMENT_REINDEX`/`DLQ#REQUIREMENT_REINDEX`, `infra/modules/dynamo-table/main.tf`) —
 * this worker never touches GSI3/GSI6 either.
 */
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { mapDynamoError } from "../../shared/dynamodb/sdk-errors.js";
import { auditGlobalIndexAccess, auditGlobalIndexAccessDenied, isAccessDeniedError } from "../../shared/observability/security-audit.js";
import type { RequirementGsi8Candidate, RequirementGsi8Page, RequirementReindexCandidateSource } from "./candidate-source.js";

const PER_INVOCATION_LIMIT = 100;
const GSI8PK_REQUIREMENT_REINDEX = "WORK#REQUIREMENT_REINDEX";

/** Base table `PK` is `TENANT#<tenantId>#SUBJECT#<subjectId>` (`requirementKey()`, `modules/
 * document-archive/domain/requirement.ts`) — parsed here, not re-exported from the domain
 * module, since only this adapter ever sees a raw GSI8 row. */
function parseTenantAndSubjectIdFromPk(pk: string): { tenantId: string; subjectId: string } {
  const match = /^TENANT#(.+)#SUBJECT#(.+)$/.exec(pk);
  if (!match || !match[1] || !match[2]) throw new Error(`Malformed base PK for requirement-reindex: ${pk}`);
  return { tenantId: match[1], subjectId: match[2] };
}

/** Base table `SK` is `REQUIREMENT#<requirementId>` (`requirementKey()`). */
function parseRequirementIdFromSk(sk: string): string {
  const match = /^REQUIREMENT#(.+)$/.exec(sk);
  if (!match || !match[1]) throw new Error(`Malformed base SK for requirement-reindex: ${sk}`);
  return match[1];
}

export class DynamoDbRequirementReindexCandidateSource implements RequirementReindexCandidateSource {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async queryDue(input: { before: string; exclusiveStartKey?: Record<string, unknown> }): Promise<RequirementGsi8Page> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: "GSI8",
          KeyConditionExpression: "GSI8PK = :pk AND GSI8SK < :before",
          ExpressionAttributeValues: { ":pk": GSI8PK_REQUIREMENT_REINDEX, ":before": input.before },
          Limit: PER_INVOCATION_LIMIT,
          ExclusiveStartKey: input.exclusiveStartKey,
        }),
      );
      const items: RequirementGsi8Candidate[] = (result.Items ?? []).map((raw) => {
        const row = raw as { PK: string; SK: string; GSI8SK: string };
        const { tenantId, subjectId } = parseTenantAndSubjectIdFromPk(row.PK);
        const requirementId = parseRequirementIdFromSk(row.SK);
        return { PK: row.PK, SK: row.SK, dueAtIso: row.GSI8SK.split("#TENANT#")[0]!, tenantId, subjectId, requirementId };
      });
      auditGlobalIndexAccess({ indexName: "GSI8", operation: "Query", component: "requirement-reindex", pageCount: 1, resultCount: items.length });
      return { items, lastEvaluatedKey: result.LastEvaluatedKey };
    } catch (err) {
      if (isAccessDeniedError(err)) {
        auditGlobalIndexAccessDenied({ indexName: "GSI8", operation: "Query", component: "requirement-reindex", awsErrorCode: "AccessDeniedException" });
      }
      throw mapDynamoError(err, "RequirementReindexCandidateSource.queryDue");
    }
  }
}

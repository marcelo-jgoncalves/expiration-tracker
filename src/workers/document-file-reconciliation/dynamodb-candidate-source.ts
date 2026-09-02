/**
 * Real DynamoDB adapter for `DocumentFileReconciliationCandidateSource` (D-179 slice 3) —
 * separate class, wired only into the DocumentFileReconciliationWorker Lambda's composition root,
 * same pattern as `invitation-purge/dynamodb-candidate-source.ts`. `queryDue()` is the ONLY GSI8
 * access this role's IAM policy permits (`dynamodb:LeadingKeys` scoped to
 * `WORK#DOCUMENT_FILE_RECONCILIATION`/`DLQ#DOCUMENT_FILE_RECONCILIATION`,
 * `infra/modules/dynamo-table/main.tf`) — this worker never touches GSI3/GSI6 either.
 */
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { mapDynamoError } from "../../shared/dynamodb/sdk-errors.js";
import { auditGlobalIndexAccess, auditGlobalIndexAccessDenied, isAccessDeniedError } from "../../shared/observability/security-audit.js";
import type { DocumentFileGsi8Candidate, DocumentFileGsi8Page, DocumentFileReconciliationCandidateSource } from "./candidate-source.js";

const PER_INVOCATION_LIMIT = 100;
const GSI8PK_DOCUMENT_FILE_RECONCILIATION = "WORK#DOCUMENT_FILE_RECONCILIATION";

/** Base table `PK` is `TENANT#<tenantId>#DOCUMENT#<documentId>` (`documentFileKey()`,
 * `modules/document-archive/domain/document-file.ts`) — parsed here, not re-exported from the
 * domain module, since only this adapter ever sees a raw GSI8 row. */
function parseTenantAndDocumentIdFromPk(pk: string): { tenantId: string; documentId: string } {
  const match = /^TENANT#(.+)#DOCUMENT#(.+)$/.exec(pk);
  if (!match || !match[1] || !match[2]) throw new Error(`Malformed base PK for document-file-reconciliation: ${pk}`);
  return { tenantId: match[1], documentId: match[2] };
}

/** Base table `SK` is `VERSION#<seqPadded>#FILE#<fileId>` (`documentFileKey()`). */
function parseSeqAndFileIdFromSk(sk: string): { seq: number; fileId: string } {
  const match = /^VERSION#(\d+)#FILE#(.+)$/.exec(sk);
  if (!match || !match[1] || !match[2]) throw new Error(`Malformed base SK for document-file-reconciliation: ${sk}`);
  return { seq: Number(match[1]), fileId: match[2] };
}

export class DynamoDbDocumentFileReconciliationCandidateSource implements DocumentFileReconciliationCandidateSource {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async queryDue(input: { before: string; exclusiveStartKey?: Record<string, unknown> }): Promise<DocumentFileGsi8Page> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: "GSI8",
          KeyConditionExpression: "GSI8PK = :pk AND GSI8SK < :before",
          ExpressionAttributeValues: { ":pk": GSI8PK_DOCUMENT_FILE_RECONCILIATION, ":before": input.before },
          Limit: PER_INVOCATION_LIMIT,
          ExclusiveStartKey: input.exclusiveStartKey,
        }),
      );
      const items: DocumentFileGsi8Candidate[] = (result.Items ?? []).map((raw) => {
        const row = raw as { PK: string; SK: string; GSI8SK: string };
        const { tenantId, documentId } = parseTenantAndDocumentIdFromPk(row.PK);
        const { seq, fileId } = parseSeqAndFileIdFromSk(row.SK);
        return { PK: row.PK, SK: row.SK, dueAtIso: row.GSI8SK.split("#TENANT#")[0]!, tenantId, documentId, seq, fileId };
      });
      auditGlobalIndexAccess({ indexName: "GSI8", operation: "Query", component: "document-file-reconciliation", pageCount: 1, resultCount: items.length });
      return { items, lastEvaluatedKey: result.LastEvaluatedKey };
    } catch (err) {
      if (isAccessDeniedError(err)) {
        auditGlobalIndexAccessDenied({ indexName: "GSI8", operation: "Query", component: "document-file-reconciliation", awsErrorCode: "AccessDeniedException" });
      }
      throw mapDynamoError(err, "DocumentFileReconciliationCandidateSource.queryDue");
    }
  }
}

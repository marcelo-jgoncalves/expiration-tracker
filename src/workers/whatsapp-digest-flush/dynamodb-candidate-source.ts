/**
 * Real DynamoDB adapter for `WhatsAppDigestCandidateSource` (D-347 §3.5) — separate class, wired
 * only into the WhatsAppDigestFlushWorker Lambda's composition root, same pattern as
 * `scheduled-reports/dynamodb-candidate-source.ts`. `queryDue()` is the ONLY GSI8 access this
 * role's IAM policy permits (`dynamodb:LeadingKeys` scoped to
 * `WORK#WHATSAPP_DIGEST`/`DLQ#WHATSAPP_DIGEST`, `infra/modules/dynamo-table/main.tf`) — this
 * worker never touches GSI3/GSI6 either.
 */
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { mapDynamoError } from "../../shared/dynamodb/sdk-errors.js";
import { auditGlobalIndexAccess, auditGlobalIndexAccessDenied, isAccessDeniedError } from "../../shared/observability/security-audit.js";
import type { WhatsAppDigestGsi8Candidate, WhatsAppDigestGsi8Page, WhatsAppDigestCandidateSource } from "./candidate-source.js";

const PER_INVOCATION_LIMIT = 100;
const GSI8PK_WHATSAPP_DIGEST = "WORK#WHATSAPP_DIGEST";

/** Base table `PK` is `TENANT#<tenantId>#DIGEST#WHATSAPP#<recipientUserId>#<windowDate>`
 * (`digestEntryKey()`, `modules/notification/domain/digest-entry.ts`) — parsed here, not
 * re-exported from the domain module, since only this adapter ever sees a raw GSI8 row. */
function parseDigestEntryPk(pk: string): { tenantId: string; recipientUserId: string; windowDate: string } {
  const match = /^TENANT#(.+)#DIGEST#WHATSAPP#(.+)#(\d{4}-\d{2}-\d{2})$/.exec(pk);
  if (!match || !match[1] || !match[2] || !match[3]) throw new Error(`Malformed base PK for whatsapp-digest: ${pk}`);
  return { tenantId: match[1], recipientUserId: match[2], windowDate: match[3] };
}

export class DynamoDbWhatsAppDigestCandidateSource implements WhatsAppDigestCandidateSource {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async queryDue(input: { before: string; exclusiveStartKey?: Record<string, unknown> }): Promise<WhatsAppDigestGsi8Page> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: "GSI8",
          KeyConditionExpression: "GSI8PK = :pk AND GSI8SK < :before",
          ExpressionAttributeValues: { ":pk": GSI8PK_WHATSAPP_DIGEST, ":before": input.before },
          Limit: PER_INVOCATION_LIMIT,
          ExclusiveStartKey: input.exclusiveStartKey,
        }),
      );
      const items: WhatsAppDigestGsi8Candidate[] = (result.Items ?? []).map((raw) => {
        const row = raw as { PK: string; SK: string; GSI8SK: string };
        const { tenantId, recipientUserId, windowDate } = parseDigestEntryPk(row.PK);
        return { PK: row.PK, SK: row.SK, flushAtIso: row.GSI8SK.split("#TENANT#")[0]!, tenantId, recipientUserId, windowDate };
      });
      auditGlobalIndexAccess({ indexName: "GSI8", operation: "Query", component: "whatsapp-digest-flush", pageCount: 1, resultCount: items.length });
      return { items, lastEvaluatedKey: result.LastEvaluatedKey };
    } catch (err) {
      if (isAccessDeniedError(err)) {
        auditGlobalIndexAccessDenied({ indexName: "GSI8", operation: "Query", component: "whatsapp-digest-flush", awsErrorCode: "AccessDeniedException" });
      }
      throw mapDynamoError(err, "WhatsAppDigestCandidateSource.queryDue");
    }
  }
}

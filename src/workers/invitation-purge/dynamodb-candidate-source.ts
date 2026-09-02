/**
 * Real DynamoDB adapter for `InvitationPurgeCandidateSource` (D-179/D-181 slice 2) — separate
 * class, wired only into the InvitationPurgeWorker Lambda's composition root, same pattern as
 * `membership-purge/dynamodb-candidate-source.ts`. `queryDue()` is the ONLY GSI8 access this
 * role's IAM policy permits (`dynamodb:LeadingKeys` scoped to `WORK#INVITATION_PURGE`/
 * `DLQ#INVITATION_PURGE`, `infra/modules/dynamo-table/main.tf`) — every other method touches the
 * base table only.
 */
import { GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { mapDynamoError } from "../../shared/dynamodb/sdk-errors.js";
import { isTransactionCanceled, type TransactWriteEntry } from "../../shared/dynamodb/occ.js";
import { auditGlobalIndexAccess, auditGlobalIndexAccessDenied, isAccessDeniedError } from "../../shared/observability/security-audit.js";
import type { EntityKey } from "../../shared/dynamodb/occ.js";
import type { InvitationGsi8Candidate, InvitationGsi8Page, InvitationPurgeCandidate, InvitationPurgeCandidateSource } from "./candidate-source.js";

const PER_INVOCATION_LIMIT = 100;
const GSI8PK_INVITATION_PURGE = "WORK#INVITATION_PURGE";

/** `GSI8SK` shape is `<dueAtIso>#TENANT#<tenantId>#<invitationId>` (`invitationGsi8Keys()`,
 * `modules/organization/domain/invitation.ts`) — parsed here, not re-exported from the domain
 * module, since only this adapter ever sees a raw GSI8 row. */
function parseTenantIdFromGsi8Sk(gsi8sk: string): string {
  const parts = gsi8sk.split("#TENANT#");
  const tenantSegment = parts[1];
  if (parts.length !== 2 || !tenantSegment) {
    throw new Error(`Malformed GSI8SK for invitation-purge: ${gsi8sk}`);
  }
  // tenantSegment is "<tenantId>#<invitationId>" - tenantId never contains "#" (organizationId
  // is a generated id), so the first segment is always the tenantId.
  return tenantSegment.split("#")[0]!;
}

export class DynamoDbInvitationPurgeCandidateSource implements InvitationPurgeCandidateSource {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async queryDue(input: { before: string; exclusiveStartKey?: Record<string, unknown> }): Promise<InvitationGsi8Page> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: "GSI8",
          KeyConditionExpression: "GSI8PK = :pk AND GSI8SK < :before",
          ExpressionAttributeValues: { ":pk": GSI8PK_INVITATION_PURGE, ":before": input.before },
          Limit: PER_INVOCATION_LIMIT,
          ExclusiveStartKey: input.exclusiveStartKey,
        }),
      );
      const items: InvitationGsi8Candidate[] = (result.Items ?? []).map((raw) => {
        const row = raw as { PK: string; SK: string; GSI8SK: string };
        return { PK: row.PK, SK: row.SK, dueAtIso: row.GSI8SK.split("#TENANT#")[0]!, tenantId: parseTenantIdFromGsi8Sk(row.GSI8SK) };
      });
      auditGlobalIndexAccess({ indexName: "GSI8", operation: "Query", component: "invitation-purge", pageCount: 1, resultCount: items.length });
      return { items, lastEvaluatedKey: result.LastEvaluatedKey };
    } catch (err) {
      if (isAccessDeniedError(err)) {
        auditGlobalIndexAccessDenied({ indexName: "GSI8", operation: "Query", component: "invitation-purge", awsErrorCode: "AccessDeniedException" });
      }
      throw mapDynamoError(err, "InvitationPurgeCandidateSource.queryDue");
    }
  }

  async getInvitation(key: EntityKey): Promise<InvitationPurgeCandidate | undefined> {
    try {
      const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: key, ConsistentRead: true }));
      return result.Item as InvitationPurgeCandidate | undefined;
    } catch (err) {
      throw mapDynamoError(err, "InvitationPurgeCandidateSource.getInvitation");
    }
  }

  async transactWrite(entries: TransactWriteEntry[]): Promise<void> {
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: entries.map((entry) => {
            if ("Put" in entry) return { Put: entry.Put };
            if ("Update" in entry) return { Update: entry.Update };
            if ("Delete" in entry) return { Delete: entry.Delete };
            return { ConditionCheck: entry.ConditionCheck };
          }),
        }),
      );
    } catch (err) {
      // Left unmapped for a transaction cancellation, same discipline as membership-purge's
      // adapter: purge.ts inspects isTransactionCanceled()/getCancellationReasonCodes() itself.
      if (isTransactionCanceled(err)) throw err;
      throw mapDynamoError(err, "InvitationPurgeCandidateSource.transactWrite");
    }
  }
}

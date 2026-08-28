/**
 * Real DynamoDB adapter for DocumentPurgeCandidateSource (W3-06/D-061). Separate class, wired
 * only into the DocumentPurgeWorker Lambda's composition root — GSI6 is a global isolation
 * boundary (`docs/architecture/data-model.md` §3), same discipline as the reminder/upload-slot
 * adapters. Deliberately no cursor persisted across invocations (D-061 §"resolução achado 4" —
 * simpler than a cursor a stateless scheduled invocation can't receive back; the next 6h run
 * naturally picks up any excess over the per-run cap, given the 30-day business deadline).
 */
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GSI6PK_PURGE_CLAIMED, GSI6PK_PURGE_PENDING } from "../../modules/document/ports/document-store.js";
import { mapDynamoError } from "../../shared/dynamodb/sdk-errors.js";
import { auditGlobalIndexAccess, auditGlobalIndexAccessDenied, isAccessDeniedError } from "../../shared/observability/security-audit.js";
import type { DocumentPurgeCandidateSource, Page } from "./document-purge-candidate-source.js";
import type { DocumentPurgeCandidate, PurgeCandidate } from "./purge.js";

const PER_INVOCATION_LIMIT = 25;

export class DynamoDbDocumentPurgeCandidateSource implements DocumentPurgeCandidateSource {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async listPendingCandidates(input: { before: string; pageSize?: number }): Promise<Page<PurgeCandidate>> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: "GSI6",
          KeyConditionExpression: "GSI6PK = :pk AND GSI6SK < :before",
          ExpressionAttributeValues: { ":pk": GSI6PK_PURGE_PENDING, ":before": input.before },
          Limit: input.pageSize ?? PER_INVOCATION_LIMIT,
        }),
      );
      const items = (result.Items ?? []) as PurgeCandidate[];
      auditGlobalIndexAccess({ indexName: "GSI6", operation: "Query", component: "document-purge", pageCount: 1, resultCount: items.length });
      return { items };
    } catch (err) {
      if (isAccessDeniedError(err)) {
        auditGlobalIndexAccessDenied({ indexName: "GSI6", operation: "Query", component: "document-purge", awsErrorCode: "AccessDeniedException" });
      }
      throw mapDynamoError(err, "DocumentPurgeCandidateSource.listPendingCandidates");
    }
  }

  async listExpiredClaims(input: { before: string; pageSize?: number }): Promise<Page<DocumentPurgeCandidate>> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: "GSI6",
          KeyConditionExpression: "GSI6PK = :pk AND GSI6SK < :before",
          ExpressionAttributeValues: { ":pk": GSI6PK_PURGE_CLAIMED, ":before": input.before },
          Limit: input.pageSize ?? PER_INVOCATION_LIMIT,
        }),
      );
      const items = (result.Items ?? []) as DocumentPurgeCandidate[];
      auditGlobalIndexAccess({ indexName: "GSI6", operation: "Query", component: "document-purge", pageCount: 1, resultCount: items.length });
      return { items };
    } catch (err) {
      if (isAccessDeniedError(err)) {
        auditGlobalIndexAccessDenied({ indexName: "GSI6", operation: "Query", component: "document-purge", awsErrorCode: "AccessDeniedException" });
      }
      throw mapDynamoError(err, "DocumentPurgeCandidateSource.listExpiredClaims");
    }
  }
}

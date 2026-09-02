/**
 * Real DynamoDB adapter for `DocumentFileReconciliationCandidateSource` — separate class, wired
 * only into the DocumentFileReconciliationWorker Lambda's composition root, same pattern as
 * `quota-telemetry-purge/dynamodb-candidate-source.ts`. A base-table `Scan`, no GetItem
 * companion needed (unlike the purge workers' tenant-lifecycle fence — a stuck upload is not a
 * retention decision, it never depended on tenant ACTIVE status, mirroring
 * `UploadSlotReconciliationWorker`, which has no such fence either). Never touches GSI3/GSI6.
 */
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { mapDynamoError } from "../../shared/dynamodb/sdk-errors.js";
import type { DocumentFileScanStatus } from "../../modules/document-archive/domain/document-file.js";
import type { DocumentFileReconciliationCandidate, DocumentFileReconciliationCandidateSource, DocumentFileReconciliationScanPage } from "./candidate-source.js";

const PER_INVOCATION_LIMIT = 100;

export class DynamoDbDocumentFileReconciliationCandidateSource implements DocumentFileReconciliationCandidateSource {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async scanCandidates(
    status: Extract<DocumentFileScanStatus, "PENDING_UPLOAD" | "SCANNING">,
    exclusiveStartKey?: Record<string, unknown>,
  ): Promise<DocumentFileReconciliationScanPage> {
    try {
      const result = await this.client.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression: "#entityType = :documentFile AND #scanStatus = :status AND attribute_exists(#gsi5pk)",
          ExpressionAttributeNames: { "#entityType": "entityType", "#scanStatus": "scanStatus", "#gsi5pk": "GSI5PK" },
          ExpressionAttributeValues: { ":documentFile": "DocumentFile", ":status": status },
          Limit: PER_INVOCATION_LIMIT,
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      return {
        items: (result.Items ?? []) as DocumentFileReconciliationCandidate[],
        lastEvaluatedKey: result.LastEvaluatedKey,
      };
    } catch (err) {
      throw mapDynamoError(err, "DocumentFileReconciliationCandidateSource.scanCandidates");
    }
  }
}

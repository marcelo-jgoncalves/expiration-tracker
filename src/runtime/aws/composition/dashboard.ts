/** Composition root for the dashboard module against real DynamoDB (Roadmap P0.6, fatia 1).
 * Reuses `DynamoDbDocumentArchiveStore`/`DynamoDbExpirationStore` directly (both already exist
 * for their own modules) rather than pulling in `buildDocumentArchiveDeps` (which also wires an
 * S3 client/quarantine bucket this read-only aggregate never needs) — same "thin adapter,
 * reuse existing persistence classes" posture `buildMemberEligibilityChecker` already
 * established in `expiration.ts`. */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDbDocumentArchiveStore } from "../../../modules/document-archive/persistence/dynamodb-document-archive-store.js";
import { DynamoDbExpirationStore } from "../../../modules/expiration/persistence/dynamodb-expiration-store.js";
import { DashboardService } from "../../../modules/dashboard/application/dashboard-service.js";

export function buildDashboardDeps(client: DynamoDBDocumentClient, tableName: string) {
  const documentStore = new DynamoDbDocumentArchiveStore(client, tableName);
  const itemStore = new DynamoDbExpirationStore(client, tableName);
  const dashboard = new DashboardService({ documentStore, itemStore });
  return { dashboard };
}

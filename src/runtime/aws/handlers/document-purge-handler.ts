/** Real handler for DocumentPurgeWorker (EventBridge Scheduler, 6h). W3-06/D-061. */
import { randomUUID } from "node:crypto";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildDocumentPurgeWorkerDeps } from "../composition/document.js";
import { runPurgeCycle, type DocumentPurgeCandidate } from "../../../workers/document-purge/purge.js";
import { runWithContext, getContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableNameEnv = process.env["TABLE_NAME"];
if (!tableNameEnv) throw new Error("TABLE_NAME env var is required.");
const tableName: string = tableNameEnv;

const { store, objects, candidates } = buildDocumentPurgeWorkerDeps(client, tableName);
const logger = new SecureLogger({ baseContext: { service: "document-purge" } });

export async function handler(): Promise<void> {
  await runWithContext({ correlationId: randomUUID() }, async () => {
    const now = () => new Date().toISOString();
    const nowIso = now();
    const [pending, claimed] = await Promise.all([
      candidates.listPendingCandidates({ before: nowIso }),
      candidates.listExpiredClaims({ before: nowIso }),
    ]);
    const result = await runPurgeCycle(
      { store, objects, tableName, now, correlationId: () => getContext()?.correlationId },
      { pendingCandidates: pending.items, claimedCandidates: claimed.items as DocumentPurgeCandidate[] },
    );
    logger.info("document-purge complete", { ...result });
  });
}

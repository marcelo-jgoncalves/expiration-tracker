/** Real handler for DossierExportGenerationWorker (SQS, fed by DispatchOutboxRelay/
 * OutboxSweeper's `SQS_DOSSIER_EXPORT_V1` destination) - D-205 fatia 2. Same thin "AWS
 * entrypoint only, pure logic lives elsewhere" shape as
 * `report-subscription-delivery-handler.ts`. Message body is the BARE
 * `DossierExportConfirmed.data` payload (`runId`/`subjectId`/`tenantId` - no envelope wrapper),
 * same convention every other bare-payload destination in this codebase already established. */
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildDossierExportGenerationDeps } from "../composition/document-archive.js";
import { processDossierExportGeneration, type DossierExportGenerationCommand } from "../../../workers/dossier-export/generate.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
const quarantineBucket = process.env["QUARANTINE_BUCKET_NAME"];
const reportExportsBucketName = process.env["REPORT_EXPORTS_BUCKET_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
// This handler never calls reserveFiles()/anything DocumentFile-related - the quarantine bucket
// parameter is unused here (same posture requirement-reindex-handler.ts's identical comment
// documents), required only because DocumentArchiveService's constructor always takes one.
if (!quarantineBucket) throw new Error("QUARANTINE_BUCKET_NAME env var is required.");
if (!reportExportsBucketName) throw new Error("REPORT_EXPORTS_BUCKET_NAME env var is required.");
const deps = buildDossierExportGenerationDeps(client, tableName, quarantineBucket, reportExportsBucketName);
const logger = new SecureLogger({ baseContext: { service: "dossier-export-generation" } });

function isDossierExportGenerationCommand(message: unknown): message is DossierExportGenerationCommand {
  const m = message as Partial<DossierExportGenerationCommand> | undefined;
  return typeof m?.tenantId === "string" && typeof m?.subjectId === "string" && typeof m?.runId === "string";
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    await runWithContext({ correlationId: randomUUID() }, async () => {
      try {
        const raw = JSON.parse(record.body) as unknown;
        if (!isDossierExportGenerationCommand(raw)) {
          logger.error("dossier-export-generation malformed message", { messageId: record.messageId });
          batchItemFailures.push({ itemIdentifier: record.messageId });
          return;
        }
        const command: DossierExportGenerationCommand = { tenantId: raw.tenantId, subjectId: raw.subjectId, runId: raw.runId };

        await runWithContext({ correlationId: randomUUID(), tenantId: command.tenantId }, async () => {
          const result = await processDossierExportGeneration(deps, command);
          logger.info("dossier-export-generation outcome", { messageId: record.messageId, subjectId: command.subjectId, runId: command.runId, ...result });
        });
      } catch (err) {
        logger.error("dossier-export-generation failed", { messageId: record.messageId, error: err instanceof Error ? err.message : String(err) });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    });
  }

  return { batchItemFailures };
}

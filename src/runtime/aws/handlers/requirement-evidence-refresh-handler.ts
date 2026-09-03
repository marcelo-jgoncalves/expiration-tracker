/** Real handler for RequirementEvidenceRefresh (SQS, fed by DispatchOutboxRelay/OutboxSweeper's
 * `SQS_REQUIREMENT_EVIDENCE_REFRESH_V1` destination) — D-193 item 6/9. Same "thin AWS
 * entrypoint, pure logic lives elsewhere" shape as `import-parse-handler.ts`. This handler
 * itself is where the "never trust the event payload" discipline is enforced structurally: it
 * extracts ONLY `tenantId`/`versionId` into a `RequirementEvidenceRefreshHint` before calling
 * `refreshRequirementsForEvidenceVersion` — nothing else in the SQS message body is ever
 * decoded into a wider type that could tempt a future caller into reading more from it. */
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildDocumentArchiveDeps } from "../composition/document-archive.js";
import { refreshRequirementsForEvidenceVersion, type RequirementEvidenceRefreshHint } from "../../../workers/requirement-evidence-refresh/refresh.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
// This handler only ever reads/writes Requirement+DocumentVersion rows via `store` — it never
// calls `documentArchive.reserveFiles()`, so the quarantine bucket parameter is unused (same
// posture as `requirement-reindex-handler.ts`'s identical comment).
const { store, documentArchive } = buildDocumentArchiveDeps(client, tableName, "");
const logger = new SecureLogger({ baseContext: { service: "requirement-evidence-refresh" } });

function isRequirementEvidenceRefreshHint(message: unknown): message is RequirementEvidenceRefreshHint {
  const m = message as Partial<RequirementEvidenceRefreshHint> | undefined;
  return typeof m?.tenantId === "string" && typeof m?.versionId === "string";
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    await runWithContext({ correlationId: randomUUID() }, async () => {
      try {
        // D-193's core discipline: parse ONLY the two hint fields, discard everything else the
        // message body might carry (a stale validUntil/state would be exactly the kind of
        // payload the design's Round 3-5 critique history warned never to trust).
        const raw = JSON.parse(record.body) as unknown;
        if (!isRequirementEvidenceRefreshHint(raw)) {
          logger.error("requirement-evidence-refresh malformed message (missing tenantId/versionId hint)", { messageId: record.messageId });
          batchItemFailures.push({ itemIdentifier: record.messageId });
          return;
        }
        const hint: RequirementEvidenceRefreshHint = { tenantId: raw.tenantId, versionId: raw.versionId };

        await runWithContext({ correlationId: randomUUID(), tenantId: hint.tenantId }, async () => {
          const result = await refreshRequirementsForEvidenceVersion({ documentArchive, store, tableName: tableName as string, now: () => new Date().toISOString() }, hint);
          logger.info("requirement-evidence-refresh outcome", { versionId: hint.versionId, ...result });
          // A per-Requirement failure inside the batch never aborts the others (refresh.ts's own
          // discipline) — but if ANY Requirement in this message's candidate set failed, the
          // message itself is reported failed so the queue's own redelivery/DLQ policy retries
          // the whole wake-up rather than silently dropping a partially-converged version.
          if (result.failed > 0) {
            batchItemFailures.push({ itemIdentifier: record.messageId });
          }
        });
      } catch (err) {
        logger.error("requirement-evidence-refresh failed", { messageId: record.messageId, error: err instanceof Error ? err.message : String(err) });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    });
  }

  return { batchItemFailures };
}

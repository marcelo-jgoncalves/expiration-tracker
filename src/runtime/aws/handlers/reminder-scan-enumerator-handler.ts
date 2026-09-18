import { randomUUID } from "node:crypto";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { defaultShardConfig } from "../../../modules/reminder/domain/shard-config.js";
import { DynamoDbScanControlStore } from "../../../workers/reminder-scan-control/store.js";
import { runControlEnumeration } from "../../../workers/reminder-scan-control/enumerator.js";
import { UlidIdGenerator, newCorrelationId } from "../ids.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";
import { toAppError } from "../../../shared/errors/app-error.js";

const tableNameValue = process.env["REMINDER_SCAN_CONTROL_TABLE_NAME"];
if (!tableNameValue) throw new Error("REMINDER_SCAN_CONTROL_TABLE_NAME is required");
const tableName: string = tableNameValue;
const store = new DynamoDbScanControlStore(createDocumentClient(), tableName);
const ids = new UlidIdGenerator();
const logger = new SecureLogger({ baseContext: { service: "reminder-scan-enumerator-v2" } });

export async function handler(event: { scheduledTime?: string }): Promise<Awaited<ReturnType<typeof runControlEnumeration>>> {
  const correlationId = newCorrelationId();
  return runWithContext({ correlationId }, async () => {
    try {
      const tick = new Date(event.scheduledTime ?? new Date().toISOString());
      if (Number.isNaN(tick.getTime())) throw new Error("Invalid scheduledTime");
      const result = await runControlEnumeration({
        store, tableName, shardConfig: defaultShardConfig(), lookbackMinutes: Number(process.env["REMINDER_SCAN_LOOKBACK_MINUTES"] ?? 15),
        leaseDurationMs: 200_000, rolloutEpoch: Number(process.env["SCAN_MODE_EPOCH"] ?? 1), now: () => new Date().toISOString(),
        newEventId: () => ids.newEventId(), correlationId: () => correlationId, newOwnerToken: () => randomUUID(),
      }, tick);
      logger.info("reminder-scan-enumerator-v2 outcome", { ...result });
      return result;
    } catch (error) {
      const appError = toAppError(error);
      logger.error("reminder-scan-enumerator-v2 failed", { errorCode: appError.code, retryable: appError.retryable });
      throw error;
    }
  });
}

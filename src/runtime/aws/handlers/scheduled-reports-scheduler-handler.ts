/** Real handler for ScheduledReportsScheduler (EventBridge Scheduler) - D-204 decisions 3-4
 * (Roadmap P1 item 15), implemented D-211 fatia 2. Same "top-level `input`, never `event.detail`"
 * contract as requirement-reindex-handler.ts (EventBridge Scheduler does NOT wrap the payload in
 * a `detail` envelope the way legacy EventBridge Rules do). Wired to real infra (Lambda resource
 * + EventBridge Scheduler schedule + IAM) in `infra/main.tf`. */
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildScheduledReportsDeps } from "../composition/reports.js";
import { runScheduledReportsTick, shouldAlarmScheduledReports } from "../../../workers/scheduled-reports/scheduler.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const deps = buildScheduledReportsDeps(client, tableName);
const logger = new SecureLogger({ baseContext: { service: "scheduled-reports-scheduler" } });

export interface ScheduledReportsSchedulerEvent {
  scheduledTime: string;
}

export async function handler(event: ScheduledReportsSchedulerEvent): Promise<void> {
  // Scheduler producer, no upstream request to inherit a correlationId from (same posture as
  // requirement-reindex-handler.ts) - new correlationId per invocation.
  const correlationId = `scheduled-reports-${event.scheduledTime}`;
  await runWithContext({ correlationId }, () => handleTick(event));
}

async function handleTick(event: ScheduledReportsSchedulerEvent): Promise<void> {
  const result = await runScheduledReportsTick(deps);
  logger.info("scheduled-reports tick complete", { scheduledTime: event.scheduledTime, ...result, failed: result.failed.length });
  const alarm = shouldAlarmScheduledReports(result);
  if (alarm.alarm) {
    throw new Error(alarm.reason);
  }
}

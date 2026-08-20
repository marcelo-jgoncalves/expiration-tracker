/**
 * Main stack: DynamoDB, Cognito, API Gateway, and the Reminder Engine's full async runtime
 * (M3.5 - docs/architecture/m3.5-runtime-design.md). Every ScopedLambdaFunction now uses
 * `entry` (real esbuild bundle) instead of the M0-M3 inline 501 placeholder.
 */
import { Stack, type StackProps } from "aws-cdk-lib";
import type { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import { ExpirationTrackerTable } from "./dynamo-table.js";
import { ExpirationTrackerAuth, type MfaPolicy } from "./cognito.js";
import { ScopedLambdaFunction, tableAccessFor, queueAccessFor } from "./scoped-lambda-function.js";
import { ExpirationTrackerApi } from "./api.js";
import { ReminderDispatchQueue } from "./reminder-queue.js";
import { ReminderSchedule } from "./reminder-schedule.js";
import { ReminderObservability } from "./reminder-observability.js";
import { CostBudget } from "./cost-budget.js";

export interface ExpirationTrackerStackProps extends StackProps {
  mfaPolicy?: MfaPolicy;
  /** M3.5 kill switch - see ReminderSchedule. Defaults to enabled. */
  schedulesEnabled?: boolean;
  /** Full-audit round1/round2 (Cost & Resource Governance) - see CostBudget. */
  monthlyBudgetUsd?: number;
  budgetNotificationEmails?: string[];
}

const HANDLERS_DIR = "src/runtime/aws/handlers";

export class ExpirationTrackerStack extends Stack {
  readonly table: ExpirationTrackerTable;
  readonly auth: ExpirationTrackerAuth;
  readonly api: ExpirationTrackerApi;
  readonly remindersHandler: ScopedLambdaFunction;
  readonly reminderProducer: ScopedLambdaFunction;
  readonly reminderDispatch: ScopedLambdaFunction;
  readonly reminderReconciliation: ScopedLambdaFunction;
  readonly dispatchOutboxRelay: ScopedLambdaFunction;
  readonly outboxSweeper: ScopedLambdaFunction;
  readonly dispatchQueue: ReminderDispatchQueue;

  constructor(scope: Construct, id: string, props: ExpirationTrackerStackProps = {}) {
    super(scope, id, props);

    this.table = new ExpirationTrackerTable(this, "Table");
    this.auth = new ExpirationTrackerAuth(this, "Auth", { mfaPolicy: props.mfaPolicy });

    const tableAccess = tableAccessFor(this.table);
    const commonEnv = { TABLE_NAME: this.table.table.tableName };

    const testRouteHandler = new ScopedLambdaFunction(this, "TestPingHandler", {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: `${HANDLERS_DIR}/test-ping-handler.ts`,
      environment: commonEnv,
      access: [tableAccess.readWriteKeys("IdentityMapping", "User", "TenantQuota")],
    });

    // M2: ExpirationItem/AuditEvent CRUD+renew+dashboard, plus outbox writes for
    // ItemDueDateChanged. GSI1 (dashboard) is table-level read/write per
    // ScopedLambdaFunction's documented IAM granularity limit (see that construct's
    // header comment) - never grantGsi3ReadTo, which stays reserved for M3's
    // ReminderProducer.
    const itemsHandler = new ScopedLambdaFunction(this, "ItemsHandler", {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: `${HANDLERS_DIR}/items-handler.ts`,
      environment: commonEnv,
      access: [tableAccess.readWriteKeys("ExpirationItem", "AuditEvent", "OutboxEvent", "IdempotencyRecord")],
    });

    // M3: policy CRUD is tenant-facing (HTTP), like ItemsHandler - table-level RW, no GSI3.
    this.remindersHandler = new ScopedLambdaFunction(this, "RemindersHandler", {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: `${HANDLERS_DIR}/reminders-handler.ts`,
      environment: commonEnv,
      access: [tableAccess.readWriteKeys("ReminderPolicy", "ReminderOccurrence")],
    });

    this.api = new ExpirationTrackerApi(this, "Api", {
      auth: this.auth,
      testRouteHandler,
      itemsHandler,
      remindersHandler: this.remindersHandler,
    });

    // ReminderProducer (§9.3) is the ONLY function in the system granted gsi3Read() - the
    // narrow capability routed through ExpirationTrackerTable.grantGsi3ReadTo, which
    // itself never appears on any tenant-facing function (test/infra/reminder-engine.test.ts
    // asserts this at the synthesized-template level).
    this.reminderProducer = new ScopedLambdaFunction(this, "ReminderProducer", {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: `${HANDLERS_DIR}/reminder-producer-handler.ts`,
      environment: commonEnv,
      reservedConcurrentExecutions: 2,
      access: [tableAccess.readWriteKeys("ReminderOccurrence"), tableAccess.gsi3Read()],
    });

    // ReminderDispatch (§9.4): CLAIMED -> TRIGGERED + NotificationIntent + outbox, all in
    // one TransactWriteItems - needs write access to occurrences/intents/outbox/idempotency
    // and read access to ExpirationItem/ReminderPolicy for the staleness check, never GSI3.
    this.reminderDispatch = new ScopedLambdaFunction(this, "ReminderDispatch", {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: `${HANDLERS_DIR}/reminder-dispatch-handler.ts`,
      environment: commonEnv,
      reservedConcurrentExecutions: 10,
      access: [
        tableAccess.readWriteKeys(
          "ReminderOccurrence",
          "NotificationIntent",
          "OutboxEvent",
          "IdempotencyRecord",
        ),
        tableAccess.readKeys("ExpirationItem", "ReminderPolicy"),
      ],
    });

    // M3.5: ReminderDispatchQueue + DLQ, consumed by ReminderDispatch via event source
    // mapping with partial batch failure (docs/architecture/m3.5-runtime-design.md §"SQS + DLQ").
    this.dispatchQueue = new ReminderDispatchQueue(this, "ReminderDispatchQueue", {
      consumerTimeoutSeconds: this.reminderDispatch.function.timeout?.toSeconds(),
    });
    queueAccessFor().consume(this.dispatchQueue.queue).grant(this.reminderDispatch.function);
    this.reminderDispatch.function.addEventSource(
      new lambdaEventSources.SqsEventSource(this.dispatchQueue.queue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      }),
    );

    // ReminderReconciliation (§9.5): claim-expiry revert + DST re-evaluation, driven by
    // `mode` in the EventBridge Scheduler input. One of EXACTLY TWO roles granted
    // gsi6Read() (docs/architecture/m3.5-runtime-design.md) - never GSI3.
    this.reminderReconciliation = new ScopedLambdaFunction(this, "ReminderReconciliation", {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: `${HANDLERS_DIR}/reminder-reconciliation-handler.ts`,
      environment: commonEnv,
      reservedConcurrentExecutions: 1,
      access: [
        tableAccess.readWriteKeys("ReminderOccurrence"),
        tableAccess.readKeys("ExpirationItem", "ReminderPolicy"),
        tableAccess.gsi6Read(),
      ],
    });

    // M3.5: DispatchOutboxRelay - DynamoDB Streams (NEW_IMAGE) -> SQS, the durable link
    // between the producer's claim and the dispatch queue (§"Decisão central").
    this.dispatchOutboxRelay = new ScopedLambdaFunction(this, "DispatchOutboxRelay", {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: `${HANDLERS_DIR}/dispatch-outbox-relay-handler.ts`,
      environment: { ...commonEnv, DISPATCH_QUEUE_URL: this.dispatchQueue.queue.queueUrl },
      reservedConcurrentExecutions: 2,
      access: [tableAccess.readWriteKeys("OutboxEvent"), queueAccessFor().send(this.dispatchQueue.queue)],
    });
    if (!this.table.table.tableStreamArn) {
      throw new Error("ExpirationTrackerTable must have a DynamoDB Stream enabled for DispatchOutboxRelay.");
    }
    this.dispatchOutboxRelay.function.addEventSource(
      new lambdaEventSources.DynamoEventSource(this.table.table, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 25,
        reportBatchItemFailures: true,
      }),
    );

    // M3.5: OutboxSweeperReminderDispatch - the other of EXACTLY TWO roles granted
    // gsi6Read() (recovers publications the relay/Stream missed).
    this.outboxSweeper = new ScopedLambdaFunction(this, "OutboxSweeperReminderDispatch", {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: `${HANDLERS_DIR}/outbox-sweeper-handler.ts`,
      environment: { ...commonEnv, DISPATCH_QUEUE_URL: this.dispatchQueue.queue.queueUrl },
      reservedConcurrentExecutions: 2,
      access: [
        tableAccess.readWriteKeys("OutboxEvent"),
        tableAccess.gsi6Read(),
        queueAccessFor().send(this.dispatchQueue.queue),
      ],
    });

    // M3.5: EventBridge Scheduler for the four periodic functions.
    new ReminderSchedule(this, "ReminderSchedule", {
      reminderProducer: this.reminderProducer.function,
      reminderReconciliation: this.reminderReconciliation.function,
      outboxSweeper: this.outboxSweeper.function,
      schedulesEnabled: props.schedulesEnabled,
    });

    // Full-audit round1 (Arquitetura, Observability & Operability): error/backlog alarms
    // for the five async-pipeline functions, beyond the pre-existing DLQ age alarm alone.
    new ReminderObservability(this, "ReminderObservability", {
      reminderProducer: this.reminderProducer.function,
      reminderDispatch: this.reminderDispatch.function,
      reminderReconciliation: this.reminderReconciliation.function,
      dispatchOutboxRelay: this.dispatchOutboxRelay.function,
      outboxSweeper: this.outboxSweeper.function,
      dispatchQueue: this.dispatchQueue.queue,
    });

    // Full-audit round1/round2 (Arquitetura, Cost & Resource Governance): monthly cost
    // ceiling alarm, complementing the structural cost choices already in place
    // (on-demand DynamoDB, reservedConcurrentExecutions, SQS long polling).
    new CostBudget(this, "CostBudget", {
      monthlyLimitUsd: props.monthlyBudgetUsd,
      notificationEmails: props.budgetNotificationEmails,
    });
  }
}

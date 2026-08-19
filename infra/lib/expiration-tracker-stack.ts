/**
 * M1 stack: wires DynamoDB, Cognito, the identity test route (ScopedLambdaFunction) and
 * the API skeleton together. Later milestones (M2+) add stacks/constructs for their own
 * modules, importing this table/auth rather than re-declaring them.
 */
import { Stack, type StackProps } from "aws-cdk-lib";
import type { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { ExpirationTrackerTable } from "./dynamo-table.js";
import { ExpirationTrackerAuth, type MfaPolicy } from "./cognito.js";
import { ScopedLambdaFunction, tableAccessFor } from "./scoped-lambda-function.js";
import { ExpirationTrackerApi } from "./api.js";

export interface ExpirationTrackerStackProps extends StackProps {
  mfaPolicy?: MfaPolicy;
}

export class ExpirationTrackerStack extends Stack {
  readonly table: ExpirationTrackerTable;
  readonly auth: ExpirationTrackerAuth;
  readonly api: ExpirationTrackerApi;
  readonly remindersHandler: ScopedLambdaFunction;
  readonly reminderProducer: ScopedLambdaFunction;
  readonly reminderDispatch: ScopedLambdaFunction;
  readonly reminderReconciliation: ScopedLambdaFunction;

  constructor(scope: Construct, id: string, props: ExpirationTrackerStackProps = {}) {
    super(scope, id, props);

    this.table = new ExpirationTrackerTable(this, "Table");
    this.auth = new ExpirationTrackerAuth(this, "Auth", { mfaPolicy: props.mfaPolicy });

    const tableAccess = tableAccessFor(this.table);

    const testRouteHandler = new ScopedLambdaFunction(this, "TestPingHandler", {
      runtime: lambda.Runtime.NODEJS_20_X,
      access: [tableAccess.readWriteKeys("IdentityMapping", "User", "TenantQuota")],
    });

    // M2: ExpirationItem/AuditEvent CRUD+renew+dashboard, plus outbox writes for
    // ItemDueDateChanged. GSI1 (dashboard) is table-level read/write per
    // ScopedLambdaFunction's documented IAM granularity limit (see that construct's
    // header comment) - never grantGsi3ReadTo, which stays reserved for M3's
    // ReminderProducer.
    const itemsHandler = new ScopedLambdaFunction(this, "ItemsHandler", {
      runtime: lambda.Runtime.NODEJS_20_X,
      access: [tableAccess.readWriteKeys("ExpirationItem", "AuditEvent", "OutboxEvent", "IdempotencyRecord")],
    });

    this.api = new ExpirationTrackerApi(this, "Api", {
      auth: this.auth,
      testRouteHandler,
      itemsHandler,
    });

    // M3: policy CRUD is tenant-facing (HTTP), like ItemsHandler - table-level RW, no GSI3.
    this.remindersHandler = new ScopedLambdaFunction(this, "RemindersHandler", {
      runtime: lambda.Runtime.NODEJS_20_X,
      access: [tableAccess.readWriteKeys("ReminderPolicy", "ReminderOccurrence")],
    });

    // ReminderProducer (§9.3) is the ONLY function in the system granted gsi3Read() - the
    // narrow capability routed through ExpirationTrackerTable.grantGsi3ReadTo, which
    // itself never appears on any tenant-facing function (test/infra/reminder-engine.test.ts
    // asserts this at the synthesized-template level).
    this.reminderProducer = new ScopedLambdaFunction(this, "ReminderProducer", {
      runtime: lambda.Runtime.NODEJS_20_X,
      access: [tableAccess.readWriteKeys("ReminderOccurrence"), tableAccess.gsi3Read()],
    });

    // ReminderDispatch (§9.4): CLAIMED -> TRIGGERED + NotificationIntent + outbox, all in
    // one TransactWriteItems - needs write access to occurrences/intents/outbox/idempotency
    // and read access to ExpirationItem/ReminderPolicy for the staleness check, never GSI3.
    this.reminderDispatch = new ScopedLambdaFunction(this, "ReminderDispatch", {
      runtime: lambda.Runtime.NODEJS_20_X,
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

    // ReminderReconciliation (§9.5): single job for claim-expiry revert + DST
    // re-evaluation - never GSI3 (it reasons over base-partition/GSI6-style batches, not
    // the scheduler index).
    this.reminderReconciliation = new ScopedLambdaFunction(this, "ReminderReconciliation", {
      runtime: lambda.Runtime.NODEJS_20_X,
      access: [
        tableAccess.readWriteKeys("ReminderOccurrence"),
        tableAccess.readKeys("ExpirationItem", "ReminderPolicy"),
      ],
    });
  }
}

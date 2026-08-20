# Root wiring — ADR-0009 step 2. Terraform equivalent of infra/lib/expiration-tracker-stack.ts
# (+ infra/bin/app.ts for naming/region). Instantiates all 7+1 modules for the dev
# environment: dynamo-table, cognito, api-gateway, lambda-function (x8), sqs-worker-queue,
# reminder-schedule, reminder-observability, cost-budget.
#
# Lambda artifacts are NOT built by this configuration — `npm run build:lambdas`
# (scripts/build-lambdas.ts) must run first to populate dist/lambda/<handler>/index.js,
# same contract documented in the lambda-function module's variables.tf.

module "table" {
  source = "./modules/dynamo-table"

  table_name     = "${local.name_prefix}-table"
  aws_region     = var.aws_region
  aws_account_id = var.aws_account_id
  tags           = { Project = local.project_name, Environment = var.environment }
}

module "auth" {
  source = "./modules/cognito"

  user_pool_name = "${local.name_prefix}-user-pool"
  mfa_policy     = var.mfa_policy
  callback_urls  = var.cognito_callback_urls
  tags           = { Project = local.project_name, Environment = var.environment }
}

# --- Lambda functions --------------------------------------------------------------------
# Each function gets EXACTLY the IAM capabilities expiration-tracker-stack.ts grants it.
# ReminderProducer is the ONLY function granted gsi3_read; ReminderReconciliation and
# OutboxSweeperReminderDispatch are the ONLY two granted gsi6_read (AGENTS.md §7's GSI
# isolation rule — the property this whole migration exists to preserve).

locals {
  common_env = { TABLE_NAME = module.table.table_name }
  dist_dir   = "${path.module}/../dist/lambda"
}

module "test_ping_handler" {
  source = "./modules/lambda-function"

  function_name         = "${local.name_prefix}-test-ping-handler"
  handler_name          = "test-ping-handler"
  source_dir            = "${local.dist_dir}/test-ping-handler"
  environment_variables = local.common_env
  policy_documents_json = [module.table.tenant_facing_read_write_policy_json]
  tags                  = { Project = local.project_name, Environment = var.environment }
}

module "items_handler" {
  source = "./modules/lambda-function"

  function_name         = "${local.name_prefix}-items-handler"
  handler_name          = "items-handler"
  source_dir            = "${local.dist_dir}/items-handler"
  environment_variables = local.common_env
  policy_documents_json = [module.table.tenant_facing_read_write_policy_json]
  tags                  = { Project = local.project_name, Environment = var.environment }
}

module "reminders_handler" {
  source = "./modules/lambda-function"

  function_name         = "${local.name_prefix}-reminders-handler"
  handler_name          = "reminders-handler"
  source_dir            = "${local.dist_dir}/reminders-handler"
  environment_variables = local.common_env
  policy_documents_json = [module.table.tenant_facing_read_write_policy_json]
  tags                  = { Project = local.project_name, Environment = var.environment }
}

module "reminder_producer" {
  source = "./modules/lambda-function"

  function_name                  = "${local.name_prefix}-reminder-producer"
  handler_name                   = "reminder-producer-handler"
  source_dir                     = "${local.dist_dir}/reminder-producer-handler"
  environment_variables          = local.common_env
  reserved_concurrent_executions = var.enable_reserved_concurrency ? 2 : null
  # The ONLY function granted gsi3_read — never add this capability to any other function.
  policy_documents_json = [
    module.table.tenant_facing_read_write_policy_json,
    module.table.gsi3_read_policy_json,
  ]
  tags = { Project = local.project_name, Environment = var.environment }
}

module "reminder_dispatch" {
  source = "./modules/lambda-function"

  function_name                  = "${local.name_prefix}-reminder-dispatch"
  handler_name                   = "reminder-dispatch-handler"
  source_dir                     = "${local.dist_dir}/reminder-dispatch-handler"
  environment_variables          = local.common_env
  reserved_concurrent_executions = var.enable_reserved_concurrency ? 10 : null
  policy_documents_json = [
    module.table.tenant_facing_read_write_policy_json,
    module.dispatch_queue.consume_policy_json,
  ]
  tags = { Project = local.project_name, Environment = var.environment }
}

module "reminder_reconciliation" {
  source = "./modules/lambda-function"

  function_name                  = "${local.name_prefix}-reminder-reconciliation"
  handler_name                   = "reminder-reconciliation-handler"
  source_dir                     = "${local.dist_dir}/reminder-reconciliation-handler"
  environment_variables          = local.common_env
  reserved_concurrent_executions = var.enable_reserved_concurrency ? 1 : null
  # One of EXACTLY TWO roles granted gsi6_read (the other is OutboxSweeperReminderDispatch).
  policy_documents_json = [
    module.table.tenant_facing_read_write_policy_json,
    module.table.gsi6_read_policy_json,
  ]
  tags = { Project = local.project_name, Environment = var.environment }
}

# DynamoDB Streams read permissions — Terraform's aws_lambda_event_source_mapping does not
# auto-grant IAM the way CDK's addEventSource(DynamoEventSource) does; this is the explicit
# equivalent, scoped to this table's stream ARN only. Shared by every Streams-triggered
# consumer of this table (DispatchOutboxRelay, and M4's NotificationRouter/
# NotificationEmailOutboxRelay) - the name predates M4 but the policy itself was already
# generic (table-stream-scoped, not reminder-specific).
data "aws_iam_policy_document" "dispatch_outbox_relay_stream_read" {
  statement {
    sid = "DynamoStreamRead"
    actions = [
      "dynamodb:GetRecords",
      "dynamodb:GetShardIterator",
      "dynamodb:DescribeStream",
      "dynamodb:ListStreams",
    ]
    resources = [module.table.stream_arn]
  }
}

module "dispatch_outbox_relay" {
  source = "./modules/lambda-function"

  function_name                  = "${local.name_prefix}-dispatch-outbox-relay"
  handler_name                   = "dispatch-outbox-relay-handler"
  source_dir                     = "${local.dist_dir}/dispatch-outbox-relay-handler"
  environment_variables          = merge(local.common_env, { DISPATCH_QUEUE_URL = module.dispatch_queue.queue_url })
  reserved_concurrent_executions = var.enable_reserved_concurrency ? 2 : null
  policy_documents_json = [
    module.table.tenant_facing_read_write_policy_json,
    module.dispatch_queue.send_policy_json,
    data.aws_iam_policy_document.dispatch_outbox_relay_stream_read.json,
  ]
  tags = { Project = local.project_name, Environment = var.environment }
}

module "outbox_sweeper" {
  source = "./modules/lambda-function"

  # Name preserved as-is (not renamed to reflect its now-broader M4 scope) - this function
  # is already deployed in the dev account since M3.5; renaming an aws_lambda_function forces
  # a destroy+recreate in Terraform, which is an unnecessary destructive change for a pure
  # naming cleanup. The comment above documents the real, broader scope instead.
  function_name = "${local.name_prefix}-outbox-sweeper-reminder-dispatch"
  handler_name  = "outbox-sweeper-handler"
  source_dir    = "${local.dist_dir}/outbox-sweeper-handler"
  environment_variables = merge(local.common_env, {
    DISPATCH_QUEUE_URL      = module.dispatch_queue.queue_url
    EMAIL_DELIVER_QUEUE_URL = module.email_deliver_queue.queue_url
  })
  reserved_concurrent_executions = var.enable_reserved_concurrency ? 2 : null
  # The other of EXACTLY TWO roles granted gsi6_read. M4 extends this SAME privileged role
  # to also send to the notification email queue (docs/architecture/m4-notification-engine-design.md
  # §7.4: one sweeper covering both destinations, not a second sweeper querying the same
  # global GSI6 partition).
  policy_documents_json = [
    module.table.tenant_facing_read_write_policy_json,
    module.table.gsi6_read_policy_json,
    module.dispatch_queue.send_policy_json,
    module.email_deliver_queue.send_policy_json,
  ]
  tags = { Project = local.project_name, Environment = var.environment }
}

# --- API Gateway ---------------------------------------------------------------------------

module "api" {
  source = "./modules/api-gateway"

  api_name                = "${local.name_prefix}-api"
  user_pool_id            = module.auth.user_pool_id
  user_pool_client_id     = module.auth.user_pool_client_id
  aws_region              = var.aws_region
  test_ping_invoke_arn    = module.test_ping_handler.invoke_arn
  test_ping_function_name = module.test_ping_handler.function_name
  items_invoke_arn        = module.items_handler.invoke_arn
  items_function_name     = module.items_handler.function_name
  reminders_invoke_arn    = module.reminders_handler.invoke_arn
  reminders_function_name = module.reminders_handler.function_name
  tags                    = { Project = local.project_name, Environment = var.environment }
}

# --- SQS: ReminderDispatchQueue + DLQ, consumed by ReminderDispatch -----------------------

module "dispatch_queue" {
  source = "./modules/sqs-worker-queue"

  queue_name               = "${local.name_prefix}-reminder-dispatch"
  consumer_timeout_seconds = 10
  aws_region               = var.aws_region
  aws_account_id           = var.aws_account_id
  tags                     = { Project = local.project_name, Environment = var.environment }
}

resource "aws_lambda_event_source_mapping" "reminder_dispatch_from_queue" {
  event_source_arn        = module.dispatch_queue.queue_arn
  function_name           = module.reminder_dispatch.function_name
  batch_size              = 10
  function_response_types = ["ReportBatchItemFailures"]
}

resource "aws_lambda_event_source_mapping" "dispatch_outbox_relay_from_stream" {
  event_source_arn        = module.table.stream_arn
  function_name           = module.dispatch_outbox_relay.function_name
  starting_position       = "LATEST"
  batch_size              = 25
  function_response_types = ["ReportBatchItemFailures"]
}

# --- M4: Notification Engine queues, SES/SNS, workers -------------------------------------
# docs/architecture/m4-notification-engine-design.md (APPROVED, Claude 9.3/Codex 9.4).

module "router_queue" {
  source = "./modules/sqs-worker-queue"

  queue_name               = "${local.name_prefix}-notification-router"
  consumer_timeout_seconds = 10
  aws_region               = var.aws_region
  aws_account_id           = var.aws_account_id
  tags                     = { Project = local.project_name, Environment = var.environment }
}

module "email_deliver_queue" {
  source = "./modules/sqs-worker-queue"

  queue_name               = "${local.name_prefix}-notification-email-deliver"
  consumer_timeout_seconds = 10
  aws_region               = var.aws_region
  aws_account_id           = var.aws_account_id
  tags                     = { Project = local.project_name, Environment = var.environment }
}

module "ses_callback_queue" {
  source = "./modules/sqs-worker-queue"

  queue_name               = "${local.name_prefix}-ses-callback"
  consumer_timeout_seconds = 10
  aws_region               = var.aws_region
  aws_account_id           = var.aws_account_id
  tags                     = { Project = local.project_name, Environment = var.environment }
}

module "ses_notifications" {
  source = "./modules/ses-notifications"

  name_prefix        = local.name_prefix
  callback_queue_arn = module.ses_callback_queue.queue_arn
  aws_region         = var.aws_region
  aws_account_id     = var.aws_account_id
  tags               = { Project = local.project_name, Environment = var.environment }
}

resource "aws_sqs_queue_policy" "ses_callback_queue" {
  queue_url = module.ses_callback_queue.queue_url
  policy    = module.ses_notifications.queue_policy_json
}

# EventBridge (M3 pattern) delivers notification.intent-created.v1 to the router queue -
# the outbox already publishes it there (OutboxPublisher's generic EventBridge path, no new
# destination discriminator needed for THIS hop, only for router->email which uses the
# SQS_NOTIFICATION_EMAIL_V1 outbox destination per the design).
resource "aws_cloudwatch_event_rule" "notification_intent_created" {
  name           = "${local.name_prefix}-notification-intent-created"
  event_bus_name = "default"
  event_pattern = jsonencode({
    "detail-type" = ["notification.intent-created.v1"]
  })
  tags = { Project = local.project_name, Environment = var.environment }
}

resource "aws_cloudwatch_event_target" "notification_intent_created_to_router_queue" {
  rule      = aws_cloudwatch_event_rule.notification_intent_created.name
  target_id = "router-queue"
  arn       = module.router_queue.queue_arn
}

data "aws_iam_policy_document" "eventbridge_to_router_queue" {
  statement {
    sid       = "AllowEventBridgeRuleToSendMessage"
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [module.router_queue.queue_arn]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_cloudwatch_event_rule.notification_intent_created.arn]
    }
  }
}

resource "aws_sqs_queue_policy" "router_queue" {
  queue_url = module.router_queue.queue_url
  policy    = data.aws_iam_policy_document.eventbridge_to_router_queue.json
}

# ses:SendEmail scoped to nothing table/queue-related - a distinct capability EmailDelivery
# alone gets (docs/architecture/reviews/m4-notification-engine-design/codex-proposal-round1.md
# §12.4: "EmailDeliveryWorker: ... e ses:SendEmail; sem GSI6").
data "aws_iam_policy_document" "ses_send_email" {
  statement {
    sid       = "SesSendEmail"
    actions   = ["ses:SendEmail"]
    resources = ["*"] # SESv2 SendEmail doesn't support resource-level restriction by FromEmailAddress; scoped narrowly to this single action instead.
  }
}

module "notification_router" {
  source = "./modules/lambda-function"

  function_name         = "${local.name_prefix}-notification-router"
  handler_name          = "notification-router-handler"
  source_dir            = "${local.dist_dir}/notification-router-handler"
  environment_variables = local.common_env
  policy_documents_json = [
    module.table.tenant_facing_read_write_policy_json,
    data.aws_iam_policy_document.dispatch_outbox_relay_stream_read.json,
  ]
  tags = { Project = local.project_name, Environment = var.environment }
}

resource "aws_lambda_event_source_mapping" "notification_router_from_stream" {
  event_source_arn        = module.table.stream_arn
  function_name           = module.notification_router.function_name
  starting_position       = "LATEST"
  batch_size              = 25
  function_response_types = ["ReportBatchItemFailures"]
}

module "notification_email_outbox_relay" {
  source = "./modules/lambda-function"

  function_name         = "${local.name_prefix}-notification-email-outbox-relay"
  handler_name          = "notification-email-outbox-relay-handler"
  source_dir            = "${local.dist_dir}/notification-email-outbox-relay-handler"
  environment_variables = merge(local.common_env, { EMAIL_DELIVER_QUEUE_URL = module.email_deliver_queue.queue_url })
  policy_documents_json = [
    module.table.tenant_facing_read_write_policy_json,
    module.email_deliver_queue.send_policy_json,
    data.aws_iam_policy_document.dispatch_outbox_relay_stream_read.json,
  ]
  tags = { Project = local.project_name, Environment = var.environment }
}

resource "aws_lambda_event_source_mapping" "notification_email_outbox_relay_from_stream" {
  event_source_arn        = module.table.stream_arn
  function_name           = module.notification_email_outbox_relay.function_name
  starting_position       = "LATEST"
  batch_size              = 25
  function_response_types = ["ReportBatchItemFailures"]
}

module "email_delivery" {
  source = "./modules/lambda-function"

  function_name = "${local.name_prefix}-email-delivery"
  handler_name  = "email-delivery-handler"
  source_dir    = "${local.dist_dir}/email-delivery-handler"
  environment_variables = merge(local.common_env, {
    SES_FROM_ADDRESS      = var.ses_from_address
    SES_CONFIGURATION_SET = module.ses_notifications.configuration_set_name
  })
  policy_documents_json = [
    module.table.tenant_facing_read_write_policy_json,
    module.email_deliver_queue.consume_policy_json,
    data.aws_iam_policy_document.ses_send_email.json,
  ]
  tags = { Project = local.project_name, Environment = var.environment }
}

resource "aws_lambda_event_source_mapping" "email_delivery_from_queue" {
  event_source_arn        = module.email_deliver_queue.queue_arn
  function_name           = module.email_delivery.function_name
  batch_size              = 10
  function_response_types = ["ReportBatchItemFailures"]
}

module "ses_callback" {
  source = "./modules/lambda-function"

  function_name         = "${local.name_prefix}-ses-callback"
  handler_name          = "ses-callback-handler"
  source_dir            = "${local.dist_dir}/ses-callback-handler"
  environment_variables = merge(local.common_env, { SES_ACCOUNT_ALIAS = "default" })
  policy_documents_json = [
    module.table.tenant_facing_read_write_policy_json,
    module.ses_callback_queue.consume_policy_json,
  ]
  tags = { Project = local.project_name, Environment = var.environment }
}

resource "aws_lambda_event_source_mapping" "ses_callback_from_queue" {
  event_source_arn        = module.ses_callback_queue.queue_arn
  function_name           = module.ses_callback.function_name
  batch_size              = 10
  function_response_types = ["ReportBatchItemFailures"]
}

# --- EventBridge Scheduler: producer / reconciliation (CLAIMS+DST) / outbox sweeper -------

module "schedule" {
  source = "./modules/reminder-schedule"

  reminder_producer_function_arn        = module.reminder_producer.function_arn
  reminder_producer_function_name       = module.reminder_producer.function_name
  reminder_reconciliation_function_arn  = module.reminder_reconciliation.function_arn
  reminder_reconciliation_function_name = module.reminder_reconciliation.function_name
  outbox_sweeper_function_arn           = module.outbox_sweeper.function_arn
  outbox_sweeper_function_name          = module.outbox_sweeper.function_name
  schedules_enabled                     = var.schedules_enabled
  tags                                  = { Project = local.project_name, Environment = var.environment }
}

# --- CloudWatch observability: per-function error alarms + dispatch queue backlog age -----

module "observability" {
  source = "./modules/reminder-observability"

  reminder_producer_function_name       = module.reminder_producer.function_name
  reminder_dispatch_function_name       = module.reminder_dispatch.function_name
  reminder_reconciliation_function_name = module.reminder_reconciliation.function_name
  dispatch_outbox_relay_function_name   = module.dispatch_outbox_relay.function_name
  outbox_sweeper_function_name          = module.outbox_sweeper.function_name
  dispatch_queue_name                   = module.dispatch_queue.queue_name
  tags                                  = { Project = local.project_name, Environment = var.environment }
}

# --- Cost governance ------------------------------------------------------------------------

module "cost_budget" {
  source = "./modules/cost-budget"

  name                = "${local.name_prefix}-monthly-cost"
  monthly_limit_usd   = var.monthly_budget_usd
  notification_emails = var.budget_notification_emails
}

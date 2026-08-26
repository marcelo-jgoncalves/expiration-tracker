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
  # Full BFF (D-053/D-054): the only real caller of this callback URL is the BFF Lambda's own
  # /bff/callback route (src/modules/bff/http/bff-handlers.ts's handleCallback), never the
  # browser directly - derived from var.app_origin so it can never drift from
  # local.bff_redirect_uri, which the BFF Lambda's BFF_REDIRECT_URI env var also uses below.
  callback_urls = [local.bff_redirect_uri]
  domain_prefix = var.bff_cognito_domain_prefix
  tags          = { Project = local.project_name, Environment = var.environment }
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
  adot_layer_arn        = var.adot_layer_arn
  environment_variables = local.common_env
  policy_documents_json = [module.table.tenant_facing_read_write_policy_json]
  tags                  = { Project = local.project_name, Environment = var.environment }
}

module "items_handler" {
  source = "./modules/lambda-function"

  function_name         = "${local.name_prefix}-items-handler"
  handler_name          = "items-handler"
  source_dir            = "${local.dist_dir}/items-handler"
  adot_layer_arn        = var.adot_layer_arn
  environment_variables = local.common_env
  policy_documents_json = [module.table.tenant_facing_read_write_policy_json]
  tags                  = { Project = local.project_name, Environment = var.environment }
}

# M10 (D-037): pepper de hash do guest token. Achado real de revisão adversarial (Codex):
# GUEST_TOKEN_PEPPER precisa chegar a QUALQUER Lambda que valide/emita token de convidado -
# faltava aqui, o que quebraria o cold start de subjects_handler e guest_documents_handler em
# runtime real. Trade-off consciente (registrado, não escondido): valor vai como env var
# Lambda (nunca hardcoded/commitado), não via Secrets Manager fetch em runtime - proporcional
# ao estágio atual sem dado real de tenant em risco. Upgrade fica como follow-up.
resource "random_password" "guest_token_pepper" {
  length  = 64
  special = false
}

module "subjects_handler" {
  source = "./modules/lambda-function"

  # M9 (D-036/D-040): TrackedSubject + RequirementAssignment + ItemWatch (watchers ficam no
  # items_handler existente, reaproveitando a mesma Lambda de expiration - ver api-gateway).
  # Sem capability nova alem da geral: GSI7 e tenant-scoped, ja incluido em
  # tenant_facing_read_write_policy_json (dynamo-table module).
  function_name  = "${local.name_prefix}-subjects-handler"
  handler_name   = "subjects-handler"
  source_dir     = "${local.dist_dir}/subjects-handler"
  adot_layer_arn = var.adot_layer_arn
  environment_variables = merge(local.common_env, {
    GUEST_TOKEN_PEPPER = random_password.guest_token_pepper.result
    # M10 cluster 4 (D-049): mecanismo de convite inicial automatizado é sempre implementado -
    # SES_FROM_ADDRESS/SES_CONFIGURATION_SET sempre wireados (reaproveita o MESMO SES já usado
    # por EmailDeliveryWorker/DocumentChasingDispatch, nenhum recurso novo), mas o ENVIO real
    # só acontece se o kill switch abaixo estiver true - default false em todos os ambientes.
    DOCUMENT_REQUEST_INITIAL_INVITE_EMAIL_ENABLED = tostring(var.document_request_initial_invite_email_enabled)
    SES_FROM_ADDRESS                              = var.ses_from_address
    SES_CONFIGURATION_SET                         = module.ses_notifications.configuration_set_name
    # GUEST_UPLOAD_BASE_URL deliberadamente NÃO setado - mesmo placeholder documentado do
    # document_chasing_dispatch_handler (ver comentário lá).
  })
  policy_documents_json = [
    module.table.tenant_facing_read_write_policy_json,
    data.aws_iam_policy_document.ses_send_email.json,
  ]
  tags = { Project = local.project_name, Environment = var.environment }
}

module "reminders_handler" {
  source = "./modules/lambda-function"

  function_name         = "${local.name_prefix}-reminders-handler"
  handler_name          = "reminders-handler"
  source_dir            = "${local.dist_dir}/reminders-handler"
  adot_layer_arn        = var.adot_layer_arn
  environment_variables = local.common_env
  policy_documents_json = [module.table.tenant_facing_read_write_policy_json]
  tags                  = { Project = local.project_name, Environment = var.environment }
}

module "notifications_handler" {
  source = "./modules/lambda-function"

  function_name         = "${local.name_prefix}-notifications-handler"
  handler_name          = "notifications-handler"
  source_dir            = "${local.dist_dir}/notifications-handler"
  adot_layer_arn        = var.adot_layer_arn
  environment_variables = local.common_env
  policy_documents_json = [module.table.tenant_facing_read_write_policy_json]
  tags                  = { Project = local.project_name, Environment = var.environment }
}

module "reminder_producer" {
  source = "./modules/lambda-function"

  function_name                  = "${local.name_prefix}-reminder-producer"
  handler_name                   = "reminder-producer-handler"
  source_dir                     = "${local.dist_dir}/reminder-producer-handler"
  adot_layer_arn                 = var.adot_layer_arn
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
  adot_layer_arn                 = var.adot_layer_arn
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
  adot_layer_arn                 = var.adot_layer_arn
  environment_variables          = local.common_env
  reserved_concurrent_executions = var.enable_reserved_concurrency ? 1 : null
  # One of EXACTLY THREE roles granted gsi6_read (the others are OutboxSweeperReminderDispatch
  # and, since M6, UploadSlotReconciliationWorker - see security-audit.ts's
  # GlobalIndexComponent "upload-slot-reconciliation").
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

  function_name  = "${local.name_prefix}-dispatch-outbox-relay"
  handler_name   = "dispatch-outbox-relay-handler"
  source_dir     = "${local.dist_dir}/dispatch-outbox-relay-handler"
  adot_layer_arn = var.adot_layer_arn
  # M10 cluster 4 (D-039/D-046/D-048): second destination on this SAME relay Lambda/DynamoDB
  # Streams event source mapping (below) - never a new relay function just for one more queue.
  # M11 (D-042) adds a third destination; BLOCKER-B adds a fourth, same reasoning.
  environment_variables = merge(local.common_env, {
    DISPATCH_QUEUE_URL                         = module.dispatch_queue.queue_url
    DOCUMENT_CHASING_DISPATCH_QUEUE_URL        = module.document_chasing_dispatch_queue.queue_url
    IMPORT_COMMIT_QUEUE_URL                    = module.import_commit_queue.queue_url
    REMINDER_MATERIALIZATION_TRIGGER_QUEUE_URL = module.reminder_materialization_trigger_queue.queue_url
  })
  reserved_concurrent_executions = var.enable_reserved_concurrency ? 2 : null
  policy_documents_json = [
    module.table.tenant_facing_read_write_policy_json,
    module.dispatch_queue.send_policy_json,
    module.document_chasing_dispatch_queue.send_policy_json,
    module.import_commit_queue.send_policy_json,
    module.reminder_materialization_trigger_queue.send_policy_json,
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
  function_name  = "${local.name_prefix}-outbox-sweeper-reminder-dispatch"
  handler_name   = "outbox-sweeper-handler"
  source_dir     = "${local.dist_dir}/outbox-sweeper-handler"
  adot_layer_arn = var.adot_layer_arn
  environment_variables = merge(local.common_env, {
    DISPATCH_QUEUE_URL                         = module.dispatch_queue.queue_url
    EMAIL_DELIVER_QUEUE_URL                    = module.email_deliver_queue.queue_url
    DOCUMENT_CHASING_DISPATCH_QUEUE_URL        = module.document_chasing_dispatch_queue.queue_url
    IMPORT_COMMIT_QUEUE_URL                    = module.import_commit_queue.queue_url
    REMINDER_MATERIALIZATION_TRIGGER_QUEUE_URL = module.reminder_materialization_trigger_queue.queue_url
  })
  reserved_concurrent_executions = var.enable_reserved_concurrency ? 2 : null
  # The second of EXACTLY THREE roles granted gsi6_read (see reminder_reconciliation above).
  # M4 extends this SAME privileged role to also send to the notification email queue
  # (m4-notification-engine-design.md §7.4: one sweeper covering multiple destinations, not a
  # second sweeper querying the same global GSI6 partition) - M10 cluster 4 extends it again
  # for document-chasing-dispatch, M11 (D-042) once more for import-commit, and BLOCKER-B once
  # more for the reminder-materialization-trigger queue, same reasoning.
  policy_documents_json = [
    module.table.tenant_facing_read_write_policy_json,
    module.table.gsi6_read_policy_json,
    module.dispatch_queue.send_policy_json,
    module.email_deliver_queue.send_policy_json,
    module.document_chasing_dispatch_queue.send_policy_json,
    module.import_commit_queue.send_policy_json,
    module.reminder_materialization_trigger_queue.send_policy_json,
  ]
  tags = { Project = local.project_name, Environment = var.environment }
}

# --- API Gateway ---------------------------------------------------------------------------

module "api" {
  source = "./modules/api-gateway"

  api_name            = "${local.name_prefix}-api"
  user_pool_id        = module.auth.user_pool_id
  user_pool_client_id = module.auth.user_pool_client_id
  aws_region          = var.aws_region
  # Rollback design entrega 1: API Gateway integrates against the `live` alias (never
  # $LATEST) so an emergency alias repoint actually changes what a real request invokes.
  test_ping_invoke_arn          = module.test_ping_handler.live_alias_invoke_arn
  test_ping_function_name       = module.test_ping_handler.function_name
  items_invoke_arn              = module.items_handler.live_alias_invoke_arn
  items_function_name           = module.items_handler.function_name
  reminders_invoke_arn          = module.reminders_handler.live_alias_invoke_arn
  reminders_function_name       = module.reminders_handler.function_name
  notifications_invoke_arn      = module.notifications_handler.live_alias_invoke_arn
  notifications_function_name   = module.notifications_handler.function_name
  documents_invoke_arn          = module.documents_handler.live_alias_invoke_arn
  documents_function_name       = module.documents_handler.function_name
  subjects_invoke_arn           = module.subjects_handler.live_alias_invoke_arn
  subjects_function_name        = module.subjects_handler.function_name
  guest_documents_invoke_arn    = module.guest_documents_handler.live_alias_invoke_arn
  guest_documents_function_name = module.guest_documents_handler.function_name
  imports_invoke_arn            = module.imports_handler.live_alias_invoke_arn
  imports_function_name         = module.imports_handler.function_name
  tags                          = { Project = local.project_name, Environment = var.environment }
}

# --- Full BFF (D-053/D-054) ---------------------------------------------------------------

module "bff_session_table" {
  source = "./modules/bff-session-table"

  table_name     = "${local.name_prefix}-bff-session"
  aws_region     = var.aws_region
  aws_account_id = var.aws_account_id
  tags           = { Project = local.project_name, Environment = var.environment }
}

# Same posture as guest_token_pepper above: env var only (never Secrets Manager), a
# conscious trade-off proportional to this stage without real tenant data at risk yet.
resource "random_password" "session_token_pepper" {
  length  = 64
  special = false
}

module "bff_handler" {
  source = "./modules/lambda-function"

  function_name  = "${local.name_prefix}-bff-handler"
  handler_name   = "bff-handler"
  source_dir     = "${local.dist_dir}/bff-handler"
  adot_layer_arn = var.adot_layer_arn
  environment_variables = merge(local.common_env, {
    BFF_SESSION_TABLE_NAME = module.bff_session_table.table_name
    SESSION_TOKEN_PEPPER   = random_password.session_token_pepper.result
    SESSION_KMS_KEY_ID     = module.bff_session_table.kms_key_id
    COGNITO_USER_POOL_ID   = module.auth.user_pool_id
    COGNITO_CLIENT_ID      = module.auth.user_pool_client_id
    COGNITO_CLIENT_SECRET  = module.auth.user_pool_client_secret
    COGNITO_DOMAIN         = "https://${module.auth.hosted_ui_domain}.auth.${var.aws_region}.amazoncognito.com"
    BFF_REDIRECT_URI       = local.bff_redirect_uri
    APP_ORIGIN             = var.app_origin
    # Server-to-server calls stay on the real API's default execution endpoint (never
    # through this same BFF's own API Gateway) - the JWT authorizer there is unaffected by
    # any of this, exactly as designed (D-053: Full BFF is additive, resource routes keep
    # accepting a direct Bearer token from any other caller too).
    API_BASE_URL = module.api.api_endpoint
  })
  # Identity module reads/writes (User/IdentityMapping/DeviceSession) on the MAIN table -
  # the SAME policy items_handler already uses, nothing new granted there. Session-table
  # access is the separate, narrowly-scoped policy from bff_session_table (D-054: never
  # merged into the general tenant_facing policy).
  policy_documents_json = [
    module.table.tenant_facing_read_write_policy_json,
    module.bff_session_table.bff_session_access_policy_json,
  ]
  tags = { Project = local.project_name, Environment = var.environment }
}

module "bff_api" {
  source = "./modules/bff-api-gateway"

  api_name          = "${local.name_prefix}-bff-api"
  bff_invoke_arn    = module.bff_handler.live_alias_invoke_arn
  bff_function_name = module.bff_handler.function_name
  app_origin        = var.app_origin
  tags              = { Project = local.project_name, Environment = var.environment }
}

# --- SPA hosting: CloudFront + S3, coexisting with the Full BFF above (ADR-0011) -----------
# docs/architecture/adr/ADR-0011-cloudfront-bff-coexistence.md - a single distribution with
# dedicated /bff, /bff/* behaviors targeting module.bff_api above, default behavior serving
# the SPA from S3+OAC. No custom domain/ACM certificate yet (CloudFront's own domain is
# explicitly acceptable for dev per the ADR) - var.app_origin stays a placeholder until the
# first apply's real distribution_domain_name is known and fed back via `-var app_origin=...`,
# same placeholder-until-verified posture already used for ses_from_address/
# bff_cognito_domain_prefix in this same file.

module "spa_hosting" {
  source = "./modules/spa-hosting"

  name_prefix      = local.name_prefix
  bff_api_endpoint = module.bff_api.api_endpoint
  tags             = { Project = local.project_name, Environment = var.environment }
}

# --- WAF (M10, D-037) — REMOVIDO (D-051): AWS WAFv2 não suporta associação com API Gateway
# HTTP API v2 (só REST API v1/ALB/AppSync/Cognito/App Runner/Verified Access/Amplify) -
# achado real no primeiro `terraform apply` de fato deste recurso (WAFInvalidParameterException
# na AssociateWebACL). O módulo `infra/modules/waf/` foi deletado (não só desligado do wiring -
# a abstração como estava era estruturalmente inválida, reconstruir do zero quando existir
# CloudFront é mais seguro que reaproveitar código que nunca poderia funcionar standalone).
# Mitigação imediata: throttling nativo do HTTP API (ver `route_settings`/
# `default_route_settings` no módulo api-gateway). CloudFront+WAF registrado como débito
# técnico bloqueante antes de tráfego público real de produção (`decisions-log.md` D-051).

# --- Observability: SNS alert topic (m5-observability-design.md §4) -----------------------
# Instantiated before the queues/observability module below so its ARN is available to wire
# into every aws_cloudwatch_metric_alarm's alarm_actions.

module "alert_topic" {
  source = "./modules/alert-topic"

  name_prefix = local.name_prefix
  alert_email = var.alert_email
  tags        = { Project = local.project_name, Environment = var.environment }
}

# --- SQS: ReminderDispatchQueue + DLQ, consumed by ReminderDispatch -----------------------

module "dispatch_queue" {
  source = "./modules/sqs-worker-queue"

  queue_name               = "${local.name_prefix}-reminder-dispatch"
  consumer_timeout_seconds = 10
  aws_region               = var.aws_region
  aws_account_id           = var.aws_account_id
  alert_topic_arn          = module.alert_topic.topic_arn
  tags                     = { Project = local.project_name, Environment = var.environment }
}

resource "aws_lambda_event_source_mapping" "reminder_dispatch_from_queue" {
  event_source_arn        = module.dispatch_queue.queue_arn
  function_name           = module.reminder_dispatch.live_alias_arn
  batch_size              = 10
  function_response_types = ["ReportBatchItemFailures"]
}

# --- SQS: ReminderMaterializationTriggerQueue + DLQ (BLOCKER-B) ---------------------------
# reminder-delivery-pipeline.md §4 (Codex Round H APPROVED 9.2/10): the trigger that closes
# BLOCKER-B - consumed by ReminderMaterializationTrigger, fed by the same DispatchOutboxRelay/
# OutboxSweeperReminderDispatch roles every other destination already uses (the "generic
# EventBridge path" the design doc originally assumed doesn't actually exist in this
# codebase - see outbox.ts's OutboxDestination comment).

module "reminder_materialization_trigger_queue" {
  source = "./modules/sqs-worker-queue"

  queue_name               = "${local.name_prefix}-reminder-materialization-trigger"
  consumer_timeout_seconds = 10
  aws_region               = var.aws_region
  aws_account_id           = var.aws_account_id
  alert_topic_arn          = module.alert_topic.topic_arn
  tags                     = { Project = local.project_name, Environment = var.environment }
}

module "reminder_materialization_trigger" {
  source = "./modules/lambda-function"

  function_name                  = "${local.name_prefix}-reminder-materialization-trigger"
  handler_name                   = "reminder-materialization-trigger-handler"
  source_dir                     = "${local.dist_dir}/reminder-materialization-trigger-handler"
  adot_layer_arn                 = var.adot_layer_arn
  environment_variables          = local.common_env
  reserved_concurrent_executions = var.enable_reserved_concurrency ? 5 : null
  policy_documents_json = [
    module.table.tenant_facing_read_write_policy_json,
    module.reminder_materialization_trigger_queue.consume_policy_json,
  ]
  tags = { Project = local.project_name, Environment = var.environment }
}

resource "aws_lambda_event_source_mapping" "reminder_materialization_trigger_from_queue" {
  event_source_arn        = module.reminder_materialization_trigger_queue.queue_arn
  function_name           = module.reminder_materialization_trigger.live_alias_arn
  batch_size              = 10
  function_response_types = ["ReportBatchItemFailures"]
}

resource "aws_lambda_event_source_mapping" "dispatch_outbox_relay_from_stream" {
  event_source_arn        = module.table.stream_arn
  function_name           = module.dispatch_outbox_relay.live_alias_arn
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
  alert_topic_arn          = module.alert_topic.topic_arn
  tags                     = { Project = local.project_name, Environment = var.environment }
}

module "email_deliver_queue" {
  source = "./modules/sqs-worker-queue"

  queue_name               = "${local.name_prefix}-notification-email-deliver"
  consumer_timeout_seconds = 10
  aws_region               = var.aws_region
  aws_account_id           = var.aws_account_id
  alert_topic_arn          = module.alert_topic.topic_arn
  tags                     = { Project = local.project_name, Environment = var.environment }
}

module "ses_callback_queue" {
  source = "./modules/sqs-worker-queue"

  queue_name               = "${local.name_prefix}-ses-callback"
  consumer_timeout_seconds = 10
  aws_region               = var.aws_region
  aws_account_id           = var.aws_account_id
  alert_topic_arn          = module.alert_topic.topic_arn
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
  adot_layer_arn        = var.adot_layer_arn
  environment_variables = local.common_env
  policy_documents_json = [
    module.table.tenant_facing_read_write_policy_json,
    data.aws_iam_policy_document.dispatch_outbox_relay_stream_read.json,
  ]
  tags = { Project = local.project_name, Environment = var.environment }
}

resource "aws_lambda_event_source_mapping" "notification_router_from_stream" {
  event_source_arn        = module.table.stream_arn
  function_name           = module.notification_router.live_alias_arn
  starting_position       = "LATEST"
  batch_size              = 25
  function_response_types = ["ReportBatchItemFailures"]
}

module "notification_email_outbox_relay" {
  source = "./modules/lambda-function"

  function_name         = "${local.name_prefix}-notification-email-outbox-relay"
  handler_name          = "notification-email-outbox-relay-handler"
  source_dir            = "${local.dist_dir}/notification-email-outbox-relay-handler"
  adot_layer_arn        = var.adot_layer_arn
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
  function_name           = module.notification_email_outbox_relay.live_alias_arn
  starting_position       = "LATEST"
  batch_size              = 25
  function_response_types = ["ReportBatchItemFailures"]
}

module "email_delivery" {
  source = "./modules/lambda-function"

  function_name  = "${local.name_prefix}-email-delivery"
  handler_name   = "email-delivery-handler"
  source_dir     = "${local.dist_dir}/email-delivery-handler"
  adot_layer_arn = var.adot_layer_arn
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
  function_name           = module.email_delivery.live_alias_arn
  batch_size              = 10
  function_response_types = ["ReportBatchItemFailures"]
}

module "ses_callback" {
  source = "./modules/lambda-function"

  function_name         = "${local.name_prefix}-ses-callback"
  handler_name          = "ses-callback-handler"
  source_dir            = "${local.dist_dir}/ses-callback-handler"
  adot_layer_arn        = var.adot_layer_arn
  environment_variables = merge(local.common_env, { SES_ACCOUNT_ALIAS = "default" })
  policy_documents_json = [
    module.table.tenant_facing_read_write_policy_json,
    module.ses_callback_queue.consume_policy_json,
  ]
  tags = { Project = local.project_name, Environment = var.environment }
}

resource "aws_lambda_event_source_mapping" "ses_callback_from_queue" {
  event_source_arn        = module.ses_callback_queue.queue_arn
  function_name           = module.ses_callback.live_alias_arn
  batch_size              = 10
  function_response_types = ["ReportBatchItemFailures"]
}

# --- EventBridge Scheduler: producer / reconciliation (CLAIMS+DST) / outbox sweeper -------

module "schedule" {
  source = "./modules/reminder-schedule"

  # Rollback design entrega 1: EventBridge Scheduler targets + its invoke permission both use
  # the `live` alias ARN (never $LATEST/the bare function ARN) so an emergency alias repoint
  # actually changes what the schedule invokes.
  reminder_producer_function_arn        = module.reminder_producer.live_alias_arn
  reminder_producer_function_name       = module.reminder_producer.function_name
  reminder_reconciliation_function_arn  = module.reminder_reconciliation.live_alias_arn
  reminder_reconciliation_function_name = module.reminder_reconciliation.function_name
  outbox_sweeper_function_arn           = module.outbox_sweeper.live_alias_arn
  outbox_sweeper_function_name          = module.outbox_sweeper.function_name
  schedules_enabled                     = var.schedules_enabled
  tags                                  = { Project = local.project_name, Environment = var.environment }
}

# --- CloudWatch observability: per-function error alarms + dispatch queue backlog age -----

module "observability" {
  source = "./modules/reminder-observability"

  reminder_producer_function_name         = module.reminder_producer.function_name
  reminder_dispatch_function_name         = module.reminder_dispatch.function_name
  reminder_reconciliation_function_name   = module.reminder_reconciliation.function_name
  dispatch_outbox_relay_function_name     = module.dispatch_outbox_relay.function_name
  outbox_sweeper_function_name            = module.outbox_sweeper.function_name
  document_chasing_dispatch_function_name = module.document_chasing_dispatch_handler.function_name
  dispatch_queue_name                     = module.dispatch_queue.queue_name
  alert_topic_arn                         = module.alert_topic.topic_arn
  tags                                    = { Project = local.project_name, Environment = var.environment }
}

# --- Cost governance ------------------------------------------------------------------------

module "cost_budget" {
  source = "./modules/cost-budget"

  name                = "${local.name_prefix}-monthly-cost"
  monthly_limit_usd   = var.monthly_budget_usd
  notification_emails = var.budget_notification_emails
}

# --- Rollback design entrega 1: deploy manifest bucket -------------------------------------
# docs/architecture/reviews/rollback-mechanism-design/codex-round2-final-design.md §3.
# Operational-only bucket (deploy manifests, current-healthy pointer, rollback records) -
# never tenant data or PII, deliberately separate from the document buckets.

module "deploy_manifests" {
  source = "./modules/deploy-manifest-bucket"

  bucket_name = "${local.name_prefix}-deploy-manifests"
  tags        = { Project = local.project_name, Environment = var.environment }
}

# --- Trilha de auditoria de segurança (MVP desta sessão) -----------------------------------
# docs/architecture/reviews/security-audit-trail-design/codex-reconciliation-round2-final-design.md
# Detecta os 2 achados reais abertos (Segurança-Logging/OWASP A09, SRE-Detecção): negação de
# autorização e acesso a GSI3/GSI6 não tinham trilha dedicada. Reusa o alert-topic real de M5.

module "security_audit_observability" {
  source = "./modules/security-audit-observability"

  http_function_names = [
    module.items_handler.function_name,
    module.reminders_handler.function_name,
    module.notifications_handler.function_name,
    module.test_ping_handler.function_name,
  ]
  global_index_function_names = [
    module.reminder_producer.function_name,
    module.reminder_reconciliation.function_name,
    module.outbox_sweeper.function_name,
  ]
  alert_topic_arn = module.alert_topic.topic_arn
  tags            = { Project = local.project_name, Environment = var.environment }
}

# --- M6: Document upload e malware boundary ------------------------------------------------
# docs/architecture/reviews/m6-document-upload-design/codex-reconciliation-round2-final-design.md
# (Claude 9.4/Codex 9.6). Two physically separate buckets (quarantine/clean, own KMS keys),
# GuardDuty Malware Protection behind the `malware_protection_enabled` toggle, 5 new Lambda
# functions. No business-facing Lambda role (items-handler etc.) is ever granted any
# permission on either bucket - only the 5 functions below.

module "document_buckets" {
  source = "./modules/document-buckets"

  name_prefix = local.name_prefix
  tags        = { Project = local.project_name, Environment = var.environment }
}

module "malware_result_queue" {
  source = "./modules/sqs-worker-queue"

  queue_name               = "${local.name_prefix}-malware-result"
  consumer_timeout_seconds = 15
  aws_region               = var.aws_region
  aws_account_id           = var.aws_account_id
  alert_topic_arn          = module.alert_topic.topic_arn
  tags                     = { Project = local.project_name, Environment = var.environment }
}

module "upload_finalizer_queue" {
  source = "./modules/sqs-worker-queue"

  queue_name               = "${local.name_prefix}-upload-finalizer"
  consumer_timeout_seconds = 30 # covers the synchronous parser-sandbox invocation below
  aws_region               = var.aws_region
  aws_account_id           = var.aws_account_id
  alert_topic_arn          = module.alert_topic.topic_arn
  tags                     = { Project = local.project_name, Environment = var.environment }
}

# S3 "Object Created" in the quarantine bucket -> UploadFinalizerWorker. The quarantine
# bucket's own aws_s3_bucket_notification (document-buckets module) forwards to EventBridge;
# this is the rule/target/queue-policy triad that routes it onward (same shape as M4's
# notification.intent-created.v1 rule below).
resource "aws_cloudwatch_event_rule" "quarantine_object_created" {
  name           = "${local.name_prefix}-quarantine-object-created"
  event_bus_name = "default"
  event_pattern = jsonencode({
    source      = ["aws.s3"]
    detail-type = ["Object Created"]
    detail = {
      bucket = { name = [module.document_buckets.quarantine_bucket_name] }
    }
  })
  tags = { Project = local.project_name, Environment = var.environment }
}

resource "aws_cloudwatch_event_target" "quarantine_object_created_to_finalizer_queue" {
  rule      = aws_cloudwatch_event_rule.quarantine_object_created.name
  target_id = "upload-finalizer-queue"
  arn       = module.upload_finalizer_queue.queue_arn
}

data "aws_iam_policy_document" "eventbridge_to_upload_finalizer_queue" {
  statement {
    sid       = "AllowEventBridgeRuleToSendMessage"
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [module.upload_finalizer_queue.queue_arn]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_cloudwatch_event_rule.quarantine_object_created.arn]
    }
  }
}

resource "aws_sqs_queue_policy" "upload_finalizer_queue" {
  queue_url = module.upload_finalizer_queue.queue_url
  policy    = data.aws_iam_policy_document.eventbridge_to_upload_finalizer_queue.json
}

# --- ParserSandbox: isolated Lambda, no VPC/DynamoDB/clean-bucket access (M6 design) --------

data "aws_iam_policy_document" "parser_sandbox_read_quarantine" {
  statement {
    sid       = "ReadQuarantineObjects"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:GetObjectVersion"]
    resources = ["${module.document_buckets.quarantine_bucket_arn}/*"]
  }
  statement {
    sid       = "DecryptQuarantineObjects"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [module.document_buckets.quarantine_kms_key_arn]
  }
}

module "parser_sandbox" {
  source = "./modules/lambda-function"

  function_name   = "${local.name_prefix}-parser-sandbox"
  handler_name    = "parser-sandbox-handler"
  source_dir      = "${local.dist_dir}/parser-sandbox-handler"
  adot_layer_arn  = var.adot_layer_arn
  timeout_seconds = 30  # M6 design: 30s hard limit on PDF structural parsing.
  memory_size     = 512 # pdf-lib needs headroom beyond the 256MB default for a 10MiB PDF.
  policy_documents_json = [
    data.aws_iam_policy_document.parser_sandbox_read_quarantine.json,
  ]
  tags = { Project = local.project_name, Environment = var.environment }
}

# --- DocumentsHandler: HTTP (POST reserve upload, DELETE document) --------------------------

data "aws_iam_policy_document" "documents_presign_quarantine_put" {
  statement {
    sid       = "PresignQuarantinePut"
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${module.document_buckets.quarantine_bucket_arn}/*"]
  }
  statement {
    sid       = "EncryptQuarantineObjects"
    effect    = "Allow"
    actions   = ["kms:GenerateDataKey"]
    resources = [module.document_buckets.quarantine_kms_key_arn]
  }
}

module "documents_handler" {
  source = "./modules/lambda-function"

  function_name  = "${local.name_prefix}-documents-handler"
  handler_name   = "documents-handler"
  source_dir     = "${local.dist_dir}/documents-handler"
  adot_layer_arn = var.adot_layer_arn
  environment_variables = merge(local.common_env, {
    QUARANTINE_BUCKET_NAME = module.document_buckets.quarantine_bucket_name
  })
  policy_documents_json = [
    module.table.tenant_facing_read_write_policy_json,
    data.aws_iam_policy_document.documents_presign_quarantine_put.json,
  ]
  tags = { Project = local.project_name, Environment = var.environment }
}

# --- GuestDocumentsHandler: /guest/document-requests/{token}* (M10, D-037) ------------------
# PRIMEIRA Lambda do projeto atrás de rota pública (sem JWT) - reusa exatamente a mesma
# capability de presign de documents_handler (mesmo bucket de quarentena), nunca uma nova.

module "guest_documents_handler" {
  source = "./modules/lambda-function"

  function_name  = "${local.name_prefix}-guest-documents-handler"
  handler_name   = "guest-documents-handler"
  source_dir     = "${local.dist_dir}/guest-documents-handler"
  adot_layer_arn = var.adot_layer_arn
  environment_variables = merge(local.common_env, {
    QUARANTINE_BUCKET_NAME = module.document_buckets.quarantine_bucket_name
    GUEST_TOKEN_PEPPER     = random_password.guest_token_pepper.result
  })
  policy_documents_json = [
    module.table.tenant_facing_read_write_policy_json,
    data.aws_iam_policy_document.documents_presign_quarantine_put.json,
  ]
  tags = { Project = local.project_name, Environment = var.environment }
}

# --- DocumentChasingDispatch: automated document chasing (M10 cluster 4, D-039/D-046/D-048) -

module "document_chasing_dispatch_queue" {
  source = "./modules/sqs-worker-queue"

  queue_name               = "${local.name_prefix}-document-chasing-dispatch"
  consumer_timeout_seconds = 10
  aws_region               = var.aws_region
  aws_account_id           = var.aws_account_id
  alert_topic_arn          = module.alert_topic.topic_arn
  tags                     = { Project = local.project_name, Environment = var.environment }
}

module "document_chasing_dispatch_handler" {
  source = "./modules/lambda-function"

  # Worker de dispatch+delivery fundido (D-048: chasing v1 é single-channel, sem lease/retry -
  # não justifica um par dispatch/delivery separado como o de M3/M4). Reaproveita o mesmo SES
  # já usado por EmailDeliveryWorker (mesma policy data.aws_iam_policy_document.ses_send_email,
  # mesmo configuration set) - nenhum recurso SES novo.
  function_name  = "${local.name_prefix}-document-chasing-dispatch"
  handler_name   = "document-chasing-dispatch-handler"
  source_dir     = "${local.dist_dir}/document-chasing-dispatch-handler"
  adot_layer_arn = var.adot_layer_arn
  environment_variables = merge(local.common_env, {
    GUEST_TOKEN_PEPPER    = random_password.guest_token_pepper.result
    SES_FROM_ADDRESS      = var.ses_from_address
    SES_CONFIGURATION_SET = module.ses_notifications.configuration_set_name
    # GUEST_UPLOAD_BASE_URL deliberadamente NÃO setado - código tem um placeholder documentado
    # (https://app.example.invalid/guest/document-requests, mesma postura já aceita para
    # cors_allow_origins, implementation-blueprint.md §4.2) até existir domínio real de
    # frontend (D-047: frontend não tem milestone atribuído ainda).
  })
  reserved_concurrent_executions = var.enable_reserved_concurrency ? 2 : null
  policy_documents_json = [
    module.table.tenant_facing_read_write_policy_json,
    module.document_chasing_dispatch_queue.consume_policy_json,
    data.aws_iam_policy_document.ses_send_email.json,
  ]
  tags = { Project = local.project_name, Environment = var.environment }
}

resource "aws_lambda_event_source_mapping" "document_chasing_dispatch_from_queue" {
  event_source_arn        = module.document_chasing_dispatch_queue.queue_arn
  function_name           = module.document_chasing_dispatch_handler.live_alias_arn
  batch_size              = 10
  function_response_types = ["ReportBatchItemFailures"]
}

# --- UploadFinalizerWorker: S3 event (via queue) -> validate + invoke ParserSandbox ---------

# Real bug found via Camada 3 (2026-08-22): UploadFinalizerWorker only had READ access to the
# quarantine bucket, but advanceAfterEvidence() (called identically by both workers) performs
# the actual quarantine->clean promotion copy whichever worker's evidence completes the pair
# LAST - which is not always MalwareResultWorker. A real upload where the finalizer's own
# evidence-persist step landed after the malware scan result hit exactly this: the finalizer
# won the PROMOTE race and got a real AccessDenied trying s3:PutObject on the clean bucket.
# Both workers need IDENTICAL object-access permissions for this reason - kept as two
# separately-named data sources (not a single shared one) so each function's IAM role
# document stays self-explanatory in `aws iam` output, but the statements are deliberately
# identical to malware_result_object_access below.
data "aws_iam_policy_document" "upload_finalizer_object_access" {
  statement {
    sid       = "ReadDeleteQuarantineObjects"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:GetObjectVersion", "s3:DeleteObjectVersion"]
    resources = ["${module.document_buckets.quarantine_bucket_arn}/*"]
  }
  statement {
    # Real bug found via Camada 3 (2026-08-22): advanceAfterEvidence() calls headObject() on
    # the clean bucket right after copyObject() to VERIFY the promotion copy actually landed
    # before confirming CLEAN - S3's HeadObject API requires the s3:GetObject IAM action (a
    # well-known S3 quirk: there is no separate "HeadObject" IAM action), which was never
    # granted here (only PutObject was). The copy itself succeeded every time; only the
    # verification step 403'd, surfaced by the AWS SDK as an opaque "UnknownError" rather than
    # a clean AccessDenied.
    sid       = "ReadWriteCleanObjects"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"]
    resources = ["${module.document_buckets.clean_bucket_arn}/*"]
  }
  statement {
    sid       = "DecryptQuarantineObjects"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [module.document_buckets.quarantine_kms_key_arn]
  }
  statement {
    sid       = "EncryptCleanObjects"
    effect    = "Allow"
    actions   = ["kms:GenerateDataKey", "kms:Decrypt"]
    resources = [module.document_buckets.clean_kms_key_arn]
  }
}

data "aws_iam_policy_document" "upload_finalizer_invoke_parser_sandbox" {
  statement {
    sid       = "InvokeParserSandbox"
    effect    = "Allow"
    actions   = ["lambda:InvokeFunction"]
    resources = [module.parser_sandbox.function_arn]
  }
}

module "upload_finalizer_handler" {
  source = "./modules/lambda-function"

  function_name   = "${local.name_prefix}-upload-finalizer-handler"
  handler_name    = "upload-finalizer-handler"
  source_dir      = "${local.dist_dir}/upload-finalizer-handler"
  adot_layer_arn  = var.adot_layer_arn
  timeout_seconds = 30
  environment_variables = merge(local.common_env, {
    CLEAN_BUCKET_NAME            = module.document_buckets.clean_bucket_name
    PARSER_SANDBOX_FUNCTION_NAME = module.parser_sandbox.function_name
  })
  policy_documents_json = [
    module.table.tenant_facing_read_write_policy_json,
    data.aws_iam_policy_document.upload_finalizer_object_access.json,
    data.aws_iam_policy_document.upload_finalizer_invoke_parser_sandbox.json,
    module.upload_finalizer_queue.consume_policy_json,
  ]
  tags = { Project = local.project_name, Environment = var.environment }
}

resource "aws_lambda_event_source_mapping" "upload_finalizer_from_queue" {
  event_source_arn        = module.upload_finalizer_queue.queue_arn
  function_name           = module.upload_finalizer_handler.live_alias_arn
  batch_size              = 10
  function_response_types = ["ReportBatchItemFailures"]
}

# --- MalwareResultWorker: GuardDuty scan result (via queue) -> promote or reject -----------

data "aws_iam_policy_document" "malware_result_object_access" {
  statement {
    sid       = "ReadDeleteQuarantineObjects"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:GetObjectVersion", "s3:DeleteObjectVersion"]
    resources = ["${module.document_buckets.quarantine_bucket_arn}/*"]
  }
  statement {
    # Real bug found via Camada 3 (2026-08-22): advanceAfterEvidence() calls headObject() on
    # the clean bucket right after copyObject() to VERIFY the promotion copy actually landed
    # before confirming CLEAN - S3's HeadObject API requires the s3:GetObject IAM action (a
    # well-known S3 quirk: there is no separate "HeadObject" IAM action), which was never
    # granted here (only PutObject was). The copy itself succeeded every time; only the
    # verification step 403'd, surfaced by the AWS SDK as an opaque "UnknownError" rather than
    # a clean AccessDenied.
    sid       = "ReadWriteCleanObjects"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"]
    resources = ["${module.document_buckets.clean_bucket_arn}/*"]
  }
  statement {
    sid       = "DecryptQuarantineObjects"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [module.document_buckets.quarantine_kms_key_arn]
  }
  statement {
    sid       = "EncryptCleanObjects"
    effect    = "Allow"
    actions   = ["kms:GenerateDataKey", "kms:Decrypt"]
    resources = [module.document_buckets.clean_kms_key_arn]
  }
}

module "malware_result_handler" {
  source = "./modules/lambda-function"

  function_name   = "${local.name_prefix}-malware-result-handler"
  handler_name    = "malware-result-handler"
  source_dir      = "${local.dist_dir}/malware-result-handler"
  adot_layer_arn  = var.adot_layer_arn
  timeout_seconds = 30
  environment_variables = merge(local.common_env, {
    CLEAN_BUCKET_NAME            = module.document_buckets.clean_bucket_name
    PARSER_SANDBOX_FUNCTION_NAME = module.parser_sandbox.function_name
  })
  policy_documents_json = [
    module.table.tenant_facing_read_write_policy_json,
    data.aws_iam_policy_document.malware_result_object_access.json,
    module.malware_result_queue.consume_policy_json,
  ]
  tags = { Project = local.project_name, Environment = var.environment }
}

resource "aws_lambda_event_source_mapping" "malware_result_from_queue" {
  event_source_arn        = module.malware_result_queue.queue_arn
  function_name           = module.malware_result_handler.live_alias_arn
  batch_size              = 10
  function_response_types = ["ReportBatchItemFailures"]
}

module "document_malware_protection" {
  source = "./modules/document-malware-protection"

  malware_protection_enabled = var.malware_protection_enabled
  environment                = var.environment
  name_prefix                = local.name_prefix
  quarantine_bucket_name     = module.document_buckets.quarantine_bucket_name
  quarantine_bucket_arn      = module.document_buckets.quarantine_bucket_arn
  quarantine_kms_key_arn     = module.document_buckets.quarantine_kms_key_arn
  malware_result_queue_arn   = module.malware_result_queue.queue_arn
  malware_result_queue_url   = module.malware_result_queue.queue_url
  tags                       = { Project = local.project_name, Environment = var.environment }
}

# --- UploadSlotReconciliationWorker: EventBridge Scheduler, every 15 minutes ---------------
# Third (of exactly three, alongside ReminderReconciliation/OutboxSweeperReminderDispatch)
# role ever granted gsi6_read - see security-audit.ts's GlobalIndexComponent
# "upload-slot-reconciliation" and stack.tftest.hcl's updated GSI6 isolation assertions.

module "upload_slot_reconciliation_handler" {
  source = "./modules/lambda-function"

  function_name         = "${local.name_prefix}-upload-slot-reconciliation-handler"
  handler_name          = "upload-slot-reconciliation-handler"
  source_dir            = "${local.dist_dir}/upload-slot-reconciliation-handler"
  adot_layer_arn        = var.adot_layer_arn
  environment_variables = local.common_env
  policy_documents_json = [
    module.table.tenant_facing_read_write_policy_json,
    module.table.gsi6_read_policy_json,
  ]
  tags = { Project = local.project_name, Environment = var.environment }
}

resource "aws_iam_role" "upload_slot_reconciliation_schedule" {
  name = "${module.upload_slot_reconciliation_handler.function_name}-schedule-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "SchedulerAssumeRole"
        Effect    = "Allow"
        Action    = "sts:AssumeRole"
        Principal = { Service = "scheduler.amazonaws.com" }
      }
    ]
  })
  tags = { Project = local.project_name, Environment = var.environment }
}

resource "aws_iam_role_policy" "upload_slot_reconciliation_schedule_invoke" {
  name = "invoke"
  role = aws_iam_role.upload_slot_reconciliation_schedule.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "InvokeUploadSlotReconciliation"
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = module.upload_slot_reconciliation_handler.live_alias_arn
      }
    ]
  })
}

# jsonencode() HTML-escapes "<"/">" (reminder-schedule/main.tf's real bug, 2026-08-21) - this
# schedule's input is a literal HCL string for the same reason, even though it has no
# scheduler context attribute today (defense against ever adding one here without noticing).
resource "aws_scheduler_schedule" "upload_slot_reconciliation" {
  name                = "upload-slot-reconciliation"
  schedule_expression = "rate(15 minutes)"
  state               = var.schedules_enabled ? "ENABLED" : "DISABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = module.upload_slot_reconciliation_handler.live_alias_arn
    role_arn = aws_iam_role.upload_slot_reconciliation_schedule.arn
    input    = "{}"
  }
}

module "document_observability" {
  source = "./modules/document-observability"

  malware_result_function_name             = module.malware_result_handler.function_name
  upload_slot_reconciliation_function_name = module.upload_slot_reconciliation_handler.function_name
  alert_topic_arn                          = module.alert_topic.topic_arn
  tags                                     = { Project = local.project_name, Environment = var.environment }
}

# --- M11: CSV Import de TrackedSubject (D-042) ---------------------------------------------
# Um único bucket (raw CSV + plano JSONL, nunca quarentena/malware scanning - fora do escopo
# de v1) e 3 novas funções: ImportsHandler (HTTP), ImportParseWorker (S3 event via fila) e
# ImportCommitWorker (SQS_IMPORT_COMMIT_V1, roteado pelo dispatch_outbox_relay/outbox_sweeper
# já existentes acima - nunca um relay/sweeper novo). Alarme de observabilidade por função
# (module.import_observability, abaixo) fecha o residual documentado em D-050 - a idade da DLQ
# de cada fila (já embutida em sqs-worker-queue) continua sendo a rede mínima herdada, agora
# complementada por sinal de causa (exceção do worker vs. FAILED_INTEGRITY_MISMATCH real).

module "import_bucket" {
  source = "./modules/import-bucket"

  name_prefix = local.name_prefix
  tags        = { Project = local.project_name, Environment = var.environment }
}

module "import_parse_queue" {
  source = "./modules/sqs-worker-queue"

  queue_name               = "${local.name_prefix}-import-parse"
  consumer_timeout_seconds = 30
  aws_region               = var.aws_region
  aws_account_id           = var.aws_account_id
  alert_topic_arn          = module.alert_topic.topic_arn
  tags                     = { Project = local.project_name, Environment = var.environment }
}

# S3 "Object Created" in the import bucket -> ImportParseWorker. Filtered to the literal
# `raw.csv` suffix (same bucket also receives the parse worker's OWN plan JSONL writes, which
# must never re-trigger it - defense in depth alongside parseImportRawKey's own key check).
resource "aws_cloudwatch_event_rule" "import_raw_object_created" {
  name           = "${local.name_prefix}-import-raw-object-created"
  event_bus_name = "default"
  event_pattern = jsonencode({
    source      = ["aws.s3"]
    detail-type = ["Object Created"]
    detail = {
      bucket = { name = [module.import_bucket.bucket_name] }
      object = { key = [{ suffix = "raw.csv" }] }
    }
  })
  tags = { Project = local.project_name, Environment = var.environment }
}

resource "aws_cloudwatch_event_target" "import_raw_object_created_to_parse_queue" {
  rule      = aws_cloudwatch_event_rule.import_raw_object_created.name
  target_id = "import-parse-queue"
  arn       = module.import_parse_queue.queue_arn
}

data "aws_iam_policy_document" "eventbridge_to_import_parse_queue" {
  statement {
    sid       = "AllowEventBridgeRuleToSendMessage"
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [module.import_parse_queue.queue_arn]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_cloudwatch_event_rule.import_raw_object_created.arn]
    }
  }
}

resource "aws_sqs_queue_policy" "import_parse_queue" {
  queue_url = module.import_parse_queue.queue_url
  policy    = data.aws_iam_policy_document.eventbridge_to_import_parse_queue.json
}

data "aws_iam_policy_document" "import_parse_object_access" {
  statement {
    sid       = "ReadWriteImportObjects"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${module.import_bucket.bucket_arn}/*"]
  }
  statement {
    sid       = "DecryptEncryptImportObjects"
    effect    = "Allow"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [module.import_bucket.kms_key_arn]
  }
}

module "import_parse_handler" {
  source = "./modules/lambda-function"

  function_name   = "${local.name_prefix}-import-parse-handler"
  handler_name    = "import-parse-handler"
  source_dir      = "${local.dist_dir}/import-parse-handler"
  adot_layer_arn  = var.adot_layer_arn
  timeout_seconds = 30
  environment_variables = merge(local.common_env, {
    IMPORT_RAW_BUCKET_NAME  = module.import_bucket.bucket_name
    IMPORT_PLAN_BUCKET_NAME = module.import_bucket.bucket_name
  })
  policy_documents_json = [
    module.table.tenant_facing_read_write_policy_json,
    data.aws_iam_policy_document.import_parse_object_access.json,
    module.import_parse_queue.consume_policy_json,
  ]
  tags = { Project = local.project_name, Environment = var.environment }
}

resource "aws_lambda_event_source_mapping" "import_parse_from_queue" {
  event_source_arn        = module.import_parse_queue.queue_arn
  function_name           = module.import_parse_handler.live_alias_arn
  batch_size              = 10
  function_response_types = ["ReportBatchItemFailures"]
}

# --- ImportCommitWorker: SQS_IMPORT_COMMIT_V1, fed by dispatch_outbox_relay/outbox_sweeper --

module "import_commit_queue" {
  source = "./modules/sqs-worker-queue"

  queue_name               = "${local.name_prefix}-import-commit"
  consumer_timeout_seconds = 60 # replaying up to 5.000 linhas via SubjectService.createSubject() pode levar um tempo real
  aws_region               = var.aws_region
  aws_account_id           = var.aws_account_id
  alert_topic_arn          = module.alert_topic.topic_arn
  tags                     = { Project = local.project_name, Environment = var.environment }
}

data "aws_iam_policy_document" "import_commit_plan_object_access" {
  statement {
    sid       = "ReadPlanObjects"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${module.import_bucket.bucket_arn}/*"]
  }
  statement {
    sid       = "DecryptImportObjects"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [module.import_bucket.kms_key_arn]
  }
}

module "import_commit_handler" {
  source = "./modules/lambda-function"

  function_name   = "${local.name_prefix}-import-commit-handler"
  handler_name    = "import-commit-handler"
  source_dir      = "${local.dist_dir}/import-commit-handler"
  adot_layer_arn  = var.adot_layer_arn
  timeout_seconds = 60
  environment_variables = merge(local.common_env, {
    IMPORT_PLAN_BUCKET_NAME = module.import_bucket.bucket_name
  })
  reserved_concurrent_executions = var.enable_reserved_concurrency ? 2 : null
  policy_documents_json = [
    module.table.tenant_facing_read_write_policy_json,
    data.aws_iam_policy_document.import_commit_plan_object_access.json,
    module.import_commit_queue.consume_policy_json,
  ]
  tags = { Project = local.project_name, Environment = var.environment }
}

resource "aws_lambda_event_source_mapping" "import_commit_from_queue" {
  event_source_arn        = module.import_commit_queue.queue_arn
  function_name           = module.import_commit_handler.live_alias_arn
  batch_size              = 10
  function_response_types = ["ReportBatchItemFailures"]
}

# --- ImportsHandler: HTTP (POST /imports, GET /imports/{jobId}, POST .../commit) -----------

data "aws_iam_policy_document" "imports_presign_raw_put" {
  statement {
    sid       = "PresignImportRawPut"
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${module.import_bucket.bucket_arn}/*"]
  }
  statement {
    sid       = "EncryptImportObjects"
    effect    = "Allow"
    actions   = ["kms:GenerateDataKey"]
    resources = [module.import_bucket.kms_key_arn]
  }
}

module "imports_handler" {
  source = "./modules/lambda-function"

  function_name  = "${local.name_prefix}-imports-handler"
  handler_name   = "imports-handler"
  source_dir     = "${local.dist_dir}/imports-handler"
  adot_layer_arn = var.adot_layer_arn
  environment_variables = merge(local.common_env, {
    IMPORT_RAW_BUCKET_NAME = module.import_bucket.bucket_name
  })
  policy_documents_json = [
    module.table.tenant_facing_read_write_policy_json,
    data.aws_iam_policy_document.imports_presign_raw_put.json,
  ]
  tags = { Project = local.project_name, Environment = var.environment }
}

module "import_observability" {
  source = "./modules/import-observability"

  import_parse_function_name  = module.import_parse_handler.function_name
  import_commit_function_name = module.import_commit_handler.function_name
  alert_topic_arn             = module.alert_topic.topic_arn
  tags                        = { Project = local.project_name, Environment = var.environment }
}

# --- M7 (extração/OCR): feature-flags (D-035 §1.5/§1.6) ------------------------------------
# AppConfig real para os kill switches AI_EXTRACTION/OCR/WHATSAPP - primeira peça de infra do
# M7 (item 1 de NEXT_SESSION_PROMPT.md's "M7 - o que falta"), pré-requisito dos workers
# futuros (TextractTaskHandler/BedrockExtractionTaskHandler consultam o kill switch antes de
# qualquer chamada paga). var.extraction_pipeline_enabled é o gate Terraform separado do
# pipeline inteiro (D-035 §1.6) - nenhum recurso do módulo abaixo depende dele porque o
# módulo em si é só a entrega do AppConfig, não o pipeline de extração (ainda não
# implementado); os workers futuros (itens 2+ de NEXT_SESSION_PROMPT.md) é que ficam
# condicionados a esse gate.

module "feature_flags" {
  source = "./modules/feature-flags"

  name_prefix    = local.name_prefix
  aws_region     = var.aws_region
  aws_account_id = var.aws_account_id
  tags           = { Project = local.project_name, Environment = var.environment }
}

# --- M7 (extração/OCR): ExtractionStarterWorker (item 2, D-035 §12.5) ---------------------
# S3 "Object Created" no bucket limpo -> ExtractionStarterWorker: cria `ExtractionRun`
# idempotente e inicia a execução Step Functions Standard (item 3, ASL, ainda não
# implementada). Lambda/fila/IAM sempre existem (deployáveis/inspecionáveis em `dev`), mas o
# ÚNICO recurso condicionado a `var.extraction_pipeline_enabled` é a regra EventBridge que
# liga o bucket limpo à fila - sem o gate, nenhum evento real chega ao worker, mesmo com o
# tráfego normal de upload do M6 já rodando continuamente em `dev` (mesma lógica descrita no
# comentário do módulo feature-flags acima: o gate controla o pipeline, não a entrega do
# AppConfig).
#
# `local.extraction_state_machine_arn` é determinístico a partir do nome que o item 3
# (ASL/Step Functions) DEVE usar para a máquina de estados
# (`aws_sfn_state_machine "document_extraction"`, nome `${local.name_prefix}-document-
# extraction`) - convenção fixada aqui deliberadamente para que este ARN já esteja correto
# quando a máquina real for criada, sem precisar trocar um placeholder depois. Inofensivo
# enquanto o gate estiver `false`: `states:StartExecution` contra uma ARN de máquina que não
# existe nunca é chamado, porque a regra EventBridge acima nunca entrega nenhum evento.

locals {
  extraction_state_machine_arn = "arn:aws:states:${var.aws_region}:${var.aws_account_id}:stateMachine:${local.name_prefix}-document-extraction"
}

module "extraction_starter_queue" {
  source = "./modules/sqs-worker-queue"

  queue_name               = "${local.name_prefix}-extraction-starter"
  consumer_timeout_seconds = 15
  aws_region               = var.aws_region
  aws_account_id           = var.aws_account_id
  alert_topic_arn          = module.alert_topic.topic_arn
  tags                     = { Project = local.project_name, Environment = var.environment }
}

data "aws_iam_policy_document" "extraction_starter_start_execution" {
  statement {
    sid       = "StartExtractionStateMachine"
    effect    = "Allow"
    actions   = ["states:StartExecution"]
    resources = [local.extraction_state_machine_arn]
  }
}

module "extraction_starter_handler" {
  source = "./modules/lambda-function"

  function_name  = "${local.name_prefix}-extraction-starter-handler"
  handler_name   = "extraction-starter-handler"
  source_dir     = "${local.dist_dir}/extraction-starter-handler"
  adot_layer_arn = var.adot_layer_arn
  environment_variables = merge(local.common_env, {
    EXTRACTION_STATE_MACHINE_ARN = local.extraction_state_machine_arn
  })
  policy_documents_json = [
    module.table.tenant_facing_read_write_policy_json,
    data.aws_iam_policy_document.extraction_starter_start_execution.json,
    module.extraction_starter_queue.consume_policy_json,
  ]
  tags = { Project = local.project_name, Environment = var.environment }
}

resource "aws_lambda_event_source_mapping" "extraction_starter_from_queue" {
  event_source_arn        = module.extraction_starter_queue.queue_arn
  function_name           = module.extraction_starter_handler.live_alias_arn
  batch_size              = 10
  function_response_types = ["ReportBatchItemFailures"]
}

resource "aws_cloudwatch_event_rule" "clean_object_created" {
  count          = var.extraction_pipeline_enabled ? 1 : 0
  name           = "${local.name_prefix}-clean-object-created"
  event_bus_name = "default"
  event_pattern = jsonencode({
    source      = ["aws.s3"]
    detail-type = ["Object Created"]
    detail = {
      bucket = { name = [module.document_buckets.clean_bucket_name] }
    }
  })
  tags = { Project = local.project_name, Environment = var.environment }
}

resource "aws_cloudwatch_event_target" "clean_object_created_to_extraction_starter_queue" {
  count     = var.extraction_pipeline_enabled ? 1 : 0
  rule      = aws_cloudwatch_event_rule.clean_object_created[0].name
  target_id = "extraction-starter-queue"
  arn       = module.extraction_starter_queue.queue_arn
}

data "aws_iam_policy_document" "eventbridge_to_extraction_starter_queue" {
  count = var.extraction_pipeline_enabled ? 1 : 0
  statement {
    sid       = "AllowEventBridgeRuleToSendMessage"
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [module.extraction_starter_queue.queue_arn]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_cloudwatch_event_rule.clean_object_created[0].arn]
    }
  }
}

resource "aws_sqs_queue_policy" "extraction_starter_queue" {
  count     = var.extraction_pipeline_enabled ? 1 : 0
  queue_url = module.extraction_starter_queue.queue_url
  policy    = data.aws_iam_policy_document.eventbridge_to_extraction_starter_queue[0].json
}

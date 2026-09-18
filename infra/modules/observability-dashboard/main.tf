locals {
  dashboard_name = var.dashboard_name != null ? var.dashboard_name : "${var.name_prefix}-operations"

  # AWS Lambda auto-creates this log group name for every function (no aws_cloudwatch_log_group
  # resource exists in modules/lambda-function - confirmed) - derived here rather than passed
  # in, one less thing for every caller to get right.
  reminder_dispatch_log_group            = "/aws/lambda/${var.reminder_dispatch_function_name}"
  notification_email_outbox_log_group    = "/aws/lambda/${var.notification_email_outbox_relay_function_name}"
  notification_whatsapp_outbox_log_group = "/aws/lambda/${var.notification_whatsapp_outbox_relay_function_name}"
  guest_credential_delivery_log_group    = "/aws/lambda/${var.guest_credential_delivery_function_name}"

  # Logs Insights query shared by the 2 log widgets below - filters to non-happy-path outcomes
  # and groups by tenantId, closing the "visão por tenant" half of the audited critique without
  # ever making tenantId a metric dimension (metrics.ts's own doc comment on why not). The
  # happy-path kinds excluded here are the 3 pipelines' own success values
  # (TRIGGERED/PUBLISHED/SENT/ALREADY_DELIVERED) - every remaining outcome, including
  # HANDLER_ERROR, is worth a human looking at per-tenant.
  per_tenant_outcome_query = <<-QUERY
    fields tenantId, outcome, @logStream
    | filter ispresent(outcome) and outcome not in ["TRIGGERED", "PUBLISHED", "SENT", "ALREADY_DELIVERED"]
    | stats count() as occurrences by tenantId, outcome, @logStream
    | sort occurrences desc
    | limit 20
  QUERY
}

resource "aws_cloudwatch_dashboard" "operations" {
  dashboard_name = local.dashboard_name

  dashboard_body = jsonencode({
    widgets = [
      # --- reminder-dispatch: SQS-triggered, Errors/Invocations/Duration are valid native
      # signals (no partial-batch-failure caveat applies to this one). ---------------------
      {
        type = "metric", x = 0, y = 0, width = 12, height = 6,
        properties = {
          title  = "reminder-dispatch — Lambda health"
          region = var.aws_region
          period = 300
          stat   = "Sum"
          metrics = [
            ["AWS/Lambda", "Invocations", "FunctionName", var.reminder_dispatch_function_name],
            ["AWS/Lambda", "Errors", "FunctionName", var.reminder_dispatch_function_name],
          ]
        }
      },
      {
        type = "metric", x = 12, y = 0, width = 12, height = 6,
        properties = {
          title  = "reminder-dispatch — queue depth/age"
          region = var.aws_region
          period = 300
          stat   = "Maximum"
          metrics = [
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", var.reminder_dispatch_queue_name],
            ["AWS/SQS", "ApproximateAgeOfOldestMessage", "QueueName", var.reminder_dispatch_queue_name],
          ]
        }
      },

      # --- The 3 DynamoDB Streams-triggered functions (partial batch failure via
      # ReportBatchItemFailures never surfaces as AWS/Lambda Errors - infra/main.tf's own
      # guest_credential_delivery_iterator_age alarm comment documents this; IteratorAge is
      # the correct native signal for all 3, not Errors). ------------------------------------
      {
        type = "metric", x = 0, y = 6, width = 24, height = 6,
        properties = {
          title  = "Streams-triggered functions — IteratorAge (partial-batch-failure means Errors never fires here)"
          region = var.aws_region
          period = 300
          stat   = "Maximum"
          metrics = [
            ["AWS/Lambda", "IteratorAge", "FunctionName", var.notification_email_outbox_relay_function_name],
            ["AWS/Lambda", "IteratorAge", "FunctionName", var.notification_whatsapp_outbox_relay_function_name],
            ["AWS/Lambda", "IteratorAge", "FunctionName", var.guest_credential_delivery_function_name],
          ]
        }
      },

      # --- DynamoDB (native, zero new instrumentation) ---------------------------------------
      {
        type = "metric", x = 0, y = 12, width = 24, height = 6,
        properties = {
          title  = "Main table — capacity/throttling"
          region = var.aws_region
          period = 300
          stat   = "Sum"
          metrics = [
            ["AWS/DynamoDB", "ConsumedReadCapacityUnits", "TableName", var.table_name],
            ["AWS/DynamoDB", "ConsumedWriteCapacityUnits", "TableName", var.table_name],
            ["AWS/DynamoDB", "ThrottledRequests", "TableName", var.table_name],
          ]
        }
      },

      # --- Custom EMF metrics (E-018/E-021, D-290) - one widget per pipeline, series by
      # Outcome (closed, low-cardinality union - never tenantId). --------------------------
      {
        type = "metric", x = 0, y = 18, width = 8, height = 6,
        properties = {
          title  = "OccurrenceDispatchOutcome (reminder-dispatch)"
          region = var.aws_region
          period = 300
          stat   = "Sum"
          metrics = [
            ["ExpirationTracker/ReminderDispatch", "OccurrenceDispatchOutcome", "Outcome", "TRIGGERED"],
            ["ExpirationTracker/ReminderDispatch", "OccurrenceDispatchOutcome", "Outcome", "ALREADY_TRIGGERED"],
            ["ExpirationTracker/ReminderDispatch", "OccurrenceDispatchOutcome", "Outcome", "CANCELLED_STALE"],
            ["ExpirationTracker/ReminderDispatch", "OccurrenceDispatchOutcome", "Outcome", "SKIPPED_NOT_CLAIMED"],
            ["ExpirationTracker/ReminderDispatch", "OccurrenceDispatchOutcome", "Outcome", "ABORTED_FRESHNESS_RACE"],
            ["ExpirationTracker/ReminderDispatch", "OccurrenceDispatchOutcome", "Outcome", "HANDLER_ERROR"],
          ]
        }
      },
      {
        type = "metric", x = 8, y = 18, width = 8, height = 6,
        properties = {
          title  = "OutboxPublishOutcome (email + whatsapp relay, shared code)"
          region = var.aws_region
          period = 300
          stat   = "Sum"
          metrics = [
            ["ExpirationTracker/DispatchOutboxRelay", "OutboxPublishOutcome", "Outcome", "PUBLISHED"],
            ["ExpirationTracker/DispatchOutboxRelay", "OutboxPublishOutcome", "Outcome", "SKIPPED_WRONG_DESTINATION"],
            ["ExpirationTracker/DispatchOutboxRelay", "OutboxPublishOutcome", "Outcome", "SKIPPED_ALREADY_PUBLISHED"],
            ["ExpirationTracker/DispatchOutboxRelay", "OutboxPublishOutcome", "Outcome", "SKIPPED_LEASE_HELD"],
            ["ExpirationTracker/DispatchOutboxRelay", "OutboxPublishOutcome", "Outcome", "FAILED"],
            ["ExpirationTracker/DispatchOutboxRelay", "OutboxPublishOutcome", "Outcome", "HANDLER_ERROR"],
          ]
        }
      },
      {
        type = "metric", x = 16, y = 18, width = 8, height = 6,
        properties = {
          title  = "GuestCredentialDeliveryOutcome"
          region = var.aws_region
          period = 300
          stat   = "Sum"
          metrics = [
            ["ExpirationTracker/GuestCredentialDelivery", "GuestCredentialDeliveryOutcome", "Outcome", "SENT"],
            ["ExpirationTracker/GuestCredentialDelivery", "GuestCredentialDeliveryOutcome", "Outcome", "ALREADY_DELIVERED"],
            ["ExpirationTracker/GuestCredentialDelivery", "GuestCredentialDeliveryOutcome", "Outcome", "SKIPPED_REQUEST_NOT_FOUND"],
            ["ExpirationTracker/GuestCredentialDelivery", "GuestCredentialDeliveryOutcome", "Outcome", "SKIPPED_STALE_GENERATION"],
            ["ExpirationTracker/GuestCredentialDelivery", "GuestCredentialDeliveryOutcome", "Outcome", "SKIPPED_NO_RECIPIENT_EMAIL"],
            ["ExpirationTracker/GuestCredentialDelivery", "GuestCredentialDeliveryOutcome", "Outcome", "SKIPPED_LEASE_ACTIVE"],
            ["ExpirationTracker/GuestCredentialDelivery", "GuestCredentialDeliveryOutcome", "Outcome", "SEND_FAILED"],
            ["ExpirationTracker/GuestCredentialDelivery", "GuestCredentialDeliveryOutcome", "Outcome", "SEND_UNCERTAIN_NOT_RETRIED"],
            ["ExpirationTracker/GuestCredentialDelivery", "GuestCredentialDeliveryOutcome", "Outcome", "PREVIOUSLY_UNCERTAIN"],
            ["ExpirationTracker/GuestCredentialDelivery", "GuestCredentialDeliveryOutcome", "Outcome", "HANDLER_ERROR"],
          ]
        }
      },

      # --- Per-tenant investigation (Logs Insights, never a metric dimension) --------------
      {
        type = "log", x = 0, y = 24, width = 12, height = 8,
        properties = {
          title  = "Non-happy-path outcomes by tenant — reminder-dispatch + outbox relay"
          region = var.aws_region
          view   = "table"
          query  = "SOURCE '${local.reminder_dispatch_log_group}' | SOURCE '${local.notification_email_outbox_log_group}' | SOURCE '${local.notification_whatsapp_outbox_log_group}' | ${local.per_tenant_outcome_query}"
        }
      },
      {
        type = "log", x = 12, y = 24, width = 12, height = 8,
        properties = {
          title  = "Non-happy-path outcomes by tenant — guest-credential-delivery"
          region = var.aws_region
          view   = "table"
          query  = "SOURCE '${local.guest_credential_delivery_log_group}' | ${local.per_tenant_outcome_query}"
        }
      },
      {
        type = "metric", x = 0, y = 32, width = 12, height = 6,
        properties = {
          title  = "BFF latency decomposition (p95)"
          region = var.aws_region
          period = 300
          stat   = "p95"
          metrics = [
            ["ExpirationTracker/BFF", "bff.session_resolve_ms"],
            ["ExpirationTracker/BFF", "bff.proxy_ms"],
          ]
        }
      },
      {
        type = "metric", x = 12, y = 32, width = 12, height = 6,
        properties = {
          title  = "Resource latency decomposition (p95)"
          region = var.aws_region
          period = 300
          stat   = "p95"
          metrics = [
            ["ExpirationTracker/RequestContext", "lambda.request_context_ms"],
            ["ExpirationTracker/Items", "lambda.business_operation_ms"],
            ["ExpirationTracker/Subjects", "lambda.business_operation_ms"],
          ]
        }
      },
      {
        type = "metric", x = 0, y = 38, width = 24, height = 6,
        properties = {
          title  = "HTTP Lambdas - throttles"
          region = var.aws_region
          period = 300
          stat   = "Sum"
          metrics = [for label, function_name in var.http_function_names :
            ["AWS/Lambda", "Throttles", "FunctionName", function_name, { label = label }]
          ]
        }
      },
      {
        type = "metric", x = 0, y = 44, width = 24, height = 6,
        properties = {
          title  = "External synthetic availability and duration"
          region = var.aws_region
          period = 300
          metrics = [
            ["CloudWatchSynthetics", "SuccessPercent", "CanaryName", var.synthetic_canary_name, { stat = "Average" }],
            ["CloudWatchSynthetics", "Duration", "CanaryName", var.synthetic_canary_name, { stat = "p95", yAxis = "right" }],
          ]
        }
      },
    ]
  })
}

# PERF-14 thresholds are deliberately above the measured 2026-09-14..18 warm p95 envelope.
# Three breaching five-minute windows avoid paging on an isolated cold start while still
# detecting a sustained regression. Missing data is healthy because dev traffic is intermittent.
locals {
  latency_alarms = {
    bff_proxy = {
      namespace = "ExpirationTracker/BFF"
      metric    = "bff.proxy_ms"
      threshold = 1500
    }
    request_context = {
      namespace = "ExpirationTracker/RequestContext"
      metric    = "lambda.request_context_ms"
      threshold = 750
    }
    items_operation = {
      namespace = "ExpirationTracker/Items"
      metric    = "lambda.business_operation_ms"
      threshold = 1000
    }
    subjects_operation = {
      namespace = "ExpirationTracker/Subjects"
      metric    = "lambda.business_operation_ms"
      threshold = 1500
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "latency_regression" {
  for_each = local.latency_alarms

  alarm_name                            = "${var.name_prefix}-${replace(each.key, "_", "-")}-p95-latency"
  namespace                             = each.value.namespace
  metric_name                           = each.value.metric
  extended_statistic                    = "p95"
  period                                = 300
  evaluation_periods                    = 3
  datapoints_to_alarm                   = 3
  evaluate_low_sample_count_percentiles = "ignore"
  threshold                             = each.value.threshold
  comparison_operator                   = "GreaterThanThreshold"
  alarm_description                     = "PERF-14: ${each.value.metric} p95 exceeded ${each.value.threshold} ms for three consecutive five-minute windows. Investigate the operations dashboard and traces."
  treat_missing_data                    = "notBreaching"
  alarm_actions                         = [var.alert_topic_arn]
  ok_actions                            = [var.alert_topic_arn]
  tags                                  = var.tags
}

resource "aws_cloudwatch_metric_alarm" "http_lambda_throttles" {
  for_each = var.http_function_names

  alarm_name          = "${var.name_prefix}-${each.key}-throttles"
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  dimensions          = { FunctionName = each.value }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_description   = "PERF-14: ${each.key} Lambda was throttled. Check account concurrency, reserved concurrency, and request volume."
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alert_topic_arn]
  ok_actions          = [var.alert_topic_arn]
  tags                = var.tags
}

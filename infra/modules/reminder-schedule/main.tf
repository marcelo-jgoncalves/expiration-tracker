# EventBridge Scheduler wiring — Terraform equivalent of infra/lib/reminder-schedule.ts.
#
# CRITICAL CONTRACT (bug found by a previous Codex implementation review of the CDK code,
# not reintroduced here): EventBridge Scheduler's Lambda target does NOT wrap the payload in
# a `detail` envelope the way legacy EventBridge Rules do — whatever `input` is set to
# becomes the event object handed to the Lambda directly. Every schedule below sets an
# explicit top-level `input` matching exactly what its handler reads (`event.mode`,
# `event.scheduledTime` — see reminder-producer-handler.ts / reminder-reconciliation-
# handler.ts), never `event.detail.*` / `event.time` (those are Rule-shaped fields that
# don't exist here). `<aws.scheduler.scheduled-time>` is a Scheduler context attribute,
# substituted at invoke time with the schedule's fire time (ISO-8601 UTC).
#
# REAL BUG found and fixed 2026-08-21 via Camada 3 evidence (live CloudWatch logs, not a
# test): `jsonencode()` HTML-escapes the angle-bracket characters to their \uXXXX form (Go's
# encoding/json default, which Terraform's jsonencode inherits) - EventBridge Scheduler's
# context-attribute substitution does literal text matching for `<aws.scheduler.scheduled-time>` and never
# found it once escaped, so the literal placeholder string reached the Lambda as
# `scheduledTime`, and every producer/reconciliation/sweeper invocation failed validation
# 100% of the time since the first `terraform apply` that created these schedules
# (confirmed via `aws logs filter-log-events`, first occurrence 2026-08-20T14:41:39Z). Fixed
# by writing `input` as a literal HCL string instead of `jsonencode(...)` for these 4
# schedules specifically - never reintroduce `jsonencode()` here.

locals {
  state = var.schedules_enabled ? "ENABLED" : "DISABLED"
}

# --- ReminderProducer: every 1 minute ---------------------------------------------------

resource "aws_iam_role" "reminder_producer" {
  name = "${var.reminder_producer_function_name}-schedule-role"
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
  tags = var.tags
}

resource "aws_iam_role_policy" "reminder_producer_invoke" {
  name = "invoke"
  role = aws_iam_role.reminder_producer.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "InvokeReminderProducer"
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = var.reminder_producer_function_arn
      }
    ]
  })
}

resource "aws_scheduler_schedule" "reminder_producer" {
  name                = "reminder-producer"
  schedule_expression = "rate(1 minute)"
  state               = local.state

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = var.reminder_producer_function_arn
    role_arn = aws_iam_role.reminder_producer.arn
    input    = "{\"scheduledTime\":\"<aws.scheduler.scheduled-time>\"}"
  }
}

# --- ReminderReconciliation (CLAIMS mode): every 5 minutes ------------------------------
# Two independent schedules invoking the SAME ReminderReconciliation function with a
# different `mode` (m3.5-runtime-design.md: "mesmo handler pode receber mode, mantendo
# lógicas e métricas separadas") - field is top-level, not under `detail`.

resource "aws_iam_role" "reminder_claim_reconciliation" {
  name = "${var.reminder_reconciliation_function_name}-claims-schedule-role"
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
  tags = var.tags
}

resource "aws_iam_role_policy" "reminder_claim_reconciliation_invoke" {
  name = "invoke"
  role = aws_iam_role.reminder_claim_reconciliation.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "InvokeReminderReconciliation"
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = var.reminder_reconciliation_function_arn
      }
    ]
  })
}

resource "aws_scheduler_schedule" "reminder_claim_reconciliation" {
  name                = "reminder-claim-reconciliation"
  schedule_expression = "rate(5 minutes)"
  state               = local.state

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = var.reminder_reconciliation_function_arn
    role_arn = aws_iam_role.reminder_claim_reconciliation.arn
    input    = "{\"mode\":\"CLAIMS\",\"scheduledTime\":\"<aws.scheduler.scheduled-time>\"}"
  }
}

# --- ReminderReconciliation (DST mode): daily cron with a flexible window ---------------

resource "aws_iam_role" "reminder_dst_reconciliation" {
  name = "${var.reminder_reconciliation_function_name}-dst-schedule-role"
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
  tags = var.tags
}

resource "aws_iam_role_policy" "reminder_dst_reconciliation_invoke" {
  name = "invoke"
  role = aws_iam_role.reminder_dst_reconciliation.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "InvokeReminderReconciliation"
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = var.reminder_reconciliation_function_arn
      }
    ]
  })
}

resource "aws_scheduler_schedule" "reminder_dst_reconciliation" {
  name                         = "reminder-dst-reconciliation"
  schedule_expression          = "cron(0 3 * * ? *)" # daily 03:00 UTC
  schedule_expression_timezone = "UTC"
  state                        = local.state

  flexible_time_window {
    mode                      = "FLEXIBLE"
    maximum_window_in_minutes = 15
  }

  target {
    arn      = var.reminder_reconciliation_function_arn
    role_arn = aws_iam_role.reminder_dst_reconciliation.arn
    input    = "{\"mode\":\"DST\",\"scheduledTime\":\"<aws.scheduler.scheduled-time>\"}"
  }
}

# --- OutboxSweeperReminderDispatch: every 5 minutes --------------------------------------

resource "aws_iam_role" "outbox_sweeper" {
  name = "${var.outbox_sweeper_function_name}-schedule-role"
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
  tags = var.tags
}

resource "aws_iam_role_policy" "outbox_sweeper_invoke" {
  name = "invoke"
  role = aws_iam_role.outbox_sweeper.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "InvokeOutboxSweeper"
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = var.outbox_sweeper_function_arn
      }
    ]
  })
}

resource "aws_scheduler_schedule" "outbox_sweeper" {
  name                = "outbox-sweeper-reminder-dispatch"
  schedule_expression = "rate(5 minutes)"
  state               = local.state

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = var.outbox_sweeper_function_arn
    role_arn = aws_iam_role.outbox_sweeper.arn
    input    = "{\"scheduledTime\":\"<aws.scheduler.scheduled-time>\"}"
  }
}

# W3-07 tenant purge orchestrator (D-124, implementing the design APPROVED as D-121).
# Structural twin of ../extraction-workflow/: Standard workflow + a vended log group + X-Ray, with
# the ASL loaded from ../../state-machines/ and its placeholders substituted by replace() so the
# checked-in file stays human-readable. What this module adds beyond that precedent is the
# CloudWatch alarm below - D-121 Rodada 3 Fix 7 established by direct reading that NO
# aws_cloudwatch_metric_alarm on AWS/States exists anywhere in infra/, so Rodada 2's claim of
# "reusing extraction-workflow's alarm" was simply false and the alarm had to be built for real.

locals {
  # D-121 Rodada 3 Fix 8: named constant, never an inline magic number in the ASL. The VALUE is a
  # deliberately conservative placeholder, not a measured one - no tenant has ever been purged for
  # real, so there is no data to derive a bound from yet. It exists to stop a permanently-stuck
  # PARTIAL loop from running until Step Functions' own 25,000-event execution-history quota kills
  # the execution as an unexplained failure, instead of surfacing deliberately as a BLOCKED tenant.
  # Same class of placeholder as enable_reserved_concurrency's account-quota-driven default.
  purge_retry_limit = 20
}

resource "aws_cloudwatch_log_group" "tenant_purge" {
  name              = "/aws/vendedlogs/states/${var.name_prefix}-tenant-purge"
  retention_in_days = 30
  tags              = var.tags
}

resource "aws_sfn_state_machine" "tenant_purge" {
  name     = "${var.name_prefix}-tenant-purge"
  type     = "STANDARD"
  role_arn = var.state_machine_role_arn
  tags     = var.tags

  tracing_configuration {
    enabled = true
  }

  # include_execution_data = false: the execution input carries a tenantId and the purge envelope
  # carries per-tenant counters - same EXTRACTION_TRANSIENT privacy discipline extraction-workflow
  # documents, no tenant-scoped payload lands in a log group with a looser access posture than the
  # data itself.
  logging_configuration {
    log_destination        = "${aws_cloudwatch_log_group.tenant_purge.arn}:*"
    include_execution_data = false
    level                  = "ERROR"
  }

  definition = replace(
    replace(
      replace(
        file("${path.module}/../../state-machines/tenant-purge.asl.json"),
        "\"tenant-lifecycle-transition:live\"", jsonencode(var.lifecycle_transition_function_arn)
      ),
      "\"tenant-purge-worker:live\"", jsonencode(var.purge_worker_function_arn)
    ),
    # jsonencode() of a number emits it unquoted, so the ASL's Choice condition ends up with a real
    # JSON number (NumericLessThan requires one) rather than the quoted placeholder token.
    "\"__PURGE_RETRY_LIMIT__\"", jsonencode(local.purge_retry_limit)
  )
}

# D-121 Rodada 3 Fix 7. Both metrics are real AWS/States metric names filterable by the
# StateMachineArn dimension. ExecutionsTimedOut is NOT redundant with ExecutionsFailed: a Standard
# workflow that exceeds its maximum duration surfaces as a timeout, never as a failure, so watching
# only ExecutionsFailed would silently miss a tenant whose purge hung rather than errored.
resource "aws_cloudwatch_metric_alarm" "executions_failed" {
  alarm_name          = "${aws_sfn_state_machine.tenant_purge.name}-executions-failed"
  namespace           = "AWS/States"
  metric_name         = "ExecutionsFailed"
  dimensions          = { StateMachineArn = aws_sfn_state_machine.tenant_purge.arn }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  # evaluation_periods = 1, unlike the reminder-observability alarms' 3: a failed tenant purge is a
  # single, non-self-healing event that leaves a tenant's data physically present past its deletion
  # request (an LGPD-relevant state), so it must page on the first occurrence rather than waiting
  # for a pattern across windows.
  alarm_description  = "A tenant-purge Step Functions execution failed - the tenant's TenantLifecycleRecord is BLOCKED and its data was not fully purged. Operator remediation required (see the blockedReason on the record)."
  treat_missing_data = "notBreaching"
  alarm_actions      = [var.alert_topic_arn]
  tags               = var.tags
}

resource "aws_cloudwatch_metric_alarm" "executions_timed_out" {
  alarm_name          = "${aws_sfn_state_machine.tenant_purge.name}-executions-timed-out"
  namespace           = "AWS/States"
  metric_name         = "ExecutionsTimedOut"
  dimensions          = { StateMachineArn = aws_sfn_state_machine.tenant_purge.arn }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_description   = "A tenant-purge Step Functions execution timed out - the purge neither converged nor reached BLOCKED, so no lifecycle state reflects the failure. Investigate before the tenant is assumed deleted."
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alert_topic_arn]
  tags                = var.tags
}

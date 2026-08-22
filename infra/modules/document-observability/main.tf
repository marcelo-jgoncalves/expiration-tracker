locals {
  malware_result_log_group = "/aws/lambda/${var.malware_result_function_name}"
  reconciliation_log_group = "/aws/lambda/${var.upload_slot_reconciliation_function_name}"
}

# Real deploy failure (2026-08-22): PutMetricFilter rejected with "ResourceNotFoundException:
# The specified log group does not exist" - a brand-new Lambda function's log group is only
# auto-created by AWS on its FIRST real invocation, which hasn't happened yet for these 2
# functions in the same apply that creates them. Same bug class already hit (and worked around
# via a one-off `aws logs create-log-group` CLI call, not Terraform-managed) for items-handler/
# reminders-handler earlier this session - fixed properly here instead of repeating the
# manual workaround: create the log group explicitly and make every metric filter below
# depend on it. Not extended to the lambda-function module itself (all 13 pre-existing
# functions already have a real, already-created log group in this account - adding an
# aws_cloudwatch_log_group there would try to (re)create an existing resource and fail with
# ResourceAlreadyExistsException on every one of them).
resource "aws_cloudwatch_log_group" "malware_result" {
  name              = local.malware_result_log_group
  retention_in_days = 30
  tags              = var.tags
}

resource "aws_cloudwatch_log_group" "reconciliation" {
  name              = local.reconciliation_log_group
  retention_in_days = 30
  tags              = var.tags
}

# --- GuardDuty scan status: THREATS_FOUND (real rejection, visibility signal) --------------

resource "aws_cloudwatch_log_metric_filter" "malware_threats_found" {
  name           = "DocumentMalwareThreatsFound"
  log_group_name = local.malware_result_log_group
  pattern        = "{ $.event = \"malware-result outcome\" && $.status = \"THREATS_FOUND\" }"
  depends_on     = [aws_cloudwatch_log_group.malware_result]

  metric_transformation {
    name      = "DocumentMalwareThreatsFound"
    namespace = var.metric_namespace
    value     = "1"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_metric_alarm" "malware_threats_found" {
  alarm_name          = "DocumentMalwareThreatsFound"
  namespace           = var.metric_namespace
  metric_name         = "DocumentMalwareThreatsFound"
  statistic           = "Sum"
  period              = 300 # 5 minutes
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_description   = "GuardDuty found real malware in at least one uploaded document in the last 5 minutes. Expected to fire on the Camada 3 EICAR exercise; outside of a deliberate test this is a real security signal - investigate via correlationId/documentId in CloudWatch Logs Insights."
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alert_topic_arn]
  ok_actions          = [var.alert_topic_arn]
  tags                = var.tags

  depends_on = [aws_cloudwatch_log_metric_filter.malware_threats_found]
}

# --- GuardDuty scan status: ACCESS_DENIED or FAILED (operational/IAM problem, not malware) --

resource "aws_cloudwatch_log_metric_filter" "malware_scan_unhealthy" {
  name           = "DocumentMalwareScanUnhealthy"
  log_group_name = local.malware_result_log_group
  pattern        = "{ $.event = \"malware-result outcome\" && ($.status = \"ACCESS_DENIED\" || $.status = \"FAILED\") }"
  depends_on     = [aws_cloudwatch_log_group.malware_result]

  metric_transformation {
    name      = "DocumentMalwareScanUnhealthy"
    namespace = var.metric_namespace
    value     = "1"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_metric_alarm" "malware_scan_unhealthy" {
  alarm_name          = "DocumentMalwareScanUnhealthy"
  namespace           = var.metric_namespace
  metric_name         = "DocumentMalwareScanUnhealthy"
  statistic           = "Sum"
  period              = 300 # 5 minutes
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_description   = "GuardDuty could not scan an uploaded object (ACCESS_DENIED or FAILED) - almost certainly an IAM/KMS misconfiguration on the scan role or key policy, not malware. These documents never reach CLEAN (fail-closed by design) so this needs a human, not a retry."
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alert_topic_arn]
  ok_actions          = [var.alert_topic_arn]
  tags                = var.tags

  depends_on = [aws_cloudwatch_log_metric_filter.malware_scan_unhealthy]
}

# --- Documents stuck in SCANNING past their upload slot's expiry (reconciler moved to TIMEOUT)

resource "aws_cloudwatch_log_metric_filter" "documents_timed_out" {
  name           = "DocumentUploadTimeouts"
  log_group_name = local.reconciliation_log_group
  pattern        = "{ $.event = \"upload-slot-reconciliation complete\" && $.documentsTimedOut > 0 }"
  depends_on     = [aws_cloudwatch_log_group.reconciliation]

  metric_transformation {
    name      = "DocumentUploadTimeouts"
    namespace = var.metric_namespace
    value     = "$.documentsTimedOut"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_metric_alarm" "documents_timed_out_burst" {
  alarm_name          = "DocumentUploadTimeoutsBurst"
  namespace           = var.metric_namespace
  metric_name         = "DocumentUploadTimeouts"
  statistic           = "Sum"
  period              = 900 # 15 minutes, matches the reconciliation schedule cadence
  evaluation_periods  = 1
  threshold           = 3
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_description   = "3+ documents moved to TIMEOUT (evidence never completed - either GuardDuty scan results or the client's own upload never arrived) in one reconciliation sweep. Likely GuardDuty/EventBridge pipeline health issue (check malware_protection_enabled too) rather than isolated client failures."
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alert_topic_arn]
  ok_actions          = [var.alert_topic_arn]
  tags                = var.tags

  depends_on = [aws_cloudwatch_log_metric_filter.documents_timed_out]
}

# --- Reconciliation sweep itself erroring (partial-failure visibility, mirrors DLQ-age intent)

resource "aws_cloudwatch_log_metric_filter" "reconciliation_errors" {
  name           = "DocumentReconciliationErrors"
  log_group_name = local.reconciliation_log_group
  pattern        = "{ $.event = \"upload-slot-reconciliation complete\" && $.errors > 0 }"
  depends_on     = [aws_cloudwatch_log_group.reconciliation]

  metric_transformation {
    name      = "DocumentReconciliationErrors"
    namespace = var.metric_namespace
    value     = "$.errors"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_metric_alarm" "reconciliation_errors" {
  alarm_name          = "DocumentReconciliationErrors"
  namespace           = var.metric_namespace
  metric_name         = "DocumentReconciliationErrors"
  statistic           = "Sum"
  period              = 900 # 15 minutes
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_description   = "UploadSlotReconciliationWorker failed to process at least one candidate slot in a sweep (OCC conflict exhaustion or a real bug) - the next sweep retries automatically, but repeated occurrences need investigation."
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alert_topic_arn]
  ok_actions          = [var.alert_topic_arn]
  tags                = var.tags

  depends_on = [aws_cloudwatch_log_metric_filter.reconciliation_errors]
}

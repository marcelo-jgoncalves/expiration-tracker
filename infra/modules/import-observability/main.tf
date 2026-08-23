locals {
  import_parse_log_group  = "/aws/lambda/${var.import_parse_function_name}"
  import_commit_log_group = "/aws/lambda/${var.import_commit_function_name}"
}

# Same real deploy failure class already hit and fixed in document-observability (2026-08-22):
# a brand-new Lambda's log group is only auto-created by AWS on its first real invocation, which
# may not have happened yet in the same apply that creates the function. Manage the log group
# explicitly and make every metric filter below depend on it.
resource "aws_cloudwatch_log_group" "import_parse" {
  name              = local.import_parse_log_group
  retention_in_days = 30
  tags              = var.tags
}

resource "aws_cloudwatch_log_group" "import_commit" {
  name              = local.import_commit_log_group
  retention_in_days = 30
  tags              = var.tags
}

# --- ImportParseWorker: any real failure (unhandled exception, or a job whose parse outcome is
# `kind: "FAILED"` - src/modules/import/application/import-parse-service.ts) ------------------

resource "aws_cloudwatch_log_metric_filter" "import_parse_exception" {
  name           = "ImportParseWorkerException"
  log_group_name = local.import_parse_log_group
  pattern        = "{ $.event = \"import-parse failed\" }"
  depends_on     = [aws_cloudwatch_log_group.import_parse]

  metric_transformation {
    name      = "ImportParseWorkerErrors"
    namespace = var.metric_namespace
    value     = "1"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_log_metric_filter" "import_parse_job_failed" {
  name           = "ImportParseJobFailed"
  log_group_name = local.import_parse_log_group
  pattern        = "{ $.event = \"import-parse outcome\" && $.outcome.kind = \"FAILED\" }"
  depends_on     = [aws_cloudwatch_log_group.import_parse]

  metric_transformation {
    name      = "ImportParseWorkerErrors"
    namespace = var.metric_namespace
    value     = "1"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_metric_alarm" "import_parse_errors" {
  alarm_name          = "ImportParseWorkerErrors"
  namespace           = var.metric_namespace
  metric_name         = "ImportParseWorkerErrors"
  statistic           = "Sum"
  period              = 300 # 5 minutes
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_description   = "ImportParseWorker threw an unhandled exception, or a job's parse outcome was FAILED (parser/S3/DynamoDB error, not a data-quality rejection - those are counted per-row inside a PARSED outcome, never alarmed). Investigate via correlationId/jobId in CloudWatch Logs Insights."
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alert_topic_arn]
  ok_actions          = [var.alert_topic_arn]
  tags                = var.tags

  depends_on = [
    aws_cloudwatch_log_metric_filter.import_parse_exception,
    aws_cloudwatch_log_metric_filter.import_parse_job_failed,
  ]
}

# --- ImportCommitWorker: any real failure (unhandled exception, schema-invalid payload, or a
# commit outcome of FAILED_INTEGRITY_MISMATCH - the plan's SHA-256 no longer matches what
# ImportParseWorker wrote, a sign of tampering or corruption between parse and commit) ---------

resource "aws_cloudwatch_log_metric_filter" "import_commit_exception" {
  name           = "ImportCommitWorkerException"
  log_group_name = local.import_commit_log_group
  pattern        = "{ $.event = \"import-commit failed\" || $.event = \"import-commit schema-invalid payload\" }"
  depends_on     = [aws_cloudwatch_log_group.import_commit]

  metric_transformation {
    name      = "ImportCommitWorkerErrors"
    namespace = var.metric_namespace
    value     = "1"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_log_metric_filter" "import_commit_integrity_mismatch" {
  name           = "ImportCommitIntegrityMismatch"
  log_group_name = local.import_commit_log_group
  pattern        = "{ $.event = \"import-commit outcome\" && $.outcome = \"FAILED_INTEGRITY_MISMATCH\" }"
  depends_on     = [aws_cloudwatch_log_group.import_commit]

  metric_transformation {
    name      = "ImportCommitWorkerErrors"
    namespace = var.metric_namespace
    value     = "1"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_metric_alarm" "import_commit_errors" {
  alarm_name          = "ImportCommitWorkerErrors"
  namespace           = var.metric_namespace
  metric_name         = "ImportCommitWorkerErrors"
  statistic           = "Sum"
  period              = 300 # 5 minutes
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_description   = "ImportCommitWorker threw an unhandled exception, received a schema-invalid SQS payload, or found a plan whose SHA-256 no longer matches what ImportParseWorker wrote (FAILED_INTEGRITY_MISMATCH - possible tampering or corruption between parse and commit). FAILED_ENTITLEMENT_EXCEEDED is deliberately not alarmed here (expected tenant-caused outcome, not a system health signal)."
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alert_topic_arn]
  ok_actions          = [var.alert_topic_arn]
  tags                = var.tags

  depends_on = [
    aws_cloudwatch_log_metric_filter.import_commit_exception,
    aws_cloudwatch_log_metric_filter.import_commit_integrity_mismatch,
  ]
}

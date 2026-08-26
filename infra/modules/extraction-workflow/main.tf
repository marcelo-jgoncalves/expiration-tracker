# Standard workflow (not Express) — waitForTaskToken (RunTextract) requires Standard, per
# design §1.1. templatefile() substitutes the four Lambda ARNs into the FunctionName fields of
# ../../state-machines/document-extraction.asl.json's Task states at plan/apply time — the
# checked-in ASL file keeps human-readable placeholder names (e.g. "textract-task:live") for
# review; this module never changes the file's structure, only the ARNs.

# CloudWatch Logs for execution history — Standard workflows don't log by default; without
# this, a stuck/failed execution has no queryable trail beyond the individual Lambda logs
# (which never see the ASL-level Choice/Retry/Catch decisions). ERROR level (not ALL) +
# include_execution_data = false deliberately, mirroring the EXTRACTION_TRANSIENT privacy
# discipline established in items 4-7 — execution input/output can carry OCR text/extracted
# field values, which must never land in a log group with a different (looser) retention/
# access posture than the artifact bucket itself. Name follows AWS's documented
# /aws/vendedlogs/states/ prefix convention for Step Functions log delivery.
resource "aws_cloudwatch_log_group" "document_extraction" {
  name              = "/aws/vendedlogs/states/${var.name_prefix}-document-extraction"
  retention_in_days = 30
  tags              = var.tags
}

resource "aws_sfn_state_machine" "document_extraction" {
  name     = "${var.name_prefix}-document-extraction"
  type     = "STANDARD"
  role_arn = var.state_machine_role_arn
  tags     = var.tags

  # X-Ray tracing — every Lambda in this repo already runs with ADOT/X-Ray active
  # (AGENTS.md §7, M5), so the state machine that orchestrates them participates in the same
  # trace, not a disconnected one.
  tracing_configuration {
    enabled = true
  }

  logging_configuration {
    log_destination        = "${aws_cloudwatch_log_group.document_extraction.arn}:*"
    include_execution_data = false
    level                  = "ERROR"
  }

  definition = replace(
    replace(
      replace(
        replace(
          file("${path.module}/../../state-machines/document-extraction.asl.json"),
          "\"textract-task:live\"", jsonencode(var.textract_task_function_arn)
        ),
        "\"pdf-parser-task:live\"", jsonencode(var.pdf_parser_task_function_arn)
      ),
      "\"bedrock-extraction-task:live\"", jsonencode(var.bedrock_extraction_task_function_arn)
    ),
    "\"extraction-validation-task:live\"", jsonencode(var.extraction_validation_task_function_arn)
  )
}

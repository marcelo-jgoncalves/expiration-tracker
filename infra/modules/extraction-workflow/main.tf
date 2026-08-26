# Standard workflow (not Express) — waitForTaskToken (RunTextract) requires Standard, per
# design §1.1. templatefile() substitutes the four Lambda ARNs into the FunctionName fields of
# ../../state-machines/document-extraction.asl.json's Task states at plan/apply time — the
# checked-in ASL file keeps human-readable placeholder names (e.g. "textract-task:live") for
# review; this module never changes the file's structure, only the ARNs.

resource "aws_sfn_state_machine" "document_extraction" {
  name     = "${var.name_prefix}-document-extraction"
  type     = "STANDARD"
  role_arn = var.state_machine_role_arn
  tags     = var.tags

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

# M7 item 3 (D-035) - dedicated terraform test for infra/modules/extraction-workflow/,
# explicitly flagged as a pending gap by item 7's session ("Nenhum terraform test escrito
# ainda para este módulo especificamente"). mock_provider - no real AWS credentials/resources
# needed. Uses `apply` (not `plan`), same rationale as feature-flags' own module test: the
# ARN-substitution assertions below need `definition`'s rendered string, which under
# mock_provider is only populated after the (mocked) resource is "created" - a real
# `terraform plan`/`apply` against dev (infra/tests/stack.tftest.hcl's
# extraction_workflow_* runs, plan-only) is the actual verification that the real Lambda ARNs
# resolve for real; this suite verifies the module's own substitution/wiring logic in
# isolation.

mock_provider "aws" {
  mock_resource "aws_sfn_state_machine" {
    defaults = {
      arn = "arn:aws:states:us-east-1:123456789012:stateMachine:exptrk-test-document-extraction"
    }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = {
      arn = "arn:aws:logs:us-east-1:123456789012:log-group:/aws/vendedlogs/states/exptrk-test-document-extraction"
    }
  }
}

variables {
  name_prefix                             = "exptrk-test"
  textract_task_function_arn              = "arn:aws:lambda:us-east-1:123456789012:function:exptrk-test-textract-task-handler:live"
  pdf_parser_task_function_arn            = "arn:aws:lambda:us-east-1:123456789012:function:exptrk-test-pdf-parser-task-handler:live"
  bedrock_extraction_task_function_arn    = "arn:aws:lambda:us-east-1:123456789012:function:exptrk-test-bedrock-extraction-task-handler:live"
  extraction_validation_task_function_arn = "arn:aws:lambda:us-east-1:123456789012:function:exptrk-test-extraction-validation-task-handler:live"
  state_machine_role_arn                  = "arn:aws:iam::123456789012:role/exptrk-test-extraction-workflow-role"
}

run "name_matches_root_local_extraction_state_machine_arn_convention" {
  command = apply

  # Root infra/main.tf's local.extraction_state_machine_arn is
  # "${name_prefix}-document-extraction" - ExtractionStarterWorker (item 2) already targets
  # that exact name. A drift here would silently break StartExecution in a live account.
  assert {
    condition     = aws_sfn_state_machine.document_extraction.name == "exptrk-test-document-extraction"
    error_message = "State machine name must be \"<name_prefix>-document-extraction\" exactly"
  }
}

run "definition_substitutes_all_four_real_arns_never_leaves_a_placeholder" {
  command = apply

  # The whole point of this module - replace() must swap every one of the four checked-in
  # ASL placeholders ("textract-task:live" etc) for the real ARN passed in, and never leave
  # any placeholder string behind (which would fail terraform apply for real against a live
  # account, not just at runtime).
  assert {
    condition     = strcontains(aws_sfn_state_machine.document_extraction.definition, var.textract_task_function_arn)
    error_message = "definition must embed the real TextractTaskHandler ARN"
  }
  assert {
    condition     = strcontains(aws_sfn_state_machine.document_extraction.definition, var.pdf_parser_task_function_arn)
    error_message = "definition must embed the real PdfParserTaskHandler ARN"
  }
  assert {
    condition     = strcontains(aws_sfn_state_machine.document_extraction.definition, var.bedrock_extraction_task_function_arn)
    error_message = "definition must embed the real BedrockExtractionTaskHandler ARN"
  }
  assert {
    condition     = strcontains(aws_sfn_state_machine.document_extraction.definition, var.extraction_validation_task_function_arn)
    error_message = "definition must embed the real ExtractionValidationTaskHandler ARN"
  }
  assert {
    condition     = !strcontains(aws_sfn_state_machine.document_extraction.definition, "textract-task:live")
    error_message = "definition must NOT retain the checked-in placeholder \"textract-task:live\" - it must be fully substituted"
  }
  assert {
    condition     = !strcontains(aws_sfn_state_machine.document_extraction.definition, "pdf-parser-task:live")
    error_message = "definition must NOT retain the checked-in placeholder \"pdf-parser-task:live\""
  }
  assert {
    condition     = !strcontains(aws_sfn_state_machine.document_extraction.definition, "bedrock-extraction-task:live")
    error_message = "definition must NOT retain the checked-in placeholder \"bedrock-extraction-task:live\""
  }
  assert {
    condition     = !strcontains(aws_sfn_state_machine.document_extraction.definition, "extraction-validation-task:live")
    error_message = "definition must NOT retain the checked-in placeholder \"extraction-validation-task:live\""
  }
}

run "standard_workflow_type_required_for_wait_for_task_token" {
  command = apply

  # RunTextract uses arn:aws:states:::lambda:invoke.waitForTaskToken (item 4) - only viable
  # on STANDARD, never EXPRESS (design §1.1).
  assert {
    condition     = aws_sfn_state_machine.document_extraction.type == "STANDARD"
    error_message = "Must be a Standard workflow - waitForTaskToken (RunTextract) requires it"
  }
}

run "role_arn_is_passed_through_exactly" {
  command = apply

  assert {
    condition     = aws_sfn_state_machine.document_extraction.role_arn == var.state_machine_role_arn
    error_message = "The module must use the caller-supplied execution role, never construct its own"
  }
}

run "tracing_and_logging_are_configured" {
  command = apply

  # AGENTS.md §7 / M5: every Lambda in this repo already runs with ADOT/X-Ray active - the
  # state machine orchestrating them must participate in the same trace. ERROR-level logging
  # (not ALL) with include_execution_data = false, matching the EXTRACTION_TRANSIENT privacy
  # discipline (execution input/output can carry OCR text/extracted field values).
  assert {
    condition     = aws_sfn_state_machine.document_extraction.tracing_configuration[0].enabled == true
    error_message = "X-Ray tracing must be enabled"
  }
  assert {
    condition     = aws_sfn_state_machine.document_extraction.logging_configuration[0].level == "ERROR"
    error_message = "Logging level must be ERROR, not ALL - execution data can carry extracted field values"
  }
  assert {
    condition     = aws_sfn_state_machine.document_extraction.logging_configuration[0].include_execution_data == false
    error_message = "include_execution_data must be false - never log OCR text/extracted field values verbatim"
  }
}

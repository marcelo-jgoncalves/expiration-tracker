# Lambda function — Terraform equivalent of infra/lib/scoped-lambda-function.ts
# (ADR-0009). Every function is constructed via this module, never a bare
# aws_lambda_function elsewhere, mirroring the CDK rule that every Lambda MUST go through
# ScopedLambdaFunction (implementation-blueprint.md §17.1) — the single enforcement point
# for least-privilege IAM per function.

data "archive_file" "this" {
  type        = "zip"
  source_dir  = var.source_dir
  output_path = "${path.module}/.build/${var.handler_name}.zip"
}

resource "aws_iam_role" "this" {
  name = "${var.function_name}-role"
  # Standard Lambda trust policy, expressed as a plain jsonencode() rather than
  # `data "aws_iam_policy_document"` so this module's `terraform test` runs (mock_provider
  # "aws") don't hit the mocked-data-source-JSON problem documented in the dynamo-table
  # module (an aws_iam_policy_document data source's rendered .json is replaced by an opaque
  # mock string under mock_provider, which fails aws_iam_role's JSON validation). The
  # policy-document pattern is reserved for the caller-supplied capability documents below,
  # which matter for audit/least-privilege review; this trust policy is fixed and uninteresting.
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "LambdaAssumeRole"
        Effect    = "Allow"
        Action    = "sts:AssumeRole"
        Principal = { Service = "lambda.amazonaws.com" }
      }
    ]
  })
  tags = var.tags
}

# CloudWatch Logs — CDK's `lambda.Function` attaches basic execution permissions
# (CreateLogGroup/CreateLogStream/PutLogEvents) to every function automatically; this is the
# Terraform equivalent, applied unconditionally (not one of the caller-supplied
# access capabilities, same as the CDK behavior).
resource "aws_iam_role_policy_attachment" "basic_execution" {
  role       = aws_iam_role.this.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# X-Ray — CDK's `tracing: lambda.Tracing.ACTIVE` also grants xray:PutTraceSegments /
# xray:PutTelemetryRecords automatically; replicated here only when tracing is active.
resource "aws_iam_role_policy_attachment" "xray" {
  count      = var.tracing_active ? 1 : 0
  role       = aws_iam_role.this.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

# Caller-supplied capability policies — Terraform equivalent of ScopedLambdaFunction's
# `access: AccessCapability[]` loop (`capability.grant(this.function)`). Each function gets
# EXACTLY the statements passed in via policy_documents_json, nothing table-wide by default.
resource "aws_iam_role_policy" "capabilities" {
  count  = length(var.policy_documents_json)
  name   = "${var.function_name}-capability-${count.index}"
  role   = aws_iam_role.this.id
  policy = var.policy_documents_json[count.index]
}

resource "aws_lambda_function" "this" {
  function_name = var.function_name
  role          = aws_iam_role.this.arn

  filename         = data.archive_file.this.output_path
  source_code_hash = data.archive_file.this.output_base64sha256

  handler = "index.handler"
  runtime = var.runtime

  timeout     = var.timeout_seconds
  memory_size = var.memory_size

  dynamic "tracing_config" {
    for_each = var.tracing_active ? [1] : []
    content {
      mode = "Active"
    }
  }

  dynamic "environment" {
    for_each = length(var.environment_variables) > 0 ? [1] : []
    content {
      variables = var.environment_variables
    }
  }

  tags = var.tags

  depends_on = [
    aws_iam_role_policy_attachment.basic_execution,
    aws_iam_role_policy_attachment.xray,
    aws_iam_role_policy.capabilities,
  ]
}

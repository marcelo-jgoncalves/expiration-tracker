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

  # Rollback design (docs/architecture/reviews/rollback-mechanism-design/
  # codex-round2-final-design.md, entrega 1): every deploy publishes an immutable numbered
  # version. The `live` alias below is what every real invoker (API Gateway, SQS event source
  # mappings, EventBridge Scheduler) actually targets - never `$LATEST` - so an emergency
  # rollback can repoint `live` to a prior version in seconds without a `terraform apply`.
  publish = true

  filename         = data.archive_file.this.output_path
  source_code_hash = data.archive_file.this.output_base64sha256

  handler       = "index.handler"
  runtime       = var.runtime
  architectures = var.architectures

  # m5-observability-design.md §3: ADOT layer instrumenting the bundled @aws-sdk clients
  # (DynamoDB/SQS/SESv2) automatically via AWS_LAMBDA_EXEC_WRAPPER - no captureAWSv3Client
  # calls in application code. IAM: already covered by the xray attachment above (same
  # AWSXRayDaemonWriteAccess permission ADOT exports through), no policy change needed.
  layers = [var.adot_layer_arn]

  timeout     = var.timeout_seconds
  memory_size = var.memory_size

  reserved_concurrent_executions = var.reserved_concurrent_executions

  dynamic "tracing_config" {
    for_each = var.tracing_active ? [1] : []
    content {
      mode = "Active"
    }
  }

  environment {
    variables = merge(var.environment_variables, { AWS_LAMBDA_EXEC_WRAPPER = "/opt/otel-handler" })
  }

  tags = var.tags

  depends_on = [
    aws_iam_role_policy_attachment.basic_execution,
    aws_iam_role_policy_attachment.xray,
    aws_iam_role_policy.capabilities,
  ]
}

# Rollback design entrega 1: stable alias every real invoker targets. Terraform advances this
# to the newly published version on every normal deploy; emergency rollback (rollback.yml)
# repoints it directly via `aws lambda update-alias`, bypassing `terraform apply` entirely -
# the next normal deploy then reconciles Terraform's view of the alias back to $LATEST's
# published version, which is expected drift-then-reconcile, not a bug.
resource "aws_lambda_alias" "live" {
  name             = "live"
  function_name    = aws_lambda_function.this.function_name
  function_version = aws_lambda_function.this.version
}

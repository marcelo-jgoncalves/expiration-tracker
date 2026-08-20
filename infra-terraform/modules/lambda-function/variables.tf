# Lambda function module — Terraform equivalent of infra/lib/scoped-lambda-function.ts
# (ADR-0009). Terraform has no built-in esbuild bundling like CDK's NodejsFunction/this
# repo's own bundleEntry, so the artifact referenced here MUST already exist on disk
# (produced by `npm run build:lambdas`, scripts/build-lambdas.ts) before `terraform
# plan`/`apply` runs — this module only zips and deploys an already-bundled directory, it
# does not invoke esbuild itself.

variable "function_name" {
  description = "Name of the Lambda function."
  type        = string
}

variable "handler_name" {
  description = <<-EOT
    Logical handler name, matching one entry in scripts/build-lambdas.ts's HANDLERS list
    (e.g. "reminder-producer-handler"). Used only for documentation/tagging purposes here —
    `source_dir` is what actually determines what gets zipped.
  EOT
  type        = string
}

variable "source_dir" {
  description = <<-EOT
    Path to the already-bundled handler directory (dist/lambda/<handler_name>/), produced by
    `npm run build:lambdas` before Terraform runs. Must contain index.js (CJS, exports.handler)
    — the module zips this directory as-is via data.archive_file.
  EOT
  type        = string
}

variable "runtime" {
  description = <<-EOT
    Lambda runtime identifier. CDK's ScopedLambdaFunction currently targets Node 20
    (bundleEntry's esbuild target is "node20"); nodejs20.x is what the bundled CJS artifact
    is built for and is the value the aws_lambda_function.runtime attribute accepts today.
  EOT
  type        = string
  default     = "nodejs20.x"
}

variable "timeout_seconds" {
  description = "Function timeout in seconds. CDK default (ScopedLambdaFunction) is 10s."
  type        = number
  default     = 10
}

variable "memory_size" {
  description = "Function memory in MB. CDK default (ScopedLambdaFunction) is 256."
  type        = number
  default     = 256
}

variable "reserved_concurrent_executions" {
  description = <<-EOT
    Reserved concurrency for this function, matching ScopedLambdaFunction's
    `reservedConcurrentExecutions` prop (infra/lib/expiration-tracker-stack.ts sets this
    per-function: ReminderProducer=2, ReminderDispatch=10, ReminderReconciliation=1,
    DispatchOutboxRelay=2, OutboxSweeperReminderDispatch=2). -1 (the aws_lambda_function
    default) means unreserved/unlimited, matching CDK's own default when the prop is unset.
  EOT
  type        = number
  default     = -1
}

variable "tracing_active" {
  description = "Whether X-Ray active tracing is enabled. CDK default (ScopedLambdaFunction) is Tracing.ACTIVE (true)."
  type        = bool
  default     = true
}

variable "environment_variables" {
  description = "Environment variables for the function."
  type        = map(string)
  default     = {}
}

variable "policy_documents_json" {
  description = <<-EOT
    List of rendered `aws_iam_policy_document` JSON strings to attach to this function's IAM
    role — e.g. the dynamo-table module's `tenant_facing_read_write_policy_json` or
    `gsi3_read_policy_json` outputs. This is the Terraform equivalent of ScopedLambdaFunction's
    `access: AccessCapability[]` — the module grants EXACTLY the statements the caller passes
    in, nothing table-wide by default (same "capability" pattern / least-privilege posture as
    the CDK construct, including its documented judgment-call limitation that DynamoDB IAM
    cannot restrict by entity/SK prefix, only by index resource ARN).
  EOT
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Tags applied to the function and its role."
  type        = map(string)
  default     = {}
}

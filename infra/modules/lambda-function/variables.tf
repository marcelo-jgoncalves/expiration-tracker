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
    Lambda runtime identifier. Node 20 was AWS-deprecated 2026-04-30 (D-136/D-137 found the
    project still pinned to it past that date, then Node 22 as an interim step once D-137
    found nodejs24.x required hashicorp/aws >= 6.19.0). The provider was bumped project-wide
    to "~> 6.19" (D-138) specifically to unblock this: build-lambdas.ts's esbuild target is
    "node24" and nodejs24.x is what the bundled CJS artifact is built for.
  EOT
  type        = string
  default     = "nodejs24.x"
}

variable "architectures" {
  description = <<-EOT
    Instruction set architecture, exactly one value (AWS Lambda does not support multi-arch
    functions). Default "arm64" (Graviton2) — roadmap-competitivo-2026-09-01.md §17.1
    (Marcelo, 2026-09-05): ~20% lower duration cost, no binary-compatibility risk (this
    project has zero native/prebuilt-binary dependencies — pure JS/TS + @aws-sdk/*, verified
    against package.json), esbuild's `platform: "node"` bundling target is architecture-
    agnostic (scripts/build-lambdas.ts), and nodejs24.x runs identically on both
    architectures. The ADOT layer ARN (`adot_layer_arn` below) IS architecture-specific and
    must match whatever value is set here.
  EOT
  type        = list(string)
  default     = ["arm64"]
  validation {
    condition     = length(var.architectures) == 1 && contains(["x86_64", "arm64"], var.architectures[0])
    error_message = "architectures must be exactly one of [\"x86_64\"] or [\"arm64\"] - AWS Lambda does not support multi-architecture functions."
  }
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

variable "adot_layer_arn" {
  description = <<-EOT
    ARN of the AWS Distro for OpenTelemetry (ADOT) Lambda layer for Node.js
    (m5-observability-design.md §3 - instrumentation for X-Ray tracing, replacing the
    legacy/maintenance-mode aws-xray-sdk-core). No default, same fail-fast rationale as
    ses_from_address - the ARN is region+architecture-specific
    (aws-otel-nodejs-<amd64|arm64>-ver-<version>, published account 901920570463) and must
    be pinned explicitly at the environment level, never resolved to "latest" implicitly
    (keeps `terraform plan` deterministic, same rationale as CI's SHA-pinned actions).
  EOT
  type        = string
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

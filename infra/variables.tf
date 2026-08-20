# Root variables — ADR-0009 step 2, mirroring infra/bin/app.ts's stack instantiation
# (ExpirationTrackerStack-Dev, us-east-1, schedulesEnabled: true).

variable "aws_region" {
  description = "AWS region. infra/bin/app.ts hardcodes us-east-1 for the dev stack as an explicit, user-confirmed exception (throwaway dev/validation environment only) — never the production region decision."
  type        = string
  default     = "us-east-1"
}

variable "aws_account_id" {
  description = "AWS account ID resources are deployed to. Used only to construct deterministic ARNs (dynamo-table/reminder-queue modules) so IAM policy documents are plan-time-known — same rationale as those modules' own variables."
  type        = string
}

variable "environment" {
  description = "Deployment environment. Only \"dev\" exists today (infra/bin/app.ts only instantiates ExpirationTrackerStack-Dev; production region is a documented pending external decision, not implemented here)."
  type        = string
  default     = "dev"

  validation {
    condition     = var.environment == "dev"
    error_message = "Only \"dev\" is implemented today (see infra/bin/app.ts) — a production environment requires its own region decision first."
  }
}

variable "enable_reserved_concurrency" {
  description = <<-EOT
    Whether the 5 async Lambda functions get the CDK-parity reserved concurrency values
    (producer=2, dispatch=10, reconciliation=1, relay=2, sweeper=2, summing to 17). Real
    finding from the first real `terraform apply` against this account (2026-08-20): the
    claude-dev dev account's total Lambda concurrent execution limit is only 10 (new/
    unverified-account default; AWS raises this on request), so reserving any of these
    values leaves the account's required minimum unreserved capacity in deficit -
    `PutFunctionConcurrency` fails outright. Defaults true (the correct/intended value for
    any account with a normal quota); `env/dev.tfvars` overrides to false specifically for
    this account until AWS raises its quota (external impediment, not a code defect) -
    `stack.tftest.hcl`'s
    `reserved_concurrency_matches_cdk_stack` test overrides this to true in its own
    `variables {}` block, so the intended parity values are still proven correct even
    while the real dev deploy can't use them yet.
  EOT
  type        = bool
  default     = true
}

variable "mfa_policy" {
  description = "Cognito MFA enforcement policy: OFF, OPTIONAL, or REQUIRED. UNK-006 is pending external research — default OPTIONAL matches infra/lib/expiration-tracker-stack.ts's own default (props.mfaPolicy undefined -> ExpirationTrackerAuth's default)."
  type        = string
  default     = "OPTIONAL"
}

variable "schedules_enabled" {
  description = "EventBridge Scheduler kill switch. infra/bin/app.ts sets schedulesEnabled: true for the dev stack."
  type        = bool
  default     = true
}

variable "monthly_budget_usd" {
  description = "Monthly AWS Budgets ceiling in USD. Matches the cost-budget module's own default (50) unless overridden."
  type        = number
  default     = 50
}

variable "budget_notification_emails" {
  description = "Email(s) notified by the monthly cost budget at 80% forecasted / 100% actual spend."
  type        = list(string)
  default     = []
}

variable "ses_from_address" {
  description = <<-EOT
    Verified SES sender address for M4's EmailDeliveryWorker (SES sandbox/test account,
    implementation-blueprint.md §19 M4 scope). No default - SES identity verification is a
    manual, out-of-band, one-time step against whichever address/domain the sandbox test
    account uses (tracked separately, not a Terraform-managed resource here), and this
    variable must fail fast rather than silently deploy against an unverified/placeholder
    address. Set via -var or TF_VAR_ses_from_address once the sandbox spike
    (docs/architecture/m4-notification-engine-design.md, item aberto #2 do fechamento de
    rodada 3) verifies an identity.
  EOT
  type        = string
}

variable "cognito_callback_urls" {
  description = "OAuth authorization-code-grant callback URLs for the BFF web client. Placeholder default until a real frontend domain is decided, same posture as the cognito module."
  type        = list(string)
  default     = ["https://example.com/callback"]
}

locals {
  project_name = "expiration-tracker"
  # Matches infra/bin/app.ts's stack id (ExpirationTrackerStack-Dev) in spirit, lowercased/
  # kebab-cased for Terraform resource naming (CDK/CloudFormation and Terraform/AWS resource
  # names follow different casing conventions; the stack's logical identity is what's
  # preserved, not the literal string). Abbreviated ("exptrk", not "expiration-tracker") for
  # resource-name-driven identifiers specifically: the longest Lambda function name
  # (outbox-sweeper-reminder-dispatch) combined with the reminder-schedule module's own
  # "-schedule-role"/"-claims-schedule-role" IAM role name suffixes must stay under IAM's
  # 64-character role name limit, discovered via `terraform plan` against the real AWS
  # provider - "expiration-tracker-dev-..." alone already exceeded it.
  name_prefix = "exptrk-${var.environment}"
}

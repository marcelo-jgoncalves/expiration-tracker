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

variable "document_request_initial_invite_email_enabled" {
  description = <<-EOT
    Kill switch global do convite inicial automatizado de guest upload (M10 cluster 4, D-049).
    Default `false` em todos os ambientes, inclusive prod - o mecanismo técnico (SES/templates/
    rate limit) já é implementado independente deste valor, mas o ENVIO em si nunca acontece
    com o switch desligado, mesmo que a preferência de tenant ou o override por chamada peçam
    EMAIL explicitamente. Ligar este switch em produção real exige primeiro o gate operacional
    registrado em D-049 (spike de validação SES em sandbox real, alarme de bounce/complaint,
    runbook de desligamento) - nenhum desses itens está fechado ainda.
  EOT
  type        = bool
  default     = false
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

variable "adot_layer_arn" {
  description = <<-EOT
    ARN of the AWS Distro for OpenTelemetry (ADOT) Lambda layer for Node.js, attached to
    every function (m5-observability-design.md §3). No default - region+architecture-
    specific (aws-otel-nodejs-<amd64|arm64>-ver-<version>, published AWS account
    901920570463), must be pinned explicitly rather than resolved to "latest" implicitly.
    Set via -var or TF_VAR_adot_layer_arn (env/dev.tfvars pins the dev value).
  EOT
  type        = string
}

variable "alert_email" {
  description = <<-EOT
    E-mail address that receives operational alerts from every CloudWatch alarm
    (m5-observability-design.md §4). No default - same fail-fast rationale as
    ses_from_address. The subscription this creates stays PendingConfirmation until the
    recipient clicks the AWS confirmation e-mail - a real manual step this milestone
    registers as an explicit acceptance criterion (see NEXT_SESSION_PROMPT.md), not closed
    by `terraform apply` alone.
  EOT
  type        = string
}

variable "malware_protection_enabled" {
  description = <<-EOT
    GuardDuty Malware Protection for S3 kill switch (M6 design,
    docs/architecture/reviews/m6-document-upload-design/codex-reconciliation-round2-final-design.md).
    Real user decision: GuardDuty has a recurring cost (~US$0.60/GB scanned, ~US$250/month
    estimated at Stage 5 production scale) - default true lets it be exercised end-to-end
    (including the real Camada 3 GuardDuty/EICAR test), but dev can turn it off (`-var
    malware_protection_enabled=false`) between exercises to avoid the recurring cost.
    document-malware-protection's own variable validation forces this true whenever
    `environment == "prod"` - fail-closed, no bypass in a real production deploy.
  EOT
  type        = bool
  default     = true
}

variable "extraction_pipeline_enabled" {
  description = <<-EOT
    Deploy/activation gate for the complete M7 extraction pipeline (D-035 §1.6). Default
    false: feature nova com custo real por chamada (Textract/Bedrock), processamento de dado
    pessoal, e pré-condições externas (RIPD, região/modelo Bedrock, inventário de
    subprocessadores) ainda não fechadas. Distinto dos kill switches em runtime
    (module.feature_flags's AI_EXTRACTION/OCR, AppConfig) - este é o gate Terraform que
    controla se a infra do pipeline (Step Functions, Textract task handlers, bucket
    EXTRACTION_TRANSIENT) chega a ser criada/mantida em um ambiente; os kill switches
    controlam o comportamento em runtime depois que a infra já existe. Não referenciado por
    nenhum recurso ainda (2026-08-25) - o módulo feature-flags é só a entrega do AppConfig; os
    workers futuros do pipeline (NEXT_SESSION_PROMPT.md, itens 2+) é que ficam condicionados a
    este gate quando forem implementados.
  EOT
  type        = bool
  default     = false
}

variable "bedrock_model_id" {
  description = <<-EOT
    Bedrock model ID for BedrockExtractionTaskHandler's Converse API call (M7 item 6, D-035
    §1.9/§4). Placeholder default, same posture as ses_from_address/app_origin - design §4
    explicitly defers "escolha/validação de modelo Bedrock + região" to a pre-production
    decision that blocks only real production activation (AI_EXTRACTION stays a kill switch
    defaulting off regardless). The placeholder value below is not a real, invokable model ID -
    a real Converse call against it fails obviously (ValidationException) rather than silently
    succeeding against the wrong model. Set via -var/TF_VAR_bedrock_model_id once a real model
    is selected and its region availability confirmed.
  EOT
  type        = string
  default     = "PLACEHOLDER_BEDROCK_MODEL_ID_NOT_SELECTED"
}

variable "bedrock_region" {
  description = <<-EOT
    AWS region BedrockExtractionTaskHandler's BedrockRuntimeClient targets for the Converse API
    call - deliberately independent of the stack's own deploy region (`var.aws_region` /
    provider default), since Bedrock model availability varies by region and the real region
    choice is part of the same deferred model-selection decision as bedrock_model_id (design
    §4). Placeholder default (the stack's typical dev region) until that decision is made.
  EOT
  type        = string
  default     = "us-east-1"
}

variable "cognito_callback_urls" {
  description = "OAuth authorization-code-grant callback URLs for the BFF web client. Placeholder default until a real frontend domain is decided, same posture as the cognito module. Overridden at the module.auth call site by local.bff_redirect_uri (derived from var.app_origin) so both stay consistent - this variable's own default is only ever hit if that override is removed."
  type        = list(string)
  default     = ["https://example.com/callback"]
}

variable "app_origin" {
  description = "The CloudFront-fronted app origin (e.g. https://app.example.com) - same placeholder posture as api-gateway's cors_allow_origins pending a real frontend domain decision. Used to derive the OIDC redirect_uri (<app_origin>/bff/callback) and the BFF's APP_ORIGIN env var (post-login redirect target)."
  type        = string
  default     = "https://app.example.invalid"
}

variable "bff_cognito_domain_prefix" {
  description = <<-EOT
    Prefix for the Cognito Hosted UI domain (Full BFF, D-053/D-054) - must be globally
    unique across every AWS Cognito user, not just this account/region. The default below is
    a reasonable per-environment guess, not a guaranteed-available value; a real `apply` that
    hits a collision fails with a clear, obvious Cognito error naming the conflicting domain,
    which the operator resolves by picking a different prefix - same placeholder-until-
    verified posture as ses_from_address/app_origin elsewhere in this environment's tfvars.
  EOT
  type        = string
  default     = "exptrk-dev-bff"
}

locals {
  bff_redirect_uri = "${var.app_origin}/bff/callback"
  project_name     = "expiration-tracker"
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

# Cognito User Pool + app client — Terraform equivalent of infra/lib/cognito.ts (ADR-0009).

variable "user_pool_name" {
  description = "Name of the Cognito User Pool."
  type        = string
}

variable "mfa_policy" {
  description = <<-EOT
    MFA enforcement policy: OFF, OPTIONAL, or REQUIRED. UNK-006 ("MFA obrigatorio vs.
    opcional") is explicitly pending external research (NEXT_SESSION_PROMPT.md) and is not a
    blocker for M1 — kept as a configurable variable (default OPTIONAL, same default as the
    CDK construct) so switching to REQUIRED later is a one-line variable change, not a rewrite.
  EOT
  type        = string
  default     = "OPTIONAL"

  validation {
    condition     = contains(["OFF", "OPTIONAL", "REQUIRED"], var.mfa_policy)
    error_message = "mfa_policy must be one of: OFF, OPTIONAL, REQUIRED."
  }
}

variable "deletion_protection" {
  description = <<-EOT
    Whether the User Pool is protected from deletion. Terraform's nearest equivalent to the
    CDK construct's `removalPolicy: RETAIN` default — ACTIVE keeps the pool from being
    destroyed by an accidental `terraform destroy`/apply that drops the resource.
  EOT
  type        = string
  default     = "ACTIVE"

  validation {
    condition     = contains(["ACTIVE", "INACTIVE"], var.deletion_protection)
    error_message = "deletion_protection must be ACTIVE or INACTIVE."
  }
}

variable "tags" {
  description = "Tags applied to the User Pool."
  type        = map(string)
  default     = {}
}

variable "callback_urls" {
  description = <<-EOT
    OAuth authorization-code-grant callback URLs for the BFF web client. The CDK construct
    (infra/lib/cognito.ts) configures `oAuth.flows.authorizationCodeGrant` without an explicit
    callbackUrls list, relying on CDK's placeholder default; Terraform's aws_cognito_user_pool_client
    requires a non-empty list whenever allowed_oauth_flows_user_pool_client is true, so this is
    exposed as a variable with the same kind of placeholder default — real BFF callback URL(s)
    are wired in at root-module composition time (out of scope for this module).
  EOT
  type        = list(string)
  default     = ["https://example.com/callback"]
}

# Cognito User Pool + web app client — Terraform equivalent of infra/lib/cognito.ts
# (ADR-0009). MFA: UNK-006 ("MFA obrigatorio vs. opcional") is pending external research and
# is NOT a blocker — implemented as a configurable variable (default OPTIONAL, never
# hardcoded to OFF/REQUIRED), same posture as the CDK construct.

locals {
  # Terraform's mfa_configuration accepts OFF/OPTIONAL/ON, not OFF/OPTIONAL/REQUIRED like the
  # CDK enum — map the module's own OFF/OPTIONAL/REQUIRED vocabulary (kept identical to the
  # CDK prop for continuity) onto the provider's accepted values.
  mfa_configuration = var.mfa_policy == "REQUIRED" ? "ON" : var.mfa_policy
}

resource "aws_cognito_user_pool" "this" {
  name = var.user_pool_name

  # signInAliases: { email: true } / autoVerify: { email: true }
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  schema {
    name                     = "email"
    attribute_data_type      = "String"
    required                 = true
    mutable                  = false
    developer_only_attribute = false
  }

  password_policy {
    minimum_length    = 12
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = true
  }

  mfa_configuration = local.mfa_configuration

  # TOTP only (avoids SMS provider/cost dependency, same judgment call as the CDK construct).
  dynamic "software_token_mfa_configuration" {
    for_each = local.mfa_configuration == "OFF" ? [] : [1]
    content {
      enabled = true
    }
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  device_configuration {
    challenge_required_on_new_device      = true
    device_only_remembered_on_user_prompt = true
  }

  deletion_protection = var.deletion_protection

  tags = var.tags
}

resource "aws_cognito_user_pool_client" "web_client" {
  name         = "WebClient"
  user_pool_id = aws_cognito_user_pool.this.id

  # authFlows: { userSrp: true }
  explicit_auth_flows = ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]

  # BFF session pattern (blueprint §4.2): client secret held server-side only, never in the
  # browser.
  generate_secret = true

  # Access/ID tokens short-lived per blueprint §4.2 (5-15 min target); refresh rotation +
  # reuse detection is enforced by the BFF /session/refresh endpoint, not by Cognito's own
  # (non-rotating) refresh token alone.
  access_token_validity  = 15
  id_token_validity      = 15
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  prevent_user_existence_errors = "ENABLED"

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["email", "openid", "profile"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = var.callback_urls
}

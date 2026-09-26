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

  # d321-direct-auth-adversarial-review round 2 (Codex, confirmed via AWS's own
  # DeviceConfigurationType doc: "When you provide a value for any property of
  # DeviceConfiguration, you activate the device remembering for the user pool") - REMOVED.
  # `device_configuration` here activated device remembering pool-wide even though NOTHING in
  # this codebase ever calls ConfirmDevice/UpdateDeviceStatus or passes DEVICE_KEY (grep for those
  # + NewDeviceMetadata across src/ returns zero matches) - a pool feature enabled with no code
  # ever using it. Per AWS's own /oauth2/token docs, a token minted via InitiateAuth (the direct-
  # auth login this app uses, D-3xx) can only be refreshed at that endpoint when remembered
  # devices is NOT active - with this block present, every direct-auth session's refresh could
  # fail once its access token expires. **Residual risk, named explicitly (same class of gotcha as
  # D-323's ManagedLoginVersion, though the provider mechanism differs)**: `device_configuration`
  # is a plain Optional block in the AWS provider (v6.65.0, verified against the provider's own
  # schema - not Computed like `managed_login_version` was), so removing it SHOULD send an
  # explicit clear on the next apply. `terraform apply` against `dev` only ever runs via the CD
  # pipeline (never locally), so this has not been verified empirically - confirm after the next
  # real apply (`aws cognito-idp describe-user-pool --profile claude-dev`, check
  # `DeviceConfiguration` is null) and, separately, exercise a real login -> wait for access-token
  # expiry -> refresh round trip against `dev` before treating this as fully closed.
  deletion_protection = var.deletion_protection

  # D-3xx: D-320's ESSENTIALS bump is reverted here - it existed only to unlock the Managed
  # Login branding designer (aws_cognito_managed_login_branding, removed below). The direct-auth
  # APIs this app now uses instead (InitiateAuth/SignUp/ForgotPassword/ConfirmForgotPassword -
  # src/modules/bff/persistence/cognito-idp-auth-client.ts) are core Cognito Identity Provider
  # APIs available on every tier, including the default (LITE) this omission now falls back to -
  # nothing here depends on Essentials/Plus. Leaving `user_pool_tier` unset (rather than pinning
  # `"LITE"` explicitly) matches how the module looked before D-320 ever touched it.
  tags = var.tags
}

resource "aws_cognito_user_pool_client" "web_client" {
  name         = "WebClient"
  user_pool_id = aws_cognito_user_pool.this.id

  # D-054 (Full BFF hardening amendment) removed ALLOW_REFRESH_TOKEN_AUTH: it is mutually
  # exclusive with refresh_token_rotation below (a client that can call /oauth2/token's
  # refresh_token grant AND has native rotation enabled would let a caller bypass rotation via
  # InitiateAuth directly) - the only supported way to refresh a token for this client is the
  # /oauth2/token endpoint, which the BFF alone calls server-side
  # (src/modules/bff/persistence/fetch-cognito-oidc-client.ts). Unchanged by D-3xx.
  #
  # D-3xx (reversal of D-320): ALLOW_USER_SRP_AUTH -> ALLOW_USER_PASSWORD_AUTH. SRP was never
  # actually used by any real code path (no src/ call site ever issued a USER_SRP_AUTH
  # InitiateAuth - this flag predates any direct-auth implementation entirely); the app's own
  # login screen now calls InitiateAuth with AuthFlow=USER_PASSWORD_AUTH server-side from the
  # BFF (src/modules/bff/persistence/cognito-idp-auth-client.ts) - the credential still travels
  # over TLS to Cognito directly, same trust boundary the Hosted UI's own login form had, without
  # reimplementing SRP's client-side math (explicitly out of scope - "não reinventar
  # criptografia"). Only the flow this app actually uses is enabled - least privilege.
  explicit_auth_flows = ["ALLOW_USER_PASSWORD_AUTH"]

  # BFF session pattern (blueprint §4.2): client secret held server-side only, never in the
  # browser.
  generate_secret = true

  # D-054: Cognito's own native refresh token rotation is the source of truth for replay
  # safety, replacing the original design's local rotation counter (found fragile under
  # normal SPA concurrency - two legitimate concurrent requests both needing to refresh could
  # each observe a stale counter and incorrectly treat the other as a reuse attempt).
  # retry_grace_period_seconds=30 gives the BFF's own short-lived lease
  # (src/modules/bff/application/bff-auth-service.ts's refreshState/refreshLeaseId) a safety
  # margin under Cognito's own reuse-detection window, never the other way around.
  refresh_token_rotation {
    feature                    = "ENABLED"
    retry_grace_period_seconds = 30
  }

  # Access/ID tokens short-lived per blueprint §4.2 (5-15 min target); refresh rotation +
  # reuse detection is now enforced natively by Cognito (refresh_token_rotation above), not a
  # custom BFF-side mechanism.
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

# Full BFF (D-053/D-054): the OAuth2 endpoints (/oauth2/authorize, /oauth2/token,
# /oauth2/revoke) the BFF calls server-side are served by this domain, not by the User Pool
# API directly - `allowed_oauth_flows = ["code"]` above is inert without one. This domain stays
# even after D-3xx (reversal of D-320): /oauth2/token (refresh_token grant) and /oauth2/revoke
# are still called by fetch-cognito-oidc-client.ts on every session refresh/logout, and the
# rendered login PAGE this domain also serves (now unbranded classic Hosted UI, D-320's
# `managed_login_version = 2` removed below) stays reachable as GET /bff/login's dormant
# fallback (bff-handlers.ts's handleLogin/handleCallback, kept but no longer linked from the
# frontend).
resource "aws_cognito_user_pool_domain" "this" {
  domain       = var.domain_prefix
  user_pool_id = aws_cognito_user_pool.this.id
}

# D-3xx: aws_cognito_managed_login_branding.web_client (D-320) removed - the app's own
# login/signup/reset-password screens (frontend/src/routes/{Login,SignUp,ForgotPassword,
# ResetPassword}.tsx) replaced the Cognito-rendered login page as the real entry point, so this
# branding config has no page left to apply to. See decisions-log.md D-3xx for the full
# rationale (Marcelo chose the app's own UI over Managed Login for visual fidelity).

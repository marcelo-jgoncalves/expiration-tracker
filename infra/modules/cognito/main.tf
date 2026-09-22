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

  # Required for Managed Login branding below (item #21, D-320) - AWS's Essentials/Plus feature
  # plans unlock the branding-designer login pages; Lite (the implicit default before this
  # change) only serves the classic, unbrandable hosted UI. Essentials is the minimum plan that
  # includes it - no need for Plus's extra advanced-security features here.
  user_pool_tier = "ESSENTIALS"

  tags = var.tags
}

resource "aws_cognito_user_pool_client" "web_client" {
  name         = "WebClient"
  user_pool_id = aws_cognito_user_pool.this.id

  # authFlows: { userSrp: true } - D-054 (Full BFF hardening amendment) removed
  # ALLOW_REFRESH_TOKEN_AUTH: it is mutually exclusive with refresh_token_rotation below (a
  # client that can call /oauth2/token's refresh_token grant AND has native rotation enabled
  # would let a caller bypass rotation via InitiateAuth directly) - the only supported way to
  # refresh a token for this client is now the Hosted UI's /oauth2/token endpoint, which the
  # BFF alone calls server-side (src/modules/bff/persistence/fetch-cognito-oidc-client.ts).
  explicit_auth_flows = ["ALLOW_USER_SRP_AUTH"]

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
# API directly - `allowed_oauth_flows = ["code"]` above is inert without one.
resource "aws_cognito_user_pool_domain" "this" {
  domain       = var.domain_prefix
  user_pool_id = aws_cognito_user_pool.this.id

  # managed_login_version=2 (item #21, D-320): switches this domain's login pages from the
  # classic, effectively-unbrandable hosted UI (version 1, the implicit default) to Managed
  # Login, the branding-designer experience the aws_cognito_managed_login_branding resource
  # below configures. Doesn't change the OAuth2/OIDC endpoints the BFF calls
  # (fetch-cognito-oidc-client.ts) or the authorization-code+PKCE flow
  # (bff-auth-service.ts's startLogin) - only the rendered login form itself.
  managed_login_version = 2
}

# Item #21 (D-320): applies the v2 design system's violet accent, radius scale and status
# colors (docs/frontend/design-system-v2/tokens/{colors,shape}.css) to the Managed Login pages
# via the branding-designer Settings schema (confirmed against the real AWS API reference,
# CreateManagedLoginBranding - no "font"/typography key exists anywhere in that schema, so
# Plus Jakarta Sans and the Lucide icon set - the other two pillars of ADR-0015 - are NOT
# reachable this way; documented as an accepted gap in decisions-log.md D-320, not a bug here).
resource "aws_cognito_managed_login_branding" "web_client" {
  client_id    = aws_cognito_user_pool_client.web_client.id
  user_pool_id = aws_cognito_user_pool.this.id

  settings = jsonencode({
    categories = {
      auth = {
        # Single COGNITO IdP only (supported_identity_providers above) - no FEDERATED entry.
        authMethodOrder = [
          [{ display = "INPUT", type = "USERNAME_PASSWORD" }]
        ]
        federation = { interfaceStyle = "BUTTON_LIST", order = [] }
      }
      form = {
        displayGraphics     = true
        instructions        = { enabled = false }
        languageSelector    = { enabled = false }
        location            = { horizontal = "CENTER", vertical = "CENTER" }
        sessionTimerDisplay = "NONE"
      }
      global = {
        colorSchemeMode = "LIGHT" # design-system-v2/tokens/colors.css: only light mode implemented
        pageFooter      = { enabled = false }
        pageHeader      = { enabled = false }
        spacingDensity  = "REGULAR"
      }
    }
    componentClasses = {
      buttons = { borderRadius = 12.0 }                      # --radius-md
      divider = { lightMode = { borderColor = "e7eaf0ff" } } # --color-neutral-200
      dropDown = {
        borderRadius = 12.0
        lightMode = {
          defaults = { itemBackgroundColor = "ffffffff" }
          hover    = { itemBackgroundColor = "f7f8faff", itemBorderColor = "858d9dff", itemTextColor = "1b2333ff" }
          match    = { itemBackgroundColor = "ede9feff", itemTextColor = "6d28d9ff" }
        }
      }
      focusState = { lightMode = { borderColor = "7c3aedff" } } # --color-focus-ring
      input = {
        borderRadius = 12.0
        lightMode = {
          defaults         = { backgroundColor = "ffffffff", borderColor = "858d9dff" } # --color-border-interactive
          placeholderColor = "5a6478ff"
        }
      }
      inputDescription = { lightMode = { textColor = "5a6478ff" } } # --color-text-secondary
      inputLabel       = { lightMode = { textColor = "1b2333ff" } } # --color-text-primary
      link = {
        lightMode = {
          defaults = { textColor = "6d28d9ff" } # --color-text-link (accent-700)
          hover    = { textColor = "5b21b6ff" } # accent-800
        }
      }
      optionControls = {
        lightMode = {
          defaults = { backgroundColor = "ffffffff", borderColor = "858d9dff" }
          selected = { backgroundColor = "7c3aedff", foregroundColor = "ffffffff" }
        }
      }
      statusIndicator = {
        lightMode = {
          error   = { backgroundColor = "fef3f2ff", borderColor = "fbd5d1ff", indicatorColor = "b42318ff" }
          success = { backgroundColor = "ecfdf3ff", borderColor = "c9ecd7ff", indicatorColor = "067647ff" }
          warning = { backgroundColor = "fffaebff", borderColor = "fce7b6ff", indicatorColor = "b54708ff" }
        }
      }
    }
    components = {
      alert = {
        borderRadius = 12.0
        lightMode    = { error = { backgroundColor = "fef3f2ff", borderColor = "fbd5d1ff" } }
      }
      favicon = { enabledTypes = ["ICO", "SVG"] }
      form = {
        backgroundImage = { enabled = false }
        borderRadius    = 18.0 # --radius-lg, matches Panel/Card
        lightMode       = { backgroundColor = "ffffffff", borderColor = "e7eaf0ff" }
        logo            = { enabled = false, formInclusion = "IN", location = "CENTER", position = "TOP" }
      }
      pageBackground = {
        # --color-surface-page is a lilac gradient (unsupported here, solid color only) -
        # accent-50 approximates its hue without a background image asset.
        lightMode = { color = "f5f3ffff" }
        image     = { enabled = false }
      }
      pageText = {
        lightMode = { bodyColor = "5a6478ff", descriptionColor = "5a6478ff", headingColor = "1b2333ff" }
      }
      primaryButton = {
        lightMode = {
          defaults = { backgroundColor = "7c3aedff", textColor = "ffffffff" } # accent-600
          hover    = { backgroundColor = "6d28d9ff", textColor = "ffffffff" } # accent-700
          active   = { backgroundColor = "5b21b6ff", textColor = "ffffffff" } # accent-800
          disabled = { backgroundColor = "d6dbe4ff", borderColor = "d6dbe4ff" }
        }
      }
      secondaryButton = {
        lightMode = {
          defaults = { backgroundColor = "ffffffff", borderColor = "7c3aedff", textColor = "6d28d9ff" }
          hover    = { backgroundColor = "f5f3ffff", borderColor = "6d28d9ff", textColor = "5b21b6ff" }
          active   = { backgroundColor = "ede9feff", borderColor = "5b21b6ff", textColor = "5b21b6ff" }
        }
      }
    }
  })
}

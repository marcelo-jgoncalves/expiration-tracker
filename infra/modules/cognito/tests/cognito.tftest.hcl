# Recreates the acceptance criteria implied by infra/lib/cognito.ts as native
# `terraform test` assertions. Uses a mocked AWS provider (no real credentials/resources
# needed or created — see ADR-0009 and the repo's hard rule against `terraform apply`
# against real AWS; this mocked apply never touches AWS at all).

mock_provider "aws" {}

run "defaults_to_optional_mfa_with_totp_and_password_policy" {
  command = apply

  variables {
    user_pool_name = "expiration-tracker-test"
  }

  assert {
    condition     = aws_cognito_user_pool.this.mfa_configuration == "OPTIONAL"
    error_message = "Default mfa_policy must map to OPTIONAL (CDK default, UNK-006 not resolved)"
  }

  assert {
    condition     = length(aws_cognito_user_pool.this.software_token_mfa_configuration) == 1
    error_message = "TOTP (software token) MFA must be configured when MFA is not OFF"
  }

  assert {
    condition     = aws_cognito_user_pool.this.password_policy[0].minimum_length == 12
    error_message = "Password minimum length must be 12"
  }

  assert {
    condition = alltrue([
      aws_cognito_user_pool.this.password_policy[0].require_lowercase,
      aws_cognito_user_pool.this.password_policy[0].require_uppercase,
      aws_cognito_user_pool.this.password_policy[0].require_numbers,
      aws_cognito_user_pool.this.password_policy[0].require_symbols,
    ])
    error_message = "Password policy must require lowercase, uppercase, numbers, and symbols"
  }
}

run "mfa_policy_off_disables_software_token_mfa" {
  command = apply

  variables {
    user_pool_name = "expiration-tracker-test-off"
    mfa_policy     = "OFF"
  }

  assert {
    condition     = aws_cognito_user_pool.this.mfa_configuration == "OFF"
    error_message = "mfa_policy=OFF must map to OFF"
  }

  assert {
    condition     = length(aws_cognito_user_pool.this.software_token_mfa_configuration) == 0
    error_message = "No software token MFA configuration should be present when MFA is OFF"
  }
}

run "mfa_policy_required_maps_to_on" {
  command = apply

  variables {
    user_pool_name = "expiration-tracker-test-required"
    mfa_policy     = "REQUIRED"
  }

  assert {
    condition     = aws_cognito_user_pool.this.mfa_configuration == "ON"
    error_message = "mfa_policy=REQUIRED must map to the provider's ON value"
  }
}

run "web_client_uses_srp_auth_and_generates_a_secret" {
  command = apply

  variables {
    user_pool_name = "expiration-tracker-test-client"
  }

  assert {
    condition     = contains(aws_cognito_user_pool_client.web_client.explicit_auth_flows, "ALLOW_USER_SRP_AUTH")
    error_message = "Web client must allow USER_SRP_AUTH"
  }

  assert {
    condition     = aws_cognito_user_pool_client.web_client.generate_secret == true
    error_message = "Web client must generate a secret (BFF session pattern)"
  }

  assert {
    condition     = aws_cognito_user_pool_client.web_client.access_token_validity == 15
    error_message = "Access token validity must be 15 minutes"
  }

  assert {
    condition     = aws_cognito_user_pool_client.web_client.refresh_token_validity == 30
    error_message = "Refresh token validity must be 30 days"
  }

  assert {
    condition     = aws_cognito_user_pool_client.web_client.prevent_user_existence_errors == "ENABLED"
    error_message = "prevent_user_existence_errors must be ENABLED"
  }

  assert {
    condition = alltrue([
      contains(aws_cognito_user_pool_client.web_client.allowed_oauth_scopes, "email"),
      contains(aws_cognito_user_pool_client.web_client.allowed_oauth_scopes, "openid"),
      contains(aws_cognito_user_pool_client.web_client.allowed_oauth_scopes, "profile"),
    ])
    error_message = "Web client must request email, openid, and profile OAuth scopes"
  }

  # D-054 (Full BFF hardening amendment): ALLOW_REFRESH_TOKEN_AUTH is mutually exclusive with
  # native refresh_token_rotation - a client with both would let a caller bypass rotation via
  # InitiateAuth directly instead of the Hosted UI's /oauth2/token endpoint.
  assert {
    condition     = !contains(aws_cognito_user_pool_client.web_client.explicit_auth_flows, "ALLOW_REFRESH_TOKEN_AUTH")
    error_message = "Web client must NOT allow REFRESH_TOKEN_AUTH directly - refresh_token_rotation requires the Hosted UI /oauth2/token endpoint to be the only refresh path"
  }

  assert {
    condition     = aws_cognito_user_pool_client.web_client.refresh_token_rotation[0].feature == "ENABLED"
    error_message = "Native Cognito refresh token rotation must be ENABLED (D-054 - replaces the fragile local rotation counter)"
  }

  assert {
    condition     = aws_cognito_user_pool_client.web_client.refresh_token_rotation[0].retry_grace_period_seconds == 30
    error_message = "Refresh token rotation grace period must be 30s, under which the BFF's own short-lived refresh lease operates"
  }
}

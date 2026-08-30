mock_provider "aws" {
  # Same fix already documented in infra/modules/api-gateway/tests: mock_provider's default
  # computed-attribute generator produces a random string, not a valid ARN, for
  # aws_apigatewayv2_api.execution_arn - but aws_lambda_permission.source_arn validates its
  # input looks like an ARN even under mock_provider.
  mock_resource "aws_apigatewayv2_api" {
    defaults = {
      execution_arn = "arn:aws:execute-api:us-east-1:123456789012:mockapiid"
    }
  }
}

run "every_bff_route_is_unauthenticated_at_the_gateway_layer" {
  command = apply

  variables {
    api_name          = "expiration-tracker-test-bff"
    bff_invoke_arn    = "arn:aws:lambda:us-east-1:123456789012:function:test-bff:live"
    bff_function_name = "test-bff"
    app_origin        = "https://app.example.com"
  }

  # BffAuthService is the real auth boundary (D-053/D-054) - a JWT authorizer in front of
  # these routes would be a contradiction (the callback route, for one, runs BEFORE any
  # session/token exists at all).
  assert {
    condition     = alltrue([for r in aws_apigatewayv2_route.bff : r.authorization_type == "NONE"])
    error_message = "Every /bff/* route must be unauthenticated at the API Gateway layer"
  }

  assert {
    condition     = length(aws_apigatewayv2_route.bff) == 10
    error_message = "Expected exactly 10 BFF routes (login, callback, session, logout, logout-all, organizations create, organizations list, organization select, invitations accept, proxy catch-all)"
  }
}

# Wave B2B-5 (D-095): POST /bff/organizations is the first real HTTP consumer of
# CreateOrganizationService (B2B-3/D-091) - authorized by identity alone inside the application
# handler (any valid session may call it, there is no Organization to be a member of yet at the
# moment of the call), never by API Gateway - same unauthenticated-at-the-gateway posture as
# every other /bff/* route, asserted generically by the run above but worth a route-specific
# existence check too (mirrors the proxy catch-all's own dedicated run below).
run "organizations_create_route_exists_for_the_first_onboarding_action" {
  command = apply

  variables {
    api_name          = "expiration-tracker-test-bff"
    bff_invoke_arn    = "arn:aws:lambda:us-east-1:123456789012:function:test-bff:live"
    bff_function_name = "test-bff"
    app_origin        = "https://app.example.com"
  }

  assert {
    condition     = aws_apigatewayv2_route.bff["organizations_create"].route_key == "POST /bff/organizations"
    error_message = "The POST /bff/organizations route must exist so a fresh login has a real way out of NO_TENANT_NO_MEMBERSHIP"
  }
}

# Wave B2B-14 (Operational Evidence, D-117): real finding - handleListOrganizations/
# handleSelectOrganization (bff-handlers.ts) have existed since Wave B2B-6/D-102, but these 2
# routes were never added here, unlike every other B2B-6 route (organizations_create). Every
# real GET /bff/organizations or POST /bff/organization/select returned API Gateway's own
# generic 404 (never reaching the Lambda) since that deploy - caught only by a real browser
# session (this environment's first), never by this test suite, because this exact class of
# existence check (route wiring, not authorization posture) was only ever written for
# organizations_create, not for its 2 siblings added in the very same wave.
run "organizations_list_and_select_routes_exist_for_multi_org_to_work_at_all" {
  command = apply

  variables {
    api_name          = "expiration-tracker-test-bff"
    bff_invoke_arn    = "arn:aws:lambda:us-east-1:123456789012:function:test-bff:live"
    bff_function_name = "test-bff"
    app_origin        = "https://app.example.com"
  }

  assert {
    condition     = aws_apigatewayv2_route.bff["organizations_list"].route_key == "GET /bff/organizations"
    error_message = "The GET /bff/organizations route must exist - handleListOrganizations has been unreachable without it since B2B-6"
  }

  assert {
    condition     = aws_apigatewayv2_route.bff["organization_select"].route_key == "POST /bff/organization/select"
    error_message = "The POST /bff/organization/select route must exist - handleSelectOrganization has been unreachable without it since B2B-6"
  }
}

# Wave B2B-14 (Operational Evidence, D-120): real finding, same class as the run above -
# handleAcceptInvitation (bff-handlers.ts) has existed since Wave B2B-8/D-099, but this route
# was never added here. Every real POST /bff/invitations/accept returned API Gateway's own
# generic 404 (never reaching the Lambda) since that deploy - caught only by building the
# frontend page that finally calls it for the first time.
run "invitations_accept_route_exists_for_the_invite_flow_to_ever_complete" {
  command = apply

  variables {
    api_name          = "expiration-tracker-test-bff"
    bff_invoke_arn    = "arn:aws:lambda:us-east-1:123456789012:function:test-bff:live"
    bff_function_name = "test-bff"
    app_origin        = "https://app.example.com"
  }

  assert {
    condition     = aws_apigatewayv2_route.bff["invitations_accept"].route_key == "POST /bff/invitations/accept"
    error_message = "The POST /bff/invitations/accept route must exist - handleAcceptInvitation has been unreachable without it since B2B-8"
  }
}

run "proxy_catch_all_route_exists_for_the_application_level_allowlist" {
  command = apply

  variables {
    api_name          = "expiration-tracker-test-bff"
    bff_invoke_arn    = "arn:aws:lambda:us-east-1:123456789012:function:test-bff:live"
    bff_function_name = "test-bff"
    app_origin        = "https://app.example.com"
  }

  assert {
    condition     = aws_apigatewayv2_route.bff["proxy_catch"].route_key == "ANY /bff/api/{proxy+}"
    error_message = "The proxy catch-all route must exist - allowlist enforcement happens in application code (src/modules/bff/domain/proxy-allowlist.ts), never at the API Gateway layer"
  }
}

run "throttling_is_more_conservative_than_the_jwt_protected_api_default" {
  command = apply

  variables {
    api_name          = "expiration-tracker-test-bff"
    bff_invoke_arn    = "arn:aws:lambda:us-east-1:123456789012:function:test-bff:live"
    bff_function_name = "test-bff"
    app_origin        = "https://app.example.com"
  }

  assert {
    condition     = aws_apigatewayv2_stage.default.default_route_settings[0].throttling_rate_limit <= 10
    error_message = "Unauthenticated BFF routes must throttle at least as conservatively as /guest/* does in infra/modules/api-gateway (D-051)"
  }
}

# ADR-0011 (achado real da Rodada 5 do protocolo Claude<->Codex): a config de CORS de
# fallback (dev/invocação direta - produção via CloudFront é same-origin) tinha 3 gaps reais
# contra frontend/src/api/client.ts: faltavam Idempotency-Key/If-Match e PATCH. Testa o
# conjunto completo, allow_credentials e allow_origins juntos - testar só headers/métodos
# permitiria uma regressão silenciosa em allow_credentials ou allow_origins (ex. wildcard).
run "cors_matches_every_header_method_and_credential_client_ts_actually_sends" {
  command = apply

  variables {
    api_name          = "expiration-tracker-test-bff"
    bff_invoke_arn    = "arn:aws:lambda:us-east-1:123456789012:function:test-bff:live"
    bff_function_name = "test-bff"
    app_origin        = "https://app.example.com"
  }

  assert {
    condition = alltrue([
      for h in ["Content-Type", "X-CSRF-Token", "Idempotency-Key", "If-Match"] :
      contains(aws_apigatewayv2_api.bff.cors_configuration[0].allow_headers, h)
    ])
    error_message = "CORS allow_headers must include every header client.ts sends: Content-Type, X-CSRF-Token, Idempotency-Key, If-Match"
  }

  assert {
    condition = alltrue([
      for m in ["GET", "POST", "PUT", "PATCH", "DELETE"] :
      contains(aws_apigatewayv2_api.bff.cors_configuration[0].allow_methods, m)
    ])
    error_message = "CORS allow_methods must include every method client.ts's MUTATING_METHODS + GET can send, including PATCH"
  }

  assert {
    condition     = aws_apigatewayv2_api.bff.cors_configuration[0].allow_credentials == true
    error_message = "allow_credentials must stay true - the session cookie IS the credential (D-053)"
  }

  assert {
    condition     = tolist(aws_apigatewayv2_api.bff.cors_configuration[0].allow_origins) == tolist([var.app_origin])
    error_message = "allow_origins must be the explicit app_origin, never a wildcard - required for allow_credentials=true to even be valid per the CORS spec"
  }
}

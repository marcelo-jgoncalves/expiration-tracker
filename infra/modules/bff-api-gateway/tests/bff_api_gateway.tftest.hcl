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
    condition     = length(aws_apigatewayv2_route.bff) == 6
    error_message = "Expected exactly 6 BFF routes (login, callback, session, logout, logout-all, proxy catch-all)"
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

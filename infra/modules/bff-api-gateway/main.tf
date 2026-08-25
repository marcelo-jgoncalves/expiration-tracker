# Dedicated HTTP API for the Full BFF (D-053/D-054) - deliberately SEPARATE from
# infra/modules/api-gateway (the JWT-authorizer-protected resource API). Every route here has
# `authorization_type = "NONE"` at the API Gateway layer, same posture as the existing public
# /guest/* routes (infra/modules/api-gateway) - these routes ARE the authentication boundary
# itself (BffAuthService does its own cookie/CSRF verification), so a JWT authorizer in front
# of them would be a contradiction, not a second layer of defense.
#
# In production this API sits behind CloudFront at the same origin as the static SPA
# (`/bff/*` path pattern routed here, everything else to S3) - same-origin is a hard
# requirement for the session cookie to work at all without CORS gymnastics. This module
# itself has no CloudFront dependency (kept separate, added when the CloudFront module is
# wired at the root), so it also has to expose a working CORS config for local/direct-invoke
# development against var.app_origin.

resource "aws_apigatewayv2_api" "bff" {
  name          = var.api_name
  protocol_type = "HTTP"
  description   = "Expiration Tracker Full BFF (D-053/D-054) - session/auth boundary, never JWT-protected"

  # ADR-0011 (achado real da revisão): faltavam Idempotency-Key/If-Match (client.ts já os
  # envia desde CREATE-IDEMPOTENCY-01/OCC) e PATCH (MUTATING_METHODS de client.ts trata PATCH
  # como mutação mesmo sem uso atual). Só afeta o fallback de dev/invocação direta - produção
  # via CloudFront é same-origin e não passa por esta config (ver comentário no topo do arquivo).
  cors_configuration {
    allow_origins     = [var.app_origin]
    allow_methods     = ["GET", "POST", "PUT", "PATCH", "DELETE"]
    allow_headers     = ["Content-Type", "X-CSRF-Token", "Idempotency-Key", "If-Match"]
    allow_credentials = true
  }

  tags = var.tags
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.bff.id
  name        = "$default"
  auto_deploy = true
  tags        = var.tags

  # Every route here is unauthenticated at the API Gateway layer (BffAuthService is the real
  # auth boundary) - throttle more conservatively than the JWT-protected API's default
  # (infra/modules/api-gateway), same rationale D-051 already applied to /guest/*.
  default_route_settings {
    throttling_burst_limit = 20
    throttling_rate_limit  = 10
  }
}

resource "aws_apigatewayv2_integration" "bff" {
  api_id                 = aws_apigatewayv2_api.bff.id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.bff_invoke_arn
  payload_format_version = "2.0"
}

locals {
  bff_routes = {
    login       = { method = "GET", path = "/bff/login" }
    callback    = { method = "GET", path = "/bff/callback" }
    session     = { method = "GET", path = "/bff/session" }
    logout      = { method = "POST", path = "/bff/session/logout" }
    logout_all  = { method = "POST", path = "/bff/session/logout-all" }
    proxy_catch = { method = "ANY", path = "/bff/api/{proxy+}" } # allowlist enforcement happens in application code (src/modules/bff/domain/proxy-allowlist.ts), never at this layer
  }
}

resource "aws_apigatewayv2_route" "bff" {
  for_each = local.bff_routes

  api_id             = aws_apigatewayv2_api.bff.id
  route_key          = "${each.value.method} ${each.value.path}"
  target             = "integrations/${aws_apigatewayv2_integration.bff.id}"
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "bff" {
  statement_id  = "AllowApiGatewayInvokeBff"
  action        = "lambda:InvokeFunction"
  function_name = var.bff_function_name
  principal     = "apigateway.amazonaws.com"
  qualifier     = "live"
  source_arn    = "${aws_apigatewayv2_api.bff.execution_arn}/*/*/bff*"
}

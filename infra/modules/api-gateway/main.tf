# HTTP API (API Gateway v2) — Terraform equivalent of infra/lib/api.ts (ADR-0009). One JWT
# authorizer (issuer = the Cognito User Pool, audience = the web app client) protects every
# route below, mirroring the CDK construct's single `authorizers.HttpJwtAuthorizer` reused
# across /test/ping, /items*, and /reminders/policies*.

resource "aws_apigatewayv2_api" "this" {
  name          = var.api_name
  protocol_type = "HTTP"
  description   = "Expiration Tracker API (ADR-0009 Terraform migration)"

  cors_configuration {
    allow_origins     = var.cors_allow_origins
    allow_methods     = ["GET", "POST", "PUT", "DELETE"]
    allow_headers     = ["Content-Type", "Authorization"]
    allow_credentials = true
  }

  tags = var.tags
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true
  tags        = var.tags
}

resource "aws_apigatewayv2_authorizer" "jwt" {
  api_id           = aws_apigatewayv2_api.this.id
  name             = "JwtAuthorizer"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    audience = [var.user_pool_client_id]
    issuer   = "https://cognito-idp.${var.aws_region}.amazonaws.com/${var.user_pool_id}"
  }
}

# --- TestPingHandler: GET /test/ping (M1 exit-criterion route) -------------------------

resource "aws_apigatewayv2_integration" "test_ping" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.test_ping_invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "test_ping" {
  api_id             = aws_apigatewayv2_api.this.id
  route_key          = "GET /test/ping"
  target             = "integrations/${aws_apigatewayv2_integration.test_ping.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
}

resource "aws_lambda_permission" "test_ping" {
  statement_id  = "AllowApiGatewayInvokeTestPing"
  action        = "lambda:InvokeFunction"
  function_name = var.test_ping_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*/test/ping"
}

# --- ItemsHandler: /items* (M2) ---------------------------------------------------------

resource "aws_apigatewayv2_integration" "items" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.items_invoke_arn
  payload_format_version = "2.0"
}

locals {
  items_routes = {
    create    = { method = "POST", path = "/items" }
    dashboard = { method = "GET", path = "/items/dashboard" }
    get_by_id = { method = "GET", path = "/items/{itemId}" }
    update    = { method = "PUT", path = "/items/{itemId}" }
    delete    = { method = "DELETE", path = "/items/{itemId}" }
    archive   = { method = "POST", path = "/items/{itemId}/archive" }
    renew     = { method = "POST", path = "/items/{itemId}/renew" }
  }

  reminders_routes = {
    create  = { method = "POST", path = "/reminders/policies" }
    get     = { method = "GET", path = "/reminders/policies/{policyId}" }
    update  = { method = "PUT", path = "/reminders/policies/{policyId}" }
    disable = { method = "POST", path = "/reminders/policies/{policyId}/disable" }
  }
}

resource "aws_apigatewayv2_route" "items" {
  for_each = local.items_routes

  api_id             = aws_apigatewayv2_api.this.id
  route_key          = "${each.value.method} ${each.value.path}"
  target             = "integrations/${aws_apigatewayv2_integration.items.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
}

resource "aws_lambda_permission" "items" {
  statement_id  = "AllowApiGatewayInvokeItems"
  action        = "lambda:InvokeFunction"
  function_name = var.items_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*/items*"
}

# --- RemindersHandler: /reminders/policies* (M3) ----------------------------------------

resource "aws_apigatewayv2_integration" "reminders" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.reminders_invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "reminders" {
  for_each = local.reminders_routes

  api_id             = aws_apigatewayv2_api.this.id
  route_key          = "${each.value.method} ${each.value.path}"
  target             = "integrations/${aws_apigatewayv2_integration.reminders.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
}

resource "aws_lambda_permission" "reminders" {
  statement_id  = "AllowApiGatewayInvokeReminders"
  action        = "lambda:InvokeFunction"
  function_name = var.reminders_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*/reminders/policies*"
}

# --- NotificationsHandler: /notifications/preferences (M4 backlog item) -----------------

resource "aws_apigatewayv2_integration" "notifications" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.notifications_invoke_arn
  payload_format_version = "2.0"
}

locals {
  notifications_routes = {
    get    = { method = "GET", path = "/notifications/preferences" }
    update = { method = "PUT", path = "/notifications/preferences" }
  }
}

resource "aws_apigatewayv2_route" "notifications" {
  for_each = local.notifications_routes

  api_id             = aws_apigatewayv2_api.this.id
  route_key          = "${each.value.method} ${each.value.path}"
  target             = "integrations/${aws_apigatewayv2_integration.notifications.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
}

resource "aws_lambda_permission" "notifications" {
  statement_id  = "AllowApiGatewayInvokeNotifications"
  action        = "lambda:InvokeFunction"
  function_name = var.notifications_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*/notifications/preferences"
}

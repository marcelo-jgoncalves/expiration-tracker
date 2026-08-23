# Recreates the acceptance criteria implied by infra/lib/api.ts as native `terraform test`
# assertions. mock_provider — no real AWS credentials/resources needed.

mock_provider "aws" {
  # The default mock_provider computed-attribute generator produces a random string, not a
  # valid ARN, for aws_apigatewayv2_api.execution_arn — but aws_lambda_permission.source_arn
  # validates its input looks like an ARN even under mock_provider (same issue documented in
  # the lambda-function/reminder-schedule modules' tests). Override with a realistic value.
  mock_resource "aws_apigatewayv2_api" {
    defaults = {
      execution_arn = "arn:aws:execute-api:us-east-1:123456789012:mockapiid"
    }
  }
}

run "jwt_authorizer_attached_to_every_route" {
  command = apply

  variables {
    api_name                    = "expiration-tracker-test-api"
    user_pool_id                = "us-east-1_testpool"
    user_pool_client_id         = "test-client-id"
    aws_region                  = "us-east-1"
    test_ping_invoke_arn        = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:123456789012:function:test-ping/invocations"
    test_ping_function_name     = "test-ping"
    items_invoke_arn            = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:123456789012:function:items/invocations"
    items_function_name         = "items"
    reminders_invoke_arn        = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:123456789012:function:reminders/invocations"
    reminders_function_name     = "reminders"
    notifications_invoke_arn    = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:123456789012:function:notifications/invocations"
    notifications_function_name = "notifications"
    documents_invoke_arn        = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:123456789012:function:documents/invocations"
    documents_function_name     = "documents"
    subjects_invoke_arn         = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:123456789012:function:subjects/invocations"
    subjects_function_name      = "subjects"
  }

  assert {
    condition     = aws_apigatewayv2_authorizer.jwt.authorizer_type == "JWT"
    error_message = "Authorizer must be a JWT authorizer (Cognito, not Lambda-custom)"
  }

  assert {
    condition     = aws_apigatewayv2_authorizer.jwt.jwt_configuration[0].issuer == "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_testpool"
    error_message = "JWT issuer must be the Cognito User Pool URL"
  }

  assert {
    condition     = contains(aws_apigatewayv2_authorizer.jwt.jwt_configuration[0].audience, "test-client-id")
    error_message = "JWT audience must include the User Pool Client ID"
  }

  assert {
    condition     = aws_apigatewayv2_route.test_ping.route_key == "GET /test/ping"
    error_message = "The M1 exit-criterion route (GET /test/ping) must exist"
  }

  assert {
    condition     = aws_apigatewayv2_route.test_ping.authorization_type == "JWT"
    error_message = "GET /test/ping must be JWT-authorized"
  }

  assert {
    condition     = aws_apigatewayv2_route.test_ping.authorizer_id == aws_apigatewayv2_authorizer.jwt.id
    error_message = "GET /test/ping must use the shared JWT authorizer"
  }

  # Every /items* route exists and is JWT-authorized with the same authorizer.
  assert {
    condition = alltrue([
      for r in aws_apigatewayv2_route.items : r.authorization_type == "JWT" && r.authorizer_id == aws_apigatewayv2_authorizer.jwt.id
    ])
    error_message = "Every /items* route must be JWT-authorized with the shared authorizer"
  }

  assert {
    condition     = length(aws_apigatewayv2_route.items) == 10
    error_message = "Expected exactly 10 /items* routes (create, dashboard, get, update, delete, archive, renew, add_watcher, remove_watcher, list_watchers)"
  }

  assert {
    condition = contains(
      [for r in aws_apigatewayv2_route.items : r.route_key],
      "GET /items/dashboard",
    )
    error_message = "GET /items/dashboard route must exist"
  }

  # Every /reminders/policies* route exists and is JWT-authorized.
  assert {
    condition = alltrue([
      for r in aws_apigatewayv2_route.reminders : r.authorization_type == "JWT" && r.authorizer_id == aws_apigatewayv2_authorizer.jwt.id
    ])
    error_message = "Every /reminders/policies* route must be JWT-authorized with the shared authorizer"
  }

  assert {
    condition     = length(aws_apigatewayv2_route.reminders) == 4
    error_message = "Expected exactly 4 /reminders/policies* routes (create, get, update, disable)"
  }

  assert {
    condition = contains(
      [for r in aws_apigatewayv2_route.reminders : r.route_key],
      "POST /reminders/policies/{policyId}/disable",
    )
    error_message = "POST /reminders/policies/{policyId}/disable route must exist"
  }

  # Every /notifications/preferences route exists and is JWT-authorized.
  assert {
    condition = alltrue([
      for r in aws_apigatewayv2_route.notifications : r.authorization_type == "JWT" && r.authorizer_id == aws_apigatewayv2_authorizer.jwt.id
    ])
    error_message = "Every /notifications/preferences route must be JWT-authorized with the shared authorizer"
  }

  assert {
    condition     = length(aws_apigatewayv2_route.notifications) == 2
    error_message = "Expected exactly 2 /notifications/preferences routes (get, update)"
  }

  assert {
    condition = contains(
      [for r in aws_apigatewayv2_route.notifications : r.route_key],
      "PUT /notifications/preferences",
    )
    error_message = "PUT /notifications/preferences route must exist"
  }

  # Rollback design entrega 1: every invoke permission must be scoped to the `live` alias,
  # never the unqualified function ($LATEST) - required for an emergency alias repoint to
  # actually change what a real API Gateway request invokes.
  assert {
    condition     = aws_lambda_permission.test_ping.qualifier == "live"
    error_message = "TestPingHandler invoke permission must be scoped to the 'live' alias"
  }

  assert {
    condition     = aws_lambda_permission.items.qualifier == "live"
    error_message = "ItemsHandler invoke permission must be scoped to the 'live' alias"
  }

  assert {
    condition     = aws_lambda_permission.reminders.qualifier == "live"
    error_message = "RemindersHandler invoke permission must be scoped to the 'live' alias"
  }

  assert {
    condition     = aws_lambda_permission.notifications.qualifier == "live"
    error_message = "NotificationsHandler invoke permission must be scoped to the 'live' alias"
  }

  assert {
    condition     = aws_lambda_permission.documents.qualifier == "live"
    error_message = "DocumentsHandler invoke permission must be scoped to the 'live' alias"
  }

  assert {
    condition     = aws_lambda_permission.subjects.qualifier == "live"
    error_message = "SubjectsHandler invoke permission must be scoped to the 'live' alias"
  }

  # Every /items/{itemId}/documents* route exists and is JWT-authorized (M6).
  assert {
    condition = alltrue([
      for r in aws_apigatewayv2_route.documents : r.authorization_type == "JWT" && r.authorizer_id == aws_apigatewayv2_authorizer.jwt.id
    ])
    error_message = "Every /items/{itemId}/documents* route must be JWT-authorized with the shared authorizer"
  }

  assert {
    condition     = length(aws_apigatewayv2_route.documents) == 2
    error_message = "Expected exactly 2 /items/{itemId}/documents* routes (reserve upload, delete)"
  }

  assert {
    condition = contains(
      [for r in aws_apigatewayv2_route.documents : r.route_key],
      "DELETE /items/{itemId}/documents/{documentId}",
    )
    error_message = "DELETE /items/{itemId}/documents/{documentId} route must exist"
  }

  # Every /subjects* route exists and is JWT-authorized (M9, D-036/D-040).
  assert {
    condition = alltrue([
      for r in aws_apigatewayv2_route.subjects : r.authorization_type == "JWT" && r.authorizer_id == aws_apigatewayv2_authorizer.jwt.id
    ])
    error_message = "Every /subjects* route must be JWT-authorized with the shared authorizer"
  }

  assert {
    condition     = length(aws_apigatewayv2_route.subjects) == 13
    error_message = "Expected exactly 13 /subjects* routes (create, dashboard, get, update, delete, archive, assign_req, list_req, get_req, update_req, delete_req, link_item, unlink_item)"
  }

  assert {
    condition = contains(
      [for r in aws_apigatewayv2_route.subjects : r.route_key],
      "POST /subjects/{subjectId}/requirements/{assignmentId}/link",
    )
    error_message = "POST /subjects/{subjectId}/requirements/{assignmentId}/link route must exist"
  }
}

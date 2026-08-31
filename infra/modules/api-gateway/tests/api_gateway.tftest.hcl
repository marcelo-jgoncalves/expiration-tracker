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
    api_name                      = "expiration-tracker-test-api"
    user_pool_id                  = "us-east-1_testpool"
    user_pool_client_id           = "test-client-id"
    aws_region                    = "us-east-1"
    test_ping_invoke_arn          = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:123456789012:function:test-ping/invocations"
    test_ping_function_name       = "test-ping"
    items_invoke_arn              = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:123456789012:function:items/invocations"
    items_function_name           = "items"
    reminders_invoke_arn          = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:123456789012:function:reminders/invocations"
    reminders_function_name       = "reminders"
    notifications_invoke_arn      = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:123456789012:function:notifications/invocations"
    notifications_function_name   = "notifications"
    profile_invoke_arn            = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:123456789012:function:profile/invocations"
    profile_function_name         = "profile"
    documents_invoke_arn          = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:123456789012:function:documents/invocations"
    documents_function_name       = "documents"
    subjects_invoke_arn           = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:123456789012:function:subjects/invocations"
    subjects_function_name        = "subjects"
    memberships_invoke_arn        = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:123456789012:function:memberships/invocations"
    memberships_function_name     = "memberships"
    guest_documents_invoke_arn    = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:123456789012:function:guest-documents/invocations"
    guest_documents_function_name = "guest-documents"
    imports_invoke_arn            = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:123456789012:function:imports/invocations"
    imports_function_name         = "imports"
    export_invoke_arn             = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:123456789012:function:export/invocations"
    export_function_name          = "export"
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

  # D-123/D-126 (CSV data export): GET /items/export is wired as its own dedicated route,
  # never merged into aws_apigatewayv2_route.items — the same class of bug D-117/D-120 fixed
  # (a route never wired to API Gateway) would recur if this were forgotten.
  assert {
    condition     = aws_apigatewayv2_route.export.route_key == "GET /items/export"
    error_message = "GET /items/export route must exist"
  }

  assert {
    condition     = aws_apigatewayv2_route.export.authorization_type == "JWT" && aws_apigatewayv2_route.export.authorizer_id == aws_apigatewayv2_authorizer.jwt.id
    error_message = "GET /items/export must be JWT-authorized with the shared authorizer"
  }

  assert {
    condition     = aws_lambda_permission.export.qualifier == "live"
    error_message = "ExportHandler's invoke permission must target the live alias, not $LATEST"
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

  # Every /profile route exists and is JWT-authorized (W5-01/GTR-01, D-060).
  assert {
    condition = alltrue([
      for r in aws_apigatewayv2_route.profile : r.authorization_type == "JWT" && r.authorizer_id == aws_apigatewayv2_authorizer.jwt.id
    ])
    error_message = "Every /profile route must be JWT-authorized with the shared authorizer"
  }

  assert {
    condition     = length(aws_apigatewayv2_route.profile) == 2
    error_message = "Expected exactly 2 /profile routes (get, update)"
  }

  assert {
    condition = contains(
      [for r in aws_apigatewayv2_route.profile : r.route_key],
      "PUT /profile",
    )
    error_message = "PUT /profile route must exist"
  }

  assert {
    condition     = aws_lambda_permission.profile.qualifier == "live"
    error_message = "ProfileHandler invoke permission must be scoped to the 'live' alias"
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
    condition     = length(aws_apigatewayv2_route.documents) == 6
    error_message = "Expected exactly 6 /items/{itemId}/documents* routes (reserve upload, list, get, delete, M7 confirm/reject)"
  }

  assert {
    condition = contains(
      [for r in aws_apigatewayv2_route.documents : r.route_key],
      "DELETE /items/{itemId}/documents/{documentId}",
    )
    error_message = "DELETE /items/{itemId}/documents/{documentId} route must exist"
  }

  # BLOCKER-A: read routes exist (docs/architecture reminder-delivery-pipeline.md's sibling
  # blocker — no route previously read/listed Document/DocumentSubmission).
  assert {
    condition = contains(
      [for r in aws_apigatewayv2_route.documents : r.route_key],
      "GET /items/{itemId}/documents",
    )
    error_message = "GET /items/{itemId}/documents route must exist"
  }

  assert {
    condition = contains(
      [for r in aws_apigatewayv2_route.documents : r.route_key],
      "GET /items/{itemId}/documents/{documentId}",
    )
    error_message = "GET /items/{itemId}/documents/{documentId} route must exist"
  }

  # Every /subjects* route exists and is JWT-authorized (M9, D-036/D-040).
  assert {
    condition = alltrue([
      for r in aws_apigatewayv2_route.subjects : r.authorization_type == "JWT" && r.authorizer_id == aws_apigatewayv2_authorizer.jwt.id
    ])
    error_message = "Every /subjects* route must be JWT-authorized with the shared authorizer"
  }

  assert {
    condition     = length(aws_apigatewayv2_route.subjects) == 21
    error_message = "Expected exactly 21 /subjects* routes (create, dashboard, get, update, delete, archive, assign_req, list_req, get_req, update_req, delete_req, link_item, unlink_item, create/list/get/revoke_document_request, get/update_delivery_preference, list/get_submission)"
  }

  # BLOCKER-A (segunda metade, 2026-08-25): DocumentSubmission read routes.
  assert {
    condition = contains(
      [for r in aws_apigatewayv2_route.subjects : r.route_key],
      "GET /subjects/{subjectId}/requirements/{assignmentId}/submissions",
    )
    error_message = "GET .../submissions route (list) must exist"
  }

  assert {
    condition = contains(
      [for r in aws_apigatewayv2_route.subjects : r.route_key],
      "GET /subjects/{subjectId}/requirements/{assignmentId}/submissions/{submissionId}",
    )
    error_message = "GET .../submissions/{submissionId} route (get) must exist"
  }

  assert {
    condition = contains(
      [for r in aws_apigatewayv2_route.subjects : r.route_key],
      "POST /subjects/{subjectId}/requirements/{assignmentId}/document-requests",
    )
    error_message = "POST .../document-requests route (create) must exist - achado real, faltava desde a sessão M10 anterior"
  }

  assert {
    condition = contains(
      [for r in aws_apigatewayv2_route.subjects : r.route_key],
      "GET /subjects/document-request-delivery-preference",
    )
    error_message = "GET /subjects/document-request-delivery-preference route must exist (D-049)"
  }

  assert {
    condition = contains(
      [for r in aws_apigatewayv2_route.subjects : r.route_key],
      "POST /subjects/{subjectId}/requirements/{assignmentId}/link",
    )
    error_message = "POST /subjects/{subjectId}/requirements/{assignmentId}/link route must exist"
  }

  # Every /organizations/members*, /organizations/invitations* route exists and is
  # JWT-authorized (Wave B2B-8, D-099).
  assert {
    condition = alltrue([
      for r in aws_apigatewayv2_route.memberships : r.authorization_type == "JWT" && r.authorizer_id == aws_apigatewayv2_authorizer.jwt.id
    ])
    error_message = "Every /organizations/members*, /organizations/invitations* route must be JWT-authorized with the shared authorizer"
  }

  assert {
    condition     = length(aws_apigatewayv2_route.memberships) == 9
    error_message = "Expected exactly 9 memberships routes (invite, revoke_invitation, list_members, list_invitations, change_role, remove_member, leave, update_settings, close_organization)"
  }

  # W3-07 (D-124): the organization-closure route. This assertion exists specifically because
  # D-117 and D-120 were both REAL production bugs of exactly one shape - a handler shipped and
  # its API Gateway route silently never added, so every call returned the gateway's own 404
  # without ever reaching the Lambda, undetected until a human clicked the button months later.
  # A dedicated assertion, not just the count above, so the failure message names the cause.
  assert {
    condition = contains(
      [for r in aws_apigatewayv2_route.memberships : r.route_key],
      "POST /organizations/close",
    )
    error_message = "POST /organizations/close route must exist - CloseOrganizationService is unreachable without it (D-117/D-120 bug class)"
  }

  # Wave B2B-10 (Tenant-aware Frontend, "settings" scope item) - same Lambda, new route.
  assert {
    condition = contains(
      [for r in aws_apigatewayv2_route.memberships : r.route_key],
      "PATCH /organizations/settings",
    )
    error_message = "PATCH /organizations/settings route must exist"
  }

  assert {
    condition = contains(
      [for r in aws_apigatewayv2_route.memberships : r.route_key],
      "DELETE /organizations/members/{userId}",
    )
    error_message = "DELETE /organizations/members/{userId} route must exist"
  }

  assert {
    condition = contains(
      [for r in aws_apigatewayv2_route.memberships : r.route_key],
      "POST /organizations/members/leave",
    )
    error_message = "POST /organizations/members/leave route must exist"
  }

  # /guest/document-requests/* routes (M10, D-037) are the project's first PUBLIC routes —
  # no JWT authorizer, auth happens inside the handler via the opaque guest token.
  assert {
    condition = alltrue([
      for r in aws_apigatewayv2_route.guest_documents : r.authorization_type == "NONE"
    ])
    error_message = "Every /guest/document-requests/* route must be public (authorization_type = NONE) — auth happens via the opaque guest token inside the handler, not API Gateway"
  }

  assert {
    condition     = length(aws_apigatewayv2_route.guest_documents) == 2
    error_message = "Expected exactly 2 /guest/document-requests/* routes (get_request, start_submission)"
  }

  assert {
    condition = contains(
      [for r in aws_apigatewayv2_route.guest_documents : r.route_key],
      "POST /guest/document-requests/{token}/uploads",
    )
    error_message = "POST /guest/document-requests/{token}/uploads route must exist"
  }

  assert {
    condition     = aws_lambda_permission.guest_documents.qualifier == "live"
    error_message = "GuestDocumentsHandler invoke permission must be scoped to the 'live' alias"
  }

  # D-051: WAFv2 can't associate with an HTTP API (real deploy finding) - native throttling is
  # the interim compensating control, tighter on the 2 public/unauthenticated guest routes than
  # the stage default.
  assert {
    condition     = aws_apigatewayv2_stage.default.default_route_settings[0].throttling_burst_limit == 50 && aws_apigatewayv2_stage.default.default_route_settings[0].throttling_rate_limit == 25
    error_message = "Stage default throttle must be burst=50/rate=25 (D-051)"
  }

  assert {
    condition = alltrue([
      for rs in aws_apigatewayv2_stage.default.route_settings : rs.throttling_burst_limit == 10 && rs.throttling_rate_limit == 5
      if contains(["GET /guest/document-requests/{token}", "POST /guest/document-requests/{token}/uploads"], rs.route_key)
    ])
    error_message = "Both /guest/* routes must have the tighter burst=10/rate=5 throttle (D-051)"
  }

  assert {
    condition = length([
      for rs in aws_apigatewayv2_stage.default.route_settings : rs
      if contains(["GET /guest/document-requests/{token}", "POST /guest/document-requests/{token}/uploads"], rs.route_key)
    ]) == 2
    error_message = "Expected exactly 2 route-level throttle settings, one per /guest/* route"
  }

  # Every /imports* route exists and is JWT-authorized (M11, D-042).
  assert {
    condition = alltrue([
      for r in aws_apigatewayv2_route.imports : r.authorization_type == "JWT" && r.authorizer_id == aws_apigatewayv2_authorizer.jwt.id
    ])
    error_message = "Every /imports* route must be JWT-authorized with the shared authorizer"
  }

  assert {
    condition     = length(aws_apigatewayv2_route.imports) == 3
    error_message = "Expected exactly 3 /imports* routes (reserve, get, commit)"
  }

  assert {
    condition = contains(
      [for r in aws_apigatewayv2_route.imports : r.route_key],
      "POST /imports/{jobId}/commit",
    )
    error_message = "POST /imports/{jobId}/commit route must exist"
  }

  assert {
    condition     = aws_lambda_permission.imports.qualifier == "live"
    error_message = "ImportsHandler invoke permission must be scoped to the 'live' alias"
  }
}

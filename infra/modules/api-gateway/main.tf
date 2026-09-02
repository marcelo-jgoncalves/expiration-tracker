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

  # D-051: throttling nativo do HTTP API nunca tinha sido configurado (nem para as rotas
  # JWT-protegidas) - default conservador aplicado a todo o stage; as 2 rotas públicas
  # /guest/* recebem um `route_settings` mais restritivo abaixo, já que são as únicas sem
  # autenticação JWT (HTTP API v2 não tem um recurso `aws_apigatewayv2_route_settings`
  # separado - é um bloco aninhado repetível dentro do próprio stage).
  default_route_settings {
    throttling_burst_limit = 50
    throttling_rate_limit  = 25
  }

  dynamic "route_settings" {
    for_each = local.guest_documents_routes
    content {
      route_key              = "${route_settings.value.method} ${route_settings.value.path}"
      throttling_burst_limit = 10
      throttling_rate_limit  = 5
    }
  }
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
  qualifier     = "live"
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
    # D-040 (07-domain-model-escalation-watchers-digest.md): ItemWatch reaproveita o mesmo
    # Lambda/integracao de ItemsHandler, nao introduz funcao/infra nova.
    add_watcher    = { method = "POST", path = "/items/{itemId}/watchers/{userId}" }
    remove_watcher = { method = "DELETE", path = "/items/{itemId}/watchers/{userId}" }
    list_watchers  = { method = "GET", path = "/items/{itemId}/watchers" }
    # D-149 (admin-activity-log-scoping/estado-final-consolidado.md): tenant-facing read,
    # same ItemsHandler Lambda/integration (no new function) - activity:read RBAC gates it
    # at the ActivityService layer, same as every other route sharing this integration.
    list_activity = { method = "GET", path = "/activity" }
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
  qualifier     = "live"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*/items*"
}

# D-149: GET /activity does not live under /items*, so it needs its own invoke permission
# even though it shares the same ItemsHandler Lambda/integration as the routes above.
resource "aws_lambda_permission" "items_activity" {
  statement_id  = "AllowApiGatewayInvokeItemsActivity"
  action        = "lambda:InvokeFunction"
  function_name = var.items_function_name
  principal     = "apigateway.amazonaws.com"
  qualifier     = "live"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*/activity"
}

# --- ExportHandler: GET /items/export (D-123/D-126, CSV data export) -------------------
# Own integration/Lambda, not folded into aws_apigatewayv2_integration.items above — see
# export-handler.ts's own comment for why (dedicated timeout_seconds=25). Same literal-vs-
# parameterized-path precedent as "GET /items/dashboard" already living alongside
# "GET /items/{itemId}" — API Gateway v2 prioritizes the literal segment.

resource "aws_apigatewayv2_integration" "export" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.export_invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "export" {
  api_id             = aws_apigatewayv2_api.this.id
  route_key          = "GET /items/export"
  target             = "integrations/${aws_apigatewayv2_integration.export.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
}

resource "aws_lambda_permission" "export" {
  statement_id  = "AllowApiGatewayInvokeExport"
  action        = "lambda:InvokeFunction"
  function_name = var.export_function_name
  principal     = "apigateway.amazonaws.com"
  qualifier     = "live"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*/items/export"
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
  qualifier     = "live"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*/reminders/policies*"
}

# --- DocumentsHandler: /items/{itemId}/documents* (M6) ----------------------------------

resource "aws_apigatewayv2_integration" "documents" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.documents_invoke_arn
  payload_format_version = "2.0"
}

locals {
  documents_routes = {
    reserve_upload = { method = "POST", path = "/items/{itemId}/documents" }
    list           = { method = "GET", path = "/items/{itemId}/documents" }
    get            = { method = "GET", path = "/items/{itemId}/documents/{documentId}" }
    delete         = { method = "DELETE", path = "/items/{itemId}/documents/{documentId}" }
    # M7 item 8 (§1.7): confirm/reject routes for a PENDING_CONFIRMATION ExtractedField - same
    # Lambda/integration as every other /items/{itemId}/documents* route above (documents_handler
    # already has full read/write table access), no new Lambda/infra needed.
    confirm_field = { method = "POST", path = "/items/{itemId}/documents/{documentId}/extractions/{runId}/fields/{fieldName}/confirm" }
    reject_field  = { method = "POST", path = "/items/{itemId}/documents/{documentId}/extractions/{runId}/fields/{fieldName}/reject" }
  }
}

resource "aws_apigatewayv2_route" "documents" {
  for_each = local.documents_routes

  api_id             = aws_apigatewayv2_api.this.id
  route_key          = "${each.value.method} ${each.value.path}"
  target             = "integrations/${aws_apigatewayv2_integration.documents.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
}

resource "aws_lambda_permission" "documents" {
  statement_id  = "AllowApiGatewayInvokeDocuments"
  action        = "lambda:InvokeFunction"
  function_name = var.documents_function_name
  principal     = "apigateway.amazonaws.com"
  qualifier     = "live"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*/items/*/documents*"
}

# --- SubjectsHandler: /subjects* (M9, D-036/D-040 - TrackedSubject + RequirementAssignment) --

resource "aws_apigatewayv2_integration" "subjects" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.subjects_invoke_arn
  payload_format_version = "2.0"
}

locals {
  subjects_routes = {
    create      = { method = "POST", path = "/subjects" }
    dashboard   = { method = "GET", path = "/subjects/dashboard" }
    get_by_id   = { method = "GET", path = "/subjects/{subjectId}" }
    update      = { method = "PUT", path = "/subjects/{subjectId}" }
    delete      = { method = "DELETE", path = "/subjects/{subjectId}" }
    archive     = { method = "POST", path = "/subjects/{subjectId}/archive" }
    assign_req  = { method = "POST", path = "/subjects/{subjectId}/requirements" }
    list_req    = { method = "GET", path = "/subjects/{subjectId}/requirements" }
    get_req     = { method = "GET", path = "/subjects/{subjectId}/requirements/{assignmentId}" }
    update_req  = { method = "PUT", path = "/subjects/{subjectId}/requirements/{assignmentId}" }
    delete_req  = { method = "DELETE", path = "/subjects/{subjectId}/requirements/{assignmentId}" }
    link_item   = { method = "POST", path = "/subjects/{subjectId}/requirements/{assignmentId}/link" }
    unlink_item = { method = "POST", path = "/subjects/{subjectId}/requirements/{assignmentId}/unlink" }
    # BLOCKER-A (segunda metade, 2026-08-25): DocumentSubmission (M10, ancorada no
    # RequirementAssignment) nunca teve rota de leitura para o lado autenticado do tenant -
    # mesmo gap que Document/M6 tinha antes desta sessão.
    list_submissions = { method = "GET", path = "/subjects/{subjectId}/requirements/{assignmentId}/submissions" }
    get_submission   = { method = "GET", path = "/subjects/{subjectId}/requirements/{assignmentId}/submissions/{submissionId}" }
    # Achado real (M10 cluster 4): estas 4 rotas de DocumentRequest (lado autenticado, D-037)
    # já tinham handler HTTP completo (document-request-handlers.ts) e roteamento real dentro
    # do Lambda (subjects-handler.ts) desde a sessão anterior, mas NUNCA tinham sido
    # registradas aqui - o API Gateway real nunca teria uma rota que as alcançasse (404),
    # apesar do código estar pronto e testado. Corrigido junto das 2 rotas novas de D-049
    # abaixo, mesmo padrão.
    create_document_request = { method = "POST", path = "/subjects/{subjectId}/requirements/{assignmentId}/document-requests" }
    list_document_requests  = { method = "GET", path = "/subjects/{subjectId}/requirements/{assignmentId}/document-requests" }
    get_document_request    = { method = "GET", path = "/subjects/{subjectId}/document-requests/{documentRequestId}" }
    revoke_document_request = { method = "POST", path = "/subjects/{subjectId}/document-requests/{documentRequestId}/revoke" }
    # M10 cluster 4 (D-049): preferência de TENANT (não por subject) para o convite inicial
    # automatizado - fora do namespace /{subjectId}/... de propósito.
    get_delivery_preference    = { method = "GET", path = "/subjects/document-request-delivery-preference" }
    update_delivery_preference = { method = "PUT", path = "/subjects/document-request-delivery-preference" }
  }
}

resource "aws_apigatewayv2_route" "subjects" {
  for_each = local.subjects_routes

  api_id             = aws_apigatewayv2_api.this.id
  route_key          = "${each.value.method} ${each.value.path}"
  target             = "integrations/${aws_apigatewayv2_integration.subjects.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
}

resource "aws_lambda_permission" "subjects" {
  statement_id  = "AllowApiGatewayInvokeSubjects"
  action        = "lambda:InvokeFunction"
  function_name = var.subjects_function_name
  principal     = "apigateway.amazonaws.com"
  qualifier     = "live"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*/subjects*"
}

# --- MembershipsHandler: /organizations/members*, /organizations/invitations* (B2B-8, D-099) -

resource "aws_apigatewayv2_integration" "memberships" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.memberships_invoke_arn
  payload_format_version = "2.0"
}

locals {
  memberships_routes = {
    invite            = { method = "POST", path = "/organizations/members/invite" }
    revoke_invitation = { method = "POST", path = "/organizations/invitations/{invitationId}/revoke" }
    list_members      = { method = "GET", path = "/organizations/members" }
    list_invitations  = { method = "GET", path = "/organizations/invitations" }
    change_role       = { method = "PUT", path = "/organizations/members/{userId}/role" }
    remove_member     = { method = "DELETE", path = "/organizations/members/{userId}" }
    leave             = { method = "POST", path = "/organizations/members/leave" }
    # Wave B2B-10 (Tenant-aware Frontend, "settings" scope item) - same handler/Lambda, new route.
    update_settings = { method = "PATCH", path = "/organizations/settings" }
    # W3-07 (D-124): CloseOrganizationService's trigger - starts the real tenant purge. Same
    # memberships Lambda, new route. Added in the SAME commit as the handler dispatch and the BFF
    # proxy allowlist entry, deliberately: D-117 and D-120 were both real production bugs of
    # exactly this shape (handler shipped, route never added, every call 404'd at the gateway
    # without ever reaching the Lambda). The tftest below asserts this route exists for that
    # reason.
    close_organization = { method = "POST", path = "/organizations/close" }
    # D-127 (quarantine/recovery window): CancelOrganizationClosureService's trigger - same
    # "route added in the same commit as the handler" discipline as close_organization above,
    # for the same D-117/D-120 bug-class reason.
    cancel_organization_closure = { method = "POST", path = "/organizations/cancel-close" }
  }
}

resource "aws_apigatewayv2_route" "memberships" {
  for_each = local.memberships_routes

  api_id             = aws_apigatewayv2_api.this.id
  route_key          = "${each.value.method} ${each.value.path}"
  target             = "integrations/${aws_apigatewayv2_integration.memberships.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
}

resource "aws_lambda_permission" "memberships" {
  statement_id  = "AllowApiGatewayInvokeMemberships"
  action        = "lambda:InvokeFunction"
  function_name = var.memberships_function_name
  principal     = "apigateway.amazonaws.com"
  qualifier     = "live"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*/organizations*"
}

# --- GuestDocumentsHandler: /guest/document-requests/{token}* (M10, D-037) -----------------
# PRIMEIRA rota pública do projeto: authorization_type = NONE, sem authorizer JWT. Validação
# fica inteiramente na aplicação (GuestSubmissionService#resolveToken) - decisão explícita do
# cluster 2 (evita duplicar lógica de token/contexto num Lambda authorizer, e o risco de cache
# stale de authorizer). D-037 originalmente exigia WAF na frente como pré-requisito - superseded
# por D-051 (achado real: WAFv2 não suporta associação com API Gateway HTTP API v2, só REST API
# v1/ALB/AppSync/etc. - CreateWebACL/AssociateWebACL nunca funcionariam aqui). Mitigação
# imediata: throttling nativo por rota (`route_settings` em `aws_apigatewayv2_stage.default`
# acima), mais restritivo que o default do stage já que estas são as únicas rotas sem
# autenticação JWT. CloudFront+WAF fica registrado como débito técnico bloqueante antes de
# tráfego público real de produção (não antes de `dev`).

resource "aws_apigatewayv2_integration" "guest_documents" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.guest_documents_invoke_arn
  payload_format_version = "2.0"
}

locals {
  guest_documents_routes = {
    get_request      = { method = "GET", path = "/guest/document-requests/{token}" }
    start_submission = { method = "POST", path = "/guest/document-requests/{token}/uploads" }
  }
}

resource "aws_apigatewayv2_route" "guest_documents" {
  for_each = local.guest_documents_routes

  api_id             = aws_apigatewayv2_api.this.id
  route_key          = "${each.value.method} ${each.value.path}"
  target             = "integrations/${aws_apigatewayv2_integration.guest_documents.id}"
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "guest_documents" {
  statement_id  = "AllowApiGatewayInvokeGuestDocuments"
  action        = "lambda:InvokeFunction"
  function_name = var.guest_documents_function_name
  principal     = "apigateway.amazonaws.com"
  qualifier     = "live"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*/guest/document-requests*"
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
  qualifier     = "live"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*/notifications/preferences"
}

# --- ImportsHandler: /imports* (M11, D-042 - CSV import de TrackedSubject) -----------------

resource "aws_apigatewayv2_integration" "imports" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.imports_invoke_arn
  payload_format_version = "2.0"
}

locals {
  imports_routes = {
    reserve = { method = "POST", path = "/imports" }
    get     = { method = "GET", path = "/imports/{jobId}" }
    commit  = { method = "POST", path = "/imports/{jobId}/commit" }
  }
}

resource "aws_apigatewayv2_route" "imports" {
  for_each = local.imports_routes

  api_id             = aws_apigatewayv2_api.this.id
  route_key          = "${each.value.method} ${each.value.path}"
  target             = "integrations/${aws_apigatewayv2_integration.imports.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
}

resource "aws_lambda_permission" "imports" {
  statement_id  = "AllowApiGatewayInvokeImports"
  action        = "lambda:InvokeFunction"
  function_name = var.imports_function_name
  principal     = "apigateway.amazonaws.com"
  qualifier     = "live"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*/imports*"
}

# --- DocumentArchiveHandler: /document-archive/* (D-143 Nucleus 1) -------------------------

resource "aws_apigatewayv2_integration" "document_archive" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.document_archive_invoke_arn
  payload_format_version = "2.0"
}

locals {
  document_archive_routes = {
    create         = { method = "POST", path = "/document-archive/documents" }
    get_by_id      = { method = "GET", path = "/document-archive/documents/{documentId}" }
    list_versions  = { method = "GET", path = "/document-archive/documents/{documentId}/versions" }
    reserve_upload = { method = "POST", path = "/document-archive/documents/{documentId}/versions" }
    reserve_files  = { method = "POST", path = "/document-archive/documents/{documentId}/versions/{seq}/files" }
    commit_upload  = { method = "POST", path = "/document-archive/documents/{documentId}/versions/{seq}/commit" }
    claim_review   = { method = "POST", path = "/document-archive/documents/{documentId}/versions/{seq}/claim" }
    accept_version = { method = "POST", path = "/document-archive/documents/{documentId}/versions/{seq}/accept" }
    reject_version = { method = "POST", path = "/document-archive/documents/{documentId}/versions/{seq}/reject" }

    # D-143 Nucleus 2, Requirement (Decision 5/D9, D-145) - same Lambda, subject-scoped routes.
    create_requirement = { method = "POST", path = "/document-archive/requirements" }
    list_requirements  = { method = "GET", path = "/document-archive/requirements/{subjectId}" }
    get_requirement    = { method = "GET", path = "/document-archive/requirements/{subjectId}/{requirementId}" }
    update_requirement = { method = "PATCH", path = "/document-archive/requirements/{subjectId}/{requirementId}" }
    link_evidence      = { method = "POST", path = "/document-archive/requirements/{subjectId}/{requirementId}/link-evidence" }
    unlink_evidence    = { method = "POST", path = "/document-archive/requirements/{subjectId}/{requirementId}/unlink-evidence" }
    delete_requirement = { method = "POST", path = "/document-archive/requirements/{subjectId}/{requirementId}/delete" }

    # D-143 Nucleus 2, entity 3/3, recurrence (Decision 8/D-147) - same Lambda, subject-scoped
    # series routes. Tenant-facing only - the guest-facing surface stays on the separate
    # document_archive_guest routes below, unchanged by this task.
    create_series      = { method = "POST", path = "/document-archive/series" }
    list_series        = { method = "GET", path = "/document-archive/series/{subjectId}" }
    get_series         = { method = "GET", path = "/document-archive/series/{subjectId}/{seriesId}" }
    cancel_series      = { method = "POST", path = "/document-archive/series/{subjectId}/{seriesId}/cancel" }
    materialize_series = { method = "POST", path = "/document-archive/series/{subjectId}/{seriesId}/materialize" }

    # D-173 (DocumentType catalog), item 5 - same Lambda, tenant-facing catalog CRUD routes.
    create_document_type     = { method = "POST", path = "/document-archive/document-types" }
    list_document_types      = { method = "GET", path = "/document-archive/document-types" }
    get_document_type        = { method = "GET", path = "/document-archive/document-types/{documentTypeId}" }
    rename_document_type     = { method = "PATCH", path = "/document-archive/document-types/{documentTypeId}" }
    deprecate_document_type  = { method = "POST", path = "/document-archive/document-types/{documentTypeId}/deprecate" }
    reactivate_document_type = { method = "POST", path = "/document-archive/document-types/{documentTypeId}/reactivate" }
  }
}

resource "aws_apigatewayv2_route" "document_archive" {
  for_each = local.document_archive_routes

  api_id             = aws_apigatewayv2_api.this.id
  route_key          = "${each.value.method} ${each.value.path}"
  target             = "integrations/${aws_apigatewayv2_integration.document_archive.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
}

resource "aws_lambda_permission" "document_archive" {
  statement_id  = "AllowApiGatewayInvokeDocumentArchive"
  action        = "lambda:InvokeFunction"
  function_name = var.document_archive_function_name
  principal     = "apigateway.amazonaws.com"
  qualifier     = "live"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*/document-archive*"
}

# --- DocumentArchiveGuestHandler: /document-archive/guest/document-requests/{token}* -------
# (D-143 Decision 4, D-146) — SEPARATE Lambda from DocumentArchiveHandler, same isolation
# posture as GuestDocumentsHandler above (authorization_type = NONE, no Cognito JWT
# authorizer; validation happens entirely in GuestDocumentAccessService#resolveCredential/
# resolveSession, never a Lambda authorizer, same reasoning as D-037's comment above).

resource "aws_apigatewayv2_integration" "document_archive_guest" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.document_archive_guest_invoke_arn
  payload_format_version = "2.0"
}

locals {
  document_archive_guest_routes = {
    get_request   = { method = "GET", path = "/document-archive/guest/document-requests/{token}" }
    start_session = { method = "POST", path = "/document-archive/guest/document-requests/{token}/session" }
    submit        = { method = "POST", path = "/document-archive/guest/document-requests/{token}/uploads" }
  }
}

resource "aws_apigatewayv2_route" "document_archive_guest" {
  for_each = local.document_archive_guest_routes

  api_id             = aws_apigatewayv2_api.this.id
  route_key          = "${each.value.method} ${each.value.path}"
  target             = "integrations/${aws_apigatewayv2_integration.document_archive_guest.id}"
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "document_archive_guest" {
  statement_id  = "AllowApiGatewayInvokeDocumentArchiveGuest"
  action        = "lambda:InvokeFunction"
  function_name = var.document_archive_guest_function_name
  principal     = "apigateway.amazonaws.com"
  qualifier     = "live"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*/document-archive/guest*"
}

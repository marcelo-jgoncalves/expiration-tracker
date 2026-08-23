# HTTP API (API Gateway v2) — Terraform equivalent of infra/lib/api.ts (ADR-0009). A single
# Cognito JWT authorizer protects every route; one Lambda per logical handler
# (test-ping/items/reminders), matching the CDK construct's Lambda-monolith-per-module
# routing table.

variable "api_name" {
  description = "Name of the HTTP API."
  type        = string
}

variable "user_pool_id" {
  description = "Cognito User Pool ID backing the JWT authorizer's issuer URL."
  type        = string
}

variable "user_pool_client_id" {
  description = "Cognito User Pool Client ID — the JWT authorizer's expected audience."
  type        = string
}

variable "aws_region" {
  description = "AWS region the User Pool lives in — used to construct the JWT issuer URL (https://cognito-idp.<region>.amazonaws.com/<user_pool_id>), same as the CDK construct's props.auth.userPool.stack.region."
  type        = string
}

variable "test_ping_invoke_arn" {
  description = "Invoke ARN of the TestPingHandler Lambda — the M1 exit-criterion route (GET /test/ping)."
  type        = string
}

variable "test_ping_function_name" {
  description = "Function name of the TestPingHandler Lambda, for the API Gateway invoke permission."
  type        = string
}

variable "items_invoke_arn" {
  description = "Invoke ARN of the ItemsHandler Lambda — backs every /items* route."
  type        = string
}

variable "items_function_name" {
  description = "Function name of the ItemsHandler Lambda, for the API Gateway invoke permission."
  type        = string
}

variable "reminders_invoke_arn" {
  description = "Invoke ARN of the RemindersHandler Lambda — backs every /reminders/policies* route."
  type        = string
}

variable "reminders_function_name" {
  description = "Function name of the RemindersHandler Lambda, for the API Gateway invoke permission."
  type        = string
}

variable "notifications_invoke_arn" {
  description = "Invoke ARN of the NotificationsHandler Lambda — backs GET/PUT /notifications/preferences."
  type        = string
}

variable "notifications_function_name" {
  description = "Function name of the NotificationsHandler Lambda, for the API Gateway invoke permission."
  type        = string
}

variable "documents_invoke_arn" {
  description = "Invoke ARN of the DocumentsHandler Lambda (M6) — backs POST /items/{itemId}/documents and DELETE /items/{itemId}/documents/{documentId}."
  type        = string
}

variable "documents_function_name" {
  description = "Function name of the DocumentsHandler Lambda, for the API Gateway invoke permission."
  type        = string
}

variable "subjects_invoke_arn" {
  description = "Invoke ARN of the SubjectsHandler Lambda (M9, D-036/D-040) — backs every /subjects* route (TrackedSubject + RequirementAssignment)."
  type        = string
}

variable "subjects_function_name" {
  description = "Function name of the SubjectsHandler Lambda, for the API Gateway invoke permission."
  type        = string
}

variable "guest_documents_invoke_arn" {
  description = "Invoke ARN of the GuestDocumentsHandler Lambda (M10, D-037) — backs /guest/document-requests/{token}*, a PUBLIC (authorization_type = NONE) route, primeira do projeto."
  type        = string
}

variable "guest_documents_function_name" {
  description = "Function name of the GuestDocumentsHandler Lambda, for the API Gateway invoke permission."
  type        = string
}

variable "cors_allow_origins" {
  description = "CORS allowed origins. CDK construct uses a documented placeholder (\"https://app.example.invalid\") pending a real frontend domain decision — same posture here."
  type        = list(string)
  default     = ["https://app.example.invalid"]
}

variable "tags" {
  description = "Tags applied to the HTTP API."
  type        = map(string)
  default     = {}
}

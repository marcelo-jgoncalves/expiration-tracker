variable "name_prefix" {
  description = "Prefix for the state machine name - the resulting \"<name_prefix>-tenant-purge\" MUST match the name segment of root infra/main.tf's local.tenant_purge_state_machine_arn, which CloseOrganizationService and the sweeper both receive as an env var."
  type        = string
}

variable "lifecycle_transition_function_arn" {
  description = "TenantLifecycleTransitionHandler Lambda ARN - the ONE handler behind all four forward transitions and every MarkBlocked state (D-121 Rodada 2 Fix 3)."
  type        = string
}

variable "purge_worker_function_arn" {
  description = "TenantPurgeWorkerHandler Lambda ARN - the thin wrapper around purgeTenant() invoked by the RunPurge Task."
  type        = string
}

variable "enable_xray_tracing" {
  description = "D-358: whether the state machine participates in X-Ray tracing. Mirrors the lambda-function module's own tracing_active toggle so the orchestrator and the Lambdas it invokes are never split (one traced, the other not)."
  type        = bool
  default     = true
}

variable "state_machine_role_arn" {
  description = "IAM role for the state machine execution. Must grant lambda:InvokeFunction on exactly the two function ARNs above (2 ARNs, never a wildcard - D-121 Rodada 3 Fix 8's minimum IAM surface)."
  type        = string
}

variable "alert_topic_arn" {
  description = "SNS topic receiving the ExecutionsFailed/ExecutionsTimedOut alarms - the same alert topic every other alarm in this project already uses."
  type        = string
}

variable "tags" {
  description = "Tags applied to the state machine, its log group, and both alarms."
  type        = map(string)
  default     = {}
}

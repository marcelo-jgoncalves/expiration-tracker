# W3-07 tenant purge orchestrator (D-124, implementing D-121). Same shape and same `apply`
# rationale as ../../extraction-workflow/tests/: under mock_provider the rendered `definition`
# string only exists after the (mocked) resource is created, and these assertions are entirely
# about what replace() actually produced.

mock_provider "aws" {
  mock_resource "aws_sfn_state_machine" {
    defaults = {
      arn = "arn:aws:states:us-east-1:123456789012:stateMachine:exptrk-test-tenant-purge"
    }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = {
      arn = "arn:aws:logs:us-east-1:123456789012:log-group:/aws/vendedlogs/states/exptrk-test-tenant-purge"
    }
  }
}

variables {
  name_prefix                       = "exptrk-test"
  lifecycle_transition_function_arn = "arn:aws:lambda:us-east-1:123456789012:function:exptrk-test-tenant-lifecycle-transition-handler:live"
  purge_worker_function_arn         = "arn:aws:lambda:us-east-1:123456789012:function:exptrk-test-tenant-purge-worker-handler:live"
  state_machine_role_arn            = "arn:aws:iam::123456789012:role/exptrk-test-tenant-purge-workflow-role"
  alert_topic_arn                   = "arn:aws:sns:us-east-1:123456789012:exptrk-test-alerts"
}

run "name_matches_root_local_tenant_purge_state_machine_arn_convention" {
  command = apply

  # CloseOrganizationService and the sweeper both receive the state machine ARN as an env var
  # derived from this exact name in root infra/main.tf. Drift here silently breaks every
  # StartExecution in a live account - the same class of failure D-117/D-120 were about.
  assert {
    condition     = aws_sfn_state_machine.tenant_purge.name == "exptrk-test-tenant-purge"
    error_message = "State machine name must be \"<name_prefix>-tenant-purge\" exactly"
  }
}

run "definition_substitutes_both_lambda_arns_and_leaves_no_placeholder" {
  command = apply

  assert {
    condition     = strcontains(aws_sfn_state_machine.tenant_purge.definition, var.lifecycle_transition_function_arn)
    error_message = "definition must embed the real TenantLifecycleTransitionHandler ARN"
  }
  assert {
    condition     = strcontains(aws_sfn_state_machine.tenant_purge.definition, var.purge_worker_function_arn)
    error_message = "definition must embed the real TenantPurgeWorkerHandler ARN"
  }
  assert {
    condition     = !strcontains(aws_sfn_state_machine.tenant_purge.definition, "tenant-lifecycle-transition:live")
    error_message = "definition must NOT retain the checked-in placeholder \"tenant-lifecycle-transition:live\""
  }
  assert {
    condition     = !strcontains(aws_sfn_state_machine.tenant_purge.definition, "tenant-purge-worker:live")
    error_message = "definition must NOT retain the checked-in placeholder \"tenant-purge-worker:live\""
  }
}

# G-V3 target for the Choice loop's retry bound (D-121 Rodada 3 Fix 8). The bound is hardcoded as a
# literal `20` directly in tenant-purge.asl.json's Choice condition (NOT templatefile-substituted -
# CI validates that checked-in file directly and requires a real JSON number there, a quoted
# placeholder token would fail that check even though it would have substituted fine at plan time).
# `local.purge_retry_limit` is the single documented declaration the ASL literal must be kept in
# sync with; this test asserts the ASL actually rendered as a real JSON number (a quoted "20" would
# make NumericLessThan an invalid ASL condition that only fails at deploy/run time, never at plan
# time) and that the local matches the value the approved design named.
run "purge_retry_limit_is_a_real_json_number_matching_the_documented_local" {
  command = apply

  assert {
    condition     = strcontains(aws_sfn_state_machine.tenant_purge.definition, "\"NumericLessThan\": 20")
    error_message = "The retry bound must render as an unquoted JSON number (\"NumericLessThan\": 20), never a quoted string"
  }
  assert {
    condition     = output.purge_retry_limit == 20
    error_message = "PURGE_RETRY_LIMIT must be the deliberately-conservative 20 the approved design named"
  }
}

# The single most load-bearing literal in the whole workflow: D-066 Rodada H's already-approved
# 1800s capability-extinction cutoff. It is deliberately hardcoded in the ASL (never a variable or
# an execution-input field) so no caller can shorten the window admitted capabilities expire in.
run "quiescence_wait_is_the_approved_1800_second_cutoff" {
  command = apply

  assert {
    condition     = strcontains(aws_sfn_state_machine.tenant_purge.definition, "\"Seconds\": 1800")
    error_message = "The Wait state must use D-066's approved 1800s cutoff verbatim"
  }
}

run "every_lifecycle_state_is_actually_driven_by_the_workflow" {
  command = apply

  # The whole reason this orchestrator exists: before it, transitionTenantLifecycle() and
  # purgeTenant() were real, working, and completely unreachable. Each forward edge of the
  # ACTIVE->DELETING->QUIESCING->PURGING->VERIFIED->DELETED machine past DELETING must appear.
  assert {
    condition     = strcontains(aws_sfn_state_machine.tenant_purge.definition, "\"to\": \"QUIESCING\"")
    error_message = "Workflow must drive DELETING -> QUIESCING"
  }
  assert {
    condition     = strcontains(aws_sfn_state_machine.tenant_purge.definition, "\"to\": \"PURGING\"")
    error_message = "Workflow must drive QUIESCING -> PURGING"
  }
  assert {
    condition     = strcontains(aws_sfn_state_machine.tenant_purge.definition, "\"to\": \"VERIFIED\"")
    error_message = "Workflow must drive PURGING -> VERIFIED"
  }
  assert {
    condition     = strcontains(aws_sfn_state_machine.tenant_purge.definition, "\"to\": \"DELETED\"")
    error_message = "Workflow must drive VERIFIED -> DELETED"
  }
  assert {
    condition     = strcontains(aws_sfn_state_machine.tenant_purge.definition, "PURGE_NOT_CONVERGING")
    error_message = "The PARTIAL-exhausted branch must record its own distinct blockedReason"
  }
  assert {
    condition     = strcontains(aws_sfn_state_machine.tenant_purge.definition, "PURGE_FAILED")
    error_message = "The FAILED branch must record its own distinct blockedReason"
  }
}

run "standard_workflow_required_for_the_1800s_wait" {
  command = apply

  # An Express workflow caps out at 5 minutes; the 1800s Wait alone rules it out.
  assert {
    condition     = aws_sfn_state_machine.tenant_purge.type == "STANDARD"
    error_message = "Must be a Standard workflow - the 1800s Wait exceeds Express's 5-minute maximum"
  }
}

run "role_arn_is_passed_through_exactly" {
  command = apply

  assert {
    condition     = aws_sfn_state_machine.tenant_purge.role_arn == var.state_machine_role_arn
    error_message = "The module must use the caller-supplied execution role, never construct its own"
  }
}

run "tracing_and_logging_are_configured" {
  command = apply

  assert {
    condition     = aws_sfn_state_machine.tenant_purge.tracing_configuration[0].enabled == true
    error_message = "X-Ray tracing must be enabled"
  }
  assert {
    condition     = aws_sfn_state_machine.tenant_purge.logging_configuration[0].level == "ERROR"
    error_message = "Logging level must be ERROR, not ALL"
  }
  assert {
    condition     = aws_sfn_state_machine.tenant_purge.logging_configuration[0].include_execution_data == false
    error_message = "include_execution_data must be false - execution state carries tenant-scoped identifiers"
  }
}

# D-121 Rodada 3 Fix 7: this alarm is genuinely new. Rodada 2 claimed extraction-workflow's alarm
# could be reused; direct reading proved no aws_cloudwatch_metric_alarm on AWS/States existed
# anywhere in infra/. These assertions exist so that stays true rather than being quietly dropped.
run "both_aws_states_alarms_exist_and_route_to_the_shared_alert_topic" {
  command = apply

  assert {
    condition     = aws_cloudwatch_metric_alarm.executions_failed.namespace == "AWS/States"
    error_message = "The failure alarm must watch the AWS/States namespace"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.executions_failed.metric_name == "ExecutionsFailed"
    error_message = "The failure alarm must watch ExecutionsFailed"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.executions_timed_out.metric_name == "ExecutionsTimedOut"
    error_message = "A timed-out execution never raises ExecutionsFailed - it needs its own alarm"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.executions_failed.dimensions["StateMachineArn"] == aws_sfn_state_machine.tenant_purge.arn
    error_message = "The alarm must be filtered to THIS state machine, never account-wide"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.executions_timed_out.dimensions["StateMachineArn"] == aws_sfn_state_machine.tenant_purge.arn
    error_message = "The timeout alarm must be filtered to THIS state machine"
  }
  assert {
    condition     = contains(aws_cloudwatch_metric_alarm.executions_failed.alarm_actions, var.alert_topic_arn)
    error_message = "The failure alarm must notify the shared alert SNS topic"
  }
  assert {
    condition     = contains(aws_cloudwatch_metric_alarm.executions_timed_out.alarm_actions, var.alert_topic_arn)
    error_message = "The timeout alarm must notify the shared alert SNS topic"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.executions_failed.evaluation_periods == 1
    error_message = "A failed tenant purge leaves data physically present past a deletion request - it must page on the first occurrence"
  }
}

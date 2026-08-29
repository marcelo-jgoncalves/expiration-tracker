# MVP desta sessão (entrega fechável, ver design doc no cabeçalho de variables.tf): 3 alarmes
# reais sobre os eventos de security-audit.ts. O alarme de anomalia de volume de acesso a
# GSI3/GSI6 fica explicitamente fora deste MVP - depende de observar baseline real em `dev`
# antes de calibrar um limiar (não incluído aqui; instrumentação de pageCount/resultCount já
# existe no código para permitir observar esse baseline quando chegar a hora).

locals {
  http_log_groups         = [for name in var.http_function_names : "/aws/lambda/${name}"]
  global_index_log_groups = [for name in var.global_index_function_names : "/aws/lambda/${name}"]
}

# --- security.authorization_denied (todas as razões) --------------------------------------

resource "aws_cloudwatch_log_metric_filter" "authorization_denied" {
  for_each = toset(var.http_function_names)

  name           = "SecurityAuthorizationDenied-${each.value}"
  log_group_name = "/aws/lambda/${each.value}"
  pattern        = "{ $.event = \"security.authorization_denied\" }"

  metric_transformation {
    name      = "SecurityAuthorizationDenied"
    namespace = var.metric_namespace
    value     = "1"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_metric_alarm" "authorization_denied_burst" {
  alarm_name          = "SecurityAuthorizationDeniedBurst"
  namespace           = var.metric_namespace
  metric_name         = "SecurityAuthorizationDenied"
  statistic           = "Sum"
  period              = 300 # 5 minutes
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_description   = "5+ authorization denials (any reason) across the HTTP handlers wired below (http_function_names) in 5 minutes - possible enumeration/abuse or an authorization regression. Not per-tenant (metric filters don't create per-dimension alarms); investigate via correlationId in CloudWatch Logs Insights."
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alert_topic_arn]
  ok_actions          = [var.alert_topic_arn]
  tags                = var.tags

  depends_on = [aws_cloudwatch_log_metric_filter.authorization_denied]
}

# --- security.authorization_denied with reason=TENANT_MISMATCH (the one denial reason that is
# actually reachable by a real caller in the current MVP - see security-audit-trail-design) ---

resource "aws_cloudwatch_log_metric_filter" "authorization_denied_tenant_mismatch" {
  for_each = toset(var.http_function_names)

  name           = "SecurityAuthorizationTenantBoundaryDenied-${each.value}"
  log_group_name = "/aws/lambda/${each.value}"
  pattern        = "{ $.event = \"security.authorization_denied\" && $.reason = \"TENANT_MISMATCH\" }"

  metric_transformation {
    name      = "SecurityAuthorizationTenantBoundaryDenied"
    namespace = var.metric_namespace
    value     = "1"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_metric_alarm" "authorization_tenant_boundary_denied" {
  alarm_name          = "SecurityAuthorizationTenantBoundaryDenied"
  namespace           = var.metric_namespace
  metric_name         = "SecurityAuthorizationTenantBoundaryDenied"
  statistic           = "Sum"
  period              = 300 # 5 minutes
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_description   = "At least 1 TENANT_MISMATCH denial - a real attempt (or bug) to act across a tenant boundary. Highest-severity signal of this MVP; investigate immediately via correlationId in CloudWatch Logs Insights."
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alert_topic_arn]
  ok_actions          = [var.alert_topic_arn]
  tags                = var.tags

  depends_on = [aws_cloudwatch_log_metric_filter.authorization_denied_tenant_mismatch]
}

# --- security.global_index_access_denied (real AccessDeniedException on GSI3/GSI6) --------

resource "aws_cloudwatch_log_metric_filter" "global_index_access_denied" {
  for_each = toset(var.global_index_function_names)

  name           = "SecurityGlobalIndexAccessDenied-${each.value}"
  log_group_name = "/aws/lambda/${each.value}"
  pattern        = "{ $.event = \"security.global_index_access_denied\" }"

  metric_transformation {
    name      = "SecurityGlobalIndexAccessDenied"
    namespace = var.metric_namespace
    value     = "1"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_metric_alarm" "global_index_access_denied" {
  alarm_name          = "SecurityGlobalIndexAccessDenied"
  namespace           = var.metric_namespace
  metric_name         = "SecurityGlobalIndexAccessDenied"
  statistic           = "Sum"
  period              = 300 # 5 minutes
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_description   = "A privileged role that should have real IAM access to GSI3/GSI6 was denied by AWS - real IAM drift, misconfigured deploy, or unexpected code path. This is the ONE component of this trail that can also be exercised as a real synthetic negative test (unlike a real cross-tenant attempt)."
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alert_topic_arn]
  ok_actions          = [var.alert_topic_arn]
  tags                = var.tags

  depends_on = [aws_cloudwatch_log_metric_filter.global_index_access_denied]
}

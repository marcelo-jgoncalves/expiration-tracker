# Recreates the acceptance criteria for M10 (D-037, 04-domain-model-guest-upload.md's WAF
# prerequisite) as native `terraform test` assertions. mock_provider — no real AWS
# credentials/resources needed; api_stage_arn is a caller-supplied input variable, not a
# mock-generated computed attribute, so no override is needed for it.

mock_provider "aws" {
  # The default mock_provider computed-attribute generator produces a random string, not a
  # valid ARN, for aws_wafv2_web_acl.arn — but aws_wafv2_web_acl_association.web_acl_arn
  # validates its input looks like an ARN even under mock_provider (same issue documented in
  # the alert-topic/api-gateway modules' tests). Override with a realistic value.
  mock_resource "aws_wafv2_web_acl" {
    defaults = {
      arn = "arn:aws:wafv2:us-east-1:123456789012:regional/webacl/exptrk-test-waf/00000000-0000-0000-0000-000000000000"
    }
  }
}

run "web_acl_has_managed_rules_and_guest_path_rate_limit" {
  command = apply

  variables {
    name_prefix   = "exptrk-test"
    api_stage_arn = "arn:aws:apigateway:us-east-1::/apis/mockapiid/stages/$default"
    tags          = { Project = "expiration-tracker", Environment = "test" }
  }

  assert {
    condition     = aws_wafv2_web_acl.this.scope == "REGIONAL"
    error_message = "Web ACL must be REGIONAL scope to attach to an HTTP API stage"
  }

  assert {
    condition     = length(aws_wafv2_web_acl.this.default_action) == 1 && length(aws_wafv2_web_acl.this.default_action[0].allow) == 1
    error_message = "Default action must be ALLOW — the rules below block explicitly, existing JWT-protected routes must not be affected"
  }

  assert {
    condition = contains(
      [for r in aws_wafv2_web_acl.this.rule : r.name],
      "AWSManagedRulesCommonRuleSet",
    )
    error_message = "AWSManagedRulesCommonRuleSet must be attached"
  }

  assert {
    condition = contains(
      [for r in aws_wafv2_web_acl.this.rule : r.name],
      "AWSManagedRulesKnownBadInputsRuleSet",
    )
    error_message = "AWSManagedRulesKnownBadInputsRuleSet must be attached"
  }

  assert {
    condition = contains(
      [for r in aws_wafv2_web_acl.this.rule : r.name],
      "GuestPathRateLimit",
    )
    error_message = "GuestPathRateLimit rate-based rule must be attached"
  }

  assert {
    condition = [
      for r in aws_wafv2_web_acl.this.rule : r.statement[0].rate_based_statement[0].limit
      if r.name == "GuestPathRateLimit"
    ][0] == 300
    error_message = "GuestPathRateLimit must default to 300 requests/5min per IP"
  }

  assert {
    condition = [
      for r in aws_wafv2_web_acl.this.rule : r.statement[0].rate_based_statement[0].scope_down_statement[0].byte_match_statement[0].search_string
      if r.name == "GuestPathRateLimit"
    ][0] == "/guest/"
    error_message = "GuestPathRateLimit must be scoped down to the /guest/ path prefix only — never affects existing JWT-protected routes"
  }

  assert {
    condition     = aws_wafv2_web_acl_association.api.resource_arn == "arn:aws:apigateway:us-east-1::/apis/mockapiid/stages/$default"
    error_message = "Web ACL must associate with the API Gateway stage ARN passed in"
  }
}

run "guest_path_rate_limit_is_overridable" {
  command = apply

  variables {
    name_prefix           = "exptrk-test"
    api_stage_arn         = "arn:aws:apigateway:us-east-1::/apis/mockapiid/stages/$default"
    guest_path_rate_limit = 50
  }

  assert {
    condition = [
      for r in aws_wafv2_web_acl.this.rule : r.statement[0].rate_based_statement[0].limit
      if r.name == "GuestPathRateLimit"
    ][0] == 50
    error_message = "guest_path_rate_limit variable must override the default limit"
  }
}

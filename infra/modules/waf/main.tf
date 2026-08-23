# WAFv2 Web ACL regional, associado ao stage do API Gateway HTTP API. Default action ALLOW —
# as regras abaixo é que bloqueiam explicitamente; a maior parte do tráfego (rotas JWT-
# protegidas já existentes) não deve ser afetada pela regra de rate-limit escopada a /guest/*.

resource "aws_wafv2_web_acl" "this" {
  name = "${var.name_prefix}-waf"
  # AWS WAFv2's description field only accepts a narrow character set
  # (^[\w+=:#@/\-,\.][\w+=:#@/\-,\.\s]+[\w+=:#@/\-,\.]$ - word chars, +=:#@/-,. and whitespace
  # only; no parentheses, asterisk, em-dash or accented characters) - real deploy failure
  # (2026-08-23, first real apply of this resource) found this the hard way against the
  # actual WAFV2 API, not caught by any local plan/validate/mock_provider test since none of
  # them call the real AWS API to validate free-text field contents.
  description = "WAF na frente do API Gateway, pre-requisito da rota publica guest, M10 D-037."
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  # AWS Managed Core Rule Set — proteções genéricas conhecidas (injection patterns comuns,
  # cross-site scripting, etc.), baixo ruído esperado para uma API JSON.
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-common-rule-set"
      sampled_requests_enabled   = true
    }
  }

  # Known bad inputs — padrões de exploit conhecidos (log4j etc.), baixo ruído.
  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-known-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  # Rate-based rule por IP, escopada só a /guest/* (04-domain-model-guest-upload.md: "limite
  # baixo específico para /guest/*") — nunca afeta as rotas JWT-protegidas já existentes.
  # Complementa (não substitui) o rate limit por token já implementado em GuestRateLimiter.
  rule {
    name     = "GuestPathRateLimit"
    priority = 3

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.guest_path_rate_limit
        aggregate_key_type = "IP"

        scope_down_statement {
          byte_match_statement {
            search_string = "/guest/"
            field_to_match {
              uri_path {}
            }
            text_transformation {
              priority = 0
              type     = "NONE"
            }
            positional_constraint = "STARTS_WITH"
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-guest-path-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name_prefix}-waf"
    sampled_requests_enabled   = true
  }

  tags = var.tags
}

resource "aws_wafv2_web_acl_association" "api" {
  resource_arn = var.api_stage_arn
  web_acl_arn  = aws_wafv2_web_acl.this.arn
}

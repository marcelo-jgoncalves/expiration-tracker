mock_provider "aws" {
  # Same fix already documented in infra/modules/api-gateway/tests and bff-api-gateway/tests:
  # mock_provider's default computed-attribute generator produces a random string, not a valid
  # ARN, for computed ARN attributes - aws_cloudfront_distribution's function_association
  # validates function_arn looks like an ARN even under mock_provider.
  mock_resource "aws_cloudfront_function" {
    defaults = {
      arn = "arn:aws:cloudfront::123456789012:function/mock-spa-routing"
    }
  }

  # aws_iam_policy_document's .json under mock_provider is an opaque mock string, not real
  # rendered JSON (same root cause documented in sqs-worker-queue/tests: content assertions on
  # aws_iam_policy_document need the real provider). This module's behavior/OAC/headers
  # properties under test don't depend on the bucket policy's content, so the data source is
  # overridden with a fixed valid JSON string instead - avoids aws_s3_bucket_policy failing to
  # apply on an invalid mock value it never needed to be correct for these assertions.
  override_data {
    target = data.aws_iam_policy_document.spa_bucket_policy
    values = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
    }
  }
}

variables {
  name_prefix                 = "exptrk-test"
  bff_api_endpoint            = "https://abc123.execute-api.us-east-1.amazonaws.com"
  spa_content_security_policy = "default-src 'self'; script-src 'self' 'sha256-abc123'"
}

# ADR-0011 Correção 1 da v4: /bff exato (sem sufixo) precisa de comportamento próprio - o
# pattern com wildcard sozinho não cobre esse path, que cairia no default behavior.
run "exact_bff_path_has_its_own_behavior" {
  command = apply

  assert {
    condition     = contains([for b in aws_cloudfront_distribution.spa.ordered_cache_behavior : b.path_pattern], "/bff")
    error_message = "An ordered_cache_behavior with path_pattern = /bff (exact) must exist - /bff/* alone does not match the bare path"
  }
}

run "bff_wildcard_behavior_exists_and_targets_the_bff_origin" {
  command = apply

  assert {
    condition = anytrue([
      for b in aws_cloudfront_distribution.spa.ordered_cache_behavior :
      b.path_pattern == "/bff/*" && b.target_origin_id == "bff-api"
    ])
    error_message = "/bff/* must be an ordered_cache_behavior targeting the bff-api origin"
  }
}

run "bff_behaviors_never_cache" {
  command = apply

  assert {
    condition = alltrue([
      for b in aws_cloudfront_distribution.spa.ordered_cache_behavior :
      b.cache_policy_id == data.aws_cloudfront_cache_policy.caching_disabled.id
    ])
    error_message = "Every /bff behavior must use CachingDisabled - BFF responses are all per-session, never cacheable"
  }
}

run "bff_behaviors_use_all_viewer_except_host_header_never_all_viewer" {
  command = apply

  # ADR-0011 Correção 2 da v2: AllViewer forwards the viewer's Host header, which breaks an
  # execute-api origin that expects its own hostname.
  assert {
    condition = alltrue([
      for b in aws_cloudfront_distribution.spa.ordered_cache_behavior :
      b.origin_request_policy_id == data.aws_cloudfront_origin_request_policy.all_viewer_except_host_header.id
    ])
    error_message = "Every /bff behavior must use AllViewerExceptHostHeader, never AllViewer"
  }
}

run "bff_behaviors_allow_every_mutating_method" {
  command = apply

  # ADR-0011 Correção 4 da v2: sem isso, logout/mutações do proxy quebrariam (default restrito
  # do CloudFront só aceita GET/HEAD).
  assert {
    condition = alltrue([
      for b in aws_cloudfront_distribution.spa.ordered_cache_behavior :
      alltrue([for m in ["GET", "HEAD", "PUT", "POST", "PATCH", "DELETE"] : contains(b.allowed_methods, m)])
    ])
    error_message = "Every /bff behavior must allow GET/HEAD/PUT/POST/PATCH/DELETE"
  }
}

run "default_behavior_targets_s3_with_the_spa_routing_function" {
  command = apply

  assert {
    condition     = aws_cloudfront_distribution.spa.default_cache_behavior[0].target_origin_id == "spa-s3"
    error_message = "The default behavior must target the S3 origin"
  }

  assert {
    condition     = length(aws_cloudfront_distribution.spa.default_cache_behavior[0].function_association) == 1
    error_message = "The default (SPA) behavior must have the CloudFront Function associated"
  }

  assert {
    condition     = length([for fa in aws_cloudfront_distribution.spa.default_cache_behavior[0].function_association : fa if fa.event_type == "viewer-request"]) == 1
    error_message = "The SPA routing function must run on viewer-request (before the cache lookup), not viewer-response"
  }
}

# ADR-0011 (achado real, Rodada 2): a CloudFront Function de SPA routing NUNCA pode estar
# associada a um behavior /bff* - é isso que garante, por construção, que 403/404 reais do BFF
# não são mascarados como HTML da SPA.
run "spa_routing_function_is_never_associated_to_a_bff_behavior" {
  command = apply

  assert {
    condition = alltrue([
      for b in aws_cloudfront_distribution.spa.ordered_cache_behavior :
      length(try(b.function_association, [])) == 0
    ])
    error_message = "No /bff behavior may have any CloudFront Function associated - the SPA routing function must stay exclusive to the default (S3) behavior"
  }
}

run "spa_and_bff_behaviors_use_distinct_response_headers_policies" {
  command = apply

  assert {
    condition     = aws_cloudfront_distribution.spa.default_cache_behavior[0].response_headers_policy_id != aws_cloudfront_response_headers_policy.bff_edge_floor.id
    error_message = "The SPA behavior must never use the BFF's response headers policy (default-src 'none' would break the SPA's own HTML)"
  }

  assert {
    condition = alltrue([
      for b in aws_cloudfront_distribution.spa.ordered_cache_behavior :
      b.response_headers_policy_id != aws_cloudfront_response_headers_policy.spa.id
    ])
    error_message = "No /bff behavior may use the SPA's response headers policy"
  }
}

# override=false é a semântica que preserva o que o BFF já decidiu, só preenchendo o que
# falta (respostas que nunca chegam ao Lambda) - ADR-0011 Correção 2 da v3/Correção 3 da v4.
run "bff_edge_floor_headers_never_override_the_lambda" {
  command = apply

  assert {
    condition     = aws_cloudfront_response_headers_policy.bff_edge_floor.security_headers_config[0].strict_transport_security[0].override == false
    error_message = "The BFF edge floor policy must use override=false for every header - it is a floor, never a replacement for bff-handler.ts's own headers"
  }

  assert {
    condition     = aws_cloudfront_response_headers_policy.bff_edge_floor.security_headers_config[0].content_security_policy[0].override == false
    error_message = "CSP on the BFF edge floor must not override the Lambda's own CSP"
  }
}

run "s3_bucket_blocks_all_public_access" {
  command = apply

  assert {
    condition = (
      aws_s3_bucket_public_access_block.spa.block_public_acls &&
      aws_s3_bucket_public_access_block.spa.block_public_policy &&
      aws_s3_bucket_public_access_block.spa.ignore_public_acls &&
      aws_s3_bucket_public_access_block.spa.restrict_public_buckets
    )
    error_message = "The SPA bucket must block all public access - CloudFront reaches it only via OAC"
  }
}

run "s3_origin_uses_oac_never_a_public_url" {
  command = apply

  assert {
    condition     = [for o in aws_cloudfront_distribution.spa.origin : o.origin_access_control_id if o.origin_id == "spa-s3"][0] != ""
    error_message = "The S3 origin must have an Origin Access Control configured"
  }
}

run "bff_origin_never_has_oac" {
  command = apply

  # OAC só se aplica à origem S3 - a origem BFF é HTTPS custom, OAC não se aplica a ela
  # (ADR-0011 Correção 2.6 confirmada pela Rodada 1).
  assert {
    condition     = [for o in aws_cloudfront_distribution.spa.origin : o.origin_access_control_id if o.origin_id == "bff-api"][0] == null
    error_message = "The BFF origin (custom HTTPS) must never have an Origin Access Control - OAC is S3-only"
  }
}

run "all_viewer_traffic_redirects_to_https" {
  command = apply

  assert {
    condition = alltrue(concat(
      [aws_cloudfront_distribution.spa.default_cache_behavior[0].viewer_protocol_policy == "redirect-to-https"],
      [for b in aws_cloudfront_distribution.spa.ordered_cache_behavior : b.viewer_protocol_policy == "redirect-to-https"]
    ))
    error_message = "Every behavior must redirect-to-https - the Secure cookie attributes (D-053/D-054) require it"
  }
}

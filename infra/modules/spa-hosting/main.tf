# SPA hosting: S3 (private, OAC) + CloudFront, coexisting with the Full BFF on a single
# distribution — ADR-0011 (docs/architecture/adr/ADR-0011-cloudfront-bff-coexistence.md).
# Desenho completo debatido em docs/architecture/reviews/spa-hosting-cloudfront-bff/ (6 rodadas
# do protocolo Claude<->Codex, nota final 9,2/9,3).

data "aws_kms_key" "s3_managed" {
  key_id = "alias/aws/s3"
}

# --- S3: private bucket, never a public URL ------------------------------------------------

resource "aws_s3_bucket" "spa" {
  bucket        = "${var.name_prefix}-spa"
  force_destroy = false
  tags          = var.tags
}

resource "aws_s3_bucket_public_access_block" "spa" {
  bucket                  = aws_s3_bucket.spa.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "spa" {
  bucket = aws_s3_bucket.spa.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "spa" {
  bucket = aws_s3_bucket.spa.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = data.aws_kms_key.s3_managed.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "spa" {
  bucket = aws_s3_bucket.spa.id
  versioning_configuration {
    status = "Enabled" # supports the deploy manifest / rollback discipline of etapa 3-4 (immutable-by-hash assets, versioned index.html).
  }
}

# Bucket policy restricted to THIS distribution only (via aws:SourceArn) - never a public read
# ACL/policy. OAC is the only credential CloudFront presents; no other principal is granted.
data "aws_iam_policy_document" "spa_bucket_policy" {
  statement {
    sid       = "AllowCloudFrontOACRead"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.spa.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.spa.arn]
    }
  }
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.spa.arn, "${aws_s3_bucket.spa.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "spa" {
  bucket = aws_s3_bucket.spa.id
  policy = data.aws_iam_policy_document.spa_bucket_policy.json
}

# --- Origin Access Control (never a public bucket URL, never legacy OAI) -------------------

resource "aws_cloudfront_origin_access_control" "spa" {
  name                              = "${var.name_prefix}-spa-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# --- CloudFront Function: SPA routing, associated ONLY to the default (S3) behavior --------
# ADR-0011: resolves the Rodada 2 blocking finding (custom_error_response is distribution-wide,
# not per-behavior, and would have masked real 403/404 responses from the BFF as SPA HTML) by
# construction - CloudFront Functions are associated per cache behavior, so this code never
# executes for a request that already selected the /bff or /bff/* behavior.

resource "aws_cloudfront_function" "spa_routing" {
  name    = "${var.name_prefix}-spa-routing"
  runtime = "cloudfront-js-2.0"
  comment = "SPA client-side routing fallback - ADR-0011, never associated to the BFF behaviors"
  publish = true
  code    = file("${path.module}/spa-routing.js")
}

# --- Response Headers Policies: one for the SPA, one as a floor for the BFF ----------------
# ADR-0011 Correção 6 (v2)/Correção 4 (v5): the two behaviors are never allowed to share a
# policy - default-src 'none' is correct for the BFF's JSON/redirect responses but would break
# the SPA's own HTML/scripts/styles.

resource "aws_cloudfront_response_headers_policy" "spa" {
  name = "${var.name_prefix}-spa-headers"

  security_headers_config {
    strict_transport_security {
      override                   = true
      access_control_max_age_sec = var.bff_edge_security_headers.hsts_max_age_seconds
      include_subdomains         = true
    }
    content_type_options {
      override = true
    }
    referrer_policy {
      override        = true
      referrer_policy = var.bff_edge_security_headers.referrer_policy
    }
    content_security_policy {
      override                = true
      content_security_policy = var.spa_content_security_policy
    }
    frame_options {
      override     = true
      frame_option = "DENY"
    }
  }
}

# Floor for responses that never reach the BFF Lambda (502/503/504 from API Gateway, TLS/
# connection failures) - override=false so a real response from bff-handler.ts (which already
# emits these same values) is NEVER overwritten, only filled in when missing.
resource "aws_cloudfront_response_headers_policy" "bff_edge_floor" {
  name = "${var.name_prefix}-bff-edge-floor-headers"

  security_headers_config {
    strict_transport_security {
      override                   = false
      access_control_max_age_sec = var.bff_edge_security_headers.hsts_max_age_seconds
      include_subdomains         = true
    }
    content_type_options {
      override = false
    }
    referrer_policy {
      override        = false
      referrer_policy = var.bff_edge_security_headers.referrer_policy
    }
    content_security_policy {
      override                = false
      content_security_policy = var.bff_edge_security_headers.content_security_policy
    }
    frame_options {
      override     = false
      frame_option = "DENY"
    }
  }
}

# --- Managed cache / origin request policies (never hand-rolled IDs) -----------------------

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

# ADR-0011 Correção 2 (v2): AllViewer forwards the viewer's Host header to the origin, which an
# execute-api origin does not expect - AllViewerExceptHostHeader is the policy AWS itself
# pre-configures for API Gateway origins (forwards cookies/query strings/other headers,
# substitutes Host for the origin's own hostname).
data "aws_cloudfront_origin_request_policy" "all_viewer_except_host_header" {
  name = "Managed-AllViewerExceptHostHeader"
}

# --- CloudFront distribution: two origins, three behaviors ----------------------------------

locals {
  bff_origin_id = "bff-api"
  spa_origin_id = "spa-s3"
  # Custom origin needs the bare hostname; aws_apigatewayv2_api.api_endpoint is a full https:// URL.
  bff_origin_domain = replace(var.bff_api_endpoint, "https://", "")

  # Every method client.ts can send as a mutation (src/api/client.ts's MUTATING_METHODS) plus
  # GET/HEAD/OPTIONS - ADR-0011 Correção 4 (v2): the CloudFront default restricted method set
  # (GET/HEAD only) would silently break logout and every proxied mutation.
  bff_allowed_methods = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
}

resource "aws_cloudfront_distribution" "spa" {
  enabled             = true
  comment             = "${var.name_prefix} SPA + Full BFF (ADR-0011)"
  default_root_object = "index.html"
  price_class         = var.price_class

  origin {
    origin_id                = local.spa_origin_id
    domain_name              = aws_s3_bucket.spa.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.spa.id
  }

  origin {
    origin_id   = local.bff_origin_id
    domain_name = local.bff_origin_domain
    custom_origin_config {
      origin_protocol_policy = "https-only"
      http_port              = 80
      https_port             = 443
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # ADR-0011 Correção 1 (v4): the exact path "/bff" (no suffix) is NOT covered by "/bff/*" -
  # without this dedicated behavior it would fall through to the default (S3) behavior and get
  # rewritten to index.html by the CloudFront Function. Evaluated before "/bff/*" (order is
  # explicit in ordered_cache_behavior, never "resolved by specificity" - ADR-0011 Correção 3
  # da v2 corrected that exact misconception).
  ordered_cache_behavior {
    path_pattern               = "/bff"
    target_origin_id           = local.bff_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = local.bff_allowed_methods
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host_header.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.bff_edge_floor.id
    compress                   = true
  }

  ordered_cache_behavior {
    path_pattern               = "/bff/*"
    target_origin_id           = local.bff_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = local.bff_allowed_methods
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host_header.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.bff_edge_floor.id
    compress                   = true
  }

  # SPA (S3) — the CloudFront Function is associated HERE ONLY, never on the /bff behaviors
  # above. No custom_error_response is used anywhere in this distribution for 403/404 SPA
  # routing - that was the Rodada 2 blocking finding this design specifically avoids.
  default_cache_behavior {
    target_origin_id           = local.spa_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.spa.id
    compress                   = true

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_routing.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # No custom domain/ACM certificate yet (docs/architecture/adr/ADR-0011 explicitly defers
  # this to etapa 2 of the plan) - CloudFront's own default certificate on its own *.cloudfront.net
  # domain is acceptable for dev, same posture already applied to other dev-only decisions.
  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = var.tags
}

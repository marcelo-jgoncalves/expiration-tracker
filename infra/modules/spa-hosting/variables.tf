# SPA hosting (CloudFront + S3 + Full BFF coexistence) — ADR-0011 (docs/architecture/adr/
# ADR-0011-cloudfront-bff-coexistence.md), debate completo em
# docs/architecture/reviews/spa-hosting-cloudfront-bff/.

variable "name_prefix" {
  description = "Prefix for bucket/distribution/function names (e.g. exptrk-dev)."
  type        = string
}

variable "bff_api_endpoint" {
  description = <<-EOT
    Full https:// endpoint of the Full BFF's dedicated HTTP API
    (module.bff_api.api_endpoint from infra/modules/bff-api-gateway). CloudFront's custom
    origin needs the bare hostname - this module strips the scheme itself (ADR-0011: the
    execute-api regional endpoint works directly as a custom HTTPS origin, no custom domain
    required).
  EOT
  type        = string
}

variable "bff_edge_security_headers" {
  description = <<-EOT
    Security header values the BFF's own runtime already emits (src/runtime/aws/handlers/
    bff-handler.ts), duplicated here as a floor for responses that never reach the Lambda
    (ADR-0011 Correção 4/Correção 2 da v5: 502/503/504 do API Gateway, falha de TLS/conexão).
    Applied with override=false - never overrides a value the Lambda already set. Values must
    be kept in sync with bff-handler.ts by whoever changes either side (no automated drift
    check exists yet, registered as a known gap rather than hidden).
  EOT
  type = object({
    hsts_max_age_seconds    = number
    referrer_policy         = string
    content_security_policy = string
  })
  default = {
    hsts_max_age_seconds    = 63072000
    referrer_policy         = "strict-origin-when-cross-origin"
    content_security_policy = "default-src 'none'; frame-ancestors 'none'"
  }
}

variable "spa_content_security_policy" {
  description = <<-EOT
    CSP for the SPA's own responses (index.html/assets) - deliberately DIFFERENT from
    var.bff_edge_security_headers.content_security_policy (default-src 'none' is correct for
    JSON/redirects, not for an HTML document that needs to load its own scripts/styles/fonts).

    Etapa 2's ADR-0011 assumed per-build script hashes would be needed
    (implementation-blueprint.md §12/§23's Day-0 CSP design predates a real frontend build).
    Verified against the real Vite build output (frontend/dist/index.html) while implementing
    etapa 3: the production build emits ZERO inline <script>/<style> content - every asset is
    loaded via an external, content-hashed URL (script type=module src="/assets/index-*.js",
    link rel=stylesheet href="/assets/index-*.css"). `script-src 'self'`/`style-src 'self'`
    therefore cover every real asset without any hash, exactly like the interim CSP
    frontend/index.html's own <meta> tag already uses - no per-build computation needed. The
    default below mirrors that meta tag's directives, adding `frame-ancestors 'none'` (which a
    meta tag cannot express, but a CloudFront Response Headers Policy can - this is the real
    gap closed by moving the CSP here, not the values themselves).
  EOT
  type        = string
  default     = "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'"
}

variable "price_class" {
  description = "CloudFront price class. PriceClass_100 (US/Canada/Europe only) is the cheapest tier, appropriate for a dev/pilot environment with no real geographic distribution requirement yet."
  type        = string
  default     = "PriceClass_100"
}

variable "tags" {
  description = "Tags applied to resources that support tagging."
  type        = map(string)
  default     = {}
}

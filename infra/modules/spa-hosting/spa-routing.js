// CloudFront Function (viewer-request) — associated ONLY to the default_cache_behavior (S3),
// NEVER to the /bff or /bff/* behaviors (ADR-0011). This is what makes the resolution of the
// Rodada 2 bloqueante ("custom_error_response masks real 403/404 from the BFF as SPA HTML")
// hold by construction: a request that already selected the BFF behavior never reaches this
// function's code at all - CloudFront selects behavior/origin from the ORIGINAL request URI
// before any function runs, and this function can only affect S3-behavior requests.
//
// RESERVED_PREFIXES is a defense-in-depth denylist (the real routing decision already lives in
// the ordered_cache_behavior blocks in main.tf) - kept here, versioned, so any future reserved
// namespace is a one-line diff instead of an implicit assumption. See
// docs/architecture/reviews/spa-hosting-cloudfront-bff/proposal-claude-v6.md Correção 1.
var RESERVED_PREFIXES = ["/bff", "/.well-known/"];

function isReservedPath(uri) {
  for (var i = 0; i < RESERVED_PREFIXES.length; i++) {
    var prefix = RESERVED_PREFIXES[i];
    if (uri === prefix) return true;
    if (prefix.slice(-1) === "/" && uri.indexOf(prefix) === 0) return true;
    if (prefix.slice(-1) !== "/" && uri.indexOf(prefix + "/") === 0) return true;
  }
  return false;
}

function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var method = request.method;

  // Only GET/HEAD are candidates for SPA fallback (ADR-0011 Correção 5 da v3) - defense in
  // depth against a future widening of allowed_methods on the default behavior, which today
  // only accepts GET/HEAD anyway.
  if (method !== "GET" && method !== "HEAD") {
    return request;
  }

  if (isReservedPath(uri)) {
    return request;
  }

  // Rewrite to index.html only when the LAST PATH SEGMENT has no extension - every real build
  // artifact (Vite always hashes JS/CSS/fonts/images with an extension) is left untouched;
  // scripts/check-spa-build-artifacts.ts enforces at CI/deploy time that no other
  // extension-less file is ever published, so this heuristic is backed by a verifiable
  // contract, not an assumption (ADR-0011 Correção 1 da v6).
  var lastSegment = uri.substring(uri.lastIndexOf("/") + 1);
  if (lastSegment.indexOf(".") === -1) {
    request.uri = "/index.html";
  }
  return request;
}

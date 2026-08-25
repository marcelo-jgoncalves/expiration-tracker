# Proposta Claude v3 — Como CloudFront e o BFF coexistem

Revisão após crítica do Codex Rodada 2 (nota 8,5/10, `codex-critique-round2.md`). Mantém a recomendação (Alternativa a) e todas as correções da v2; fecha os 6 pontos que a Rodada 2 listou como necessários para o gate de 9,0.

## Correção 1 (bloqueante da Rodada 2) — SPA routing sem `custom_error_response` global

Achado real aceito integralmente: `custom_error_response` é propriedade da `aws_cloudfront_distribution`, não de um `ordered_cache_behavior` — não existe isolamento por path para 403/404. Se a etapa de implementação configurasse `custom_error_response` (403/404 → `index.html`, técnica padrão de SPA routing) no nível da distribution, um 403 real de CSRF/autorização do BFF ou um 404 real da allowlist viraria `index.html`, e `ApiClient` tentaria fazer `JSON.parse` de HTML (`ApiError.processing`), mascarando o erro real do backend.

**Mecanismo escolhido**: nenhum `custom_error_response`. SPA routing via **CloudFront Function** (`viewer-request`, roda no edge, sem custo de Lambda@Edge) associada só ao `default_cache_behavior` (S3) — CloudFront Functions são associadas por behavior, então o behavior `/bff/*` nunca executa essa function, ponto que resolve o problema por construção, não por convenção:

```js
// infra/modules/spa-hosting/spa-routing.js (esboço)
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  // só reescreve para index.html quando o path não tem extensão de arquivo
  // (rotas de client-side router como /items/123) - nunca toca /bff/* porque
  // esta function só está associada ao default_cache_behavior (S3), nunca ao
  // behavior /bff/*.
  if (!uri.includes(".")) {
    request.uri = "/index.html";
  }
  return request;
}
```

404 real de asset inexistente no S3 (ex. `/favicon.ico` ausente) continua um 404 real do S3 — não é mascarado, é um caso diferente de "rota de client-side router sem extensão", que é o único caso reescrito.

**Teste exigido** (etapa 5 do plano, verificação real): requisição a uma rota `/bff/*` inexistente ou não autorizada deve retornar o corpo/status real do BFF, nunca HTML da SPA — verificado contra CloudFront real, não só `terraform plan`. `infra/tests/` ganha um `terraform test` que confirma que a CloudFront Function está associada apenas ao `default_cache_behavior`.

## Correção 2 — Response Headers Policy dedicada para `/bff/*`, não "nenhuma"

Achado real aceito: "os headers vêm do BFF" só vale para respostas que chegam ao runtime Lambda (`src/runtime/aws/handlers/bff-handler.ts`, não `bff-handlers.ts` — obrigado pela correção de path). Respostas geradas antes do Lambda (falha de TLS/conexão com a origem, 502/503/504 do API Gateway, erro de rota) não carregam esses headers.

Behavior `/bff/*` ganha sua própria `aws_cloudfront_response_headers_policy` (distinta da policy do SPA): HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `frame-ancestors 'none'` — mesmo conjunto que o BFF já emite, aplicado como piso pela borda. Usar o modo `override = false` do CloudFront para headers de segurança (a policy da borda só preenche o que a origem não enviou, nunca substitui um valor que o BFF já setou) — assim uma resposta real do Lambda mantém exatamente o que `bff-handler.ts` decidiu, e só uma resposta de infraestrutura (que nunca passou pelo Lambda) recebe o piso da borda em vez de nada.

## Correção 3 — CORS do fallback: assertion de infraestrutura, não só descrição em prosa

Achado real: a v2 descrevia a correção (adicionar `Idempotency-Key`, `If-Match`, `PATCH` ao `cors_configuration` de `infra/modules/bff-api-gateway/main.tf`) mas não a amarrava a um teste. Fechado agora: a correção do CORS é aplicada nesta mesma decisão (é um bug pré-existente de 1 linha, não uma etapa futura) e `infra/modules/bff-api-gateway`, que já tem `terraform test`, ganha um caso que lê `aws_apigatewayv2_api.bff.cors_configuration` e afirma que `allow_headers` contém os 4 headers reais que `client.ts` envia (`content-type`, `x-csrf-token`, `idempotency-key`, `if-match`) e `allow_methods` contém os 4 métodos de `MUTATING_METHODS` mais `GET`.

## Correção 4 — exposição direta do `execute-api`: owner, trigger e gate, não só "residual"

Achado real: "candidato a WAF numa etapa futura" não é uma pendência governada. Fixado: registrado em `NEXT_SESSION_PROMPT.md` como pendência residual com **gate explícito** — "reavaliar acesso direto ao `execute-api` do BFF (WAF e/ou política de resource policy do API Gateway restringindo a `aws:SourceArn` da distribution) antes de qualquer plano de produção pública real (fora de `dev`/pilot fechado)". Owner: mesmo responsável de qualquer decisão de arquitetura pendente (Marcelo, via protocolo `AGENTS.md` §4, é Type 1). Até lá: throttling e todos os controles de autorização continuam também no API Gateway/BFF (`BffAuthService`), nunca dependendo só do CloudFront — isso já é verdade hoje e continua sendo, não é uma mudança de postura, só uma afirmação explícita de que a defesa não é "só a borda".

## Itens da v2 confirmados sem nova objeção pela Rodada 2 (mantidos sem alteração)

`AllViewerExceptHostHeader`, ordem explícita de `ordered_cache_behavior`, `allowed_methods`/`cached_methods` do behavior `/bff/*`, `CachingDisabled`, OAC só na origem S3, API Gateway regional como custom origin HTTPS sem custom domain, separação conceitual CSP-SPA vs CSP-BFF, `viewer_protocol_policy = redirect-to-https` em ambos os behaviors.

## Desenho concreto atualizado (diff sobre a v2)

```hcl
# comportamento /bff/* - adiciona response_headers_policy_id dedicada (Correção 2)
ordered_cache_behavior {
  path_pattern              = "/bff/*"
  target_origin_id          = "bff-api"
  viewer_protocol_policy    = "redirect-to-https"
  allowed_methods           = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
  cached_methods            = ["GET", "HEAD"]
  cache_policy_id           = data.aws_cloudfront_cache_policy.caching_disabled.id
  origin_request_policy_id  = data.aws_cloudfront_origin_request_policy.all_viewer_except_host_header.id
  response_headers_policy_id = aws_cloudfront_response_headers_policy.bff_edge_floor.id # NOVO - Correção 2
}

# comportamento default (SPA) - associa a CloudFront Function (Correção 1), NUNCA no behavior acima
default_cache_behavior {
  target_origin_id           = "spa-s3"
  viewer_protocol_policy     = "redirect-to-https"
  allowed_methods            = ["GET", "HEAD"]
  cached_methods             = ["GET", "HEAD"]
  cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
  response_headers_policy_id = aws_cloudfront_response_headers_policy.spa.id
  function_association {                              # NOVO - Correção 1
    event_type   = "viewer-request"
    function_arn = aws_cloudfront_function.spa_routing.arn
  }
}

# NENHUM aws_cloudfront_distribution.custom_error_response para 403/404 - Correção 1
```

## O que continua fora do escopo desta decisão (etapas seguintes do plano)

- Valores exatos da CSP da SPA (hashes por build) — etapa 2.
- Certificado ACM / domínio custom — etapa 2.
- Invalidação de `index.html`, deploy imutável por hash — etapas 3/4.
- WAF real / resource policy restringindo `execute-api` — gate registrado (Correção 4), implementação não é parte desta decisão.

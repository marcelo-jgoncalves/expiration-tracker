# Proposta Claude v2 — Como CloudFront e o BFF coexistem

Revisão após crítica do Codex (Rodada 1, nota 7,6/10, ver `codex-critique-round1.md`). Mantém a recomendação (Alternativa a), corrige os erros técnicos apontados e fecha os pontos que a Rodada 1 identificou como indevidamente adiados.

## Recomendação (inalterada): Alternativa (a)

Uma única distribution CloudFront, dois `ordered_cache_behavior`: `/bff/*` → origem custom HTTPS apontando para o domínio regional de `aws_apigatewayv2_api.bff` (sem custom domain necessário no API Gateway — o hostname `execute-api` funciona como origem custom desde que `origin_protocol_policy = "https-only"` e `origin_ssl_protocols = ["TLSv1.2"]`); default behavior → origem S3 com OAC.

## Correção 1 — formulação de "forçado" (achado real do Codex, aceito integralmente)

A Rodada 1 está correta: (a) não é a única arquitetura segura concebível — o CSRF token poderia, em tese, ser entregue por outro canal (corpo de uma resposta de bootstrap) e domínios separados same-site poderiam preservar `SameSite=Strict` com CORS credenciado explícito. Reformulação correta: **(a) é a única alternativa compatível, sem reabrir nenhum design já aprovado (D-053/D-054) nem alterar `client.ts`/`csrf.ts`/o modelo de cookie**. (b) é tecnicamente possível mas exige reabrir esse design fechado (nota 9,2-9,4/10 em duas rodadas) sem nenhum ganho identificado neste estágio — o argumento de custo/benefício continua de pé, só a moldura factual ("forçado" → "sem alternativa que preserve o design atual sem reabri-lo") muda.

## Correção 2 — origin request policy: `AllViewerExceptHostHeader`, não `AllViewer`

Achado real e correto do Codex: `AllViewer` encaminha o header `Host` do viewer (o domínio do CloudFront) para a origem `execute-api`, que espera seu próprio hostname — pode causar falha de handshake/roteamento. A política gerenciada correta é `AllViewerExceptHostHeader` (`b689b0a8-53d0-40ab-baf2-68738e2966ac`), que encaminha cookies/query strings/demais headers e substitui `Host` pelo hostname da origem. É a mesma política que a AWS pré-configura no template de origem para API Gateway. Módulo `spa-hosting` usa essa policy id, não a de `AllViewer`, no behavior `/bff/*`.

## Correção 3 — ordem dos behaviors é explícita, não "automática por especificidade"

Formulação anterior estava factualmente errada. `ordered_cache_behavior` no Terraform é avaliado na ordem em que os blocos aparecem — o primeiro `path_pattern` que casar vence; `default_cache_behavior` só se aplica se nenhum `ordered_cache_behavior` casar. Com apenas `/bff/*` e o default isso já dá o resultado certo, mas o motivo é a ordem declarada, não uma resolução automática por especificidade — registrar isso explicitamente no HCL (comentário) para não confundir quem adicionar um terceiro `path_pattern` no futuro.

## Correção 4 — `allowed_methods` explícito no behavior `/bff/*`

O comportamento restrito default do CloudFront (GET/HEAD) quebraria login/callback (GET, ok) mas também `logout`/`logout-all`/toda a proxy allowlist (POST/PUT/PATCH/DELETE). Behavior `/bff/*` declara `allowed_methods = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]`, `cached_methods = ["GET", "HEAD"]` (irrelevante na prática com `CachingDisabled`, mas correto declarar).

## Correção 5 — CORS de fallback (dev/invocação direta) também tinha gaps reais

Achado real do Codex sobre `infra/modules/bff-api-gateway/main.tf`: `cors_configuration.allow_headers` não inclui `Idempotency-Key` nem `If-Match` (ambos enviados por `client.ts`), e `allow_methods` não inclui `PATCH` (tratado como mutação por `MUTATING_METHODS` mesmo sem uso atual). Isso é um bug pré-existente independente desta decisão de CloudFront, mas descoberto por ela — corrigir junto: adicionar os dois headers e o método faltantes ao `cors_configuration` do módulo `bff-api-gateway`. Não afeta produção via CloudFront (same-origin não passa por CORS), só o caminho de dev/invocação direta que a config já existe para servir.

## Correção 6 — ownership de security headers entre os dois behaviors (fechado nesta decisão, não adiado)

A Rodada 1 está certa: com dois behaviors na mesma distribution, indefinição de qual lado emite qual header é uma lacuna de arquitetura, não um detalhe de sintaxe a adiar. Decisão fixada agora (valores exatos de CSP ficam para a etapa 2 do plano, `infra/modules/spa-hosting`):
- **Behavior S3 (SPA)**: uma Response Headers Policy do CloudFront própria do SPA — HSTS, CSP (hashes estáticos, `implementation-blueprint.md` §12/§23), `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. Aplicada a `index.html` e assets.
- **Behavior `/bff/*`**: **nenhuma** Response Headers Policy do CloudFront sobreposta — os handlers do BFF já emitem seu próprio conjunto (HSTS, `default-src 'none'`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, confirmado em `src/modules/bff/http/bff-handlers.ts`), apropriado para respostas JSON/redirect, não para HTML. Aplicar a policy do SPA aqui sobrescreveria isso incorretamente (é exatamente o erro que a Rodada 1 apontou não decidir por omissão).
- `viewer_protocol_policy = "redirect-to-https"` em **ambos** os behaviors (cookies `Secure` tornam isso obrigatório, não opcional).
- Sem fallback de erro do S3 (`custom_error_response` de SPA-routing, 403/404 → `index.html`) aplicado ao path `/bff/*` — o comportamento de erro do behavior do BFF deve devolver a resposta real do backend, nunca cair no fallback de rota da SPA.

## Correção 7 — exposição direta do endpoint `execute-api`

Achado real, registrado como decisão consciente (não corrigido nesta etapa por não ter mitigação de baixo custo óbvia sem WAF, que não está no escopo aprovado ainda): o endpoint `execute-api` regional do BFF continua publicamente resolvível e aceita requisições que não passam pelo CloudFront, contornando qualquer controle futuro que exista só na borda (WAF, rate limit de CDN). Não quebra a autenticação do BFF em si (`BffAuthService` continua sendo a fronteira real), mas é uma superfície que existia desde a implementação do Full BFF e não é introduzida por esta decisão — registrado como pendência residual não bloqueante em `NEXT_SESSION_PROMPT.md`, candidato a WAF/mitigação de acesso direto numa etapa futura, não parte do escopo desta decisão de coexistência CloudFront/BFF.

## Desenho concreto atualizado (substitui a seção equivalente da v1)

```hcl
# infra/modules/spa-hosting (esboço, não literal)

origin { # S3
  origin_id                = "spa-s3"
  domain_name               = aws_s3_bucket.spa.bucket_regional_domain_name
  origin_access_control_id  = aws_cloudfront_origin_access_control.spa.id
}

origin { # BFF API Gateway
  origin_id   = "bff-api"
  domain_name = replace(var.bff_api_endpoint, "https://", "") # api_endpoint do aws_apigatewayv2_api.bff
  custom_origin_config {
    origin_protocol_policy = "https-only"
    origin_ssl_protocols   = ["TLSv1.2"]
    http_port              = 80
    https_port             = 443
  }
}

ordered_cache_behavior { # avaliado ANTES do default - ordem explícita, não "por especificidade"
  path_pattern           = "/bff/*"
  target_origin_id       = "bff-api"
  viewer_protocol_policy = "redirect-to-https"
  allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
  cached_methods         = ["GET", "HEAD"]
  cache_policy_id        = data.aws_cloudfront_cache_policy.caching_disabled.id
  origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host_header.id
  # nenhuma response_headers_policy_id aqui - os headers vêm do próprio BFF
}

default_cache_behavior { # SPA / S3
  target_origin_id          = "spa-s3"
  viewer_protocol_policy    = "redirect-to-https"
  allowed_methods           = ["GET", "HEAD"]
  cached_methods            = ["GET", "HEAD"]
  cache_policy_id           = data.aws_cloudfront_cache_policy.caching_optimized.id
  response_headers_policy_id = aws_cloudfront_response_headers_policy.spa.id
}
```

## O que continua fora do escopo desta decisão (etapas seguintes do plano)

- Valores exatos da CSP (hashes por build) — etapa 2.
- Certificado ACM / domínio custom — etapa 2, não decidida aqui (CloudFront's own domain aceitável para `dev`).
- Invalidação de `index.html`, deploy imutável por hash — etapas 3/4.
- WAF / mitigação de acesso direto ao `execute-api` — registrado como pendência residual, não bloqueante.

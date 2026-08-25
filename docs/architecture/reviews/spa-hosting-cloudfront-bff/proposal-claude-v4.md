# Proposta Claude v4 — Como CloudFront e o BFF coexistem

Revisão após crítica do Codex Rodada 3 (nota 8,9/10, `codex-critique-round3.md`). Mantém a Alternativa (a) e todas as correções das v2/v3; fecha os 8 pontos listados como necessários para o gate de 9,0.

## Correção 1 — path exato `/bff` (sem sufixo) fechado explicitamente

Achado real aceito: `path_pattern = "/bff/*"` não cobre `GET /bff` (sem barra/sufixo) — esse path cai no `default_cache_behavior`, não tem ponto no URI, e a CloudFront Function o reescreveria para `/index.html`. Fechado com um terceiro comportamento explícito em vez de depender de reescrita:

```hcl
ordered_cache_behavior {          # NOVO - path exato, avaliado antes de /bff/*
  path_pattern              = "/bff"
  target_origin_id          = "bff-api"
  viewer_protocol_policy    = "redirect-to-https"
  allowed_methods           = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
  cached_methods            = ["GET", "HEAD"]
  cache_policy_id           = data.aws_cloudfront_cache_policy.caching_disabled.id
  origin_request_policy_id  = data.aws_cloudfront_origin_request_policy.all_viewer_except_host_header.id
  response_headers_policy_id = aws_cloudfront_response_headers_policy.bff_edge_floor.id
}
ordered_cache_behavior {          # /bff/* - já existia na v3
  path_pattern = "/bff/*"
  # ... idêntico ao path exato acima
}
```

`GET /bff` sem rota registrada no BFF simplesmente recebe o 404 real do API Gateway/handler — nunca HTML. Nenhuma rota do produto usa hoje `/bff` sem sufixo (confirmado em `local.bff_routes` de `infra/modules/bff-api-gateway/main.tf` — todas começam com `/bff/`), então este behavior nunca serve tráfego funcional hoje; existe só para fechar o contrato "namespace `/bff` inteiro nunca vira HTML da SPA", que é a propriedade que a Rodada 3 pediu.

## Correção 2 — heurística da CloudFront Function: denylist do namespace reservado + allowlist de extensão, não "sem ponto = SPA"

Achado real aceito: `!uri.includes(".")` classificaria incorretamente um asset estático futuro sem extensão (`/manifest`, `/.well-known/acme-challenge/...`) como rota SPA. Reescrita como contrato explícito:

```js
// infra/modules/spa-hosting/spa-routing.js
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var method = request.method;

  // Correção 5: só GET/HEAD são candidatos a fallback de SPA - qualquer outro
  // método passa intocado (o default behavior já só aceita GET/HEAD, isto é
  // defesa em profundidade contra uma futura ampliação de allowed_methods).
  if (method !== "GET" && method !== "HEAD") {
    return request;
  }

  // Namespace reservado - nunca reescrito, mesmo que caia aqui por engano
  // (defesa em profundidade; o roteamento real de /bff* já é feito pelos
  // ordered_cache_behavior dedicados, esta function nunca deveria nem
  // executar para essas requisições).
  if (uri === "/bff" || uri.indexOf("/bff/") === 0) {
    return request;
  }

  // .well-known (ACME, etc.) nunca é rota de SPA.
  if (uri.indexOf("/.well-known/") === 0) {
    return request;
  }

  // Só reescreve para index.html quando o último segmento do path não tem
  // extensão de arquivo - assets publicados (JS/CSS/imagens/fontes, todos
  // com extensão pelo próprio build do Vite) nunca são afetados. Um recurso
  // estático futuro sem extensão exigiria ser adicionado à lista acima ou
  // publicado sob um prefixo dedicado - contrato deliberadamente restritivo.
  var lastSegment = uri.substring(uri.lastIndexOf("/") + 1);
  if (lastSegment.indexOf(".") === -1) {
    request.uri = "/index.html";
  }
  return request;
}
```

## Correção 3 — suíte de testes da function (unitário) + verificação real (Camada 3)

Novo, exigido pela Rodada 3. `infra/modules/spa-hosting` ganha testes unitários puros da function (Node, sem AWS) cobrindo: `/` → `/index.html`; `/items/123` (rota SPA com parâmetro) → `/index.html`; `/assets/index-a1b2c3.js` → preservado; `/bff`, `/bff/`, `/bff/api/items` → preservados (nunca reescritos, ainda que por defesa em profundidade); `/.well-known/acme-challenge/x` → preservado; método `POST` para qualquer path → preservado; query string preservada em todos os casos de reescrita. Etapa 5 (verificação real) do plano em `NEXT_SESSION_PROMPT.md` ganha explicitamente: uma chamada real a `/bff` e `/bff/algo-inexistente-e-nao-autorizado` contra o CloudFront real, afirmando que a resposta é a resposta real do BFF (status 401/403/404 conforme o caso, `Content-Type` não-HTML, corpo não é o `index.html` da SPA) — não só `terraform plan`.

## Correção 4 — Response Headers Policy do BFF: valores concretos + teste de resposta pré-Lambda

Achado real aceito: "mesmo conjunto que o BFF já emite" em prosa não é verificável, e falta cobrir explicitamente que `frame-ancestors` é diretiva de CSP, não header próprio. `aws_cloudfront_response_headers_policy.bff_edge_floor` (introduzida na v3) fixa agora os valores exatos, com `override = false` em todos:
- `strict_transport_security` (HSTS): `access_control_max_age_sec = 63072000`, `include_subdomains = true`, `preload = false` (mesmos valores que `bff-handler.ts` já emite, confirmar na implementação em vez de reafirmar aqui um número que pode ter mudado).
- `content_security_policy`: `default-src 'none'; frame-ancestors 'none'` — via `custom_headers_config` (CSP não tem bloco dedicado na response headers policy da AWS), `override = false`.
- `content_type_options`: `nosniff` (`override = false`).
- `referrer_policy`: mesmo valor de `bff-handler.ts` (`override = false`).
Teste real exigido (etapa 5): forçar uma resposta que não passa pelo Lambda (ex. método não permitido no API Gateway antes da integração, ou uma rota inexistente no nível do API Gateway) e confirmar que os 4 headers chegam ao browser mesmo assim — é exatamente o caso que motiva a policy existir.

## Correção 5 — teste CORS preserva `allow_credentials` e origem explícita, não só headers/métodos

Achado real aceito: testar só `allow_headers`/`allow_methods` permitiria uma regressão independente em `allow_credentials` ou em `allow_origins` (ex. alguém trocar por `["*"]`, o que o browser rejeita com `credentials: "include"` mas seria uma regressão silenciosa até alguém testar manualmente). O `terraform test` novo em `infra/modules/bff-api-gateway` (Correção 3 da v3) afirma os 4: `allow_headers` contém os 4 headers reais (comparação por conjunto, sem depender de ordem/capitalização), `allow_methods` contém os métodos de `MUTATING_METHODS` + `GET`, `allow_credentials == true`, `allow_origins == [var.app_origin]` (nunca wildcard).

## Correção 6 — gate do `execute-api`: `aws:SourceArn` é hipótese a validar, não mitigação presumida

Achado real aceito e importante: CloudFront acessando um custom origin HTTP(S) não carrega a identidade IAM de uma integração assinada — uma resource policy do API Gateway restringindo por `aws:SourceArn` da distribution **não se aplica** a esse modelo de origem (isso funciona para origens S3 com OAC, que é uma integração assinada SigV4; não é o caso de uma origem HTTPS custom). Correção do texto do gate: a lista de mecanismos candidatos a avaliar quando o gate disparar (produção pública real, fora de `dev`/pilot) passa a ser, sem pré-aprovar nenhum: (a) um custom header secreto gerado no CloudFront e validado pelo BFF antes de qualquer outro processamento; (b) AWS WAF associado à distribution (não resolve o bypass do endpoint direto sozinho, mas cobre a borda); (c) restringir o `execute-api` a um VPC endpoint privado + CloudFront com VPC origin (mudança de topologia maior, fora do escopo de avaliação leve). Nenhuma dessas é implementada nesta decisão — só o gate e a lista de candidatos reais (antes: "WAF e/ou resource policy `aws:SourceArn`", que continha uma opção tecnicamente inválida).

## Itens das v2/v3 confirmados sem nova objeção pela Rodada 3 (mantidos sem alteração)

Escolha da CloudFront Function sobre `custom_error_response` (validada explicitamente pela Rodada 3 como resolvendo o mascaramento por construção), evento `viewer-request` (correto, antes da consulta ao cache), `AllViewerExceptHostHeader`, ordem explícita de `ordered_cache_behavior`, `allowed_methods`/`cached_methods`, `CachingDisabled`, OAC só na origem S3, separação CSP-SPA vs CSP-BFF.

## O que continua fora do escopo desta decisão (etapas seguintes do plano)

Valores exatos da CSP da SPA (hashes por build), certificado ACM/domínio custom, invalidação de `index.html`/deploy imutável por hash, implementação real de qualquer mecanismo do gate do `execute-api` (só o gate e os candidatos válidos são fixados aqui).

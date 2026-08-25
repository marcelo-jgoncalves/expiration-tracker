# ADR-0011 — Coexistência CloudFront + Full BFF numa única distribution

**Status**: Aceito | **Data**: 2026-08-25 | **Type**: Type 1 (nível 5-6, `docs/engineering/change-risk-scale.md` — decisão de arquitetura, protocolo `AGENTS.md` §4 aplicado) | **Decisor**: protocolo Claude↔Codex, 6 rodadas, nota final 9,2/9,3 sobre 10 (sem arredondar)

## Contexto

O plano de infra de hospedagem do SPA (`NEXT_SESSION_PROMPT.md`) precisava fechar, antes de qualquer Terraform novo, como uma distribution CloudFront (servindo o SPA via S3 privado) coexiste com o Full BFF já implementado e aprovado (D-053/D-054, `docs/frontend/frontend-production-foundation.md`). `frontend/src/api/client.ts` assume same-origin como axioma (`baseUrl = "/bff/api"`, path relativo, `credentials: "include"`); os três cookies de sessão (`src/modules/bff/domain/cookies.ts`) usam o prefixo `__Host-`, que o browser só aceita sem atributo `Domain` — uma restrição real, não uma preferência de configuração.

## Options Considered

1. **(a) Uma única distribution CloudFront, dois behaviors/origens** (escolhida) — `/bff` e `/bff/*` → origem custom HTTPS apontando para o domínio regional do API Gateway do BFF; default behavior → S3 privado com Origin Access Control (OAC). Mantém same-origin, zero mudança em `client.ts`/`cookies.ts`/`csrf.ts`.
2. (b) Domínios separados (`app.exemplo.com`/`api.exemplo.com`) com CORS credenciado explícito — tecnicamente possível (Rodada 1 corrigiu a tese inicial de que seria "tecnicamente forçado" descartar isso), mas exige reabrir o design já fechado do CSRF double-submit e do modelo de cookie (D-053/D-054, nota 9,2-9,4/10 em duas rodadas) sem nenhum ganho identificado neste estágio do projeto — rejeitada por custo/benefício, não por impossibilidade técnica.

## Desenho aprovado

- **Origem S3**: bucket privado, OAC (nunca URL pública nem OAI legado).
- **Origem BFF**: origem custom HTTPS apontando para o `api_endpoint` regional de `aws_apigatewayv2_api.bff` (sem custom domain necessário) — `origin_protocol_policy = "https-only"`, `origin_ssl_protocols = ["TLSv1.2"]`.
- **Dois `ordered_cache_behavior` explícitos** para o namespace do BFF — `path_pattern = "/bff"` (path exato) **e** `path_pattern = "/bff/*"` (achado real da Rodada 3: o pattern com wildcard sozinho não cobre o path exato, que cairia no default behavior) — ambos com `cache_policy_id = CachingDisabled`, `origin_request_policy_id = AllViewerExceptHostHeader` (achado real da Rodada 1: `AllViewer` encaminharia o `Host` do viewer para uma origem `execute-api` que espera seu próprio hostname), `allowed_methods` explícito incluindo todos os métodos mutantes, e uma Response Headers Policy dedicada com `override = false` (piso de segurança só para respostas que nunca chegam ao Lambda — falha de conexão, 502/503/504 do API Gateway).
- **`default_cache_behavior`** (S3): `cache_policy_id = CachingOptimized`, Response Headers Policy própria da SPA (CSP com hashes de build, HSTS, `frame-ancestors`), e uma **CloudFront Function em `viewer-request`** associada só a este behavior — nunca ao behavior do BFF — que reescreve para `/index.html` qualquer path GET/HEAD fora de uma denylist versionada (`RESERVED_PREFIXES = ["/bff", "/.well-known/"]`) cujo último segmento não tenha extensão. Achado real da Rodada 2: `custom_error_response` (a técnica padrão de SPA routing via 403/404→index.html) é propriedade da distribution inteira, não por behavior — teria mascarado 403/404 reais do BFF como HTML da SPA. A CloudFront Function resolve isso por construção (nunca executa para requisições que já selecionaram o behavior do BFF), não por convenção.
- **Regra de publicação**: nenhum artefato do build do Vite fica sem extensão fora de `index.html` — verificado por um script de CI compartilhado (`scripts/check-spa-build-artifacts.ts`, a escrever na etapa de implementação) rodado tanto no job `guardrails` de `ci.yml` quanto no job de deploy de `cd.yml`.
- **Fix de 1 linha, pré-existente, descoberto por esta revisão**: `src/modules/bff/application/proxy-service.ts` nunca encaminhava o header `Idempotency-Key` ao backend (`FORWARDED_REQUEST_HEADERS` só tinha `content-type`/`if-match`) — corrigido junto, senão a correção de CORS desta decisão teria permitido o header no preflight sem ele chegar à API de recurso.
- **Fix de CORS de fallback** (dev/invocação direta, `infra/modules/bff-api-gateway/main.tf`): `allow_headers` ganha `idempotency-key`/`if-match`, `allow_methods` ganha `PATCH` — gaps reais confirmados contra `client.ts`, cobertos por `terraform test` novo (headers, métodos, `allow_credentials`, `allow_origins`, tudo verificado, não só descrito).
- **Gate registrado, não implementado nesta decisão**: o endpoint `execute-api` regional continua publicamente resolvível, contornando qualquer controle futuro que exista só na borda CloudFront (WAF, rate limit). Owner: Marcelo (Type 1). Trigger: antes de qualquer plano de produção pública real fora de `dev`/pilot fechado. Candidatos válidos a avaliar então (achado real da Rodada 4/5: `aws:SourceArn` não se aplica a uma origem custom HTTPS não-assinada, e CloudFront VPC origins não suportam API Gateway diretamente): header estático na origem (`custom_header`) validado pelo BFF, e/ou AWS WAF na distribution (nenhum dos dois sozinho é suficiente).

## Evidence

Debate completo (6 rodadas, propostas v1-v6, críticas e notas cegas de ambos os lados) em `docs/architecture/reviews/spa-hosting-cloudfront-bff/`. Cada rodada corrigiu pelo menos um erro técnico real verificado contra a documentação da AWS ou o código real do repositório (nunca uma correção cosmética) — ver os arquivos `codex-critique-round{1..6}*.md` e `claude-score-round{1..6}*.md` para o detalhe de cada achado.

## Reliability Impact

Sem isso, o risco real era duplo: (1) um erro de origin request policy (`AllViewer`) poderia ter quebrado silenciosamente a integração do BFF em produção só depois do deploy; (2) um `custom_error_response` mal desenhado teria mascarado erros reais de autorização/CSRF do BFF como a página da SPA, um problema de observabilidade e potencialmente de segurança (um 403 de CSRF virando 200 com HTML é uma classe de bug que esconde falhas de autorização do time e do usuário).

## Trade-offs

- **A favor**: zero mudança no design de sessão/CSRF já aprovado (D-053/D-054); uma única distribution simplifica operação; `__Host-` cookies continuam com a garantia de isolamento que motivou sua escolha original.
- **Contra**: o endpoint `execute-api` continua exposto diretamente até um gate futuro resolver isso (aceito conscientemente, não é regressão desta decisão); a CloudFront Function de SPA routing precisa de disciplina de manutenção (`RESERVED_PREFIXES` versionado) se novos prefixos reservados aparecerem no futuro.

## Final Decision

Aprovado. Implementação (módulo Terraform `infra/modules/spa-hosting`, script de validação de build, fixes de `proxy-service.ts`/CORS) é a próxima etapa concreta do plano em `NEXT_SESSION_PROMPT.md`.

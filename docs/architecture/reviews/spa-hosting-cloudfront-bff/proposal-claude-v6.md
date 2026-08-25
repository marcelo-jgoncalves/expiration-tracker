# Proposta Claude v6 — Como CloudFront e o BFF coexistem

Revisão após crítica do Codex Rodada 5 (nota 8,8/10, `codex-critique-round5.md`). Mantém a Alternativa (a) e todas as correções anteriores; fecha os 5 pontos remanescentes.

## Correção 1 — matriz de verificação real: adiciona caso 403 determinístico

Achado real aceito: a Rodada 4 já tinha pedido "pelo menos um 403 real", a v5 não incluiu. Confirmado em `src/modules/bff/http/bff-handlers.ts:170-182` (`handleProxy`) — CSRF ausente/divergente numa mutação proxied retorna `{ statusCode: 403, body: { code: "CSRF_CHECK_FAILED", category: "AUTHORIZATION", ... } }`.

## Correção 2 — V6 com path literal real, não condicional

Achado real aceito: `/manifest (se existir)` não é determinístico. Substituído por `/items` — rota real e estável, confirmada em `frontend/src/App.tsx:54` (`<Route path="items" element={<ItemsCollection />} />`).

## Correção 3 — V1/V2: camada produtora do 404 é o API Gateway pré-Lambda, não "API Gateway/BFF"

Achado real aceito: `infra/modules/bff-api-gateway/main.tf` não define nenhuma rota `$default` — `local.bff_routes` só registra os 6 paths conhecidos. Um path não roteado (`/bff`, `/bff/`) nunca invoca a Lambda; o 404 é gerado pelo próprio API Gateway HTTP API antes de qualquer código do BFF rodar. Camada corrigida para as duas linhas.

## Matriz final (substitui a da v5)

| Caso | Path | Método | Estado de auth/CSRF | Camada produtora | Status esperado | Verificação |
|---|---|---|---|---|---|---|
| V1 | `/bff` | GET | n/a | API Gateway HTTP API, pré-Lambda (rota não registrada em `local.bff_routes`) | 404 | `Content-Type` não-HTML, corpo != `index.html`; confirmar ausência de invocação da Lambda (métrica/log) |
| V2 | `/bff/` | GET | n/a | API Gateway HTTP API, pré-Lambda | 404 | idem V1 |
| V3 | `/bff/session` | GET | sem sessão | BFF (`bff-handler.ts`, rota real) | 200, `{authenticated: false}` | `Content-Type: application/json` |
| V4 | `/bff/api/items` | GET | sem sessão (sem cookie) | `BffAuthService` | 401 | `Content-Type` não-HTML |
| V5-404 | `/bff/api/rota-nao-allowlisted` | GET | com sessão válida | `proxy-allowlist.ts` | 404 | `Content-Type` não-HTML, corpo != `index.html` |
| V5-403 | `/bff/api/items` | POST | com sessão válida, CSRF ausente/divergente | `handleProxy`/`checkCsrf` (`bff-handlers.ts:170-182`) | 403, `code: "CSRF_CHECK_FAILED"` | JSON, corpo != `index.html` |
| V6 | `/items` | GET | n/a | S3 via fallback da CloudFront Function (rota React Router real, `App.tsx:54`) | 200, corpo = `index.html` | confirma o fallback de SPA no caso legítimo |

## Correção 4 — mecanismo de injeção do header secreto: remove `origin-request` (não suportado por CloudFront Functions)

Achado real aceito: CloudFront Functions só suportam `viewer-request`/`viewer-response` — `origin-request`/`origin-response` exigem Lambda@Edge, não CloudFront Functions. Candidato 5(a) do gate do `execute-api` corrigido: **header estático configurado na origem custom** (`custom_header` no bloco `origin` do Terraform da distribution — nomenclatura correta, não `custom_headers_config`, que é um bloco diferente) é o mecanismo simples (valor fixo, sem lógica dinâmica — CloudFront sempre injeta o mesmo header em toda requisição que sai para aquela origem, o BFF valida contra um valor conhecido). Lambda@Edge em `origin-request` registrado só como alternativa se um dia houver necessidade real de lógica dinâmica (rotação automática, por exemplo) — não avaliada em detalhe aqui por não haver esse requisito hoje.

## Correção 5 — política de validação de `frontend/dist/`: roda no CI de PR, não só no deploy

Achado real aceito (contradição operacional): a validação de "nenhum arquivo sem extensão fora de `index.html`" precisa rodar antes de qualquer coisa chegar a `develop`/`main`, não só na hora de publicar. Fixado: o checker é um script (`scripts/check-spa-build-artifacts.ts`, mesmo padrão de `scripts/check-doc-drift.ts` já existente) invocado tanto pelo job `guardrails` do `ci.yml` (depois de `npm run build` do frontend, todo PR) quanto pelo job de deploy do `cd.yml` (mesma checagem, defesa em profundidade antes de sincronizar para S3) — um único script, dois call sites, nunca dois checkers divergentes.

## Itens das v2-v5 confirmados sem nova objeção pela Rodada 5 (mantidos sem alteração)

`RESERVED_PREFIXES` versionado, behaviors `/bff` e `/bff/*` explícitos, CloudFront Function em `viewer-request` só no default behavior, guarda de método GET/HEAD, valores literais de `Referrer-Policy`/CSP/HSTS/nosniff via bloco nativo `content_security_policy`, forwarding de `idempotency-key` em `proxy-service.ts`, remoção do VPC origin inválido do gate, `AllViewerExceptHostHeader`, ordem explícita de `ordered_cache_behavior`, `CachingDisabled`, OAC só na origem S3, teste CORS cobrindo headers/métodos/`allow_credentials`/`allow_origins`.

## O que continua fora do escopo desta decisão (etapas seguintes do plano)

Valores exatos da CSP da SPA (hashes por build), certificado ACM/domínio custom, invalidação de `index.html`/deploy imutável por hash, implementação real de qualquer candidato do gate do `execute-api`.

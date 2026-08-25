# Proposta Claude — Como CloudFront e o BFF coexistem

Decisão de arquitetura Type 1 (nível 5-6, `docs/engineering/change-risk-scale.md`), etapa 1 do plano de infra de hospedagem do SPA (`NEXT_SESSION_PROMPT.md`). Objeto: `frontend/src/api/client.ts` (baseUrl `/bff/api`, `credentials: "include"`) e as três famílias de cookie de `src/modules/bff/domain/cookies.ts` (`__Host-et_session`, `__Host-et_login`, `__Host-et_csrf`) precisam continuar funcionando quando o SPA passa a ser servido via CloudFront+S3 em vez de (hoje) diretamente.

## Recomendação: Alternativa (a) — uma única distribution CloudFront, dois comportamentos/origens

`/bff/*` → origem API Gateway do BFF (`infra/modules/bff-api-gateway`); todo o resto → origem S3 privada (OAC). Mesmo domínio, mesma origem lógica do ponto de vista do browser. Nenhuma mudança em `client.ts`, `cookies.ts`, `csrf.ts` ou no CORS do BFF.

## Por que não é uma escolha de gosto — é forçada pelo design já aprovado

Isto não é uma preferência de engenharia nova sendo introduzida agora; é a única alternativa compatível com decisões **já fechadas e implementadas** (D-053/D-054):

1. **O prefixo `__Host-` é uma restrição imposta pelo browser, não uma configuração nossa.** Um cookie `__Host-*` só é aceito pelo browser se: `Secure`, **sem atributo `Domain`**, `Path=/`. Isso significa que a Alternativa (b) (domínios separados, ex. `app.exemplo.com` + `api.exemplo.com`) não pode simplesmente adicionar `Domain=exemplo.com` para compartilhar os cookies entre os dois — faria o browser **rejeitar silenciosamente** os três cookies de sessão. A única forma de (b) funcionar seria abandonar o prefixo `__Host-`, o que reabre uma garantia de segurança específica que D-053/D-054 fecharam deliberadamente (nenhuma variante de subdomínio pode ler/sobrescrever o cookie).
2. **`client.ts` já assume same-origin como axioma, não como detalhe.** `baseUrl = "/bff/api"` é um path relativo — só existe uma origem no modelo mental do código. `credentials: "include"` com fetch cross-origin exige CORS com `Access-Control-Allow-Credentials: true` e origem explícita (nunca `*`), o que já está parcialmente presente (`infra/modules/bff-api-gateway/main.tf` já configura `cors_configuration` com `allow_credentials = true`) — mas essa config existe hoje só como fallback para dev local/invocação direta, não como o modelo de produção (o próprio comentário no topo do arquivo já registra isso: "In production this API sits behind CloudFront at the same origin as the static SPA (...) - same-origin is a hard requirement for the session cookie to work at all without CORS gymnastics").
3. **CSRF double-submit depende de same-origin.** `csrf.ts`/`client.ts` leem o cookie `__Host-et_csrf` (não-HttpOnly) via `document.cookie` e ecoam como header `X-CSRF-Token`. Isso já pressupõe que o JS da SPA consegue ler um cookie escrito pelo BFF na mesma origem — outra garantia que desaparece cruzando domínios sem reabrir o desenho de CSRF do zero.
4. **A infra já foi escrita presumindo (a).** O comentário em `infra/modules/bff-api-gateway/main.tf:8-13` já documenta a topologia de destino (CloudFront na frente, `/bff/*` roteado para esta API, resto para S3) — isso não é uma proposta nova, é a confirmação formal de uma suposição de design que já está no código desde a implementação do Full BFF.

Ou seja: (b) não é "a alternativa mais simples só que muda CORS" — é reabrir D-053/D-054 (protocolo já fechado, nota 9,2-9,4/10 em duas rodadas) para trocar o modelo de cookie por um menos seguro, sem nenhum ganho compensatório identificado. Não há um caso de negócio real para domínios separados neste estágio (não há CDN de terceiros, não há múltiplos frontends consumindo o mesmo BFF).

## Desenho concreto da Alternativa (a)

- **Uma `aws_cloudfront_distribution`** em um módulo novo `infra/modules/spa-hosting`.
- **Origem 1 (S3)**: bucket privado, `origin_access_control` (OAC, nunca OAI legado nem URL pública), `default_cache_behavior` aponta para cá.
- **Origem 2 (API Gateway do BFF)**: origem custom (HTTPS, domínio regional do `aws_apigatewayv2_api.bff`), `ordered_cache_behavior` com `path_pattern = "/bff/*"` — CloudFront resolve por especificidade, então isso tem prioridade sobre o `default_cache_behavior` do S3 automaticamente, nenhuma configuração extra de ordem necessária.
- **Cache behavior do `/bff/*`**: `cache_policy_id` = `CachingDisabled` (gerenciada pela AWS) — respostas do BFF nunca podem ser cacheadas (são todas por-sessão). `origin_request_policy_id` precisa encaminhar `Cookie`, `Authorization` (não usado, mas inofensivo) e todos os headers relevantes (`X-CSRF-Token`) — usar `AllViewer` gerenciada em vez de compor uma lista manual, risco menor de esquecer um header no futuro.
- **`app_origin` do BFF** (`infra/modules/bff-api-gateway/variables.tf`, hoje usado só no CORS de fallback) passa a ser o domínio do CloudFront, não o domínio do API Gateway.
- **Sem mudança em `cookies.ts`, `csrf.ts`, `client.ts`** — é exatamente o ponto do desenho: a fronteira de sessão já aprovada continua válida sem alteração.

## O que fica em aberto para as próximas etapas (não é parte desta decisão)

- Certificado ACM / domínio custom para `dev` — este documento não decide isso; se não houver domínio decidido, o domínio próprio do CloudFront (`*.cloudfront.net`) é aceitável para `dev`, mesma postura já adotada para outras decisões de ambiente descartável.
- Response Headers Policy (CSP/HSTS/frame-ancestors) — etapa 2 do plano em `NEXT_SESSION_PROMPT.md`, não decidida aqui.
- Invalidação de `index.html` no deploy — etapa 3/4, não decidida aqui.

## Pergunta direta para a rodada de crítica

Existe algum cenário real (não hipotético) em que domínios separados (Alternativa b) trariam um benefício que supere o custo de reabrir D-053/D-054? Se não, a única coisa que resta validar é o desenho concreto de (a) acima (behaviors, cache policy, origin request policy) — não a escolha entre (a) e (b) em si, que já está determinada pelas restrições do `__Host-` prefix.

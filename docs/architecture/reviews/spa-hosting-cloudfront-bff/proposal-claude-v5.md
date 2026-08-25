# Proposta Claude v5 — Como CloudFront e o BFF coexistem

Revisão após crítica do Codex Rodada 4 (nota 8,9/10, `codex-critique-round4.md`). Mantém a Alternativa (a) e todas as correções anteriores; fecha os 5 pontos listados como necessários para o gate de 9,0.

## Correção 1 — política de assets sem extensão: denylist versionada + teste de build, não heurística solta

Achado real aceito: a v4 documentou a lacuna sem fechá-la. Fechado agora como contrato de duas partes:
1. **Regra de publicação** (`infra/modules/spa-hosting`, aplicada no passo de sync para S3 da etapa 3/4 do plano): todo artefato publicado sob o prefixo de build do Vite (`frontend/dist/assets/**`) tem extensão por construção (Vite sempre gera `*.js`/`*.css`/`*.woff2`/etc. com hash) — a única exceção estrutural é `index.html`, que é tratado à parte (nunca passa pela function, é o alvo dela). Nenhum outro arquivo sem extensão é publicado na raiz do bucket; um teste de CI (`scripts/`, rodado no job de deploy) falha o build se `frontend/dist/` contiver, fora de `index.html`, qualquer arquivo cujo nome não tenha `.`.
2. **Denylist explícita na function**, substituindo a heurística implícita da v4: em vez de só excluir `/bff*` e `/.well-known/*`, a lista de prefixos reservados fica centralizada numa constante versionada na própria function (`RESERVED_PREFIXES`), documentada com um comentário apontando para esta decisão — qualquer prefixo estático futuro que precise ficar de fora do fallback de SPA entra nessa lista, nunca inferido implicitamente por "tem ponto ou não".

```js
// infra/modules/spa-hosting/spa-routing.js
var RESERVED_PREFIXES = ["/bff", "/.well-known/"]; // ver docs/architecture/reviews/spa-hosting-cloudfront-bff/ - qualquer prefixo estático novo que não deva cair no fallback de SPA entra aqui, nunca inferido pela presença de "." no path.

function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var method = request.method;

  if (method !== "GET" && method !== "HEAD") return request;

  for (var i = 0; i < RESERVED_PREFIXES.length; i++) {
    var prefix = RESERVED_PREFIXES[i];
    if (uri === prefix || uri.indexOf(prefix + "/") === 0 || uri.indexOf(prefix) === 0 && prefix.slice(-1) === "/") {
      return request;
    }
  }

  var lastSegment = uri.substring(uri.lastIndexOf("/") + 1);
  if (lastSegment.indexOf(".") === -1) {
    request.uri = "/index.html";
  }
  return request;
}
```
(A combinação de regra de publicação + denylist explícita é o que a Rodada 4 pediu como "assumir formalmente uma destas opções" — aqui as duas juntas, porque são baratas e se reforçam: a denylist cobre namespaces de rota reservados, a regra de build cobre assets.)

## Correção 2 — matriz de verificação real (Camada 3), determinística

Substitui "401/403/404 conforme o caso" por casos fixos e nomeados, todos exigidos na etapa 5 do plano:

| Caso | Path | Estado de auth | Camada que responde | Status esperado | Verificação |
|---|---|---|---|---|---|
| V1 | `/bff` | sem sessão | API Gateway/BFF (rota inexistente) | 404 | `Content-Type` não-HTML, corpo != `index.html` |
| V2 | `/bff/` | sem sessão | API Gateway/BFF (rota inexistente) | 404 | idem |
| V3 | `/bff/session` | sem sessão | BFF (`bff-handler.ts`, rota real) | 200 com `{authenticated: false}` (contrato já existente do endpoint) | `Content-Type: application/json` |
| V4 | `/bff/api/items` | sem sessão (sem cookie) | BFF (`BffAuthService`) | 401 | `Content-Type` não-HTML |
| V5 | `/bff/api/rota-nao-allowlisted` | com sessão válida | BFF (`proxy-allowlist.ts`) | 404 | `Content-Type` não-HTML, corpo != `index.html` |
| V6 | `/manifest` (se existir) ou qualquer path sem extensão fora de `RESERVED_PREFIXES` | n/a | S3 via fallback da function | 200, corpo = `index.html` | confirma que o fallback de SPA funciona para o caso legítimo |

V3/V4/V5 exercitam três camadas diferentes (BFF respondendo normalmente, `BffAuthService` barrando por falta de sessão, allowlist barrando por rota não registrada) — nenhuma delas pode regredir para outra sem que a matriz detecte.

## Correção 3 — Response Headers Policy: valor literal do Referrer-Policy + correção sobre o bloco nativo de CSP

Achado real aceito nos dois pontos. Valores confirmados lendo `src/runtime/aws/handlers/bff-handler.ts:46-49` (não mais "mesmo valor de"):
- `strict_transport_security`: `access_control_max_age_sec = 63072000`, `include_subdomains = true`, `override = false`.
- `content_type_options`: `nosniff` (bloco nativo `content_type_options`), `override = false`.
- `referrer_policy`: **`"strict-origin-when-cross-origin"`** (bloco nativo `referrer_policy`), `override = false`.
- `content_security_policy`: **`"default-src 'none'; frame-ancestors 'none'"`**, via o bloco nativo `content_security_policy` de `security_headers_config` (a v4 estava errada ao dizer que CSP "não tem bloco dedicado" — `aws_cloudfront_response_headers_policy.security_headers_config.content_security_policy` existe e é o bloco correto a usar, não `custom_headers_config`), `override = false`.

## Correção 4 — `Idempotency-Key` precisa ser encaminhado pelo proxy, não só permitido no CORS

Achado real e mais importante desta rodada: `src/modules/bff/application/proxy-service.ts:14` define `FORWARDED_REQUEST_HEADERS = ["content-type", "if-match"]` — o header `Idempotency-Key` **nunca chega à API de recurso hoje**, mesmo já sendo enviado por `client.ts`/`useIdempotentMutation.ts` desde a sessão que fechou `CREATE-IDEMPOTENCY-01`. Isto é um bug pré-existente real, descoberto por esta revisão, independente de CloudFront — mas como a Correção de CORS desta mesma decisão permitiria o header no preflight sem isso, ficaria uma correção incompleta (o header passaria pelo CORS e seria silenciosamente descartado pelo proxy, mascarando a intenção de idempotência na criação de item via qualquer caminho que passe pelo BFF).

Fechado como parte desta decisão (mudança de 1 linha, sem risco): `FORWARDED_REQUEST_HEADERS = ["content-type", "if-match", "idempotency-key"]`. Teste novo em `src/modules/bff/application/proxy-service.test.ts` (arquivo já existe, a suíte de 76 testes do BFF cobre este service) afirmando que uma requisição proxied com `Idempotency-Key` chega à API downstream com o header presente. Não decide nada de arquitetura nova — é o mesmo padrão já usado para `if-match`, só adicionando o header que faltava.

## Correção 5 — gate do `execute-api`: remove a opção de VPC origin inválida

Achado real aceito: CloudFront VPC origins suportam ALB/NLB/instância EC2 dentro de uma VPC — não existe conexão direta suportada entre uma VPC origin do CloudFront e um endpoint privado de API Gateway. Removida do texto do gate. Lista de candidatos a avaliar quando o gate disparar (produção pública real, fora de `dev`/pilot), agora só com opções tecnicamente válidas, nenhuma pré-aprovada:
- (a) custom header secreto gerado/injetado no CloudFront (`custom_headers_config` numa origem custom, ou via uma CloudFront Function no `origin-request`) e validado pelo BFF antes de qualquer outro processamento — requer decidir armazenamento do segredo, rotação, e comportamento fail-closed se o header estiver ausente/errado.
- (b) AWS WAF associado à distribution — reduz abuso na borda, não impede sozinho o acesso direto ao `execute-api` (registrado explicitamente, não uma mitigação completa).
- (c) colocar um Application Load Balancer (suportado como VPC origin) na frente de uma integração privada, se um dia a topologia migrar para compute em VPC — hoje não se aplica (o BFF é Lambda atrás de API Gateway HTTP API regional, não há VPC nesta arquitetura), registrado só como opção de topologia futura caso a arquitetura mude, não como algo avaliável hoje.
Nenhum desses é implementado nesta decisão — só o gate e a lista corrigida de candidatos reais.

## Itens das v2-v4 confirmados sem nova objeção pela Rodada 4 (mantidos sem alteração)

Behaviors `/bff` e `/bff/*` explícitos, CloudFront Function em `viewer-request` só no default behavior, guarda de método GET/HEAD, `AllViewerExceptHostHeader`, ordem explícita de `ordered_cache_behavior`, `CachingDisabled`, OAC só na origem S3, teste CORS cobrindo headers/métodos/`allow_credentials`/`allow_origins`.

## O que continua fora do escopo desta decisão (etapas seguintes do plano)

Valores exatos da CSP da SPA (hashes por build, diferente da CSP do BFF fixada acima), certificado ACM/domínio custom, invalidação de `index.html`/deploy imutável por hash, implementação real de qualquer candidato do gate do `execute-api` (só o gate e a lista corrigida são fixados aqui).

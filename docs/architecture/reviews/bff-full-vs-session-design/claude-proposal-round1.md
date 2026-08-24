# Proposta Claude — Rodada 1: BFF de sessão vs. Full BFF

## Contexto e pergunta a decidir

`implementation-blueprint.md` §4.2/§23.1 (D-034) decidiu "BFF de sessão vs. Cognito direto no
browser" a favor de um **BFF de sessão**: cookie `HttpOnly`/`Secure`/`SameSite=Lax`, endpoints
`/session/refresh` e `/session/logout`, access token "fora do JS do cliente". Essa decisão nunca
especificou o mecanismo pelo qual o SPA chama as rotas de recurso já existentes e protegidas
(`/items`, `/documents`, `/subjects`, `/imports`, etc.).

Isso não é um detalhe de implementação — é uma lacuna estrutural. Evidência concreta contra o
código real:

- `infra/modules/api-gateway/main.tf:47-53` protege **toda** rota de recurso com um
  `aws_apigatewayv2_authorizer` tipo `JWT` nativo do API Gateway HTTP API. Esse tipo de
  authorizer só sabe validar um header `Authorization: Bearer <token>` contra o JWKS do user
  pool — não lê cookies, não invoca lógica customizada.
- `infra/modules/cognito/main.tf:72` já configura `generate_secret = true` no app client, com o
  comentário explícito "BFF session pattern (blueprint §4.2): client secret held server-side
  only, never in the browser" e `allowed_oauth_flows = ["code"]` (Authorization Code). Um client
  secret só existe para ser usado por um confidential client server-side — a infra já pressupõe
  que **alguma coisa no servidor** troca código/refresh token por access token junto ao Cognito.
- Nenhum lugar do código (`grep` completo por `bff`, `session/refresh`, `proxy`) implementa
  tradução cookie→Bearer, nem um proxy que reencaminhe chamadas de recurso.

Logo: se o browser nunca recebe o access token, e o authorizer de todas as rotas de recurso só
aceita Bearer, **o SPA não tem como chamar hoje nenhuma rota autenticada** sem um componente que
troque a sessão do browser (cookie) pelo Bearer token do lado do servidor, por requisição. Um
"BFF de sessão" restrito a `/session/refresh`/`/session/logout` não resolve isso — ele decide
como o *token* é renovado, não como as *chamadas de recurso* são autenticadas. É preciso decidir
o segundo problema agora, antes do primeiro PR de implementação.

## Posição proposta

**Full BFF**: toda chamada do browser a uma rota de recurso passa por um Lambda BFF que anexa o
access token (obtido/renovado server-side) antes de encaminhar ao API Gateway/`ApiHandler`
existente. O browser nunca possui `access_token`/`refresh_token` em nenhuma forma — nem em Web
Storage, nem em variável JS, nem em memória de longa duração. Ele só possui um cookie de sessão
opaco.

```text
Browser --(cookie de sessão)--> CloudFront --/bff/*--> BFF Lambda --(Bearer, server-side)--> API Gateway (JWT authorizer) --> ApiHandler existente
                                          --/*--------> S3 (SPA estática)
```

Isso não substitui nada do backend já construído — o JWT authorizer, o `RequestContext`, a
matriz de autorização (`identity/authorization.ts`) continuam exatamente como estão. O BFF é só
mais um cliente autenticado desse backend, do ponto de vista do `ApiHandler`.

## Decisões específicas (uma por item do checklist do ADR)

1. **Browser nunca recebe tokens OAuth**: confirmado. Nem em resposta HTTP, nem em erro, nem em
   redirect com fragmento (`#access_token=...`) — descartar implicit/hybrid flow. Login usa
   Authorization Code (já configurado em Cognito) com o BFF trocando o `code` pelo par de tokens
   diretamente com Cognito, usando o client secret já provisionado.

2. **Cookie de sessão opaco**: `sessionId` aleatório (não JWT, não contém claims legíveis) que
   indexa um registro de sessão do lado do servidor (DynamoDB, mesma tabela single-table já
   existente — nova entidade `PK=SESSION#<sessionId>` / `SK=SESSION`, TTL físico via
   `purgeAfterTtl` igual ao padrão já usado por `GuestTokenPointer`). O registro guarda o refresh
   token (ou referência a ele) e o access token corrente com sua expiração, nunca o secret do
   client.

3. **Atributos do cookie**: `Secure`, `HttpOnly`, `Path=/`, prefixo `__Host-` (exige `Secure` +
   sem `Domain` + `Path=/`, elimina classe inteira de ataque de cookie fixation entre
   subdomínios). `SameSite`: manter `Lax` no lançamento — o fluxo de login usa redirect
   cross-site para o Hosted UI do Cognito e de volta (`callback_urls`), e `Strict` quebraria o
   cookie de sessão nesse retorno na primeira visita. Reavaliar `Strict` só se o fluxo de login
   for reescrito para nunca sair do domínio da aplicação (não é o caso hoje, Hosted UI é
   domínio Cognito). Isso ajusta a recomendação inicial do documento de análise
   (`expiration-tracker-bff-frontend-quality-standard.md` §9), que sugeria preferir `Strict` sem
   examinar o redirect real do Hosted UI.

4. **Estratégia de CSRF**: obrigatória, já que a autenticação passa a ser 100% cookie-based no
   `/bff/*`. Padrão `double-submit` não é suficiente sozinho com `HttpOnly` (o cookie CSRF
   precisaria ser legível por JS, o que é aceitável — é um token CSRF, não um token de sessão).
   Proposta: token CSRF em cookie não-`HttpOnly` (`__Host-csrf`), o frontend ecoa seu valor num
   header customizado (`X-CSRF-Token`) em toda mutação (`POST`/`PUT`/`PATCH`/`DELETE`); o BFF
   rejeita com 403 se o header não bater com o cookie. Rotaciona a cada login. GETs idempotentes
   não exigem o header.

5. **Deploy same-origin**: `/*` → S3 (SPA), `/bff/*` → BFF Lambda via CloudFront, mesma origem
   percebida pelo browser. Isso é pré-requisito técnico do cookie `SameSite=Lax`+`__Host-`
   funcionar sem CORS.

6. **Roteamento CloudFront**: dois cache behaviors, `/bff/*` com `CachingDisabled` (respostas de
   API nunca cacheadas por padrão — item 14 trata exceção pontual) e origin = API Gateway; `/*`
   com a política de cache já usada para o SPA imutável (`architecture-fase3-consolidada.md`
   §3). Response Headers Policy do CSP/HSTS já prevista em §4.2 permanece igual, adicionando
   `connect-src 'self'` (chamadas passam a ser same-origin, `/bff/*`, não mais o domínio da API
   direto).

7. **Autenticação BFF → API de recurso**: o BFF chama o `ApiHandler` exatamente como qualquer
   outro chamador — via API Gateway, com `Authorization: Bearer <access_token>` obtido da sessão
   server-side. Nenhuma rota nova de "acesso interno sem token" — isso preservaria o
   `RequestContext`/matriz de autorização inalterados e testados.

8. **Ciclo de vida do refresh**: BFF detecta access token expirado (ou expira em breve, ex. <60s)
   e troca o refresh token por um par novo via Cognito antes de encaminhar a chamada — refresh
   transparente ao SPA, sem endpoint dedicado que o frontend precise chamar proativamente (isso
   simplifica o frontend: ele nunca lida com token, só com 401 de sessão morta). Reuse detection:
   se o Cognito rejeitar o refresh token (já usado/revogado), o BFF invalida a sessão e responde
   401 — frontend redireciona para login.

9. **Modelo de armazenamento de sessão**: DynamoDB, entidade nova conforme item 2. Nunca em
   memória do Lambda (não sobrevive frio/concorrência) nem em cookie (excede 4KB e expõe
   metadados). Idempotência de refresh concorrente (dois requests simultâneos com access token
   expirado) via `ConditionExpression` no update do registro de sessão — mesmo padrão OCC já
   usado em todo o resto do projeto (`src/shared/dynamodb/occ.ts`), não uma implementação nova.

10. **Semântica de logout**: `/bff/session/logout` (dispositivo) apaga o registro de sessão e
    invalida o cookie; `/bff/session/logout-all` (global) segue o padrão já decidido em §4.2
    (`globalLogoutAfter`) e revoga via Cognito `AdminUserGlobalSignOut`. Nenhuma mudança ao
    mecanismo de revogação já desenhado — só a superfície HTTP muda de raiz para `/bff/`.

11. **Allowlist do proxy**: o BFF nunca aceita hostname/path arbitrário do cliente. Mapeamento
    explícito, code-first: `/bff/items/*` → `{API_BASE}/items/*`, etc., um mapa curto (mesmas
    rotas hoje registradas no API Gateway) — nunca um wildcard `/bff/*` → passthrough total sem
    lista. Método e path validados contra a mesma tabela antes de montar a chamada upstream.

12. **Normalização de erro**: o BFF repassa o `AppError` normalizado que o backend já produz
    (`src/shared/errors/app-error.ts`) sem reformular a taxonomia — só garante que nenhum detalhe
    de infraestrutura (stack trace, nome de tabela, ARN) vaze, o que já é a postura de
    `SecureLogger`/`Redactor` hoje.

13. **Propagação de correlation ID**: o BFF gera/propaga `correlationId` do mesmo jeito que
    `resolveRequestContext` já espera receber (`src/shared/observability/context.ts`) — se o
    browser mandar um, é ignorado como fonte de verdade (não confiável), o BFF sempre gera o seu
    e o inclui como header ao chamar o `ApiHandler`, preservando o padrão "correlation nunca vem
    do cliente sem validação" já em uso.

14. **Política de cache**: default `no-store` em toda resposta de `/bff/*`. Exceção pontual só
    quando uma rota de leitura específica justificar (nenhuma identificada ainda) — decidida caso
    a caso, nunca por padrão.

15. **Rate limiting**: o BFF herda o throttling nativo do HTTP API já em vigor (D-051,
    `default_route_settings`) por estar atrás do mesmo API Gateway/Lambda. Adicional: um limite
    por sessão no próprio BFF para o endpoint de refresh (mitiga abuso de refresh contínuo),
    seguindo o mesmo padrão de implementação in-memory-per-request+DynamoDB condicional já usado
    por `GuestRateLimiter`/`InitialInviteRateLimiter` (duplicado deliberadamente por módulo, não
    generalizado — D-049).

16. **BFF vs. responsabilidade de domínio**: o BFF nunca decide regra de negócio. Ele pode compor
    view models por tela (ex. `/bff/dashboard` agregando `/items`+`/notifications` internamente)
    mas cada chamada interna ainda passa pela mesma autorização/`RequestContext` do backend — o
    BFF não ganha nenhum privilégio que o usuário autenticado não teria fazendo as chamadas
    individualmente.

## Classificação

Type 1 (nível 5-6, `change-risk-scale.md`) — decisão de segurança do browser, difícil de
reverter depois que o frontend depender dela. Refina (não reabre) a decisão já fechada em D-034:
"BFF, não Cognito direto" permanece; o que se decide agora é o mecanismo pelo qual esse BFF
autentica as chamadas de recurso, algo que D-034/§23.1 nunca cobriu.

## O que fica fora deste debate

- Escolha de framework/runtime do BFF (Lambda simples vs. outra opção) — Full BFF não exige
  Next.js (`expiration-tracker-bff-frontend-quality-standard.md` §6, mantido).
- Rubrica de qualidade de frontend (§13-30 do mesmo documento) — não é uma decisão de arquitetura
  Type 1, é um processo de avaliação; se for adotada como padrão oficial, deveria passar pela
  mesma convergência independente que os 9 eixos de `docs/engineering/joint-review-criteria.md`
  já usaram, não ser herdada de um documento de análise solo.
- MFA (`UNK-006`), provider de e-mail, modelo Bedrock — pendências externas já registradas,
  não tocadas aqui.

> Transcrito da resposta do MCP `codex` (thread `01a03041-5a22-7091-8f7d-3b4a3f29f1cb`), rodada 1
> (proposta independente, sem visibilidade da proposta Claude).

**Proposta independente: Full BFF same-origin com proxy allowlistado.**

A decisão antiga de "BFF de sessão" restrito a `/session/refresh` e `/session/logout` não fecha a
arquitetura. Evidência: as rotas de recurso atuais são protegidas por JWT authorizer nativo do
HTTP API, com token extraído de `Authorization`, não de cookie
(`infra/modules/api-gateway/main.tf:47`). As rotas `/items*`, `/subjects*`, `/documents*`,
`/notifications/preferences` e `/imports*` usam `authorization_type = "JWT"`
(`infra/modules/api-gateway/main.tf:118,241,356`). A documentação AWS confirma que, para JWT
authorizer em HTTP API, a identity source é uma única origem de header ou query string (ex.
`$request.header.Authorization`); cookie não é origem suportada.

Portanto, se o browser não recebe OAuth token, ele não consegue chamar diretamente essas rotas. A
solução: o browser chama um BFF same-origin via cookie; o BFF chama a API existente com
`Authorization: Bearer <access_token>` server-side.

## Design proposto

1. **Browser recebe tokens OAuth?** Não — nem access, nem refresh, nem ID token, em nenhuma
   forma. Preserva blueprint §4.2.
2. **Cookie de sessão**: opaco, não JWT. `__Host-et_session`, handle aleatório de alta entropia,
   sem claims/tenant/roles/sub/tokens. Estado real em DynamoDB.
3. **Atributos**: `Set-Cookie: __Host-et_session=<opaque>; HttpOnly; Secure; SameSite=Lax;
   Path=/; Max-Age=<ttl>` (sem `Domain`, exigido pelo prefixo `__Host-`). CSRF token em cookie
   separado não-HttpOnly `__Host-et_csrf`, mesmos atributos exceto `HttpOnly`.
4. **CSRF**: toda mutação (`POST`/`PUT`/`PATCH`/`DELETE`) exige header `X-CSRF-Token` == cookie
   `__Host-et_csrf` == valor registrado na sessão server-side. `GET`/`HEAD`/`OPTIONS` isentos
   (nunca podem mutar). Falha → 403 via taxonomia `AppError` existente.
5. **Same-origin/CloudFront**: obrigatório. `/*` → SPA estática; `/bff/*` → BFF Lambda.
   `/bff/session/refresh`/`/bff/session/logout` como rotas do mesmo prefixo (ou alias literal de
   `/session/*` se quiser manter literalidade do blueprint).
6. **BFF → backend de recurso**: lê sessão opaca, obtém/decripta access token server-side, chama
   o HTTP API atual com `Authorization: Bearer`. API Gateway continua validando issuer/audience
   contra Cognito; handlers atuais continuam extraindo claims de
   `event.requestContext.authorizer.jwt.claims` (`http-adapter.ts:9`) e resolvendo
   `RequestContext` centralmente (`resolve-request-context.ts:44`). **Não trocar para Lambda
   authorizer agora.**
7. **Refresh lifecycle**: Cognito já configurado para client secret server-side (`generate_secret
   = true`), auth code flow, access/ID token 15min, refresh token 30 dias
   (`infra/modules/cognito/main.tf:63`). BFF renova quando faltar <60s para expirar. Reuse
   detection: se Cognito rejeitar o refresh (já usado/revogado), invalida sessão e limpa cookies.
8. **Armazenamento server-side**: DynamoDB, alinhado ao padrão existente `TENANT#t#USER#u` /
   `SESSION#<deviceId>` (`user-repository.ts:29`). Persistir `sessionId`, `deviceId`,
   `refreshFamilyId`, status, `createdAt`, `lastSeenAt`, `expiresAt`, expiry do token, hash do
   cookie handle, hash do CSRF token, refresh token **cifrado com KMS**. Access token pode ficar
   em memória/cache curta do BFF ou persistido cifrado; nunca em cookie.
9. **Logout**: `/bff/session/logout` (dispositivo) revoga sessão corrente, limpa cookies, chama
   revogação Cognito suportada — mesmo modelo de `deviceLogoutAfter`/status `REVOKED`
   (`user-repository.ts:98`). `/bff/session/logout-all` (global): atualiza `globalLogoutAfter` +
   revoga via Cognito, conforme blueprint §4.2.
10. **Allowlist**: explícita, nunca proxy aberto. Mapa versionado de prefixos/métodos —
    `/bff/items*`, `/bff/subjects*`, `/bff/notifications/preferences`, `/bff/imports*`,
    `/bff/reminders/policies*`. `/guest/*` fica fora do BFF (já é rota pública com validação
    própria, `infra/modules/api-gateway/main.tf:260`).
11. **Erro e correlation ID**: reaproveita `AppError`/`toAppError`, sem envelope novo. BFF deve
    encaminhar `X-Correlation-Id` gerado por ele ao backend, mas os handlers atuais **precisariam
    ser ajustados** para aceitar esse header como fonte confiável só quando vier do BFF/CloudFront
    — não do browser direto.
12. **Cache**: `/bff/*` → `Cache-Control: no-store`, CloudFront `CachingDisabled`, forward de
    cookies/headers necessários. Assets SPA versionados continuam cacheáveis.
13. **Rate limiting**: mantém throttling nativo do HTTP API (`api-gateway/main.tf:27`) como rede
    básica. Adiciona rate limit no BFF por `sessionId` para refresh/login-callback/mutações
    sensíveis, mesmo estilo de janela fixa DynamoDB de `GuestRateLimiter`
    (`guest-rate-limiter.ts:31`). Por IP real fica com CloudFront+WAF pré-produção (D-051).
14. **Fronteira com domínio**: BFF só autentica sessão/CSRF/refresh/encaminha allowlist — nunca
    decide tenant/roles/quotas/autorização/regra de domínio. Isso permanece no
    `resolveRequestContext`/matriz de autorização já centralizados.

## Risco

**Type 1, nível 6** — decisão arquitetural formal de segurança e fronteira de sistema; muda como
o browser alcança toda rota autenticada e introduz superfície nova de sessão/cookie/proxy.
Exige protocolo Claude↔Codex e ADR formal (`change-risk-scale.md:11`).

## Fora deste debate

Framework do frontend, layout da SPA, MFA, biblioteca HTTP final do BFF, política comercial de
sessão concorrente, CloudFront+WAF completo de produção, mudanças na matriz de autorização.

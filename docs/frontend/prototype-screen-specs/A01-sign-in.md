# A01 — Entrar (Sign In)

**Corrigida em 2026-09-10 (D-255/D-2xx)** — a versão anterior (revisada em 2026-09-09) descrevia
um formulário de e-mail/senha client-side com rotas `/login`, `/auth/callback`, `/session-expired`
próprias. Essa descrição contradiz a arquitetura real já `APPROVED` (6 rodadas Claude↔Codex,
D-053/D-054, `docs/frontend/frontend-production-foundation.md` F1, FPF-G1 auditado: nenhum token
OAuth alcança o browser em nenhum caminho testado) — Cognito Hosted UI mediado inteiramente pelo
BFF, login é sempre um redirect de página inteira (`window.location.assign`), nunca um form
client-side. Por precedência (`AGENTS.md` §5: ADR/decisão aceita > documento temático corrente), a
arquitetura aprovada prevalece sobre esta spec, que nunca passou pelo protocolo Claude↔Codex
(`prototype-screen-specs/README.md`: proveniência é material de protótipo gerado por IA, não uma
decisão de arquitetura). Esta revisão reconcilia a spec com o código real e testado
(`frontend/src/auth/{AuthContext,ProtectedRoute,OnboardingGate}.tsx`,
`frontend/src/api/session.ts`) em vez de reabrir a decisão de arquitetura.

**Não há rotas `/login`, `/auth/callback` ou `/session-expired` client-side.** A "tela de login"
não é uma página React separada — é o comportamento visível de `ProtectedRoute` (estado
`SESSION_MISSING`/`SESSION_EXPIRED`/`REFRESH_FAILED`) no instante entre "sessão não confirmada" e
o redirect de página inteira para `/bff/login`, que por sua vez redireciona para o Cognito Hosted
UI (fora do domínio do produto — sem controle de UI aqui). O callback OAuth é tratado inteiramente
server-side pelo BFF (`GET /bff/callback`), que troca o código por sessão e redireciona de volta
para dentro do app — o browser nunca renderiza uma tela de callback.
**Acesso:** público (não autenticado) até o momento do redirect.

## Estados reais (AuthContext.AuthState, 6 estados — todos observáveis, nenhum decorativo)

1. **`SESSION_REFRESHING`** — probe inicial de sessão em andamento (`GET /bff/session`). UI:
   `InitialLoading` (`role="status" aria-live="polite"`, texto neutro "Carregando…" — nunca
   linguagem técnica tipo "validando sessão", achado real de usuário D-136/D-A). Nenhum redirect
   disparado neste estado.
2. **`AUTHENTICATED`** — sessão confirmada; `ProtectedRoute` renderiza os filhos normalmente.
3. **`SESSION_MISSING`** — o BFF diz explicitamente "não autenticado" (sem cookie, ou cookie
   resolvido como inválido) — o caso comum de "nunca logou neste navegador". `ProtectedRoute`
   dispara `reauthenticate()` via `useEffect` e renderiza `InitialLoading label="Redirecionando…"`
   como placeholder estrutural breve antes da navegação de página inteira.
4. **`SESSION_EXPIRED`** — havia uma sessão `AUTHENTICATED`; uma chamada de API subsequente voltou
   401 (`ApiClient.onUnauthorized` → `AuthContext.reportUnauthorized`). Distinto de
   `SESSION_MISSING`: aqui a sessão existiu e foi encerrada (expiração absoluta/idle, ou o BFF
   determinou falha definitiva de refresh — nunca uma resposta silenciosa "ainda autenticado").
   Mesmo comportamento de redirect de `SESSION_MISSING`.
5. **`REFRESH_FAILED`** — o probe de sessão em si não pôde ser completado (falha de rede/parse
   falando com `/bff/session`) — incerteza, não uma negativa definitiva do BFF. Tratado como
   reautenticação necessária (mesmo redirect), nunca silenciosamente equiparado a "sessão válida".
6. **`REAUTH_REQUIRED`** — estado transitório nomeado no tipo (`returnTo` capturado) que antecede
   a chamada real a `startLogin()`; na implementação atual do `AuthContext`, os 3 estados acima já
   disparam o redirect diretamente via `reauthenticate()`, então este estado é alcançável apenas
   como valor de tipo, não como uma renderização própria adicional — `ProtectedRoute` trata seu
   placeholder visual de forma idêntica aos 3 estados acima (mesmo texto "Redirecionando…"), sem
   disparar um segundo `reauthenticate()`.

## `returnPath` / `returnTo` (prevenção de open redirect)

Capturado como `${window.location.pathname}${window.location.search}` no momento da transição
(nunca de estado de componente/valores de formulário — não há formulário). Passado a
`startLogin(returnTo)`, que monta `/bff/login?returnTo=...` — a validação de que `returnTo` é um
caminho interno relativo (nunca uma URL externa) é feita **server-side** pelo BFF
(`BffAuthService.startLogin`, já auditado em D-053/D-054); o cliente nunca é a única guarda contra
open redirect. Um `returnTo` inválido/externo é descartado pelo BFF e o destino cai no fallback
padrão do app (`OnboardingGate` decide A02 vs. conteúdo normal, conforme `activeOrganizationId`).

## O que a UI do produto controla (e o que não controla)

- **Controla**: os 6 estados acima, seus placeholders neutros, e o instante do redirect.
- **Não controla**: a aparência do formulário de login em si (tela hospedada pelo Cognito, fora do
  domínio do produto) nem o callback (inteiramente server-side).
- **Nenhum campo de e-mail/senha, nenhum banner de erro de credencial, nenhuma tela de spinner de
  callback própria existe ou deveria existir no código do produto** — isso pertenceria à UI
  hospedada do Cognito, não a este repositório.

## Acessibilidade

- `InitialLoading` usa `role="status" aria-live="polite"` em ambos os textos ("Carregando…" e
  "Redirecionando…") — anúncio único ao leitor de tela, sem exigir ação do usuário.
- Não há foco a gerenciar manualmente (nenhum formulário, nenhum banner `role="alert"` neste
  componente) — o próximo ponto de foco relevante é o da própria UI hospedada do Cognito, fora do
  controle deste código.

## Testes reais

- `frontend/test/auth/AuthContext.test.tsx` — os 6 estados do `AuthState`, incluindo
  `reportUnauthorized`/`logout`/`logoutAll`.
- `frontend/test/auth/ProtectedRoute.test.tsx` — mapeamento estado → render/redirect, um único
  `reauthenticate()` por transição, nunca um flash de conteúdo protegido.

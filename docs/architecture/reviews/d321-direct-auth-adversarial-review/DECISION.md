# D-321 — Login/signup/reset de senha via UI própria — Revisão Adversarial (D-329)

## Status

**APROVADO** via protocolo Claude↔Codex (`AGENTS.md` §4), 3 rodadas (mínimo do protocolo).
Notas cegas finais: **Claude 9,3/10, Codex 9,1/10** — ambos ≥9,0 sem arredondar.

## Trajetória de convergência (notas cegas, sem arredondar)

| Rodada | Claude | Codex | Achado principal fechado nessa rodada |
|---|---|---|---|
| R1 | 8,2/10 (não estritamente cego — ver nota abaixo) | 6,8/10 | 8 achados: login-CSRF viável (alta); forgot-password sem anti-enumeração completa (média); confirmação inferindo sucesso de exceção genérica (média); indisponibilidade no login virando "credencial inválida" (média); incompatibilidade real entre tokens `InitiateAuth` e refresh via `/oauth2/token` sob device-remembering (alta); signup como oráculo de existência (já admitido); rate-limiting incompleto; corpo malformado virando 500 |
| R2 | 9,0/10 | 8,4/10 | 6 dos 8 achados corrigidos com código real; rate-limiting e signup-409 registrados/aceitos por decisão explícita; tréplica do Claude sobre device-remembering (Rodada 2) **estava errada** — Codex refutou com a documentação oficial da AWS |
| R3 | 9,3/10 | 9,1/10 | `device_configuration` removido do Cognito (fecha o bug de integração real); cobertura de teste do adapter real adicionada; pequenas imprecisões de documentação corrigidas — **CONVERGIDO** |

**Nota de processo**: a Rodada 1 não foi estritamente cega — a auto-nota do Claude foi escrita
dentro do mesmo arquivo que o Codex leu, e ele corretamente apontou isso. Corrigido a partir da
Rodada 2 (auto-nota sempre em arquivo separado, nunca na lista de leitura do Codex).

## O que foi corrigido (com código real, testado)

1. **Login-CSRF** (`bff-handlers.ts`): `requireSameSiteFetch()`, novo, reaproveita
   `isSameSiteFetch()` (já existente em `domain/csrf.ts`) — aplicado às 6 rotas D-3xx
   (`handleLoginPassword`, `handleSignUp`, `handleConfirmSignUp`, `handleResendConfirmationCode`,
   `handleForgotPassword`, `handleConfirmForgotPassword`). `docs/engineering/performance/traces/
   perf-04-auth.mjs` (smoke k6) ajustado para declarar `Sec-Fetch-Site: none`.
2. **Corpo malformado** (`bff-handlers.ts`): `parseJsonObjectBody()`, compartilhado pelas 6 rotas.
3. **Indisponibilidade de login** (`bff-auth-service.ts`): `loginWithPassword` mapeia
   `TRANSIENT_FAILURE`/`UNKNOWN_OUTCOME` para 503, nunca mais um falso "credencial inválida".
4. **Anti-enumeração de `forgotPassword`** (`cognito-idp-auth-client.ts`): `InvalidParameterException`
   dobrado em `SUCCESS`, mesmo tratamento que `UserNotFoundException` já tinha.
5. **Falso-sucesso de confirmação** (`cognito-idp-auth-client.ts`): `confirmSignUp`/
   `resendConfirmationCode` só mapeiam `NotAuthorizedException`/`InvalidParameterException` para
   `ALREADY_CONFIRMED` quando a mensagem bate com o texto documentado (`looksAlreadyConfirmed()`,
   best-effort, declarado como tal — mensagem não é contrato formal da API).
6. **Bug de integração real (device-remembering)**: `device_configuration` removido de
   `infra/modules/cognito/main.tf` — nunca usado por nenhum código real (zero chamadas a
   `ConfirmDevice`/`UpdateDeviceStatus`/`DEVICE_KEY`/`NewDeviceMetadata` em todo `src/`), mas
   ativava device-remembering pool-wide e quebrava o refresh de tokens `InitiateAuth` via
   `/oauth2/token` (documentação oficial da AWS). Não reescrito para `REFRESH_TOKEN_AUTH` porque
   D-054 exclui deliberadamente esse auth flow (incompatível com a rotação de refresh token
   habilitada neste client).

## Decisões explícitas mantidas (não "corrigidas", por julgamento consciente)

- **Signup revela e-mail já cadastrado (409)**: mantido por UX real do frontend
  (`SignUp.tsx`) + mesmo comportamento que a Hosted UI já tinha antes de D-321 — o próprio Codex
  ofereceu esta saída como aceitável se documentada.
- **Rate-limiting dedicado por conta/IP**: NÃO implementado nesta rodada — registrado como
  pendência OBRIGATÓRIA antes de usuário real (mesma lista de E-019, `NEXT_SESSION_PROMPT.md`
  item 23/4), com a saída que o próprio Codex propôs ("aceitaria postergar... mediante pendência
  explícita, obrigatória antes de usuários reais").

## Risco residual, nomeado explicitamente, não bloqueador da convergência

A remoção do `device_configuration` não foi verificada empiricamente contra o pool `dev` real
(`terraform apply` só roda via pipeline, nunca localmente) — confirmar após o próximo deploy:
1. `aws cognito-idp describe-user-pool --profile claude-dev` — `DeviceConfiguration` deve ser nulo.
2. Exercitar um login real via `POST /bff/login`, esperar o access token expirar (~1h), confirmar
   que o refresh subsequente funciona (não força um novo login silenciosamente).

## Escopo desta decisão

Cobre a superfície de autenticação como ela existe hoje (login/signup/confirm/resend/forgot-password/
confirm-forgot-password). Não cobre MFA (fora do escopo v1, gap nomeado desde D-321) nem a
verificação empírica pós-deploy acima, que fica como item de acompanhamento separado.

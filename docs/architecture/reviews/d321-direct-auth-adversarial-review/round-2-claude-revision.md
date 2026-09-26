# D-321 — Rodada 2 (revisão Claude, endereçando os 8 achados da Rodada 1)

Nota do Codex na Rodada 1: **6.8/10**. Nota cega do Claude (registrada antes de ler a crítica,
arquivo separado desta vez): ver `round-2-claude-selfgrade.md`.

## Achado 1 — Gap de segurança, alta: login-CSRF viável — CORRIGIDO

`requireSameSiteFetch()` novo em `bff-handlers.ts`, reaproveitando `isSameSiteFetch()` (já
existente em `domain/csrf.ts`, mesma primitiva que `checkCsrf()` usa como sua primeira camada) —
aplicado às 6 rotas D-3xx (`handleLoginPassword`, `handleSignUp`, `handleConfirmSignUp`,
`handleResendConfirmationCode`, `handleForgotPassword`, `handleConfirmForgotPassword`), rejeitando
com 403 qualquer requisição cujo `Sec-Fetch-Site` não seja `same-origin`/`none` — inclusive
ausente (fail-closed, mesma disciplina de `isSameSiteFetch`'s próprio comentário). Isso fecha
login-CSRF por construção: um navegador sob controle de uma página cross-site NUNCA consegue
forjar esse header (é controlado pelo próprio navegador, não pelo JS da página) — só um chamador
que é genuinamente o app (ou um script/cliente de primeira parte fora de um navegador, que pode
declarar `Sec-Fetch-Site: none` livremente, categoria de confiança distinta de "navegador sob
controle de terceiro") passa. `docs/engineering/performance/traces/perf-04-auth.mjs` (script de
smoke k6, chamador de primeira parte) atualizado para declarar `Sec-Fetch-Site: none` explicitamente
— sem isso, o mesmo fix que fecha o buraco real também quebraria esse smoke test.

## Achado 7 — Gap de segurança, rate-limiting — REGISTRADO como pendência explícita, não bloqueia

O próprio Codex propôs esta saída ("aceitaria postergar o limitador dedicado mediante pendência
explícita, obrigatória antes de usuários reais"). Registrado em `NEXT_SESSION_PROMPT.md`/
`decisions-log.md` como pendência OBRIGATÓRIA antes de `WHATSAPP`/login com usuário real (mesma
lista que já tem E-019) — nunca silenciosamente esquecido. Rate 10/burst 20 (número real
confirmado pelo Codex, corrigindo o "burst=50" que a proposta da Rodada 1 citou errado — a proposta
usava o número de outro módulo/rota por engano) na stage do BFF continua sendo a única defesa de
vazão até essa pendência ser endereçada.

## Achado 8 — Bug de correção, baixa: entrada malformada vira 500 — CORRIGIDO

`parseJsonObjectBody()` novo, compartilhado pelas 6 rotas D-3xx — JSON inválido ou não-objeto
(array, `null`, string crua) agora lança `ValidationError` (400), nunca deixa `JSON.parse(...)`
sem tratamento estourar como 500.

## Achado 4 — Bug de correção, média: indisponibilidade no login vira "credencial inválida" — CORRIGIDO

`loginWithPassword` agora mapeia `TRANSIENT_FAILURE`/`UNKNOWN_OUTCOME` para
`DependencyUnavailableError` (503) — mesma disciplina que `signUp`/`confirmSignUp`/
`resendConfirmationCode`/`startForgotPassword`/`confirmForgotPassword` já tinham nesta mesma
classe. Apenas os outcomes genuinamente relacionados a credencial (`INVALID_CREDENTIALS`,
`USER_NOT_CONFIRMED`, `PASSWORD_RESET_REQUIRED`, `UNSUPPORTED_CHALLENGE`) continuam o
`AuthenticationError` genérico único (anti-enumeração preservada — 503 não distingue nada sobre a
conta, só que o sistema não pôde processar agora).

## Achado 3 — Bug de correção + gap de segurança, média: confirmação infere sucesso de exceção genérica — CORRIGIDO (parcialmente, ver nota)

`confirmSignUp`/`resendConfirmationCode` (adapter) agora só mapeiam `NotAuthorizedException`/
`InvalidParameterException` para `ALREADY_CONFIRMED` quando a mensagem contém o texto documentado
("already confirmed"/"current status is confirmed", `looksAlreadyConfirmed()`, case-insensitive) —
qualquer outra causa cai em `UNKNOWN_OUTCOME` (503 no `BffAuthService`), nunca um falso sucesso
silencioso. **Nota honesta, não escondida**: o texto exato da mensagem do Cognito NÃO é parte do
contrato documentado da API (só o TIPO da exceção é) — este é um narrowing best-effort, defesa em
profundidade, não uma garantia formal. O oráculo residual que o Codex apontou (conta confirmada +
código arbitrário = 204, conta pendente + código errado = 400) continua existindo estruturalmente
— é uma consequência inerente de `confirmSignUp` precisar ser idempotente para "já confirmado"
(UX real: usuário clica no link de confirmação duas vezes), não algo que dá para eliminar sem
remover essa idempotência. Julgamento: o vazamento residual ("este e-mail tem uma conta
confirmada") é estritamente mais fraco que o oráculo JÁ ACEITO do achado 6 (signup 409 já revela
"este e-mail tem conta", ponto final) — não é uma nova classe de informação, é um refinamento do
mesmo fato já exposto por design. Não fechado 100%, mas o bug de correção real (qualquer
`NotAuthorizedException` virando sucesso) está.

## Achado 2 — Gap de segurança, média: forgot-password sem anti-enumeração completa — CORRIGIDO

`forgotPassword` (adapter) agora também dobra `InvalidParameterException` em `SUCCESS`, mesmo
tratamento que `UserNotFoundException` já tinha — fecha o oráculo de 3 vias (202 real, 202
não-existe, 503 "existe mas sem atributo verificado para receber código") que a Rodada 1 apontou,
citando a documentação oficial da AWS sobre supressão de existência.

## Achado 6 — Gap de segurança, média, já admitido: signup é oráculo de existência — MANTIDO, DECISÃO EXPLÍCITA REGISTRADA

Decisão consciente de MANTER o `409` (não seguir a recomendação do Codex de resposta uniforme).
Razões: (1) `SignUp.tsx` (frontend) já tem UX real dependente dessa distinção ("Já existe uma conta
com este e-mail.") — removê-la é uma mudança de produto/UX real, não só um endurecimento de
segurança, e degradaria a experiência de um usuário legítimo que esqueceu que já tem conta; (2) o
próprio Codex ofereceu esta saída como aceitável ("se o produto mantiver 409 deliberadamente,
registrar a aceitação específica"); (3) mesmo comportamento que a Hosted UI já tinha antes de
D-321 — não é uma regressão introduzida por esta mudança. Registrado aqui, em `decisions-log.md` e
em `NEXT_SESSION_PROMPT.md` como decisão explícita e nomeada, não como omissão silenciosa.

## Achado 5 — Bug de integração, alta: tokens novos incompatíveis com refresh existente — CONTESTADO (tréplica com evidência)

Pesquisa externa feita (AGENTS.md §4, AWS oficial): a página do endpoint `/oauth2/token`
confirma literalmente o texto que o Codex citou — "Users who sign in with the API operations
`InitiateAuth`... can refresh their tokens with the token endpoint when remembered devices is
*not* active in your user pool." Isto é real e a citação do Codex está correta quanto ao texto.

Mas a página de device tracking (`amazon-cognito-user-pools-device-tracking.md`) esclarece o que
"ativo" significa na prática: dispositivos só passam a ser "lembrados"/rastreados quando o app
efetivamente chama `ConfirmDevice`/`UpdateDeviceStatus` com o `DeviceKey`/`DeviceGroupKey`
retornados em `NewDeviceMetadata` — a simples presença do bloco `device_configuration` no user
pool (Terraform) não coloca nenhuma sessão real em estado "rastreado" por si só.

Evidência concreta, verificada nesta rodada:
1. `grep -rn "ConfirmDevice\|UpdateDeviceStatus\|DEVICE_SRP_AUTH\|NewDeviceMetadata" src/` — **zero
   ocorrências em todo o repositório**. Nem o adapter novo (`CognitoIdpAuthClient`) nem o
   `CognitoOidcClient`/`fetch-cognito-oidc-client.ts` (fluxo OIDC/PKCE original) jamais chamam
   `ConfirmDevice`. `NewDeviceMetadata`, se retornado, é descartado, nunca usado.
2. `device_configuration` (`challenge_required_on_new_device`/`device_only_remembered_on_user_prompt`)
   existe desde o commit `57942e11` (2026-08-20 — "Add Terraform cognito module"), **um mês antes
   de D-321**, aplicando-se IGUALMENTE ao fluxo OIDC/PKCE original (`handleCallback`/`refresh()`
   via o MESMO endpoint `/oauth2/token`, nunca alterado por D-321).
3. Esse fluxo original processou logins reais contra `dev` por semanas (D-053 em diante, múltiplas
   sessões de teste real, k6, e2e) sem nenhum incidente relatado de "refresh falha silenciosamente"
   — se a mera presença do bloco `device_configuration` bastasse para ativar o modo "rastreado"
   incompatível com `/oauth2/token`, isso já teria quebrado o refresh do fluxo original há um mês,
   e nunca quebrou.

**Conclusão**: o achado cita uma ressalva real e documentada da AWS, mas a aplica à interpretação
errada de "ativo" (config presente no pool vs. dispositivo efetivamente confirmado por sessão) —
neste código específico, nenhuma sessão jamais confirma um dispositivo, então "remembered devices"
nunca fica "ativo" para nenhum usuário, em nenhum dos dois fluxos. Não vejo motivo para classificar
como bloqueador. Aceito, porém, que a ambiguidade da própria documentação da AWS não é 100%
dirimida por esta inferência sozinha — fechamento total exigiria uma evidência empírica direta
(login via `POST /bff/login` real, esperar o access token expirar, confirmar refresh bem-sucedido
contra `dev`), que não foi executada nesta rodada (fora do escopo de teste local, mesma disciplina
de nunca rodar `terraform apply`/testes reais contra `dev` sem necessidade clara). Registrado como
item de verificação empírica pendente, não como bug confirmado nem como fechamento sem ressalva.

## Auto-nota cega (Claude), Rodada 2

Ver `round-2-claude-selfgrade.md` (arquivo separado, não incluído no que o Codex lê nesta rodada).

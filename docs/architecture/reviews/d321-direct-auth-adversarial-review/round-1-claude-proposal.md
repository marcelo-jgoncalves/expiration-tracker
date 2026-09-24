# D-321 — Login/signup/reset via UI própria — Rodada 1 (proposta Claude)

## Contexto

D-321 (2026-09-22) substituiu o redirect para a Cognito Hosted UI/Managed Login por telas próprias
(`frontend/src/routes/auth/{Login,SignUp,VerifyEmail,ForgotPassword,ResetPassword}.tsx`), reversão
explícita de D-320 a pedido de Marcelo (fidelidade visual/design system v2). Implementado sem o
protocolo Claude↔Codex formal (suspenso desde 2026-09-19), autorizado diretamente por Marcelo dado
o nível 5-6 da mudança. Este é o backlog de revisão adversarial completa, agora que o protocolo
voltou.

Escopo desta rodada: avaliar a superfície de autenticação nova como um todo — mecanismo
(`InitiateAuth`/`SignUp`/`ForgotPassword` via `USER_PASSWORD_AUTH`, `SECRET_HASH` calculado
server-side no BFF), anti-enumeração, política de senha, e o que foi deliberadamente deixado de
fora (MFA, rate-limiting dedicado).

## Arquitetura implementada

- **Mecanismo**: `CognitoIdpAuthClient` (`src/modules/bff/persistence/cognito-idp-auth-client.ts`)
  chama `InitiateAuthCommand`/`SignUpCommand`/`ConfirmSignUpCommand`/`ResendConfirmationCodeCommand`/
  `ForgotPasswordCommand`/`ConfirmForgotPasswordCommand` via `@aws-sdk/client-cognito-identity-provider`
  (SDK oficial, nunca uma reimplementação de SRP/criptografia). `SECRET_HASH` = `HMAC-SHA256(client
  secret, username + client_id)`, base64 — algoritmo documentado publicamente pela própria AWS para
  clients confidenciais (`generate_secret=true`), calculado uma única vez em `secretHash()` e
  reutilizado por todo método da classe.
- **`explicit_auth_flows = ["ALLOW_USER_PASSWORD_AUTH"]`** (least privilege — `ALLOW_USER_SRP_AUTH`,
  nunca usado por código real, foi removido).
- **Credencial em trânsito**: `POST /bff/login` → BFF → `InitiateAuth` sobre TLS direto para a API
  do Cognito. A senha nunca é logada (`CognitoIdpAuthClient` não loga `input`; erros mapeados para
  outcomes tipados antes de qualquer log downstream).
- **Anti-enumeração** (`prevent_user_existence_errors = "ENABLED"` no user pool + reforço explícito
  em código, nunca só confiança no comportamento do Cognito):
  - `authenticateWithPassword`: `NotAuthorizedException`/`UserNotFoundException` → mesmo
    `INVALID_CREDENTIALS` → `BffAuthService.loginWithPassword` lança o MESMO `AuthenticationError`
    genérico para credencial errada, conta não confirmada, e senha-reset-obrigatório.
  - `forgotPassword`/`resendConfirmationCode`: `UserNotFoundException` dobrado em `SUCCESS`/`SENT` —
    um e-mail nunca cadastrado responde OBSERVAVELMENTE igual a um real.
  - `confirmForgotPassword`: `UserNotFoundException` → `INVALID_CODE_OR_EXPIRED` (nunca distinguido
    de um código errado).
  - **Exceção deliberada, não regressão**: `SignUp` continua revelando e-mail já cadastrado
    (`UsernameExistsException` → 409) — mesmo comportamento que o formulário de signup da Hosted UI
    já tinha antes de D-321; sem isso o formulário de cadastro seria inutilizável (usuário nunca
    saberia por que "criar conta" falhou silenciosamente).
- **Política de senha** (`infra/modules/cognito/main.tf`): mínimo 12 caracteres, exige minúscula +
  maiúscula + número + símbolo — mais rigorosa que o mínimo do NIST 800-63B (8) e do próprio padrão
  anterior da Hosted UI (que usava a mesma política, nunca mudou).
- **CSRF**: `POST /bff/login`/`/bff/signup`/etc. deliberadamente SEM verificação CSRF — não existe
  cookie de sessão ainda neste ponto para proteger; o mesmo trust boundary que o redirect não
  autenticado da Hosted UI já tinha. Login-CSRF (atacante loga vítima na CONTA DO ATACANTE) é um
  risco residual conhecido, de severidade baixa, não introduzido por esta mudança.
- **`SECRET_HASH` nunca sai do BFF**: o app client Cognito tem `generate_secret=true`; nenhum client
  secret chega ao browser em nenhum momento (nem no bundle do frontend, nem em resposta HTTP).
- **Fallback dormente preservado**: `GET /bff/login`/`GET /bff/callback` (OIDC/PKCE original,
  D-053/D-054) continuam intactos, testados, nunca removidos — rollback de emergência sem
  reimplementação se o direct-auth apresentar problema real em produção.
- **Sessão**: `establishSession()` (extraído de `handleCallback`, agora compartilhado com
  `loginWithPassword`) garante que as duas entradas nunca divergem no bootstrap de identidade —
  mesmo cookie opaco `__Host-et_session` já existente, nenhum formato novo.

## Gaps conhecidos, assumidos deliberadamente (não regressão silenciosa)

1. **MFA fora do escopo v1**: `mfa_configuration=OPTIONAL` está configurado no user pool, mas
   nenhuma UI de matrícula jamais existiu (Hosted UI incluída) e nenhum usuário real tem TOTP
   configurado. `InitiateAuth` retornando `ChallengeName` inesperado falha fechado como
   `UNSUPPORTED_CHALLENGE` — nunca um bypass silencioso.
2. **Sem rate-limiting dedicado por conta/IP nas rotas de auth**: a única defesa de vazão hoje é o
   throttle da própria API Gateway stage do BFF, `throttling_rate_limit=10`/`burst=50`
   (`infra/modules/bff-api-gateway/main.tf`) — um limite AGREGADO para TODO `/bff/*` (login, signup,
   `GET /bff/session`, proxy autenticado, tudo), não um controle específico de tentativas de login
   por conta/IP. Sem `AdvancedSecurityMode` no user pool (não configurado — ausência confirmada em
   `infra/modules/cognito/main.tf`), o Cognito não aplica bloqueio adaptativo de credencial
   comprometida nem CAPTCHA. Isto é IDÊNTICO à exposição que a Hosted UI já tinha antes de D-321
   (ela também chamava `InitiateAuth` sem `AdvancedSecurityMode`) — não é uma regressão introduzida
   por esta mudança, mas também nunca foi endereçado explicitamente. Marcado aqui como achado real
   a decidir nesta rodada, não escondido.
3. **Login-CSRF residual** (ver acima) — mesmo perfil de risco que qualquer formulário de login sem
   token anti-CSRF prévio (a vítima teria que estar convencida a submeter credenciais PRÓPRIAS via
   um site do atacante contra o formulário genuíno — o Cognito nunca vê a origem do POST).

## Testes/evidência (D-321, decisions-log.md)

Backend: 271 arquivos/3208 testes verdes (+~30 cobrindo `loginWithPassword`/`signUp`/
`confirmSignUp`/`resendConfirmationCode`/`startForgotPassword`/`confirmForgotPassword`), cobertura
86,26%/84,66%/87,01%/86,26%. Frontend: 57/452 testes verdes (+16). Terraform: `validate`/`test`
(módulos `cognito` 4/4, `bff-api-gateway` 8/8) verdes. `terraform plan` real NUNCA rodado contra
`dev` fora da pipeline (regra permanente).

## Auto-nota cega (Claude, antes de ver a crítica do Codex)

**8.2/10.** Mecanismo correto (SDK oficial, HMAC documentado, least-privilege auth flow),
anti-enumeração bem pensada e testada, fallback de rollback preservado, cobertura de teste real e
extensa. Não chega a 9 porque dois dos três gaps acima (rate-limiting dedicado, `AdvancedSecurityMode`)
são reais faltas de defesa em profundidade numa superfície de autenticação nova — "não é pior que
antes" é verdade, mas não é o mesmo padrão que o resto do projeto aplica a outras superfícies
sensíveis (ex. `DocumentArchiveGuestRateLimiter` dedicado para acesso de convidado). Uma rodada
adversarial adequada deve decidir se isso é aceitável para a fase atual do projeto (sem usuário
real, `AGENTS.md` §1) ou se deveria fechar antes de considerar D-321 encerrado.

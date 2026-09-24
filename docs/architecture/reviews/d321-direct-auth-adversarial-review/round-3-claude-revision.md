# D-321 — Rodada 3 (endereçando os achados da Rodada 2, nota 8.4/10)

## Achado 5 (device-remembering) — ACEITO o achado do Codex, CORRIGIDO com evidência decisiva

A citação do Codex na Rodada 2 é decisiva e eu estava errado na Rodada 2: `DeviceConfigurationType`
(doc oficial AWS) diz literalmente **"When you provide a value for any property of
DeviceConfiguration, you activate the device remembering for the user pool."** — ativação é uma
propriedade do POOL, não da sessão/confirmação de dispositivo. Minha tréplica anterior (inferir
"não ativo" a partir de zero chamadas a `ConfirmDevice`) estava structurally errada.

**Corrigido**: `device_configuration` REMOVIDO por completo de
`infra/modules/cognito/main.tf` — nada no código chama `ConfirmDevice`/`UpdateDeviceStatus`/passa
`DEVICE_KEY` (confirmado por grep, zero ocorrências em `src/`), então o bloco só ativava uma
funcionalidade nunca usada, com o efeito colateral real de quebrar o refresh de sessões
`InitiateAuth` via `/oauth2/token`.

**Por que não reescrevi o refresh para `InitiateAuth`/`REFRESH_TOKEN_AUTH` em vez disso**:
investigação encontrou uma decisão PRÉ-EXISTENTE, deliberada, em `infra/modules/cognito/tests/
cognito.tftest.hcl` (D-054, "Full BFF hardening amendment") que **exclui explicitamente**
`ALLOW_REFRESH_TOKEN_AUTH` do `explicit_auth_flows` do client — para forçar todo refresh a passar
pelo endpoint `/oauth2/token`. **Correção de precisão (Rodada 3, achado do Codex)**: a formulação
original desta nota dizia que rotação "só é aplicada" via `/oauth2/token` — impreciso;
`GetTokensFromRefreshToken` (outra operação da API que também suporta rotação) não foi excluída por
esse motivo isoladamente. O ponto real que sustenta manter a decisão de D-054 intacta é mais
simples: `REFRESH_TOKEN_AUTH` via `InitiateAuth` direto é incompatível com rotação HABILITADA (o
estado real deste client, D-054), e reabilitar esse auth flow só para contornar o problema de
device-remembering teria sido uma mudança de superfície de autenticação desnecessária para resolver
um problema que a remoção do `device_configuration` já resolve sozinha, sem reabrir nada. Desativar
o device tracking (que não tem NENHUM uso funcional hoje) continua sendo a correção mais direta e
de menor risco.

**Risco residual, nomeado explicitamente (mesma classe do gotcha de D-323/`ManagedLoginVersion`)**:
`device_configuration` pode ser um atributo optional+computed do provider Terraform — remover do
código-fonte pode não forçar limpeza automática num pool JÁ implantado (`terraform apply` só roda
via pipeline, nunca localmente, então isto não foi verificado empiricamente nesta rodada). Registrado
como item de verificação pós-deploy (`aws cognito-idp describe-user-pool --profile claude-dev`,
confirmar `DeviceConfiguration` nulo), não assumido como fechado sem essa checagem.

Novo teste `terraform test` (`cognito.tftest.hcl`) assertando `length(device_configuration) == 0`
— roda contra `mock_provider`, então prova a DECLARAÇÃO (nunca vai reintroduzir o bloco por
acidente), não o estado real do pool `dev` (que só a verificação acima cobre).

## Achados de cobertura de teste (Rodada 2) — CORRIGIDOS

- Novo arquivo `test/unit/bff/cognito-idp-auth-client.test.ts` (10 testes) — exercita o adapter
  REAL (`CognitoIdpAuthClient`) contra um `CognitoIdentityProviderClient` mockado lançando as
  classes de exceção REAIS do SDK (`NotAuthorizedException`/`InvalidParameterException`/
  `UserNotFoundException`/`CodeMismatchException`), não o `FakeCognitoAuthClient` de nível HTTP
  que a Rodada 1/2 usava (que nunca exercitava `looksAlreadyConfirmed()` nem o fold de
  `InvalidParameterException`). Cobre especificamente: mensagem "already confirmed" real vs.
  mensagem não relacionada (prova que `UNKNOWN_OUTCOME` é o resultado para o segundo caso, não
  mais um falso `ALREADY_CONFIRMED`); `forgotPassword` com `InvalidParameterException` real;
  `SECRET_HASH` calculado corretamente via HMAC real.
- `test/unit/bff/bff-handlers.test.ts`: teste do guard de login-CSRF reescrito para provar ORDEM
  (corpo malformado/incompleto + cross-site ainda retorna 403, nunca 400 — prova que o guard roda
  ANTES do parsing/validação, não só que uma requisição bem-formada cross-site é rejeitada). Teste
  de corpo malformado ganhou o caso `"null"` (JSON válido, não-objeto) — `"[]"` sozinho não
  discriminava a correção nova de uma validação de campo já existente.

## Achado 3 (residual da Rodada 2) — reconhecimento ajustado, não "estritamente mais fraco"

Aceito a correção do Codex: saber que uma conta está CONFIRMADA é informação adicional sobre a
existência da conta, não uma consequência estritamente mais fraca do oráculo já aceito do achado 6
(signup 409 revela "existe uma conta"; este achado revela adicionalmente "e está confirmada").
Mantido como residual aceito, mas descrito corretamente agora, não subestimado.

## Achados 2/6/7 (Rodada 2) — reconciliação de registro

Corrigido: a pendência de rate-limiting (achado 7) e a decisão explícita do achado 6 (signup 409)
agora estão de fato em `NEXT_SESSION_PROMPT.md` e `decisions-log.md` (D-329) — a Rodada 2 já as
declarava resolvidas nesse sentido, mas os arquivos ainda não tinham sido escritos; o Codex
corretamente notou a divergência entre o que a revisão afirmava e o que existia nos arquivos.

## Auto-nota cega (Claude), Rodada 3

Ver `round-3-claude-selfgrade.md` (arquivo separado).

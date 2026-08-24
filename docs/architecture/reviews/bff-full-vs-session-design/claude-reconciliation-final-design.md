> **Amendment (D-054, mesmo dia)**: uma auditoria adversarial independente trazida por Marcelo
> encontrou furos reais neste documento — em especial nos itens 8 (refresh transparente/reuse
> detection) e 9 (armazenamento de sessão) abaixo — corrigidos sem reabrir a decisão central. Ver
> `claude-adversarial-audit-round-a.md` no mesmo diretório para o texto vigente desses dois itens;
> este arquivo permanece como registro histórico imutável da Rodada 3 original, não normativo
> onde o amendment o contradiz.

# Reconciliação final (Rodada 3) — Full BFF como fronteira de sessão do browser

Convergência forte entre as propostas independentes Claude/Codex (Rodada 1) já na tese central —
nenhuma diferença material sobre "Full BFF é necessário" precisou de reconciliação. A Rodada 2
(crítica cruzada) achou 6 furos reais na proposta Claude (todos aceitos abaixo) e resolveu, com
acordo explícito dos dois lados, as 6 perguntas abertas da crítica Claude à proposta Codex.
Nenhum ponto ficou sem posição fechada.

## Decisão

Adotar Full BFF: toda chamada do browser a uma rota de recurso passa por um Lambda BFF
(`/bff/*`, atrás de HTTP API v2 próprio, mesmo padrão de infra já usado no resto do projeto) que
anexa `Authorization: Bearer <access_token>` obtido/renovado server-side antes de encaminhar ao
`ApiHandler`/API Gateway existente, cujo JWT authorizer nativo permanece **inalterado**. O
browser nunca recebe access token, refresh token ou ID token em nenhuma forma — só um cookie de
sessão opaco.

```text
Browser --(cookie __Host-et_session)--> CloudFront
                                           |-- /*      --> S3 (SPA estática, já decidido)
                                           |-- /bff/*  --> HTTP API (BFF) --> BFF Lambda
                                                              |
                                                        Authorization: Bearer <access_token>
                                                              v
                                                 API Gateway existente (JWT authorizer, inalterado)
                                                              v
                                                     ApiHandler / RequestContext / domínio (inalterados)
```

## Pontos fechados por item do checklist do ADR

1. **Tokens OAuth nunca chegam ao browser.** Login via Authorization Code (Cognito já configurado
   com `generate_secret = true`, `allowed_oauth_flows = ["code"]`,
   `infra/modules/cognito/main.tf:72,90-91`); implicit/hybrid descartados. **Lacuna encontrada só
   nesta reconciliação, não coberta por nenhuma das duas propostas de Rodada 1**: usar **PKCE**
   (`code_challenge`/`code_verifier`) além do client secret — a IETF BCP para OAuth em
   browser-based apps recomenda PKCE mesmo para confidential client, como defesa adicional contra
   interceptação/injeção do `code` de autorização no redirect. O `code_verifier` é gerado e
   mantido pelo próprio BFF (nunca pelo browser, já que o BFF inicia o redirect e recebe o
   callback), custo de implementação baixo (parâmetro extra na URL de autorização + na troca de
   token) e sem trade-off real a favor de omitir. Requer confirmação de que
   `aws_cognito_user_pool_client` aceita PKCE no fluxo de código autorizado por client secret
   (suportado nativamente pelo endpoint OAuth2 do Cognito) antes de implementar.

   **Segunda lacuna, achada na revisão do Codex à reconciliação (Rodada 3)**: PKCE protege o
   `code` contra interceptação/replay, mas não substitui `state` — proteção contra CSRF no
   próprio login (um atacante induzir a vítima a completar o callback de uma sessão de login
   iniciada por ele). Fechado: o BFF cria um registro `LoginAttempt` efêmero server-side
   (DynamoDB, TTL curto ~10min, tenantless pelo mesmo motivo estrutural do item 9 — identidade
   ainda não é conhecida), guardando `state`, `codeVerifier` e `nonce`; o browser recebe só um
   cookie transitório opaco `__Host-et_login` = `loginAttemptId` (`HttpOnly`, `Secure`,
   `SameSite=Lax`, `Max-Age` curto). No callback, o BFF busca o registro pelo cookie, exige
   `state` da URL de retorno do Cognito idêntico ao guardado, usa o `codeVerifier` guardado na
   troca do `code`, apaga o `LoginAttempt` e só então emite o cookie de sessão real (item 2).
   Mesmo princípio de "cookie é sempre um handle opaco para estado server-side", nunca payload
   auto-contido — consistente com o resto do desenho, em vez de um mecanismo de cookie assinado
   à parte.

2. **Cookie de sessão**: `__Host-et_session`, handle opaco de alta entropia, **conceitualmente
   distinto** do `sessionId` já usado internamente em `RequestContext`
   (`src/modules/identity/domain/request-context.ts`) e em `DeviceSession`
   (`user-repository.ts:36`) — furo real do Codex (Rodada 2, item 2): reaproveitar o mesmo nome
   aumentaria acoplamento sem ganho. Só o **hash** do cookie handle é persistido (nunca o valor
   em claro), mesmo princípio já usado por `GuestTokenPointer` (selector/secret com HMAC+pepper).

3. **Atributos do cookie**: `Secure`, `HttpOnly`, `Path=/`, sem `Domain`, prefixo `__Host-`.
   `SameSite=Lax` — confirmado por ambos os lados (Rodada 2): `Strict` quebraria o retorno do
   redirect cross-site do Hosted UI do Cognito na primeira visita (`callback_urls`,
   `infra/modules/cognito/main.tf:89,93`). Cookie CSRF separado, não-`HttpOnly`
   (`__Host-et_csrf`), mesmos demais atributos.

4. **CSRF**: toda mutação (`POST`/`PUT`/`PATCH`/`DELETE`) exige header `X-CSRF-Token` igual ao
   valor do cookie `__Host-et_csrf` e ao valor registrado na sessão server-side; `GET`/`HEAD`/
   `OPTIONS` isentos (nunca mutam). Falha → 403 via taxonomia `AppError` existente
   (`src/shared/errors/app-error.ts`), sem envelope novo. Rotaciona a cada login.

5. **Deploy same-origin**: `/*` → S3 (SPA), `/bff/*` → BFF via CloudFront, mesma origem
   percebida pelo browser — pré-requisito técnico do cookie funcionar sem CORS.

6. **Origem CloudFront concreta** (furo real do Codex, Rodada 2, item 6): o BFF é exposto por um
   HTTP API v2 próprio na frente do(s) Lambda(s) — mesmo padrão de infra já usado por todo
   handler existente (`infra/modules/api-gateway/`), não uma Function URL solta. CloudFront
   aponta `/bff/*` para esse HTTP API. `CachingDisabled`, `Cache-Control: no-store` em toda
   resposta de `/bff/*`.

7. **BFF → API de recurso**: o BFF chama o `ApiHandler` existente como qualquer chamador
   autenticado, anexando o Bearer obtido da sessão server-side. **O JWT authorizer nativo não
   muda para Lambda authorizer.** Rotas de recurso **continuam aceitando Bearer direto**, sem
   passar pelo BFF — acordo explícito Rodada 2 (pergunta 4): Full BFF é aditivo, preserva o
   caminho para um cliente mobile/API futuro, não revoga o mecanismo de autenticação existente.

8. **Ciclo de vida de refresh, 100% transparente** (acordo explícito Rodada 2, pergunta 6): o BFF
   renova o access token internamente sempre que uma chamada de recurso chega com o token
   expirando (<60s), sem endpoint de refresh que o frontend precise chamar proativamente — o
   frontend só reage a 401 de sessão morta. **Reuse detection real** (furo do Codex, Rodada 2,
   item 1 — minha Rodada 1 tratava só "se Cognito rejeitar, invalida", insuficiente): o registro
   de sessão mantém uma versão/geração do refresh token local; cada troca bem-sucedida incrementa
   a geração via `ConditionExpression` (mesmo padrão OCC de `src/shared/dynamodb/occ.ts`) — uma
   segunda tentativa de uso da geração anterior (replay) falha a condição e força invalidação
   completa da sessão, independentemente do que o Cognito aceitaria isoladamente.

9. **Armazenamento server-side, com ponteiro tenantless** (furo do Codex, Rodada 2, item 3, e
   pergunta 2 da crítica Claude — acordo explícito dos dois lados): o `DeviceSession` existente
   (`TENANT#t#USER#u`/`SESSION#<deviceId>`) permanece intocado, dono da semântica de revogação já
   implementada. Adiciona-se um ponteiro tenantless novo — `PK=SESSION#<cookieHandleHash>` /
   `SK=POINTER` — apontando para `{tenantId, userId, deviceId}`, mesmo padrão estrutural já usado
   2x (`IdentityMapping` para `cognitoSub→userId`, `GuestTokenPointer` para token de guest
   upload) — com este ponteiro e o `LoginAttempt` do item 1, o padrão se repete pela 3ª e 4ª vez,
   candidato a nomear explicitamente em `data-model.md` numa próxima revisão (não bloqueia esta
   decisão; ajuste editorial apontado pelo Codex na revisão desta reconciliação).

   **Correção real, achada na revisão do Codex à reconciliação (Rodada 3)**: minha resposta à
   pergunta 3 (Rodada 2, "chave gerenciada `aws/dynamodb`, sem CMK dedicada, mesmo raciocínio de
   D-033") estava tecnicamente errada. `aws/dynamodb` é a chave gerenciada usada pela criptografia
   transparente **da tabela inteira** (`infra/modules/dynamo-table/main.tf:143`, já existente,
   inalterada) — protege contra exposição de mídia física/backup, mas é invisível à aplicação:
   nenhum código de Lambda chama `kms:Decrypt` contra ela, e ela não pode ser usada para
   criptografia de campo a partir de código da aplicação. O problema real que a pergunta 3
   tentava resolver é outro: a política geral de leitura da tabela
   (`tenant_facing_read_write`/`tenant_facing_read`, `infra/modules/dynamo-table/main.tf:180+`) já
   concede `GetItem`/`Query` na tabela base a várias roles de handler de recurso
   (`items_handler`, `subjects_handler`, etc., `infra/main.tf`) — exatamente o mesmo isolamento
   que já levou o projeto a nunca conceder GSI3/GSI6 pela política geral, só por política
   escopada explicitamente ao índice (`infra/modules/dynamo-table/main.tf:215-226`, regra em
   `AGENTS.md` §7). O item de sessão está sob esse mesmo risco: qualquer handler de recurso já
   consegue ler o item de sessão bruto.

   Correção: **envelope encryption real do campo do refresh token**, via uma **CMK dedicada
   nova** (`infra/modules/session-crypto` ou equivalente) cuja política + IAM concedem
   `kms:Decrypt`/`kms:GenerateDataKey` **só à role do BFF Lambda**, nunca às roles de handler de
   recurso — mesmo princípio de isolamento explícito já usado para GSI3/GSI6, aplicado a uma
   permissão de KMS em vez de uma policy de índice. Isso reverte minha resposta à pergunta 3 da
   Rodada 2: o caso de D-033 (chave gerenciada em vez de CMK) não se aplica aqui, porque D-033
   tratava de SSE de bucket S3 (transparente, sem chamada de app), enquanto aqui o requisito é
   uma chamada de API de KMS a partir do código do BFF — algo que uma chave AWS-managed
   (`aws/dynamodb`, `aws/s3`) estruturalmente não expõe a código de aplicação. Sem a CMK
   dedicada, um handler de recurso com `dynamodb:GetItem` já concedido leria o refresh token em
   texto claro (SSE de tabela não o impede). Custo real (~US$1/mês, mesma ordem que D-033
   rejeitou) é justificado aqui porque é o próprio mecanismo de isolamento, não um extra
   opcional como era o caso do bucket S3.

10. **Logout**: `/bff/session/logout` (dispositivo) e `/bff/session/logout-all` (global) atualizam
    `deviceLogoutAfter`/`globalLogoutAfter` exatamente como já implementado em
    `UserRepository.logoutDevice()`/`logoutAll()`. Ajuste de precisão (furo do Codex, Rodada 2,
    item 4): a fonte de verdade da revogação é o watermark já checado em toda requisição por
    `resolveRequestContext` (`src/modules/identity/application/resolve-request-context.ts:71,76`)
    — `AdminUserGlobalSignOut` do Cognito é um complemento best-effort (impede o próprio Cognito
    de emitir/renovar tokens depois), nunca a única semântica de enforcement.

11. **Allowlist explícita**, code-first: `/bff/items/*`→`{API_BASE}/items/*` etc., mapa curto
    espelhando as rotas já registradas no API Gateway. Nunca wildcard passthrough. `/guest/*`
    fica fora do BFF (já é rota pública com validação própria).

12. **Erro**: repassa o `AppError` normalizado já existente, sem reformular taxonomia; nunca vaza
    detalhe de infraestrutura.

13. **Correlation ID: handlers de recurso permanecem intocados** (furo do Codex, Rodada 2, item
    1 — acordo explícito, pergunta 1). Hoje nenhum handler aceita correlationId de header do
    chamador (`event.requestContext.requestId` gerado pelo API Gateway +
    `ulid()` local, `src/runtime/aws/handlers/items-handler.ts:36-43`); o único caso de
    correlation cross-hop confiável no projeto usa `MessageAttribute` interno de fila
    (`correlationIdFromSqsRecord`, `src/shared/observability/context.ts:35`), nunca um header
    HTTP externamente alcançável — e como rotas continuam aceitando Bearer direto (item 7), um
    handler não teria como distinguir "header veio do BFF" de "header veio de qualquer chamador
    com Bearer válido" sem inventar um segredo compartilhado, fora de escopo deste ADR. Correlação
    BFF↔backend fica por log-join (rota/timestamp/request id de cada hop), não por campo de
    confiança propagado.

14. **Cache**: `no-store` default em toda resposta de `/bff/*`.

15. **Rate limiting**: herda throttling nativo do HTTP API (D-051) + limite por sessão para
    refresh/login-callback, mesmo padrão de implementação de `GuestRateLimiter`/
    `InitialInviteRateLimiter` (duplicado deliberadamente por módulo — D-049).

16. **Fronteira com domínio, escopo restrito** (furo do Codex, Rodada 2, item 5 — aceito): o BFF
    autentica sessão, aplica CSRF, renova token, encaminha por allowlist e normaliza erro. **Não
    decide** nada de negócio. Composição de view model por tela (ex. um endpoint agregador
    `/bff/dashboard`) fica **explicitamente fora do escopo desta decisão** — não é rejeitada,
    mas não é decidida aqui; se surgir necessidade real, é uma decisão de produto separada,
    revisada quando houver caso concreto, para não abrir escopo/blast radius sem necessidade
    comprovada.

## Classificação e status

Type 1, nível 5-6 (`change-risk-scale.md`). Refina D-034/§23.1 do blueprint (nunca reabre "BFF,
não Cognito direto") — decide o mecanismo de autenticação das chamadas de recurso, que a decisão
original nunca cobriu.

## Fora deste debate (confirmado pelos dois lados)

Framework/runtime do BFF, rubrica de qualidade de frontend (`expiration-tracker-bff-frontend-quality-standard.md`
§13-30 — se virar padrão oficial, deveria passar pela mesma convergência independente que os 9
eixos de `docs/engineering/joint-review-criteria.md` já usaram), MFA/provider de e-mail/modelo
Bedrock, composição de view model por tela (item 16), política comercial de sessão concorrente.

## Rodada 4 — correções finais e nota

Revisão do Codex à reconciliação (Rodada 3) achou 2 furos reais adicionais, ambos corrigidos
antes de fechar (ver itens 1 e 9 acima): ausência de `state` no callback OAuth (CSRF de login,
distinto de PKCE) e uso tecnicamente incorreto de chave gerenciada `aws/dynamodb` para cifrar o
refresh token (SSE de tabela não isola contra Lambda de recurso com `GetItem` já concedido —
corrigido para envelope encryption com CMK dedicada, `kms:Decrypt` só para a role do BFF, mesmo
princípio de isolamento explícito já usado para GSI3/GSI6).

**Nota final (protocolo de nota cega, `AGENTS.md` §4): Claude 9,2 / Codex 9,3 — ambos ≥9,0, sem
arredondar. APPROVED.**

## Próxima ação

Registrado como **D-053** em `decisions-log.md`. Recomendações de manutenção de contexto
(`AGENTS.md` §6), não bloqueantes para a implementação: (1) mover
`expiration-tracker-bff-frontend-quality-standard.md` para `docs/frontend/bff-architecture.md`
(conforme sua própria §33), com nota clara de que este documento de reconciliação é a fonte
normativa do desenho, não a análise original; (2) se a rubrica de qualidade de frontend
(§13-30 do mesmo documento) for adotada como padrão oficial, passar pela mesma convergência
independente Claude↔Codex que os 9 eixos de `docs/engineering/joint-review-criteria.md` já
usaram, em vez de herdada de uma análise solo; (3) anotar `implementation-blueprint.md` §4.2 com
referência a este ADR. Implementação em si aguarda decisão do Marcelo sobre início — mesmo padrão
de D-035/M7 — mas o design já está pronto para a próxima sessão que ele autorizar.

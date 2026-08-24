# Auditoria adversarial Rodada A (Claude) — 16 pontos levantados por revisão independente sobre D-053

Escopo confirmado: **não reabre Full BFF**. Todos os itens de "não reabrir sem evidência" (§24 do
prompt de auditoria) permanecem — Full BFF, SPA estática, S3+CloudFront, HTTP API dedicado, JWT
authorizer inalterado, Bearer direto continua aceito, `/guest/*` fora do BFF, BFF sem regra de
negócio, `AppError` existente, `no-store`, watermarks como source of truth, route allowlist,
handle opaco, hash-only persistido, PKCE, `state`. Cada ponto abaixo foi verificado contra código
real (dois levantamentos factuais dedicados, um de código, um de fontes externas atuais — RFC
9700 é real e "Best Current Practice"; "OAuth 2.0 for Browser-Based Applications" **é hoje RFC
10017 / BCP 212**, confirmando o número citado no prompt de auditoria) antes de qualquer veredito.

## Achado estrutural prévio a todos os 16 pontos (não estava no prompt de auditoria, encontrado na verificação de código)

`DeviceSession` (`user-repository.ts:29-43`) — a entidade que D-053 item 9/10 assume como já
existente e funcional para revogação por dispositivo — **nunca é criada por nenhum fluxo real
hoje**. `upsertDeviceSession()` só é chamado em teste (`test/unit/identity/resolver.test.ts:82`).
`resolveRequestContext()` só faz leitura (`getDeviceSession`), gera um `sessionId` novo em memória
quando não encontra nada, e **nunca persiste** esse valor. Ou seja: "logout por dispositivo" como
descrito desde o blueprint §4.2 original nunca funcionou de ponta a ponta — é uma lacuna
pré-existente (M1), só exposta agora porque D-053 depende dela para revogação. Isso não invalida
D-053, mas muda o que precisa ser implementado: o BFF não pode assumir que pode simplesmente
"apontar" para um `DeviceSession` já materializado — alguém precisa finalmente escrever
`upsertDeviceSession()` no caminho de `resolveRequestContext`. Tratado no Ponto 11 abaixo.

## Tabela dos 16 pontos

| # | Ponto | Veredito | Severidade | Evidência principal | Mudança necessária |
|---|---|---|---|---|---|
| 1 | `nonce` no ID Token | PARTIALLY VALID | LOW | OIDC Core exige validar `nonce` só *se enviado*; seu propósito normativo é proteger ID Token que trafega pelo front-channel (implicit/hybrid) — aqui o ID Token nunca sai do back-channel BFF↔Cognito. RFC 9700 trata PKCE como já suficiente para o papel de CSRF que `state`/`nonce` cobririam | Adicionar `nonce` ao `LoginAttempt` (custo ~zero, já existe o registro) e validar no ID Token; não é lacuna que bloqueie o design |
| 2 | Race condition no refresh transparente | VALID | HIGH | Meu texto original ("geração incrementada, réplica = invalida sessão") cria falso positivo real sob concorrência legítima. Cognito tem **rotação nativa com grace period de até 60s desde abril/2025**, desenhada exatamente para absorver isso | Substituir o mecanismo local de "geração" por rotação nativa do Cognito (grace period) como fonte de verdade + lease BFF-side só como otimização de latência, nunca como decisão de segurança |
| 3 | Estados de resultado do refresh | VALID | MEDIUM | Decorre diretamente do Ponto 2; `AppError` já tem categoria `DEPENDENCY_UNAVAILABLE` (retryable) pronta para timeouts/5xx do Cognito | Formalizar as 5 categorias de resultado; só `invalid_grant` fora do grace period mata a sessão |
| 4 | Sessão em tabela dedicada vs. tabela compartilhada | VALID | HIGH | `tenant_facing_read_write`/`tenant_facing_read` (`dynamo-table/main.tf:180+`) concede `GetItem`/`Query` na tabela base a **~20+ roles de Lambda de recurso** (`items_handler`, `subjects_handler`, etc.) — cifrar só o refresh token não protege `codeVerifier` (segredo PKCE) nem os demais metadados de sessão, todos legíveis por qualquer uma dessas roles hoje | Mover ponteiro de sessão + `LoginAttempt` para uma tabela DynamoDB **nova, dedicada, IAM-isolada só para o BFF** — menor blast radius que retrofitar `dynamodb:LeadingKeys` nas ~20 policies já em produção |
| 5 | `SameSite=Lax` vs `Strict` | VALID | MEDIUM | Cookie de login (`__Host-et_login`) precisa `Lax` (retorno cross-site do Hosted UI); cookie de sessão só é setado DEPOIS do callback validado, via redirect same-origin — pode ser `Strict` sem quebrar nada | Dois cookies com atributos distintos: login=`Lax`, sessão=`Strict` |
| 6 | Prefixo `__Host-Http-` vs `__Host-` | NOT VALID | — | `__Host-`/`__Secure-` têm suporte universal nos browsers atuais; nenhum browser distingue o meio do nome — é só rótulo | Manter `__Host-et_session` como já reconciliado; sem mudança funcional |
| 7 | `Origin`/`Sec-Fetch-Site` como defesa CSRF adicional | VALID | LOW | OWASP recomenda como camada adicional; suporte universal desde março/2023; fallback obrigatório quando ausente (nunca fail-open) | Adicionar checagem de `Sec-Fetch-Site` ANTES do token CSRF, como camada extra — não substitui o double-submit já decidido |
| 8 | Logout + `RevokeToken` | VALID | LOW-MEDIUM | API real do Cognito, revoga só a família de UM refresh token, não afeta outros dispositivos, chamável pelo BFF (não via IAM) | Adicionar `RevokeToken` best-effort no logout por dispositivo, sempre APÓS a revogação local (que continua sendo a fonte de verdade) |
| 9 | Allowlist de headers do proxy | VALID | MEDIUM | `toApiGatewayResult()` (`http-adapter.ts:34-40`) já só monta um header fixo — padrão do próprio projeto é construção explícita, nunca passthrough | Formalizar allowlist de request/response headers como requisito explícito do BFF, não deixar implícito |
| 10 | Path traversal / normalização | VALID (mas já coberto pelo princípio) | LOW | API Gateway já resolve `pathParameters` antes do Lambda ver o evento; allowlist code-first (D-053 item 11) já implica reconstrução por template, nunca concatenação de string bruta | Tornar explícito por escrito + teste de aceite; não é mudança estrutural |
| 11 | Resolução de identidade interna pelo BFF | VALID (elevado de PARTIALLY VALID/MEDIUM na Rodada B) | HIGH | Ver achado estrutural acima — `DeviceSession` nunca é persistida hoje, E o backend só checa `deviceLogoutAfter` quando o JWT tem claim `device_id` (`http-adapter.ts:18`, `resolve-request-context.ts:76`) — origem exata dessa claim não confirmada nesta auditoria | Escopo corrigido explicitamente (ver detalhamento abaixo) — nunca prometer enforcement de dispositivo no backend para Bearer direto sem essa claim confirmada |
| 12 | Armazenamento do `client_secret` | PARTIALLY VALID | LOW | Projeto não usa Secrets Manager/SSM hoje; único precedente real (`GUEST_TOKEN_PEPPER`) é `random_password` + env var Lambda em texto plano | Seguir o MESMO padrão já estabelecido (env var só no BFF, `sensitive = true` no Terraform); não introduzir Secrets Manager sem motivo concreto |
| 13 | Lifetime da sessão (idle/absolute timeout) | VALID | MEDIUM-HIGH | Confirmado: nenhum documento normativo do projeto define idle/absolute timeout hoje — risco real de "sessão eterna" via refresh contínuo | Definir `absoluteExpiresAt` (fixo na criação, nunca estendido) + idle timeout via `purgeAfterTtl` já usado no projeto |
| 14 | Consumo único do `LoginAttempt` | VALID (maioria já implícita no design) | LOW | Nenhum código ainda escrito; decisão de delete-on-consume é direta com os OCC helpers já existentes | Formalizar como requisito + testes de aceite (callback duplicado, `state` inválido, timeout) |
| 15 | `returnTo`/open redirect | VALID, mas não aplicável hoje | MEDIUM (condicional) | D-053 nunca propôs `returnTo` — não é uma lacuna do design atual | Registrar como requisito a aplicar SE/QUANDO essa funcionalidade for adicionada |
| 16 | CloudFront + WAF no escopo do milestone | VALID | MEDIUM | Confirmado: **não existe nenhum módulo CloudFront no projeto hoje** — D-053 item 5/6 pressupõe CloudFront que ainda não foi construído | CloudFront (S3+BFF origins, sem WAF) entra no escopo do milestone Full BFF por necessidade técnica; WAF-on-CloudFront permanece no MESMO gate pré-produção já estabelecido em D-051 (não uma decisão nova) |

## Aprofundamento dos pontos VALID/HIGH

### Ponto 2 — Race condition (o mais grave, confirmado)

Resposta às 8 perguntas obrigatórias:
1. **Sim**, o texto original de D-053 ("cada troca bem-sucedida incrementa a geração... réplica
   falha a condição e força invalidação completa") tem uma falha real: não especifica QUANDO a
   condição é reivindicada em relação à chamada ao Cognito.
2/3. Se a `ConditionExpression` reivindica a geração **depois** de uma chamada bem-sucedida ao
   Cognito (like meu texto sugeria), nada impede duas Lambdas concorrentes de chamarem o Cognito
   **antes** de qualquer uma reivindicar — ambas teriam sucesso na chamada externa, e só uma
   ganharia a atualização local, fazendo a outra parecer "réplica" sem ser.
4. **Sim**, existe essa janela — nenhuma coordenação acontece antes da chamada ao Cognito no
   desenho original.
5. **Sim, decisivamente**: com rotação nativa habilitada, o Cognito aceita o refresh token antigo
   por até 60s de grace period especificamente para tolerar isso — o "replay" real só existe
   quando o Cognito rejeita **fora** dessa janela.
6. **Sim**, no desenho original; **não**, no desenho corrigido abaixo.
7. Cada invocação Lambda é isolada (sem estado compartilhado em memória entre invocações
   concorrentes) — qualquer correção tem que vir de DynamoDB condicional ou do comportamento do
   próprio Cognito, nunca de cache local.
8. Distinção correta: replay real = Cognito rejeita com `invalid_grant` **fora** do grace period
   nativo; concorrência legítima = absorvida pelo grace period do Cognito (ou pela lease BFF-side
   antes de sequer chegar ao Cognito).

**Correção adotada (substitui D-053 item 8), com o furo real que o Codex achou na Rodada B já
fechado**: habilitar rotação nativa do Cognito (`RefreshTokenRotation.Feature = ENABLED`,
`RetryGracePeriodSeconds` recomendado 30s — margem confortável abaixo do teto de 60s) como
mecanismo de correção primário. **Verificado via busca externa dedicada (WebSearch, não aceito de
graça)**: rotação nativa é **mutuamente exclusiva** com o auth flow `REFRESH_TOKEN_AUTH` — a
AWS exige desabilitar `ALLOW_REFRESH_TOKEN_AUTH` no app client e usar só `/oauth2/token`
(`grant_type=refresh_token`) ou `GetTokensFromRefreshToken`, nunca `InitiateAuth`/
`AdminInitiateAuth` com esse flow. Isso não custa nada ao design: o Full BFF já usa
exclusivamente os endpoints OAuth2/Hosted UI (Authorization Code + PKCE) para login E refresh,
nunca `InitiateAuth` direto — `ALLOW_REFRESH_TOKEN_AUTH` em
`infra/modules/cognito/main.tf:67` é hoje **vestigial** para este desenho (configurado sob a
suposição antiga de "BFF de sessão" que nunca foi implementada) e deve ser removido do
`explicit_auth_flows` como parte do amendment. `ALLOW_USER_SRP_AUTH` também deveria ser
reavaliado pelo mesmo motivo (least privilege de auth flow) a menos que algum caller real e não
descoberto nesta auditoria dependa dele — verificar antes de remover. Acima disso, uma lease
BFF-side (`refreshState: IDLE|IN_PROGRESS`, `refreshLeaseId`, `refreshLeaseUntil` TTL curto ~5s)
serve só para reduzir chamadas redundantes ao Cognito/latência — nunca para decidir se algo é
"replay". **Fencing explícito (furo real achado pelo Codex na Rodada B, adotado)**: a lease só é
adquirida via `ConditionExpression` antes de chamar o Cognito (nunca depois), gerando um
`refreshLeaseId` novo por tentativa; ao terminar (sucesso ou falha), a escrita de
liberação/persistência só é aceita se `refreshLeaseId` ainda bater com o valor lido na aquisição
(fencing token) — evita que um vencedor atrasado sobrescreva um estado mais novo já escrito por
uma tentativa posterior que já considerou a lease expirada e reivindicou de novo. Se o vencedor
morre depois do Cognito responder mas antes de persistir, o resultado cai em `UNKNOWN_OUTCOME`
(Ponto 3), nunca em replay.

Avaliação das alternativas do prompt: lock distribuído genérico e version-based
reconciliation são reinvenção do que o Cognito já resolve nativamente e mais robustamente;
"evitar refresh proativo e reagir a 401" sozinho pioraria UX (toda call perto da expiração sofreria
um round-trip extra de 401→refresh→retry) sem eliminar a race (dois 401 concorrentes teriam o
mesmo problema); "refresh token rotation do Cognito como única fonte de verdade" é essencialmente
a escolha feita aqui, com a lease como otimização não-crítica por cima.

### Ponto 3 — Estados de resultado (decorre do Ponto 2)

- `SUCCESS`: Cognito retorna par novo — persiste, libera lease, segue.
- `DEFINITIVE_AUTH_FAILURE`: `invalid_grant` (ou equivalente) — **único** caso que mata a sessão.
- `TRANSIENT_TRANSPORT_FAILURE`: timeout/5xx antes de resposta — libera a lease (TTL curto já
  garante isso mesmo sem ação explícita), responde ao browser via `AppError`
  `DEPENDENCY_UNAVAILABLE` (categoria já existente, retryable) — nunca invalida a sessão.
- `CONCURRENT_REFRESH`: lease ocupada — backoff curto (~50-100ms), re-lê, usa o resultado do
  vencedor; se o lease expirar sem resolução (Lambda vencedora morreu), qualquer requisição pode
  reivindicar de novo (self-healing pelo TTL curto).
- `UNKNOWN_OUTCOME`: resposta perdida depois do Cognito processar — tratado como transiente por
  até 1 nova tentativa completa antes de escalar a definitivo; risco residual aceito (janela muito
  estreita: só ocorre se a perda de rede durar mais que o grace period, cenário raro e não
  adversarial).

### Ponto 4 — Tabela de sessão dedicada (segundo achado mais grave)

Tabela pedida (token por token):

| Token | Persiste? | Sensibilidade | Cripto? | Motivo |
|---|---|---|---|---|
| access token | Sim (cache curto, ≤15min) | Média | Recomendado (mesma CMK, custo marginal zero já com a infra existindo) | Evita re-obter a cada chamada; TTL curto já limita exposição |
| refresh token | Sim (30 dias) | Alta | **Sim, obrigatório** | Já decidido em D-053 Rodada 4 — mantido |
| ID token | **Não** | Alta (PII: email, sub) | N/A | Só usado para extrair claims no login; identidade durável já vive em `IdentityMapping`/`UserProfile` — persistir seria reter PII sem necessidade (mesmo princípio FG5 da análise original) |

Comparação A (tabela compartilhada + cripto de campo) vs. B (tabela dedicada + least privilege +
cripto opcional): **B vence** — não por dogma, mas porque a política de leitura geral já
existente (`tenant_facing_read_write`) concede acesso de leitura à tabela base a ~20 roles que
não deveriam nunca ver `codeVerifier`/metadados de sessão, e cifrar só um campo (refresh token)
deixa o resto exposto. Uma tabela nova custa ~zero adicional (DynamoDB on-demand não tem custo
fixo por tabela) e isola por IAM exatamente como GSI3/GSI6 já fazem por índice — mesmo princípio,
aplicado a uma tabela em vez de um índice. `DeviceSession` continua na tabela principal (não
contém segredo, só metadados de revogação) — só o ponteiro de sessão + `LoginAttempt` migram para
a tabela nova. CMK dedicada permanece como defesa em profundidade sobre o refresh token mesmo
dentro da tabela isolada (contra erro futuro de IAM), não como a única camada.

### Ponto 11 — Escopo corrigido do logout por dispositivo (Rodada B elevou este ponto para HIGH)

Codex apontou corretamente um furo real na minha correção original: "consertar
`upsertDeviceSession()`" não resolve sozinho o problema, porque o backend só aplica o watermark
`deviceLogoutAfter` quando o JWT carrega uma claim `device_id` (`http-adapter.ts:18`,
`resolve-request-context.ts:76`) — e esta auditoria não confirmou de onde essa claim viria de
forma confiável hoje (não é uma claim padrão do Cognito; a origem real não foi localizada no
código verificado). Prometer "enforcement por dispositivo checado em toda requisição" sem essa
claim resolvida seria uma afirmação falsa no ADR.

**Escopo corrigido, honesto sobre o que é garantido onde**: para o browser (o único cliente do
Full BFF), a tabela de sessão dedicada do BFF (Ponto 4) já É a fonte de verdade suficiente do
logout por dispositivo — o BFF simplesmente recusa/expira o ponteiro de sessão correspondente, e
como o browser só alcança rotas de recurso *através* do BFF, isso já bloqueia o acesso
imediatamente, sem depender de nenhuma claim JWT nova. `DeviceSession` na tabela principal
continua existindo só como metadado auxiliar best-effort (ex. futura tela "dispositivos ativos"),
**nunca** como garantia de enforcement backend para um chamador com Bearer direto (que continua
protegido só pelo watermark global `globalLogoutAfter`, já funcional). Resolver a claim
`device_id` confiável para Bearer direto fica registrado como item separado, fora do escopo do
Full BFF (não é uma regressão introduzida por D-053, é uma lacuna pré-existente do próprio
suporte a Bearer direto, quando/se isso vier a importar).

**Fronteira de invocação do BFF para `logoutDevice()`/`logoutAll()`** (furo 3 do Codex, Rodada B):
não requer endpoint HTTP interno novo — o BFF importa e chama `UserRepository`/o composition root
de `identity` diretamente como dependência de biblioteca dentro do mesmo processo/bundle, mesmo
padrão já usado por `src/workers/reminder-producer` importando `src/modules/reminder`
diretamente. Sem transação cross-table: a escrita crítica (ponteiro de sessão do BFF) e a escrita
best-effort (`DeviceSession` na tabela principal) não precisam de atomicidade entre si — são
preocupações diferentes com requisitos de consistência diferentes (mesmo padrão já usado no
projeto para efeitos colaterais best-effort fora da transação principal, ex. envio de e-mail em
D-049).

### Ponto 13 — Lifetime de sessão

`createdAt` (fixo), `lastSeenAt` (atualizado a cada uso), `absoluteExpiresAt = createdAt + 30d`
(nunca estendido por refresh — evita sessão "eterna" via uso contínuo), idle timeout separado
(recomendo 7 dias sem uso) via o mesmo mecanismo de TTL físico (`purgeAfterTtl`) já usado em todo
o projeto (`GuestTokenPointer`, etc.). BFF checa os dois antes de honrar uma sessão, além dos
watermarks já existentes.

## Pontos rejeitados ou sem mudança necessária

- **Ponto 6** (prefixo de cookie): NOT VALID como requisito de segurança — puramente cosmético,
  sem diferença funcional em nenhum browser atual.
- **Correlation ID** (seção 23 do prompt): não reaberto — nenhuma evidência nova invalida a
  decisão de D-053 Rodada 3/4 (log-join, sem header de confiança). CloudFront gera seu próprio
  `x-amz-cf-id`, disponível de graça como mais uma chave de log-join, sem criar trust boundary
  novo — nota informativa, não mudança de decisão.
- **Ponto 10** (path traversal): já coberto pelo princípio de allowlist code-first do design
  original — vira requisito explícito + teste, não mudança estrutural.

## Impacto sobre D-053

**D-053 precisa de amendment** (não substituição). A decisão central (Full BFF, JWT authorizer
inalterado, Bearer direto mantido, allowlist, CSRF triplo, cookie opaco, PKCE+state) permanece
integralmente válida e não é questionada por nenhum dos 16 pontos. O amendment cobre: (1)
mecanismo de refresh corrigido (rotação nativa Cognito + lease de latência, não geração local);
(2) sessão movida para tabela dedicada IAM-isolada; (3) split de cookies login/sessão com
`SameSite` diferenciado; (4) lifetime de sessão explícito; (5) `RevokeToken` no logout; (6)
allowlist de headers explícita; (7) `Sec-Fetch-Site` como camada extra de CSRF; (8) `nonce`
adicionado ao `LoginAttempt`; (9) CloudFront (sem WAF) formalmente no escopo do milestone; (10)
achado colateral: consertar `upsertDeviceSession()` nunca-chamado como pré-requisito funcional
(pré-existente a D-053, não um item novo de segurança, mas bloqueia a revogação por dispositivo
funcionar de verdade).

## Rodada B (Codex) — furos reais achados na correção da Rodada A

Codex concordou com os 16 vereditos, mas achou 4 furos reais nas correções propostas, todos
verificados e corrigidos antes de fechar:

1. **Verificado via WebSearch dedicado antes de aceitar**: rotação nativa do Cognito é
   mutuamente exclusiva com o auth flow `REFRESH_TOKEN_AUTH` — confirmado pela documentação AWS.
   `ALLOW_REFRESH_TOKEN_AUTH` (`infra/modules/cognito/main.tf:67`) precisa ser removido do app
   client; sem custo real, já que o Full BFF só usa OAuth2/Hosted UI. `ALLOW_USER_SRP_AUTH`
   também deve ser reavaliado pelo mesmo motivo de least privilege.
2. **Fencing na lease do Ponto 2**: adotado — lease adquirida via `ConditionExpression` antes de
   chamar o Cognito, `refreshLeaseId` como fencing token, morte do vencedor entre resposta e
   persistência cai em `UNKNOWN_OUTCOME`, nunca em replay (detalhado no Ponto 2 acima).
3. **Coordenação tabela dedicada vs. tabela principal**: decidido que não é necessário
   `TransactWriteItems` cross-table — ponteiro de sessão do BFF (crítico) e `DeviceSession`
   (metadado best-effort) têm requisitos de consistência diferentes, mesmo padrão já usado no
   projeto para efeitos colaterais fora da transação principal. BFF invoca `UserRepository`
   diretamente como biblioteca (mesmo padrão de `reminder-producer` importando `src/modules/
   reminder`), sem endpoint HTTP interno novo.
4. **Ponto 11 elevado para HIGH e escopo corrigido**: detalhado na seção "Escopo corrigido do
   logout por dispositivo" acima — a tabela de sessão do BFF é fonte de verdade suficiente para o
   browser; `DeviceSession` nunca é apresentada como enforcement de backend para Bearer direto.

## Rodada D (Codex) — verificação final

Confirmado: as 4 correções fecham os furos da Rodada B. **Ainda é amendment ao D-053, não
substituição** — a decisão central Full BFF permanece intacta.

## Nota final (protocolo de nota cega, `AGENTS.md` §4)

**Claude 9,2 / Codex 9,4 — ambos ≥9,0, sem arredondar. APPROVED como amendment.**

Residual explicitamente aceito por ambos os lados (não bloqueia, mas exige validação na
implementação real, não só em design): app client Cognito com rotation habilitada contra a AWS
real; callback Hosted UI + CloudFront + cookies em browser real; testes negativos de IAM/KMS
provando que uma role de handler de recurso não consegue ler a tabela de sessão do BFF.

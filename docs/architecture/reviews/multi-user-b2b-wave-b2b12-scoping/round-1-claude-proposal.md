# Wave B2B-12 (Cutover de dev) — Round 1 Proposal

Escopo per `roadmap-evolution/17-multi-user-b2b-revised-strategy.md` §62-65 (regra de migração) e §117
(texto integral do job desta wave): "Se dados sintéticos: snapshot, reset/reseed. Se necessário
preservar: one-off migration. Nenhum compatibility fallback permanente."

## Classificação de risco (`change-risk-scale.md`)

**Type 1, nível 5** — duas ações concorrem para o nível: (a) uma ação destrutiva contra recursos AWS
reais (mesmo que dado sintético) é "difícil de reverter" por definição; (b) remover o estado
`LEGACY_TENANT_ONLY` (achado abaixo) muda o contrato observável de `OnboardingStateResolver`/
`RequestContextResolver`/`GET /bff/session`. Não é nível 6: não introduz modelo de dado fundamental
novo — o physical model já foi `APPROVED` em D-086, esta wave só fecha um remanescente dele. Protocolo
Claude↔Codex completo obrigatório.

## Achados reais (verificados por leitura de código E por inventário real `aws --profile claude-dev`,
não hipotéticos)

**Achado #1 — inventário real de `dev` confirma dado 100% sintético/descartável, zero `Organization`/
`Membership`.** `exptrk-dev-table` (`us-east-1`) tem 47 itens: `TenantQuota` (23), `TextractJob` (21),
`IdentityMapping` (1), `NotificationPreferences` (1), `User`/`UserProfile` (1). Existem só **3 valores
distintos de `tenantId` em toda a tabela**: `user_01M0K7W2PVTVCN1WADK5V1AJVY` (uma única identidade de
"smoke-test", pré-cutover), `w2-07-drill-tenant` e `w2-03-drill-tenant` (tenants sintéticos de teste de
carga do milestone W2 — `scripts/w2-07-load-test.mjs`, `scripts/grant-wave2-drill-permissions.mjs`,
nada relacionado a Multi-User B2B). **Nenhuma linha `Organization`/`Membership`/`GlobalUser` existe em
`dev` hoje**, apesar de B2B-3 a B2B-11 estarem deployados — ninguém exercitou o fluxo de onboarding novo
contra `dev` ainda. `exptrk-dev-bff-session`: 0 itens. S3: dos 6 buckets (`documents-clean`,
`documents-quarantine`, `imports`, `deploy-manifests`, `extraction-transient`, `spa`), só
`extraction-transient` tem conteúdo (21 objetos — batendo 1:1 com os 21 `TextractJob`, artefato de OCR
efêmero, já classificado "não migrar cegamente" por §66).

**Achado #2 — prova concreta de que `dev` nunca foi resetado desde antes do cutover B2B-5.** A linha
`IdentityMapping` real em `dev` (`PK=IDENTITY#cognitoSub#smoke-test-user`) **ainda tem o atributo
`tenantId`** (`fields: [cognitoSub, entityType, userId, tenantId, createdAt, SK, PK]`), mesmo o TYPE
atual (`identity-mapping-repository.ts:8`) declarando explicitamente que `tenantId` foi removido na
Wave B2B-5/D-095. DynamoDB não impõe schema — o atributo antigo simplesmente sobra, inerte, num item
gravado pelo código pré-B2B-5. Achado inofensivo por si só (nada lê esse atributo), mas é a prova
concreta e não hipotética de que o "estado real" de `dev` é literalmente pré-cutover, exatamente o que
§62/§63 descrevem em abstrato.

**Achado #3 — um remanescente real de código produtivo que ainda "entende" `tenantId=userId`.**
`src/modules/organization/application/onboarding-state.ts:50-53`
(`OnboardingStateResolver.resolve()`): `this.store.get(tenantLifecycleKey(userId))` — se encontra uma
`TenantLifecycleRecord` (chave legada `TENANT#<userId>#LIFECYCLE`), classifica como
`LEGACY_TENANT_ONLY`, um estado terminal de onboarding sem conversão para `RequestContext` usável.
Wired de verdade: `resolve-request-context.ts:101-104` lança `OnboardingRequiredError` para qualquer
estado ≠ `HAS_USABLE_MEMBERSHIP` (login bloqueado); `bff-auth-service.ts:563-568` expõe
`onboardingState` em `GET /bff/session` para o frontend reagir. **Confirmado pelo scan real acima: `dev`
tem ZERO linhas `TenantLifecycleRecord` hoje** — o ramo `LEGACY_TENANT_ONLY` é código morto contra o
dado real de `dev` neste exato momento, mas ainda existe no código produtivo, e o comentário do próprio
arquivo (linha 16-17) diz "the real state of every user today, pre-B2B-5 cutover" — comentário já
desatualizado (nada em `dev` está nesse estado; o comentário antecede o fechamento de B2B-11).

**Achado #4 — nenhum código produtivo GRAVA registro novo no formato legado.** Confirmado por leitura:
`recipient-resolver.ts`'s fallback `assigneeUserId ?? tenantId` foi **removido inteiramente** (não
mantido como compat) pela Wave B2B-11/D-108 — comentário do próprio arquivo linhas 14-21 documenta a
remoção. `identity-mapping-repository.ts:8` confirma `tenantId` removido do TYPE pela Wave B2B-5/D-095.
`bootstrap-identity.ts`'s `bootstrapUser()` grava só `GlobalUser`+`IdentityMapping` (transact de 2 itens,
confirmado em `multi-user-b2b-wave-tracker.md` B2B-5.1) — nenhum `TenantLifecycleRecord`/`UserProfile`/
`Organization` mais criado no login.

**Achado #5 — `docs/architecture/multi-user-b2b-wave-b2b0-inventory.md` (as-of B2B-0, antes de qualquer
wave rodar) já havia catalogado exatamente 3 pontos `tenantId=userId`** (§1): 2 origens
(`bootstrap-identity.ts:166-199` caminho direct-API; `bff-auth-service.ts:158-172` caminho OIDC/BFF —
ambos reescritos por B2B-5) + 1 consumidor (`recipient-resolver.ts`, removido por B2B-11). §3.1/§3.2 do
mesmo documento **não listam nenhum padrão de PK/SK ou prefixo S3 "legado"** — a convenção
`TENANT#<tenantId>#...` já era (e continua sendo) a única forma de chave; o que os Achados #1/#2 acima
mostram é um VALOR legado (`tenantId=userId` real) dentro dessa mesma forma correta de chave, não uma
forma de chave diferente — confirmado batendo `TenantQuota`'s PK real (`TENANT#user_01M0...#QUOTA`)
contra a convenção documentada em §3.1.

**Achado #6 — nenhuma ferramenta de reset/migração existe ainda.** `scripts/backfill-reminder-policies.ts`
é o precedente real deste projeto para script one-off contra AWS: Scan paginado (único uso aceito de
Scan neste código-base), `--table` nomeado, `--dry-run` default-seguro, checkpoint/resume via
`LastEvaluatedKey`, invocação manual, nunca auto-executado no deploy (`AGENTS.md`/comentário do próprio
arquivo, "RB-G10"). Nenhum script de reset/reseed/migração de tenant existe hoje;
`src/workers/tenant-purge/*` (W3-07) é só-purga, não reset/migração.

## Declaração E-014

**NÃO.** Motivo: a decisão central desta wave (reset vs. migração de dado descartável de `dev` antes de
um cutover de schema) não é um padrão que sistemas externos resolvem de forma convergente do jeito que
RBAC/invite/sessão multi-tenant são — é um julgamento de proporcionalidade interno
(`docs/engineering/principles.md` #1) sobre o dado real DESTE projeto. Mais importante: a política em
si ("preferir reset/reseed quando o dado é sintético") **já foi decidida e aprovada via o protocolo
completo** dentro do próprio `roadmap-evolution/17` §62-63 (Claude 9,2/Codex 9,2, ver cabeçalho do
documento) — o trabalho desta wave é **aplicar** essa política já aprovada contra uma classificação
real e agora verificada (zero Organization/Membership, 3 identidades sintéticas, nenhuma evidência de
teste valiosa), não redecidir a política a partir de pesquisa de mercado. Separadamente, a forma da
ferramenta (script idempotente/dry-run/resumível) também não precisa de pesquisa externa —
`scripts/backfill-reminder-policies.ts` já estabeleceu a convenção própria deste projeto para esse tipo
de operação.

## Proposta concreta

### 1. Reset/reseed de `dev`, não migração one-shot

Per a taxonomia de §63 (`synthetic/disposable` | `valuable test evidence` | `required persistent dev
fixture`): os Achados #1/#2 classificam **100% do dado real de `dev` como `synthetic/disposable`** —
uma única identidade de smoke-test pré-cutover, dois tenants de drill de carga do W2, zero evidência de
teste com valor de negócio real. Construir uma ferramenta de migração para reescrever 47 itens
sintéticos (dos quais nenhum tem `Organization`/`Membership` para migrar de qualquer forma — não há
"tenant" B2B real para virar `organizationId`) seria desproporcional (`principles.md` #1) e contradiz a
própria recomendação de §63 ("mais limpo que desenvolver infraestrutura de migração para dados sem
valor").

### 2. Mecanismo de reset — script de aplicação, não `terraform destroy`/recriação de tabela

Proposta: `scripts/reset-dev-data.ts`, mesmo padrão de `backfill-reminder-policies.ts` — Scan paginado
de `exptrk-dev-table` + `BatchWriteItem` de delete, `--table` obrigatório, `--dry-run` default (reporta
o que seria apagado sem apagar), uma flag explícita (`--confirm`) exigida para escrita real, invocação
manual apenas, nunca wireado a deploy/CI. Preferido sobre `terraform destroy`+recriação da tabela
porque: (a) recriar a tabela via Terraform também derruba configuração não relacionada ao dado em si
(PITR, tags, etc.) e acopla um reset de DADO a uma operação de INFRA, escopo maior que o necessário;
(b) um script de aplicação é reaproveitável para rodar de novo no futuro sem depender de `terraform
apply`. `exptrk-dev-bff-session` (0 itens hoje) não precisa de ação — script documenta isso
explicitamente em vez de silenciosamente ignorar. S3: só `extraction-transient` tem conteúdo — um
`aws s3 rm --recursive` por bucket é suficiente (nenhum código/complexidade nova necessária), a decidir
com o Codex se isso deve entrar no mesmo script ou ficar como passo de runbook manual separado.

### 3. Fechar o remanescente de código: remover `LEGACY_TENANT_ONLY`

Per §62/§65 ("depois do cutover, nenhum código produtivo entende `tenantId=userId`") e o Achado #3
confirmando que o estado é hoje inalcançável contra o dado real de `dev`: propor remover
`LEGACY_TENANT_ONLY` de `OnboardingState`/`OnboardingStateResolver.resolve()` (linhas 16-17, 32, 50-53),
seu tratamento em `resolve-request-context.ts:101-104` e sua exposição em `bff-auth-service.ts:563-568`.
Não é um risco de regressão real: nenhum criador de `TenantLifecycleRecord` existe mais em nenhum
caminho de login (Achado #4) — o estado só é hoje alcançável por fixture sintética de teste, nunca por
um caminho de produção real. Esta é a sub-decisão que quero destacar explicitamente como aberta na
próxima seção — é menor que a decisão de reset/dado, mas é uma mudança de contrato real, então merece
concordância explícita do Codex sobre estar dentro do escopo desta wave.

### 4. Gate de execução — separado da aprovação de design

Este documento e as rodadas seguintes do protocolo Claude↔Codex **podem fechar o design/escopo por
completo sem esperar confirmação prévia do Marcelo** (`AGENTS.md` §1/§3). Mas **executar de verdade**
qualquer comando destrutivo contra a conta AWS real (`aws --profile claude-dev` com `--confirm`,
`aws s3 rm --recursive` real, qualquer `terraform apply`/`destroy`) **para** e pede confirmação explícita
do Marcelo antes de rodar — exceção registrada explicitamente no início desta sessão, mesmo padrão do
handoff anterior. Isso não bloqueia a implementação: o script pode ser escrito e testado inteiramente
contra um `OrganizationStore`/`DynamoDbStore` fake em memória (mesmo padrão de teste já usado em todo o
resto do projeto) e seu modo `--dry-run` PODE rodar contra a conta real sem parar (é só leitura), porque
não é destrutivo — só a flag `--confirm` real fica gated.

## Fora de escopo desta wave

- Limpar o padrão literal `tenantId=userId` em fixtures de teste (~10 arquivos de teste, cosmético,
  código de teste não produtivo) — não bloqueia nada, cleanup separado de baixo risco se algum dia
  valer a pena.
- Fixtures de permissão de drill do W2 (`scripts/grant-wave2-drill-permissions.mjs`,
  `w2-07-load-test.mjs`) — não fazem parte de Multi-User B2B; o reset as apaga como efeito colateral
  aceito (recriáveis rodando os próprios scripts de novo se algum dia forem necessários de novo outra
  vez — registrado aqui para não parecer um descuido).
- Construir uma ferramenta de migração genérica de dado tenant-scoped (§65) — não necessária, nada é
  preservado.

## Perguntas abertas para a Rodada 1 do Codex

1. Script de aplicação (Scan+delete) vs. `terraform taint`/destroy+recreate da tabela — concorda com a
   escolha de item 2 acima, ou há um motivo real para preferir a rota Terraform que não considerei?
2. Remover `LEGACY_TENANT_ONLY` (item 3) deveria entrar NESTA wave (fecha de vez o texto de §62/§65) ou
   ser destacado para uma wave/decisão separada, dado que é uma mudança de contrato observável
   cavalgando uma wave que é majoritariamente operação de dado, não decisão de arquitetura?
3. `exptrk-dev-bff-session` já está com 0 itens — concorda que nenhuma ação real é necessária além de o
   script/documentação afirmar isso explicitamente (em vez de rodar um Scan que sempre retornaria
   vazio)?
4. Algum outro consumidor real de `tenantId=userId`/`TenantLifecycleRecord` que esta leitura não tenha
   encontrado, que tornaria a remoção do item 3 insegura?

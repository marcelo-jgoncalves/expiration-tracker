# Expiration Tracker — Status e Próxima Sessão

## Decisão do Marcelo (2026-08-23): próxima sessão começa pelo BFF de sessão — leia isto primeiro

Depois de mapear os caminhos possíveis ao final da sessão anterior (M7, M12, M13, frontend/BFF,
débito técnico residual), Marcelo decidiu: **a próxima sessão começa pelo BFF de sessão**
(`/session/refresh`, `/session/logout` — Cognito já configurado para o padrão, endpoints nunca
implementados), não por M7/M12/M13. Isso resolve a parte "QUANDO" da pendência registrada em
2026-08-22 ("Frontend e BFF de sessão não têm milestone atribuído", ver seção abaixo para o
histórico completo) — ainda falta decidir formalmente em qual milestone numerado isso entra
(provavelmente uma trilha paralela, já que M9-M13 já estão ocupados pela evolução comercial e o
BFF nunca dependeu tecnicamente de nenhum deles), mas isso pode ficar para o início da própria
sessão de implementação, não é bloqueante para começar.

**Nenhuma implementação de código foi feita ainda** — esta é só a decisão de priorização,
registrada aqui para não perder o contexto de por que essa lacuna existia nem repetir a
investigação.

**Próxima ação real, primeira coisa da próxima sessão**: implementar o BFF de sessão. Antes de
escrever código: (1) reler a seção "Pendência registrada (2026-08-22)" abaixo para o contexto
completo (CSP/CloudFront Response Headers Policy foi adiada junto em M1 — decidir se entra agora
ou continua adiada até existir distribuição CloudFront real); (2) confirmar escopo exato das
rotas/contrato de `/session/refresh`/`/session/logout` contra a configuração Cognito já existente
(`infra/modules/cognito`); (3) avaliar se isso passa pelo protocolo Claude↔Codex (AGENTS.md §4) —
provavelmente sim, é a primeira superfície de sessão HTTP do projeto além do padrão JWT direto já
usado por toda rota autenticada existente, o que a torna uma decisão de segurança/arquitetura
nova, não implementação direta de algo já fechado.

## D-052 (M12 bloqueado) + alarmes de import worker deployados — sessão anterior (2026-08-23)

Continuação da mesma autorização de sessões anteriores (Marcelo indisponível, "trabalhe de forma
mais autônoma possível"). Confirmado primeiro: o CD pós-D-051 (PR #39/#40) completou com sucesso
— **M9+M10+M11 estão de fato deployados e funcionais em `dev`** (`docs/architecture/README.md`
atualizado, estava desatualizado apontando "não deployado"). Gasto real do mês confirmado via
Cost Explorer antes de qualquer trabalho novo: ~US$0,66 (23 dias), bem abaixo do teto de US$5/mês.

**M12 (Commercial Monetization/Billing) avaliado e registrado como BLOQUEADO — zero código
novo**, via protocolo Claude↔Codex (D-052, 2 rodadas, 9,3/9,4,
`docs/architecture/roadmap-evolution/15-m12-billing-scope-decision.md`). Achado real: a
mensagem de handoff anterior chamava a próxima etapa de "M12 (Organization/Membership/RBAC)",
mas isso está invertido no roadmap fechado — Organization/RBAC é **M13**, gated por gatilho
comercial real (primeira venda B2B, `evolution.md:13`) que não disparou; **M12 real é Billing**,
bloqueado por decisão de produto (fornecedor de pagamento, "fora deste roadmap" por decisão
explícita). Mesmo a fatia mínima cogitada (override manual de `TenantEntitlement` para um
early-adopter negociado direto) foi descartada depois de checar
`src/modules/identity/domain/authorization.ts` inteiro: o projeto não tem nenhum conceito de
"platform staff" cross-tenant hoje — criar essa ação exigiria um role novo para um caso ainda
inexistente, ou deixaria o próprio tenant `OWNER` aumentar seu limite sozinho (bypass de quota
self-service). Caminho aceito se o caso aparecer: `UpdateItem` manual pontual via
`buildVersionedUpdate` (`src/shared/dynamodb/occ.ts`), nunca um script/endpoint dedicado hoje.

**Débito técnico residual de M11 fechado nesta sessão**: novo módulo Terraform
`infra/modules/import-observability` (mesmo padrão de `document-observability`) — alarmes reais
`ImportParseWorkerErrors` (exceção do handler ou outcome `FAILED`) e `ImportCommitWorkerErrors`
(exceção, payload schema-inválido, ou `FAILED_INTEGRITY_MISMATCH`) wireados ao SNS `alert_topic`
já existente. `FAILED_ENTITLEMENT_EXCEEDED` deliberadamente não alarmado (desfecho de negócio
esperado). `terraform test` (módulo novo + suíte raiz `stack.tftest.hcl`, 13/13) e `terraform
plan` real contra `dev` verificados (8 a criar — exatamente os recursos do módulo novo — 0 a
destruir) antes do merge. PR #41 mergeado, CI verde, **CD real acompanhado até completar com
sucesso** — confirmado via `aws cloudwatch describe-alarms` que os 2 alarmes existem de fato em
`dev` (`INSUFFICIENT_DATA`, esperado - nenhum import rodou ainda).

**Próxima ação real**: nenhum milestone novo tem autorização explícita para começar agora — M7
(design aprovado) segue aguardando decisão explícita do Marcelo sobre quando começar (gate
distinto, não coberto pela autorização desta sessão); M12 e M13 seguem bloqueados por decisão de
produto/gatilho comercial (ver D-052 acima). Candidatos de trabalho não-especulativo ainda
abertos, se uma sessão futura quiser continuar sem nova decisão de produto: (1) Camada 3 de M6
— teste real de reconciliação de upload slot expirado (mecanismo implementado/testado
unitariamente, nunca exercitado contra AWS real); (2) observação menor não investigada a fundo
nesta sessão — `npm audit --omit=dev` no job `guardrails` segue com annotation "npm audit found
dev-dependency findings" apontando pacotes (`testcontainers`/`dockerode`/`tar-fs`/`undici`) que
não batem com os pacotes descritos em `docs/engineering/exceptions.md` EX-001 (vitest/vite/
esbuild) — pré-existente (confirmado que já aparecia antes desta sessão, run da PR #40), não
bloqueante (job é informacional), mas `exceptions.md` pode estar desatualizado e vale
reavaliar/re-registrar quando houver tempo.

## M9+M10+M11 DEPLOYADOS EM `main` + achado real de WAF corrigido (D-051) — leia isto primeiro

Marcelo autorizou explicitamente o merge `develop→main` (PR #38) depois de M11 completo — CI
verde, `terraform plan` limpo, tudo conforme padrão já estabelecido. O `cd.yml` disparou o
PRIMEIRO apply real de fato de todo esse acumulado (M9+M10+M11), e isso revelou um achado real
que nenhum `terraform plan`/`validate`/`mock_provider` local jamais pegaria: **AWS WAFv2 não
suporta associação com API Gateway HTTP API (v2)** — só REST API (v1), ALB, AppSync, Cognito,
App Runner, Verified Access, Amplify. O módulo `infra/modules/waf/` (M10, D-037) tentava
associar um Web ACL ao stage do HTTP API deste projeto — estruturalmente impossível, não um
erro de configuração. `AssociateWebACL` falhou com `WAFInvalidParameterException` no meio do
apply (a maioria dos recursos, incluindo as 3 Lambdas novas de M11, JÁ tinha aplicado com
sucesso antes desse ponto).

**Resolvido via protocolo Claude↔Codex (3 rodadas, Claude 9,2/Codex 9,3) como D-051**: módulo
`infra/modules/waf/` **deletado inteiramente** (não só desligado — reconstruir do zero quando
existir CloudFront é mais seguro que reaproveitar uma abstração já comprovadamente inválida).
Mitigação imediata: throttling nativo do HTTP API (`aws_apigatewayv2_stage.default_route_settings`
burst=50/rate=25 para o stage inteiro; `route_settings` burst=10/rate=5 só para as 2 rotas
`/guest/*`, as únicas sem JWT). CloudFront+WAF registrado como débito técnico bloqueante antes
de tráfego público real de produção (não antes de `dev`). Residual aceito e documentado: o
throttle nativo é por rota/stage, nunca por IP — um único IP hostil ainda consome sozinho toda a
cota de 5 req/s da rota guest; é exatamente por isso que CloudFront+WAF continua bloqueante
pré-produção. Um teste de regressão (`waf.tftest.hcl`... já deletado junto do módulo -
substituído por 2 asserts novos em `api_gateway.tftest.hcl` verificando os valores de throttle)
verificou que a string antiga (com em-dash/acento/parênteses) teria sido pega por uma checagem
de regex antes mesmo do achado maior aparecer — 2 bugs reais em sequência no mesmo recurso,
ambos só visíveis contra a API real.

**Estado real verificado antes do segundo push**: `terraform plan` real contra o state remoto
de `dev` (`AWS_PROFILE=claude-dev`, backend S3 real) — exatamente 1 destroy (o Web ACL órfão), 0
create novo (route_settings é adição in-place ao stage existente), resto são refreshes inócuos
de hash de Lambda. PR #39 (fix WAF description) e a correção de D-051 seguem o mesmo fluxo
develop→PR→CI verde→merge→CD já usado no resto da sessão.

**Próxima ação real**: confirmar que o CD deploy final (pós-D-051) completou com sucesso em
`main` (verificar `gh run list --branch main` para o run "Deploy (CD)" mais recente). Se verde,
M9+M10+M11 estão de fato deployados e funcionais em `dev`. Depois disso, mesma decisão de antes:
M12 (Organization/Membership/RBAC) ou pausa. Ver `roadmap-evolution/10-phase3-scoring-and-roadmap.md`.

## M11 (CSV Import de TrackedSubject) — COMPLETO EM `develop`, DEPLOYADO EM `main` (D-042/D-050)

M11 (cluster 7, último cluster do roadmap de D-043) implementado de ponta a ponta na mesma
sessão contínua que fechou M10, seguindo o design já aprovado em D-042
(`roadmap-evolution/09-domain-model-csv-import.md`, Claude 9,2/Codex 9,4). Registrado como
**D-050** em `decisions-log.md`.

**Módulo novo `src/modules/import`** (domain/ports/persistence/application/http completos,
v1 deliberadamente estreito: só CSV, só `TrackedSubject`, per o próprio D-042):
- `ImportService` (`reserveImport`/`getImportJob`/`requestCommit`) — presign+idempotência,
  mirror exato de `DocumentService.reserveUpload`; consome quotas novas `IMPORT_COUNT`/
  `IMPORT_BYTES` (identity's `TenantQuotaService`, reaproveitado diretamente — nunca duplicado,
  ao contrário de `GuestRateLimiter`/`InitialInviteRateLimiter`, que SÃO duplicados
  deliberadamente para não acoplar módulos, ver decisions-log D-049).
- `parseImportJob` (worker, disparado por evento S3 real) — parser CSV próprio (RFC4180
  mínimo), dedupe forte por `externalId` (contra DynamoDB + contra o próprio arquivo) e
  fallback fraco por `type`+nome normalizado (preload único de GSI7 — o teto do
  `TenantEntitlement`, hoje 25, garante que isso nunca é um scan caro), plano JSONL + SHA-256
  gravado em S3 (nunca linha-a-linha em DynamoDB, per `ADR-0001`).
- `commitImportJob` (worker, disparado por `SQS_IMPORT_COMMIT_V1`) — replay do plano validado
  via `SubjectService.createSubject()` **inalterado** (sibling-aggregate principle: nunca uma
  segunda implementação de criação de subject só para este worker); idempotência de retry
  (SQS at-least-once) via cursor `lastCommittedRowNumber` na própria `ImportJob` + claim de
  `ImportDedupRecord` por linha ANTES de criar o subject (chave real `externalId` quando existe,
  senão sintética `job:<jobId>:row:<rowNumber>`); fail-fast (não pula linhas) em
  `QuotaExceededError`.

**Bug real corrigido antes do commit da infra** (nenhum teste teria pego sem inspecionar o
wire format real): `ImportService.requestCommit()` gravava `data: { jobId }` no `OutboxRecord`,
mas `DispatchOutboxRelay`/`OutboxSweeper` só reenviam `OutboxRecord.payload` (== `event.data`)
para a fila SQS — nunca o `DomainEvent` completo, então `tenantId` nunca chegaria ao worker de
commit. Corrigido para o MESMO padrão já usado por `DispatchCommand` em
`reminder-producer/producer.ts`: o comando inteiro (`messageVersion`/`messageId`/`tenantId`/
`deduplicationKey`/`data`, exigido por `command-envelope.v1.json`) vira `event.data`. Schema
novo `import-commit.v1.json`; teste dedicado (`import-service.test.ts`) valida o outbox record
real contra esse schema, não apenas contra o shape do TypeScript.

**Infra nova**: um único bucket S3 (`import-bucket`, deliberadamente SEM quarentena/malware
scan — fora do escopo de v1 por decisão do próprio D-042: DynamoDB nunca interpreta fórmula de
planilha, a mitigação de CSV injection pertence à futura exportação); 2 filas SQS novas
(`import-parse`, `import-commit`); 3 Lambdas (`ImportsHandler` HTTP, `ImportParseWorker` via
regra EventBridge filtrada pelo sufixo literal `raw.csv` — o mesmo bucket também recebe a
escrita do PRÓPRIO plano JSONL do worker, que nunca deve re-disparar o parser — e
`ImportCommitWorker`, roteado pelo `dispatch_outbox_relay`/`outbox_sweeper` JÁ existentes, nunca
um relay novo, mesmo padrão do cluster 4/D-039). Rotas `/imports*` novas no API Gateway.
**Observabilidade por função para as 2 Lambdas novas foi deliberadamente deixada como residual**
(ver seção de pendências abaixo) — a DLQ-age alarm de cada fila (já embutida em
`sqs-worker-queue`) é a rede mínima herdada, sem estender `reminder-observability`/
`document-observability` (ambos já revisados/aprovados) para escopo fora do que foram
desenhados a cobrir.

**Estado final verificado**: `terraform fmt`/`validate` limpos; `terraform test` real
(`AWS_PROFILE=claude-dev`, plan-only, nunca apply) verde no módulo novo `import-bucket`, no
módulo `api-gateway` (rotas `/imports*`) e na suíte raiz `stack.tftest.hcl` (24 funções Lambda,
contagem atualizada de 21→24). **527 testes totais, zero regressão.**
typecheck/lint/check-boundaries/validate-schemas/build:lambdas/check-docs todos limpos.

**Pendência residual explícita (não bloqueante)**: alarme CloudWatch por função para
`ImportParseWorker`/`ImportCommitWorker` (paralelo ao que `document-observability` faz para
M6) não foi criado nesta sessão — decisão deliberada de não estender um módulo já
revisado/aprovado para escopo novo sem justificativa forte o bastante (a DLQ-age alarm
genérica já cobre "está falhando repetidamente"). Fica para quando a próxima rodada de
observabilidade holística for decidida (mesmo padrão já registrado para M4 em
`stack.tftest.hcl`'s próprio comentário).

**Autorização explícita do Marcelo para o restante deste trabalho** (ainda em vigor):
"no fim de todo esse trabalho, pode fazer o push e o merge" — `develop→main` está autorizado ao
final, sem precisar de nova confirmação (ainda assim, verificar CI verde e `terraform plan`
limpo antes).

**Próxima ação real**: M11 era o ÚLTIMO cluster (7) do roadmap de evolução estratégica (D-043).
Com M9/M10/M11 completos em `develop`, os candidatos naturais são: (a) M12 (Organization/
Membership/RBAC — D-038 já decidiu que billing por `TrackedSubject` vem ANTES desta ordem
original do prompt estratégico, então billing pode já estar coberto por `TenantEntitlement`;
confirmar o que realmente falta de M12 antes de implementar), ou (b) finalmente executar o
push+merge `develop→main` já autorizado, dado que M9/M10/M11 se acumularam sem deploy real. Ver
`roadmap-evolution/10-phase3-scoring-and-roadmap.md` para a sequência completa M9-M13.

## M10 (Guest Collection & Automated Chasing) — COMPLETO EM `develop`, NÃO DEPLOYADO

M10 inteiro (guest upload + automated chasing + convite inicial automatizado) está implementado
de ponta a ponta nesta sessão contínua, seguindo o roadmap de D-043. Sequência real de decisões:
mini-revisão de capacidade do GSI3 (D-046, fechada — pico orgânico combinado ~220× abaixo do SLO
de drenagem de pico extremo) → gap de design real (entrega/reenvio do link) fechado via protocolo
Claude↔Codex como **D-048** (`roadmap-evolution/13-guest-link-delivery-design.md`, 3 rodadas,
Claude 9,2/Codex 9,4): rotação de token a cada disparo de chasing, sem KMS, sem secret cifrado
persistido → Marcelo delegou ao mesmo protocolo a decisão de automatizar o convite inicial,
fechada como **D-049** (`roadmap-evolution/14-document-request-initial-invite-design.md`, outras 3
rodadas, Claude 9,2/Codex 9,4): APROVADO.

**Cluster 4 (automated chasing, D-039/D-046/D-048) implementado de ponta a ponta**: domínio
(`DocumentChasingOccurrence`/`DocumentChasingIntent`, agregados-irmãos de `ReminderOccurrence`/
`NotificationIntent`, nunca os generaliza), materializer (preset fechado T7/T3/EXPIRED ancorado em
`tokenExpiresAt`), producer branch (`src/workers/reminder-producer/producer.ts` — o arquivo mais
sensível do projeto, discrimina `entityType` pela FORMA da GSI3SK antes de qualquer I/O, caminho
reminder comprovadamente byte-idêntico ao anterior; revisão adversarial Codex dedicada nesse diff
achou e corrigiu um bug real: `unknownEntityType` nunca de fato alarmava, corrigido com
`shouldAlarm()` extraído/testado), worker de dispatch+delivery fundido, reconciliação de
claim-expiry alargada, e todo o wiring de infra real (fila SQS+DLQ, Lambda
`document-chasing-dispatch-handler`, relay/sweeper estendidos, alarme novo em
`reminder-observability`).

**D-049 (convite inicial automatizado) implementado**: `DocumentRequestDeliveryPreference`
(preferência de TENANT, default `MANUAL`, action `tenant:configure-document-request-delivery`
`ADMIN_ROLES`), override por chamada em `createDocumentRequest`, kill switch global
`document_request_initial_invite_email_enabled` (default `false`), `InitialInviteRateLimiter` (20/h
e 100/dia por tenant, 3/24h por destinatário — bloqueia CRIAÇÃO com 429 antes de qualquer escrita),
envio best-effort fora da transação (reaproveita `SesEmailAdapter`/templates já usados por
`EmailDeliveryWorker`/`DocumentChasingDispatch`), trilha de auditoria dos 5 desfechos, rotas HTTP
novas (`GET`/`PUT /subjects/document-request-delivery-preference`).

**Achados reais corrigidos no caminho** (nenhum deles no escopo original, descobertos ao
implementar): (1) `GuestTokenPointer`/`GuestTokenRateLimit` (cluster 2) nunca setavam
`purgeAfterTtl` — o atributo real de TTL físico da tabela, não `expiresAt` — corrigido antes da
rotação multiplicar o acúmulo; (2) as 4 rotas HTTP autenticadas de `DocumentRequest`
(create/list/get/revoke, com handler completo desde a sessão anterior) nunca tinham sido
registradas no API Gateway real — 404 garantido em produção apesar do código pronto — corrigido
junto das 2 rotas novas de D-049.

**Estado final verificado**: `terraform plan` real contra `dev` (60 a criar, 55 a atualizar, **0 a
destruir**) — nunca aplicado. **466 testes totais, zero regressão.**
typecheck/lint/check-boundaries/validate-schemas/build:lambdas/check-docs todos limpos.

**Autorização explícita do Marcelo para o restante deste trabalho**: "no fim de todo esse
trabalho, pode fazer o push e o merge" — `develop→main` está autorizado ao final, sem precisar de
nova confirmação (ainda assim, verificar CI verde e `terraform plan` limpo antes).

**Próxima ação real**: M11 (CSV import/export, cluster 7, D-042, design já aprovado 9,2/9,4) per o
roadmap de D-043 — próximo milestone com design fechado, pronto para implementar seguindo o mesmo
padrão desta sessão. Ao final de tudo, push + merge `develop→main` já autorizado.

## M10 (Guest Collection & Automated Chasing) — fatia de guest upload IMPLEMENTADA EM `develop`, NÃO DEPLOYADA (2026-08-23)

Continuação direta da mesma autorização usada para M9 ("prossiga... o mais longe possível...
registre e pule para a etapa seguinte", Marcelo indisponível). Implementada a fatia de **guest
upload/magic link** de M10 (design já fechado em D-037, `roadmap-evolution/04-domain-model-guest-upload.md`)
— **automated chasing (a outra metade de M10, cluster 4) não foi iniciado nesta sessão**, fica
como próxima ação real.

**Implementado** (commits `c7ecf77`, `12da47b`, `f5b87dc`, branch `develop`, D-045):
- `DocumentRequest`/`DocumentSubmission` (`src/modules/subject/domain/`) — coleções sob a mesma
  partição/assignment de `RequirementAssignment` (M9), sem GSI novo. `DocumentSubmission`
  reaproveita `DocumentStatus`/`UploadEvidence`/`MalwareEvidence`/`DocumentObjectReference` do
  módulo `document` (M6), não redefine.
- `GuestTokenPointer` (`GUESTTOKEN#<selectorHash>`/`POINTER`) — terceira exceção tenantless do
  modelo (depois de `IdentityMapping` e o scheduler GSI3): token opaco `selector.secret`, só o
  hash HMAC-SHA256+pepper é persistido, comparação via `timingSafeEqual`. `GuestSubmissionService`
  nunca passa por `RequestContext`/`authorize()` — é a primeira superfície não-autenticada do
  projeto, validada só pelo token.
- `src/workers/{submission-finalizer,submission-malware-result}` — espelhos estruturais dos
  workers de M6, roteados por um namespace de quarantine-key deliberadamente não-sobreposto ao de
  `item/` (`parseSubmissionQuarantineKey`), plugados nos handlers Lambda existentes
  (`upload-finalizer-handler`/`malware-result-handler`) via branch aditivo — só tenta o parser
  novo quando o de M6 retorna `undefined`. Pipeline de malware scanning de M6 (já verificado em
  produção real) permanece intocado.
- **Revisão adversarial dedicada (Codex) antes do commit**, justificada pela impossibilidade de
  testar contra AWS real nesta sessão (Camada 3) — achou 2 ALTO + 3 MÉDIO reais, todos corrigidos
  antes de commitar: (1) `GUEST_TOKEN_PEPPER` exigido no cold start mas nunca wireado na infra;
  (2) rota `/guest/*` e WAF pré-requisito não estavam provisionados; (3) oráculo de enumeração —
  rate limit só era consumido depois da checagem de existência do pointer, deixando
  `QuotaExceededError` (token real sem quota) distinguível de `GuestTokenInvalidError` (token
  inexistente) — corrigido consumindo o rate limit por `selectorHash` ANTES do lookup do pointer,
  convertendo qualquer falha no mesmo erro genérico; (4) ausência de caminho dummy contra timing
  attack — corrigido com um hash determinístico calculado mesmo quando o pointer não existe; (5)
  `deadline` do `DocumentRequest` decidido em design mas nunca aplicado — corrigido, TTL do token
  agora é `min(now+14d, deadline)`, revalidado em `resolveToken()`.
- 4 schemas/testes novos, 405 testes totais, zero regressão (confirmado depois das correções de
  segurança, incluindo o teste de rate-limit que precisou ser reescrito para verificar o novo
  comportamento anti-enumeração).
- Infra nova (`infra/`, código apenas — nenhum `terraform apply` executado): módulo `waf` (WAFv2
  Web ACL regional, `AWSManagedRulesCommonRuleSet`+`AWSManagedRulesKnownBadInputsRuleSet`+
  rate-based rule por IP escopada só a `/guest/*` via `scope_down_statement`, associado ao stage
  do API Gateway); módulo Lambda `guest_documents_handler` (rotas `authorization_type = NONE` —
  primeira rota pública do projeto); `random_password` para `GUEST_TOKEN_PEPPER`, wireado em
  `subjects_handler` e `guest_documents_handler`. Todos os `.tftest.hcl` atualizados (20 Lambdas,
  novas rotas/variáveis de `guest_documents`, novo módulo `waf/tests/waf.tftest.hcl`) e
  verificados: `terraform fmt`/`validate`/`test` (mock + real-provider plan-only,
  `AWS_PROFILE=claude-dev`) todos verdes.
- **`terraform plan` real contra `dev` executado e verificado (nunca aplicado)**: 38 a criar, 54
  a atualizar, **0 a destruir**.
- `docs/architecture/data-model.md` (§2/§3, novas entidades + nota da 3ª exceção tenantless) e
  `requirements.md` (§1.9, FR-075..078) atualizados. `decisions-log.md` ganhou D-045.

**Pendência real, não resolvida nesta sessão — decisão do Marcelo**: igual a M9, deploy real
(merge `develop→main`) não foi executado — ação visível/compartilhada que exige confirmação
explícita (`AGENTS.md` §3).

**Próxima ação real**: (1) Marcelo decide se/quando mergear `develop→main` para deploy real de
M9+M10 (guest upload); (2) implementar a outra metade de M10 — **automated chasing**
(`DocumentChasingOccurrence`/`DocumentChasingIntent`, reaproveitando GSI3 condicionalmente, design
já fechado em `roadmap-evolution/04-domain-model-guest-upload.md` cluster 4) — não iniciado nesta
sessão; (3) considerar uma rodada extra de revisão Codex confirmando que as 5 correções de
segurança realmente fecham os achados originais (não estritamente necessário, mas consistente com
a cultura de verificação do projeto).

## M9 (Commercial Domain Foundation) — IMPLEMENTADO EM `develop`, NÃO DEPLOYADO (2026-08-23)

Depois das Fases 1-3 da evolução estratégica (seção abaixo) ficarem prontas, Marcelo decidiu
diretamente prosseguir para implementação ("prossiga... o mais longe possível... se encontrar
algum impedimento que depende de minha aprovação, registre e pule para a etapa seguinte")
enquanto estava indisponível. M9 foi implementado de ponta a ponta seguindo exatamente o design
já fechado nos clusters 1/3/5 (D-036/D-038/D-040) — **nenhum código escrito antes dessa decisão
explícita, mesmo padrão de autorização já usado para M6/M7**.

**Implementado** (commits `154b7e1`..`bdd409b`, branch `develop`, D-044):
- `src/modules/subject/` — módulo novo: `TrackedSubject` (agregado raiz), `RequirementAssignment`
  (coleção sob a partição do subject, sem GSI novo — mesmo padrão de `identity`/`document` já em
  produção), `TenantEntitlement` (contador `activeTrackedSubjectsCount` incrementado/decrementado
  na MESMA transação que cria/arquiva um subject, mais forte que o padrão `release()` best-effort
  de `TenantQuotaService`). Ciclo real de `RequirementAssignment` em M9: `MISSING⇄SATISFIED` via
  link/unlink manual de `ExpirationItem` existente (validado via porta `ExpirationItemLookup`,
  nunca aceito só pelo `itemId` informado). `REQUESTED`/`SUBMITTED`/`UNDER_REVIEW`/`REJECTED`
  existem só no enum — sem transição implementada (isso é M10, guest upload/chasing).
- `ItemWatch` — extensão do módulo `expiration` (coleção sob a partição do item, mesmo padrão que
  `Document`/M6 já usa) — nunca muta `ExpirationItem`. `ExpirationStore` ganhou `queryByPk`
  (aditivo, zero risco ao agregado já em produção).
- Matriz de autorização (`identity/authorization.ts`): actions `subject:*`, `requirement:*`,
  `item:watch`.
- 5 schemas JSON novos + 10 testes de contrato + 22 testes unitários novos — **377 testes
  totais, zero regressão** (confirmado antes de cada commit).
- Infra (`infra/`, código apenas — nenhum `terraform apply` executado): GSI7 novo no
  `dynamo-table` (tenant-scoped, incluído na política geral — não isolado como GSI3/GSI6);
  módulo Lambda `subjects_handler`; 13 rotas `/subjects*` + 3 rotas `/items/{itemId}/watchers*`
  (reaproveitando o Lambda já existente de `items_handler`, sem infra nova) no `api-gateway`.
  Todos os `.tftest.hcl` atualizados (7 GSIs, 19 Lambdas, contagens de rota) e verificados:
  `terraform test` mock_provider (dynamo-table + api-gateway, 5/5) e real provider plan-only
  (`AWS_PROFILE=claude-dev`, dynamo_table_policy 2/2 + stack.tftest.hcl 13/13). `terraform fmt
  -check` limpo.
- **`terraform plan` real contra `dev` executado e verificado (nunca aplicado)**: 24 a criar, 54
  a atualizar (bump de versão esperado — mesmo padrão já documentado em M5/M6, toda função ganha
  nova versão porque o módulo `table` compartilhado mudou), **0 a destruir**. GSI7 é adição pura
  in-place na tabela existente, nunca replace.
- `docs/architecture/data-model.md` (§2/§3) e `requirements.md` (§1.8, FR-070..074) atualizados
  com as entidades/GSI7/requisitos reais — não ficam mais só no `roadmap-evolution/`.
  `decisions-log.md` ganhou D-044.

**Pendência real, não resolvida nesta sessão — decisão do Marcelo**: deploy real (merge
`develop→main`, que aciona `cd.yml` automaticamente) não foi executado. `terraform plan` está
limpo e verificado, mas abrir/mergear o PR é ação visível/compartilhada que exige confirmação
explícita (`AGENTS.md` §3) — diferente de "implementar", que já estava autorizado.

**Próxima ação real**: superada pela seção M10 acima — a fatia de guest upload de M10 já foi
implementada na sequência desta mesma sessão. Ver seção do topo para o estado vigente e a próxima
ação real atual (automated chasing + decisão de deploy).

## Evolução estratégica do roadmap — Fases 1-3 CONCLUÍDAS (2026-08-23), aguardando decisão do Marcelo sobre implementação

Marcelo trouxe um prompt de evolução estratégica (`Prompt — Evolução Estratégica e Arquitetural do
Roadmap do Expiration Tracker.md`, raiz do repo) propondo capacidades comerciais novas
(TrackedSubject, Requirement, ExternalContact, DocumentRequest, guest upload/magic link,
automated chasing, digest, custom fields, Organization/RBAC, billing, CSV import/export,
WhatsApp, e-mail ingestion, API/webhooks) para evoluir o produto de "cadastre uma data" para
"vendor/employee document compliance leve", sem virar ERP/GRC/CLM. Processo acordado em 3 fases:
(1) auditoria + gap analysis, (2) pesquisa de mercado + modelagem de domínio + protocolo
Claude↔Codex por tema (nível 5-6, `change-risk-scale.md` — não dispensável), (3) roadmap final +
ADRs. **Implementação de qualquer milestone novo só começa depois da Fase 3, com decisão explícita
do Marcelo** — mesmo padrão já usado para M7.

**Fase 1 concluída**: `docs/architecture/roadmap-evolution/01-gap-analysis.md` — estado real dos
milestones + classificação de cada capacidade proposta contra o código real (7 investigações
paralelas factuais, com citação arquivo:linha). Achados centrais: nenhuma das ~20 capacidades
propostas já existe implementada; `Organization`/`Membership`/RBAC é a única com readiness formal
real (`ADR-0002`, `evolution.md` já tem gatilho e plano de migração de 3 fases nunca disparado);
`WhatsApp` está parcialmente scaffolded (enum+router+kill switch reservados); nenhuma rota de API
Gateway é pública/sem-JWT hoje (bloqueio de infra real para guest upload/webhook); `Document`/M7
sempre exigem `ExpirationItem` pai já existente (sem caminho para "requisito ausente, sem item
ainda"); billing já tem lacuna formalmente registrada em `evolution.md` (não drift, lacuna
conhecida). Documento é insumo de análise, não normativo — supersedido pelos entregáveis de
domínio/roadmap da Fase 2-3 quando produzidos.

**Fase 2a (pesquisa de mercado) concluída**: `docs/architecture/roadmap-evolution/
02-market-research.md` — 6 concorrentes reais pesquisados (TrustLayer, Certificial,
SubCompliant, VendorJot, Remindax, categoria ampla). Achado central: billing por sujeito
rastreado (`TrackedSubject`) e guest upload/magic link sem conta são padrões de mercado
dominantes, não especulação — múltiplos concorrentes independentes convergem na mesma mecânica.

**Fase 2b (modelagem de domínio) concluída — 7/7 clusters fechados via protocolo Claude↔Codex
completo (MCP `codex mcp-server`, sandbox read-only, nota cega, 3 rodadas reais cada)**, todos
≥9,0 dos dois lados:

| # | Cluster | Nota | Documento |
|---|---|---|---|
| 1 | `TrackedSubject`+`RequirementAssignment` | 9,1/9,1 | `03-domain-model-tracked-subject-requirement.md` |
| 2 | Guest upload/magic link (`DocumentRequest`+`DocumentSubmission`) | 9,2/9,2 | `04-domain-model-guest-upload.md` |
| 3 | Organization/Membership/RBAC + Billing/Entitlements | 9,2/9,2 | `05-domain-model-organization-billing.md` |
| 4 | Automated document chasing (Reminder Engine) | 9,1/9,2 | `06-domain-model-automated-chasing.md` |
| 5 | Escalation/watchers/digest | 9,2/9,4 | `07-domain-model-escalation-watchers-digest.md` |
| 6 | Custom fields (rejeitado/adiado por padrão) | 9,1/9,0 | `08-domain-model-custom-fields.md` |
| 7 | CSV import/export | 9,2/9,4 | `09-domain-model-csv-import.md` |

Achados técnicos reais capturados pelo protocolo adversarial (não só concordância): GSI novo
evitado 2x reaproveitando padrões já existentes no código (`IdentityMapping` para guest token
lookup; coleção sob partição do item/subject para `ItemWatch`/`RequirementAssignment`/
`DocumentRequest`/`DocumentSubmission`); generalização de `NotificationIntent`/
`ReminderOccurrence` (já em produção) rejeitada em favor de agregados-irmãos, aplicando o mesmo
precedente que o próprio projeto já usou em M7 (parser-sandbox isolado); billing reordenado para
vir por `TrackedSubject` ANTES de Organization/Membership (inverte a ordem do prompt original,
com base em evidência de mercado); guest upload/chasing desacoplados de billing pago (free tier,
padrão de mercado real); formula/CSV injection mitigada na exportação, não na entrada (evita
falso positivo); plano de import linha-a-linha em S3, não DynamoDB por linha (custo); correção
pendente real identificada em `evolution.md:13` (plano de migração de 3 fases subestima que
`tenantId` está embutido em chaves físicas/GSIs, não só atributo) — registrada para correção
formal, não editada especulativamente.

**Fase 3 (síntese final) concluída**: `docs/architecture/roadmap-evolution/
10-phase3-scoring-and-roadmap.md` (executive summary, feature score ponderado, roadmap M9-M13
completo por milestone, dependency graph) e `11-phase3-impacts-and-closing.md` (domain model
antes/depois, impactos de arquitetura/segurança/persistência/custo, 10 ADRs candidatos,
estratégia de teste/migração, 8 perguntas abertas reais, 9 capacidades rejeitadas/adiadas).
**Roadmap proposto**: M9 Commercial Domain Foundation (`TrackedSubject`/`RequirementAssignment`/
Entitlement mínimo/watchers) → M10 Guest Collection & Automated Chasing (guest upload+chasing) →
M11 Bulk Operations (CSV import/export) → M12 Commercial Monetization (billing real) → M13
Commercial Accounts (Organization/RBAC, gatilho B2B, independente do resto). O pacote completo
passou por revisão adversarial final de coerência (nota 8,2/10, 8 achados reais corrigidos:
contagem de GSI errada, CSV export sem milestone, ADR faltante, contradição no dependency graph,
residuais fora de P/Q, nota de risco de Organization/RBAC contradizendo o próprio texto,
descrição errada de `notes?` como mudança de core).

**Nenhuma implementação de código foi feita ou autorizada.** Próxima ação real: Marcelo decide
quais milestones (M9-M13) priorizar e quando autorizar o início de implementação de cada um —
mesmo padrão de decisão explícita já usado para M7. Esta sessão trabalhou autonomamente durante
o período em que Marcelo estava indisponível (instrução explícita: "não pare o trabalho... adie
a etapa que exigir minha decisão e siga em frente") — por isso o roadmap está pronto até o ponto
de decisão de priorização, sem ter cruzado a linha de "começar a implementar sem autorização".

**Próxima ação real**: cluster 7 (último antes da Fase 3) — CSV import/export, eixo Qualidade de
Engenharia + Segurança. Depois disso, síntese da Fase 3 (roadmap final milestone-a-milestone,
lista de ADRs candidatos, DAG de dependências, impacto de segurança/privacidade/persistência/
custo, estratégia de teste/migração, perguntas abertas reais, lista de rejeitados — entregáveis
A-Q do prompt estratégico). **Implementação de qualquer milestone novo continua não autorizada
sem decisão explícita do Marcelo**, mesmo depois da Fase 3 pronta.

**Próxima ação real**: Fase 2 — pesquisa de mercado externa (Remindax, Doc Warden, SubCompliant,
VendorJot, TrustLayer, Certificial etc.), tentativa de refutar cada capacidade proposta, e rodadas
do protocolo Claude↔Codex agrupadas por tema (ex. TrackedSubject+Requirement via eixos
Arquitetura+Contexto; guest upload via Segurança+Privacidade; Organization/RBAC/Billing via
Produto-Multi-tenant+Jurídico+Privacidade — ver `docs/engineering/joint-review-criteria.md`).

Ambiente desta sessão (2026-08-23, continuação em máquina nova): branch `develop`, identidade Git
local alinhada à conta GitHub pessoal (`marcelo-jgoncalves`), `gh` CLI instalado e autenticado,
profile AWS `claude-dev` configurado, MCP `codex` instalado e aprovado (Codex CLI logado em
`tchelojg@gmail.com`, plano ChatGPT Plus).

## M7 (Extraction e confirmação) — DESIGN APROVADO (2026-08-22), IMPLEMENTAÇÃO AINDA NÃO INICIADA

Decisão explícita do Marcelo: "design completo primeiro, depois eu decido implementar" — dado o
escopo maior que M6 (Step Functions + Textract + Bedrock, 2 integrações de IA com custo real por
chamada). Protocolo Claude↔Codex completo, 7 rodadas (D-035, decisions-log.md): proposta
independente de cada lado → crítica cruzada (Codex deu 6,8/10 na proposta Claude round1, apontando
que Textract síncrono não se sustentava contra o limite de 50 páginas já aprovado, entre outros
problemas reais) → reconciliação com 5 correções pontuais reais, cada uma batendo numa nota real
antes de fechar (8,7→8,6→8,8→8,9→9,3) — a mais séria: uma corrida real de limpeza do artefato OCR
transitório que, se implementada como a rodada 5 propunha, causaria uma falha intermitente real em
produção (exatamente a classe de bug que só timing real revela, como os achados de Camada 3 de M6).
**Nota final: Claude 9,2 / Codex 9,3 — gate atingido.**

Design final: `docs/architecture/reviews/m7-extraction-design/claude-reconciliation-final-design.md`.
Decisões-chave: Step Functions Standard; Textract **assíncrono** com `waitForTaskToken` (a Fase 3
tinha deixado essa escolha para um "ADR dedicado" nunca escrito); parser de extração como função nova
isolada (nunca estende o `parser-sandbox` de M6, para não ampliar o blast radius de uma função já
verificada em produção real); AWS AppConfig real para os kill switches `AI_EXTRACTION`/`OCR` (módulo
Terraform `feature-flags`, transversal — não acoplado a Document, já que o schema também cobre
`WHATSAPP`); classe de retenção `EXTRACTION_TRANSIENT` (pré-requisito de **início** de implementação
em `privacy-lgpd.md` §4, não só de produção); toggle `extraction_pipeline_enabled` com **default
`false`** (diferente do padrão de M6 — feature nova com custo real e pré-condições externas ainda
não fechadas, ao contrário do GuardDuty que é requisito de segurança não-negociável); rotas HTTP
`POST .../extractions/{runId}/fields/{fieldName}/confirm` e `.../reject`; critério `NeedsBedrock`
fechado com threshold versionado por campo (nenhuma das duas propostas originais tinha isso
implementável); isolamento de prompt via API Converse com tool `submit_extraction` forçada.

**Pendências externas que bloqueiam só a ativação em produção** (não a implementação/teste em
`dev`): escolha e validação de modelo Bedrock + região; RIPD formal para uso de IA/OCR sobre
documento de titular (`privacy-lgpd.md` §6, gatilho já registrado).

**Próxima ação real**: implementar M7 seguindo o design aprovado — aguardando decisão do Marcelo
sobre quando começar (não autorizado a iniciar implementação sem essa decisão explícita).

## M6 (Document upload e malware boundary) — IMPLEMENTADO, DEPLOYADO e VERIFICADO EM PRODUÇÃO REAL (2026-08-22)

Design aprovado via protocolo Claude↔Codex (Claude 9.4/Codex 9.6,
`docs/architecture/reviews/m6-document-upload-design/`). Implementação completa: domínio,
aplicação, portas, persistência DynamoDB/S3, HTTP, 4 workers, 5 handlers Lambda, 3 módulos
Terraform novos (`document-buckets`, `document-malware-protection` com o toggle
`malware_protection_enabled` fail-closed em prod, `document-observability`). 345 testes
unitários. Deployado em `dev` via `cd.yml` (PRs #23-#32, todas mergeadas em `main`).

**Decisão de custo real (D-033)**: `document-buckets` usa a chave gerenciada `aws/s3` em vez de
CMKs dedicadas por bucket (decisão direta do Marcelo — corta ~US$2/mês de custo fixo). GuardDuty
Malware Protection for S3 não tem custo de estar ligado, só cobra por GB escaneado.

**6 bugs reais encontrados e corrigidos via o exercício de Camada 3** (upload real de PDF limpo +
arquivo EICAR real contra GuardDuty real, PRs #23-#32 — nenhum destes seria pego por
`terraform plan`/`terraform test`, só por um `terraform apply` real seguido de invocação real):
1. `documents-handler`/`upload-finalizer-handler`/`malware-result-handler` liam nomes de env var
   diferentes dos que `infra/main.tf` configurava (`QUARANTINE_BUCKET_NAME` vs `QUARANTINE_BUCKET`
   etc.) — os 3 handlers teriam falhado desde o cold start.
2. `UploadFinalizerWorker`/`MalwareResultWorker` perdiam permanentemente sua própria evidência na
   primeira colisão de OCC com o outro worker (`isTransactionCanceled` → `IGNORED_STALE` sem
   retry) — corrigido com o mesmo loop de retry limitado que `advanceAfterEvidence` já usa.
3. A promoção copiava de `doc.quarantineObject` (versionId sempre `""`, placeholder) em vez do
   objeto real em `uploadEvidence.object`/`malwareEvidence.object` — S3 rejeitava com "Version id
   cannot be the empty string".
4. `upload-finalizer-handler` só tinha permissão de LEITURA no bucket quarantine — mas
   `advanceAfterEvidence()` (a promoção) é executada por QUALQUER UM dos 2 workers (quem
   completar a evidência que faltava por último), não sempre `malware-result-handler`.
5. `CopySource` usava `encodeURIComponent()` na key inteira, escapando os separadores `/` para
   `%2F` — toda quarantine key real tem múltiplos segmentos, quebrando 100% das promoções reais.
6. A verificação pós-cópia (`headObject` no bucket clean) precisa de `s3:GetObject` (peculiaridade
   do S3: não existe action IAM "HeadObject") — nunca concedido no bucket clean (só `PutObject`).

**Evidência real de que funciona, ponta a ponta** (2026-08-22, ver PR #32 e commits seguintes):
upload real de PDF limpo → GuardDuty real → `NO_THREATS_FOUND` → `status: CLEAN` real, objeto
real no bucket clean, quarantine deletado. Upload real do arquivo EICAR padrão da indústria →
GuardDuty real → `THREATS_FOUND` → `status: REJECTED` real. Alarme `DocumentMalwareThreatsFound`
disparou de verdade (`StateValue: ALARM`). Limpeza completa verificada: buckets vazios, todos os
registros `Document`/`UploadSlot`/`IdempotencyRecord` de teste deletados, usuário/role IAM
temporários criados para diagnóstico de permissão deletados e confirmados (`NoSuchEntity`).

Pendências reais não resolvidas nesta sessão: teste de reconciliação real (timeout de upload slot
expirado, mecanismo implementado e testado unitariamente mas não exercitado em Camada 3);
extração de conteúdo do documento (M7, depende de M6, ainda não iniciado).

## Pendência registrada (2026-08-22): Frontend e BFF de sessão não têm milestone atribuído

Achado ao responder uma pergunta direta do Marcelo sobre em que fase o frontend entra: **não
entra em nenhum milestone nomeado nos M0-M8 atuais.** Isso é uma lacuna real, não uma decisão
fechada — decisão registrada é só sobre O QUE o frontend será (S3+CloudFront, D-012, Type 2),
nunca QUANDO construí-lo. Todos os M0-M8 são 100% backend (identity, expiration core, reminder,
notification, document upload/malware, extraction, hardening). Consequência prática: CSP/
CloudFront Response Headers Policy (adiada em M1, `implementation-blueprint.md` §4.2) e o BFF de
sessão (`/session/refresh`, `/session/logout` — Cognito já configurado para o padrão, endpoints
nunca implementados) seguem em aberto, re-flagueados a cada handoff de sessão desde M1 sem nunca
virar ação concreta (ver linha "Judgment calls" do M1 abaixo e item 2 da lista histórica de
"Próxima ação obrigatória").

**Decisão explícita do Marcelo (2026-08-22): registrar como pendência para etapa posterior, não
resolver agora.** Não bloqueia M7/M8 (ambos são backend). Quando o projeto entrar na fase de
construir uma interface de usuário real, esse é o ponto para: (1) decidir formalmente em qual
milestone (provavelmente um M9 novo, pós-M8, ou uma iniciativa paralela) o frontend entra; (2)
implementar CSP/CloudFront Response Headers Policy junto da distribuição CloudFront real; (3)
implementar as rotas HTTP do BFF de sessão. Até lá, todo teste/exercício real deste projeto
continua sendo feito via chamada direta a Lambda/API (padrão já usado em M0-M6), nunca via UI.

**Atualização (2026-08-23): parte "QUANDO" resolvida** — Marcelo decidiu que a próxima sessão
começa pelo BFF de sessão (item 3 acima), ver seção do topo deste arquivo para a decisão completa
e a próxima ação real. Itens 1 (numeração de milestone) e 2 (CSP/CloudFront) continuam em aberto,
a fechar no início dessa implementação.

## Renumeração de milestone registrada (2026-08-22) — leia antes de qualquer trabalho de M6/M7

Achado real de drift de contexto: "M5" já foi usado para Observabilidade (inserção ad hoc, não
fazia parte do `implementation-blueprint.md` original — `decisions-log.md` D-030). O blueprint
original define M5="Document upload e malware boundary", M6="Extraction e confirmação",
M7="Hardening operacional" — esses 3, ainda não implementados, agora são tratados como **M6**,
**M7**, **M8** neste projeto (nota registrada em `implementation-blueprint.md` §19, mesmo padrão
de inserção já usado para M3.5). `docs/architecture/diagrams/project-status.html` já atualizado.
**Próxima ação real de produto: M6 = Document upload e malware boundary** (upload presigned,
quarentena S3, GuardDuty, promoção CLEAN, exclusão segura) — não "Extraction/AI" como uma
referência vaga anterior sugeria; extração (M7) depende de M6 existir primeiro.

## Progresso real desta sessão (2026-08-21/22, resumo — ver seções datadas abaixo para detalhe)

Camada 3 real (IAM negativo + DLQ/redrive, decisão do usuário de reusar a conta `dev`) achou um
bug crítico colateral: `reminder-producer` parado ~1 dia inteiro (EventBridge Scheduler +
`jsonencode()` HTML-escapando o placeholder) — corrigido e verificado. Na sequência, 2 achados
abertos da rodada focada de auditoria foram fechados via protocolo Claude↔Codex completo,
implementados, deployados e verificados em produção real: mecanismo de rollback (alias+versão
Lambda, manifesto S3, `rollback.yml`, exercitado de ponta a ponta) e trilha de auditoria de
segurança (negação de autorização + acesso GSI3/GSI6, 3 alarmes reais). 255→274 testes.

## Trilha de auditoria de segurança — MVP implementado, commitado em `develop` (2026-08-22), aguardando deploy

Achado real aberto da rodada focada (Segurança-Logging/OWASP A09:2025 + SRE-Detecção) fechado via
protocolo Claude↔Codex completo (nota cega round1: Codex 9.4/10 com proposta muito mais completa
que a minha inicial; round2 reconciliação aceita com 2 ajustes — divisão MVP-desta-sessão vs.
entrega futura, módulo em `src/shared/observability/`). Design:
`docs/architecture/reviews/security-audit-trail-design/codex-reconciliation-round2-final-design.md`.

Implementado: `src/shared/observability/security-audit.ts` (3 funções de taxonomia fechada —
`auditAuthorizationDenied`/`auditGlobalIndexAccess`/`auditGlobalIndexAccessDenied` — nunca
`Record<string, unknown>` arbitrário); `AuthorizationDeniedError` agora expõe `action` como
propriedade real (bug real corrigido); os 4 handlers HTTP (`item-handlers.ts`,
`policy-handlers.ts`, `preferences-handlers.ts`, `test-route-handler.ts`) emitem 1 evento exato
por negação real, sem alterar a resposta HTTP; os 3 adapters GSI3/GSI6
(`dynamodb-reminder-producer-store.ts`, `dynamodb-reconciliation-candidate-source.ts`,
`dynamodb-outbox-relay-store.ts`) emitem 1 evento de sucesso por chamada lógica (mesmo paginada)
e 1 evento de negação real em `AccessDeniedException`, sem alterar retry/DLQ;
`outbox-sweeper-handler.ts` corrigido (não chamava `runWithContext`, achado real do Codex — sem
isso os eventos de GSI6 do sweeper não tinham `correlationId`); novo módulo Terraform
`infra/modules/security-audit-observability` com 3 alarmes reais (`SecurityAuthorizationDeniedBurst`,
`SecurityAuthorizationTenantBoundaryDenied`, `SecurityGlobalIndexAccessDenied`) ligados ao
`alert-topic` real de M5. Nova regra de `dependency-cruiser` (`shared-must-not-reach-modules`)
adicionada para não deixar essa arquitetura ser violada silenciosamente no futuro.

274 testes (era 264), incluindo cobertura real da trilha (formato/redação, 1-evento-por-chamada
mesmo paginada, `AccessDeniedException` sintético não altera retry, 1-evento-por-negação real via
`authorize()` de verdade em 2 dos 4 handlers). `terraform test` (módulo novo + raiz) verde;
`terraform plan` real contra `dev`: 14 a adicionar, 26 a mudar (todas as 13 funções recebem nova
versão/alias porque o módulo compartilhado novo entra no bundle de todas), 0 destroy.

**Fora do MVP desta sessão, explicitamente**: alarme de anomalia de volume de acesso a GSI3/GSI6
(a instrumentação `pageCount`/`resultCount` já existe para gerar dado, mas o alarme em si só pode
ser calibrado depois de observar baseline real em `dev` — não fechar isso especulativamente).

**Deployado e verificado em produção real (2026-08-22)**: PR #22 mergeado, `cd.yml` real.
**Achado real durante o deploy**: `terraform apply` falhou na primeira tentativa —
`aws_cloudwatch_log_metric_filter` para `items-handler`/`reminders-handler` exigia log group
já existente, mas essas 2 das 13 funções nunca tinham sido invocadas em `dev` (CloudWatch só cria
o log group no primeiro `Invoke` real). Corrigido criando os 2 log groups vazios via
`aws logs create-log-group` (fora do Terraform, não é `apply` manual — só supre um pré-requisito
de uma API que o Terraform não gerencia), deploy re-executado com sucesso
(`gh run rerun --failed`). Achado estrutural registrado (não corrigido agora): qualquer função
nova adicionada a este módulo que nunca tenha sido invocada reproduz o mesmo erro — candidato a
melhoria futura (`lambda-function` module gerenciar `aws_cloudwatch_log_group` explicitamente).

Verificação real pós-deploy: evento real `security.global_index_access` confirmado nos logs reais
de `reminder-producer` (gerado pelo schedule real, correlacionável por `correlationId`); os 3
alarmes reais exercitados `OK→ALARM→OK` via `aws cloudwatch set-alarm-state`, todos publicando de
verdade no tópico SNS real de M5. Evento de negação de autorização real **não** exercitado via
API real por decisão deliberada (exigiria fabricar identidade quebrada na tabela real de `dev`,
sem valor que justifique o risco) — aceito como evidência suficiente os 2 testes reais
(não-mockados) que já exercitam `authorize()` de verdade. Detalhe completo:
`docs/architecture/reviews/security-audit-trail-design/real-exercise-2026-08-22.md`.

## Mecanismo de rollback — entrega 1 implementada, commitada em `develop` (2026-08-21/22), NÃO deployada

Achado real da rodada focada (rollback/roll-forward inexistente) fechado via protocolo
Claude↔Codex completo (nota cega round1: Codex 8.6-8.7×2 propostas independentes convergiram no
mesmo mecanismo; round2 reconciliação com 3 ajustes meus aceitos — bucket S3 dedicado, gate de
aprovação humana no `workflow_dispatch`, canários semânticos fatiados como entrega 2 — nota final
9.1-9.2 dos dois lados). Design completo:
`docs/architecture/reviews/rollback-mechanism-design/codex-round2-final-design.md`.

Implementado: alias `live` real + versionamento em `infra/modules/lambda-function` (todo
invocador real — API Gateway, event source mappings, EventBridge Scheduler — aponta pro alias,
nunca `$LATEST`); módulo novo `infra/modules/deploy-manifest-bucket` (bucket S3 dedicado,
privado, versionado, nunca dado de tenant); `cd.yml` com `plan -out=tfplan`/`apply tfplan` (fecha
de brinde o achado de "artefato recalculado, não promovido"), verificação real de alias
pós-apply, manifesto de deploy + ponteiro `current-healthy` só avançado após sucesso completo;
`rollback.yml` novo (`workflow_dispatch` manual, `environment: dev` — precisa de required
reviewer configurado nas settings do GitHub, passo operacional ainda pendente de confirmação),
com compensação real de falha parcial.

`terraform test` (módulo + raiz) verde; `terraform plan` real contra `dev`: 23 a adicionar, 31 a
mudar (12 são replace de `aws_lambda_permission` só para adicionar `qualifier="live"`,
esperado), 0 destroy de dado/infra crítica.

**Decisão do usuário (2026-08-21/22): sem required reviewer no environment `dev`, deliberadamente.**
Perguntado sobre configurar isso (eu tentei via API, bloqueado pelo classificador de permissões
do Claude Code — mudança de configuração de repositório), a resposta foi: "não quero que você
não consiga trabalhar de maneira autônoma, então não acho que seja interessante me colocar como
reviewer no momento". Ou seja, o gate de aprovação humana que o design original do `rollback.yml`
previa como "critério operacional obrigatório da entrega" foi **deliberadamente não configurado**
— trade-off consciente entre segurança extra e permitir que o agente dispare `cd.yml`/
`rollback.yml` sem pausar esperando aprovação manual. Não reabrir essa pergunta em sessões
futuras sem um motivo novo e real (ex. um incidente causado por disparo não intencional).

**Mergeado e deployado com sucesso (2026-08-22)**: PR #20 mergeado (usuário: "pode fazer o merge
e prosseguir... você não precisa de minha autorização"), `cd.yml` real aplicou via pipeline.
Verificação real pós-deploy (não só o smoke test do próprio `cd.yml`, verificação independente
nesta sessão):
- As 13 aliases `live` reais confirmados via `aws lambda get-alias`, todos em `v1`.
- Manifesto real persistido em `s3://exptrk-dev-deploy-manifests/deployments/32547276849-1.json`
  + `pointers/current-healthy.json` (mesmo conteúdo, `previousHealthyDeploymentId: null` — é o
  primeiro deploy healthy desde que a entrega 1 existe).
- Zero erros reais nas 3 funções agendadas (`reminder-producer`/`reminder-reconciliation`/
  `outbox-sweeper-reminder-dispatch`) nos minutos seguintes ao deploy.
- Chamada HTTP real contra o endpoint real da API (`GET /test/ping` sem token) retornou
  **401** (não 500/502) — prova que a cadeia real API Gateway→autorizer JWT→integração→alias
  `live`→Lambda está intacta depois do rewiring simultâneo das 13 funções.

**Rollback exercitado de ponta a ponta com evidência real (2026-08-22)** — rodada 3 focada
(`docs/engineering/reviews/full-audit-round1-focused-round3-summary.md`) reavaliou os 2
critérios ainda abaixo do gate; Codex encontrou e eu corrigi 2 bugs reais em `rollback.yml`
(passo de compensação sem `id:` classificava toda falha parcial incorretamente; validação de
manifesto não checava conjunto exato de nomes de função nem formato de versão). Depois disso,
mudança trivial e reversível forçou um segundo deploy real (`test-ping-handler` v1→v2),
seguido de um rollback real disparado via `gh workflow run rollback.yml` — verificado
independentemente via AWS CLI: alias voltou pra v1, `current-healthy` restaurado ao manifesto
anterior, registro real `routing_restored`/`health_verified`/`completed`, API real continuou
respondendo corretamente (401) depois do rollback. Detalhe completo:
`docs/architecture/reviews/rollback-mechanism-design/rollback-exercise-2026-08-22.md`. **Os 2
critérios agora batem o gate ≥9.0** (9.3 e 9.1). Achado residual não bloqueante: caminho de
compensação de falha parcial nunca foi exercitado com uma falha real induzida (só por leitura
de código); ausência de validação diferenciada por blast radius de schema/GSI/KMS permanece
real, candidato a design futuro. Canários semânticos (entrega 2) continuam registrados como
escopo futuro explícito, não implementados.

## Passo 1 concluído (2026-08-21) — rodada focada Claude↔Codex, ver `full-audit-round1-focused-round2-summary.md`

2 dos 6 critérios fecharam (nota ≥9.0 dos dois lados): Debuggability & Operational Feedback (9.2),
e Correção do Serviço de Lembretes/preferências (9.3, depois de corrigir achado real do Codex —
`getOrCreatePreferences()` marcava proveniência falsa `consentSource: "ONBOARDING"` num bridge que
não é o onboarding real; corrigido para `"MIGRATED_DEFAULT"`, valor do enum que já existia para
esse caso exato). Achado documental corrigido (afetava 2 critérios): `incident-runbooks.md`
afirmava falsamente que não havia `alarm_actions`/SNS — atualizado para refletir M5 real.

**4 critérios permanecem abaixo do gate, achado real não-arredondado, classificado como trabalho
de design/feature (não ponto-fix desta rodada)**: rollback/roll-forward real ausente em `cd.yml`
(afeta Delivery/Recovery e SRE-Deploy/Rollback); trilha de auditoria de segurança dedicada ausente
para negação de autorização/acesso a GSI3/GSI6 (afeta Segurança-Logging e parcialmente
SRE-Detecção/Resposta, que também carece de um exercício humano completo de incidente, não só o
teste de transporte de alarme já realizado). Candidatos para uma sessão dedicada de design de
deploy/segurança — decidido nesta sessão (ver abaixo) que a próxima prioridade estrutural é a
Camada 3, não esses 4 itens diretamente.

## Passo 2 concluído (2026-08-21) — template de e-mail real e versionado

Decisão do usuário: motor = string interpolation simples versionada em código (sem motor
externo/dependência nova); localização = só pt-BR por agora. Implementado:
`src/modules/notification/providers/email-templates.ts` (registro `templateId`→`templateVersion`→
`locale`→renderer, fail-closed em combinação desconhecida, escapa HTML), `ses-email-adapter.ts`
passou a chamar `renderEmailTemplate()` real em vez do placeholder ad-hoc anterior. Teste novo
`test/unit/notification/email-templates.test.ts` (4 casos: render real, defaults, escape de
HTML/injection, fail-closed em combinação desconhecida). 259/259 testes, typecheck/lint/
check-boundaries/validate-schemas/check-docs limpos.

**Spike de validação das tags SES em sandbox real continua bloqueado** — usuário confirmou que
ainda não tem identidade SES verificada; permanece pendência externa genuína, não tentar sem
identidade real.

## Camada 3 — primeiros testes reais executados (2026-08-21), achado severo encontrado e corrigido

Decisão do usuário: reusar a conta `dev` real (sem conta nova), da forma mais segura possível, com
verificação explícita de limpeza depois de cada teste.

1. **Teste de IAM negativo real** (`aws iam simulate-principal-policy`, motor de avaliação real da
   AWS contra as políticas reais anexadas — zero recursos criados, nada para limpar): confirma
   exatamente o isolamento desenhado em M3.5 — as 10 roles não-privilegiadas negadas em GSI3 e
   GSI6; `reminder-producer` permitida só em GSI3; `reminder-reconciliation` e
   `outbox-sweeper-reminder-dispatch` permitidas só em GSI6, nenhuma com as duas. Controle
   positivo confirma que a role tem acesso real à tabela base (não é role sem permissão alguma).
   Evidência completa: `docs/architecture/reviews/camada3-iam-negative-test-2026-08-21.md`.
2. **Teste real de poison message → DLQ → redrive** contra `exptrk-dev-reminder-dispatch`: mensagem
   sintética real esgotou `maxReceiveCount=5` e caiu na DLQ real (~4.5min); redrive real via
   `aws sqs start-message-move-task` executado com o event source mapping temporariamente
   desabilitado (nunca deixando a mensagem ser reprocessada de verdade); limpeza verificada
   (fila/DLQ voltaram a 0, event source mapping reabilitado, estado idêntico ao baseline). Nenhum
   recurso ficou órfão. Evidência: `docs/architecture/reviews/camada3-dlq-redrive-test-2026-08-21.md`.
3. **Achado severo real, não relacionado aos testes acima, encontrado ao investigar telemetria
   real durante a Camada 3**: `exptrk-dev-reminder-producer` estava falhando em **100% das
   invocações desde 2026-08-20T14:41:39Z** (~1 dia inteiro) — motor de lembretes real de `dev`
   efetivamente parado. Causa: `jsonencode()` do Terraform HTML-escapa `<`/`>` do placeholder
   `<aws.scheduler.scheduled-time>`, o que quebra a substituição textual literal que o
   EventBridge Scheduler faz — o handler recebia o texto literal do placeholder em vez de um
   timestamp real, e essa função em particular valida `scheduledTime` como fatal. As outras 3
   schedules (`reminder-claim-reconciliation`/`reminder-dst-reconciliation`/
   `outbox-sweeper-reminder-dispatch`) tinham o mesmo bug de armazenamento, mas **sem impacto
   funcional real** — verificado que seus handlers não validam nem usam `scheduledTime` na
   lógica (reconciliação só loga o valor; sweeper nem lê o campo). Corrigido em
   `infra/modules/reminder-schedule/main.tf` (input via string HCL literal, não `jsonencode()`)
   para as 4, por consistência/prevenção, não só pela produtora.
   **Achado adicional**: os testes Terraform existentes comparavam contra o mesmo `jsonencode()`
   usado em produção, certificando o bug como correto — corrigidos para comparar contra o texto
   literal esperado, com um teste novo de regressão anti-escape na raiz.

**Deployado e verificado em produção real (2026-08-22)**: PR #19 (`develop→main`) mergeado,
`cd.yml` aplicou via pipeline com sucesso. Confirmado via `aws scheduler get-schedule` que o
`Input` armazenado não tem mais escaping, e via métricas CloudWatch (`Invocations`/`Errors` de
`exptrk-dev-reminder-producer`) que, após o backlog de retries assíncronos remanescentes drenar,
a função passou a invocar com sucesso de forma sustentada (`Invocations=1`/`Errors=0` por
minuto). Detalhe completo, impacto real por função e verificação pós-deploy:
`docs/architecture/reviews/camada3-eventbridge-scheduler-escaping-bug-2026-08-21.md`.

## Passo 3 concluído (2026-08-21) — decisão de próximo marco estrutural

Usuário delegou a decisão. Escolhido: **Camada 3 de teste (sandbox AWS efêmero)** antes de M6/M7 —
motivo: é pendência estrutural reaberta a cada milestone desde M3.5, nunca fechada, e destrava
diretamente achados classificados como "Camada 3 pendente" em 3 eixos do full-audit
(Arquitetura/Segurança/Operações) simultaneamente — maior alavancagem que abrir superfície de
produto nova (M6/M7) enquanto essa dívida estrutural continua se acumulando. Próxima sessão deve
COMEÇAR desenhando o escopo real da Camada 3 (ambiente efêmero dedicado, distinto de `dev`; IAM
negativo real, redrive de DLQ real, invocação real do EventBridge Scheduler) — provavelmente
precisa de decisão de arquitetura (ambiente novo, custo, ciclo de vida) antes de implementar,
avaliar se o protocolo Claude↔Codex (`AGENTS.md` §4) se aplica antes de desenhar.

## Plano priorizado (2026-08-21, histórico — Passo 1 concluído acima, Passos 2/3 continuam válidos)

Análise feita ao final desta sessão: dos 8 eixos do full-audit round1 que ficaram abaixo do
gate de 9,0 (ver seção "Status mais recente" no histórico abaixo), a implementação e o deploy
real de M4/M5 nesta sessão geraram **achado novo real** — não cosmético — para 6 critérios
específicos, espalhados em 3 eixos diferentes. Isso NÃO significa reabrir os 8 eixos inteiros
(`AGENTS.md` §"não reabrir rodadas... só se houver achado novo real" continua valendo para o
resto) — só esses 6 têm evidência nova genuína desde 2026-08-20:

| Eixo | Critério | Por que há achado novo |
|---|---|---|
| Qualidade de Engenharia | Delivery/Release/Recovery Discipline | `cd.yml` real usado, corrida CI/CD real corrigida, bug pós-deploy real caçado via `aws lambda invoke` e corrigido |
| Qualidade de Engenharia | Debuggability & Operational Feedback | M5 implementou exatamente o mecanismo que faltava (`AsyncLocalStorage`/`SecureLogger` contextual) |
| Segurança da Informação | Critério 7 (alarmes sem destino de notificação real) | M5 entregou SNS→e-mail real, testado de verdade (`OK→ALARM→OK`) |
| Operações/SRE e Continuidade | Critério 3 (detecção/resposta a incidente) | Mesmo alerta real de M5 |
| Operações/SRE e Continuidade | Critério 6 (deploy/rollback) | Mesma evidência de `cd.yml` real de Qualidade |
| Governança de Produto Multi-tenant | "Correção do Serviço de Lembretes" (nota 8,6 — "entrega/feedback de provider é M4+") | M4 entregou SES real + rota `/notifications/preferences` self-service |

### Passo 1 — Rodada focada Claude↔Codex (só esses 6 critérios, não os eixos inteiros)

Protocolo `AGENTS.md` §4, nota cega, mínimo 3 rodadas, ≥9,0 sem arredondar por critério (não
por eixo — os outros critérios de Qualidade/Segurança/Operações/Produto continuam como estavam,
não fazem parte desta rodada). Ler `docs/engineering/joint-review-criteria.md` para o texto
exato de cada critério antes de avaliar contra o estado real do repositório (não contra intenção
documentada). Registrar o resultado em
`docs/engineering/reviews/full-audit-round1-<eixo>-round2-*` (mesmo padrão de nomenclatura já
usado) e atualizar os `*-summary.md` correspondentes.

### Passo 2 — Fechar os residuais reais de M4 (não bloqueantes, mas pontuais)

1. **Spike de validação das tags SES em sandbox real** — depende de uma identidade SES
   verificada (passo manual, fora do Terraform) antes de rodar; perguntar ao usuário se já tem
   uma identidade de e-mail/domínio pra verificar, ou se isso continua bloqueado externamente.
2. **Template de e-mail real e versionado** (`templateId`+`templateVersion`, hoje placeholder em
   `ses-email-adapter.ts`) — decisão de produto sobre motor de template/localização antes de
   implementar; não é ponto-fix trivial, calibrar `docs/engineering/change-risk-scale.md` (é
   Nível 3-4, não deveria precisar do protocolo Claude↔Codex, mas confirmar).

### Passo 3 — Decidir o próximo marco estrutural (M6/M7 ou Camada 3)

Duas opções reais, mutuamente não-exclusivas, mas uma decisão de prioridade é necessária:
- **M6/M7** (`implementation-blueprint.md` §19: Document/AI, evidência operacional final) — é o
  próximo marco de produto per o blueprint original.
- **Camada 3** (sandbox AWS efêmero: teste negativo de IAM real, redrive de DLQ real, invocação
  real do EventBridge Scheduler) — pendência estrutural reaberta a cada milestone desde M3.5,
  nunca fechada. Destravaria diretamente vários achados de Arquitetura/Segurança/Operações
  classificados como "Camada 3 pendente" no full-audit.

Não presumir qual vem primeiro sem perguntar ao usuário — é decisão de priorização de produto,
não técnica.

### Pendências não relacionadas a este plano, mantidas como estavam (ver full-audit no histórico)

Privacidade/Jurídico (DSR/purge, DPA, parecer jurídico, região AWS), Governança de IA (processo,
não arquitetura), Produto Multi-tenant (control plane, catálogo de planos — exceto o critério do
Passo 1), e os critérios de Operações que exigem tráfego/incidente/backup real — nenhum desses
muda com código desta sessão, continuam exatamente como classificados no full-audit round1.

---

## Status atual (2026-08-21) — M5 implementado, deployado, verificado em produção real e operacionalmente fechado.

**M5 (Observabilidade)** está implementado, revisado pelo protocolo Claude↔Codex e **verificado
funcionando na conta AWS `dev` real** — não só "código no repo". Linha do tempo resumida (detalhe
completo no histórico abaixo, se precisar dos porquês):

1. Implementação de `correlationId`/`tenantId` contextual via `AsyncLocalStorage`, ADOT tracing,
   alerta SNS→e-mail — revisão Claude↔Codex 7,4→8,8→**9,1/10**.
2. Achado colateral (`reminder.dispatch.v1` nunca cumpria seu próprio schema de envelope) —
   corrigido no mesmo dia, revisão Claude↔Codex **9,2/10** de primeira (Nível 5 da escala de
   risco, `DispatchCommand` passou a emitir `messageVersion`/`messageId`/`createdAt`/
   `correlationId` reais).
3. Deploy real via `cd.yml` exigiu 3 correções de infra que nada tinham a ver com o código do
   milestone: role de CI/CD trocada para `GITHUB-OIDC-ROLE` (decisão do usuário — essa role tem
   policy `Action:*/Resource:*`, admin total da conta, mantida assim deliberadamente após o
   risco ser avisado), trust policy da role corrigido para o formato "imutável" do `sub` claim
   OIDC do GitHub (`repo:owner@orgId/repo@repoId:*`, não só o clássico), e `dev.tfvars` com
   `alert_email`/`adot_layer_arn` reais (verificados via CLI, não placeholders).
4. **Bug real e severo pós-deploy**, achado via `aws lambda invoke` real: a ADOT layer quebrava
   as 12 funções (`Cannot redefine property: handler` — esbuild exporta `handler` como getter
   não-configurável, o `shimmer`/instrumentation do OTel não consegue envolvê-lo). Corrigido em
   `scripts/build-lambdas.ts` (esbuild `footer` reatribui `module.exports` a um objeto plano
   novo) + teste de regressão real (`test/unit/build-lambdas-export-shape.test.ts`). Verificado
   corrigido via novo `aws lambda invoke` real após redeploy.
5. **Achado de infra separado, também corrigido**: `ci.yml` e `cd.yml` disparavam ambos em
   `push: branches: [main]`, competindo pelo mesmo lock nativo do state no S3 — quem perdia
   falhava com "Error acquiring the state lock" (parecia lock travado, era só corrida). Corrigido:
   `cd.yml` agora dispara via `workflow_run` (`workflows: ["CI"]`), só depois da CI real terminar
   com sucesso — verificado funcionando sequencialmente num merge real subsequente.
6. **Subscription SNS confirmada pelo usuário** (`tchelojg@gmail.com`, deixou de ser
   `PendingConfirmation`). **Teste real de alarme→e-mail executado**: `exptrk-dev-reminder-producer-errors`
   tinha um estado `ALARM` real e antigo (de 2026-08-20, antes do M5 ter destino de notificação) —
   limpo para `OK`, depois forçado `OK→ALARM→OK` via `aws cloudwatch set-alarm-state` (método
   prescrito pelo próprio design M5 §4 para esse teste), publicando de verdade no tópico
   `exptrk-dev-alerts` já confirmado.

**Nenhuma pendência técnica bloqueante conhecida para M5.** Todas as PRs (#8–#16) mergeadas em
`main`, todas revisadas/testadas conforme o protocolo aplicável, suíte de testes verde, deploy
real confirmado saudável.

### Pendências reais não-M5 ainda abertas (backlog do projeto, nenhuma bloqueante)

- **M4**: spike de validação das tags SES em sandbox real (nunca provado contra API real),
  template de e-mail real versionado (hoje placeholder em `ses-email-adapter.ts`).
  - ~~Rota HTTP `PUT /notifications/preferences`~~ **FECHADA nesta sessão**: novo
    `GET`/`PUT /notifications/preferences` (`src/modules/notification/http/preferences-handlers.ts`
    + `NotificationPreferencesService` + `notifications-handler.ts`/infra novos). Achado real
    descoberto ao implementar: `defaultNotificationPreferences()` nunca era chamado em lugar
    nenhum do `src/` — "hoje só via onboarding" no backlog era aspiracional, não código real.
    Bridge pragmático: o `GET` cria o registro padrão na hora se ele não existir (em vez de
    depender de um onboarding que não existe), e o `PUT` reusa a mesma lógica. Ação
    `notification:configure` já existia na matriz de autorização (`ADMIN_ROLES`/OWNER) — sem
    mismatch real porque o MVP é `tenantId=userId`/tenant single-owner (`authorization.ts:36`),
    então o usuário editando as próprias preferências já É o OWNER daquele tenant.

    **Bug real pós-deploy encontrado via smoke test real** (`aws lambda invoke` contra
    `exptrk-dev-notifications-handler` real): `GET` funcionou (200), `PUT` retornou 500
    "Unknown schema $id". Causa: `schema-validator.ts`'s `defaultSchemaRegistry` usa imports
    estáticos explícitos de cada schema (necessário pro bundle esbuild-cjs — `import.meta.url`
    não funciona nesse formato, então a varredura dinâmica de diretório resolveria zero
    schemas em cold start real). O novo schema foi criado no disco mas eu esqueci de
    adicioná-lo a essa lista estática — o próprio comentário do arquivo já avisava
    explicitamente sobre esse passo manual. **Nunca pego por nenhum teste** porque
    `test/contract/schemas.test.ts` valida contra `loadAllSchemasFromDisk()` (registro
    diferente, só usado por testes/`validate-schemas`, nunca por um handler real) — só o
    `defaultSchemaRegistry` real importa os schemas estaticamente. Corrigido (linha de import +
    entrada no array) + novo teste de regressão real
    (`test/unit/notification/preferences-handlers.test.ts`) que exercita o handler de verdade
    contra o `defaultSchemaRegistry` real — confirmei que esse teste falha sem o fix (revertido
    temporariamente, reproduziu o mesmo 500) antes de restaurar. 255/255 testes,
    typecheck/lint/check-boundaries/validate-schemas/check-docs limpos.

    **Segundo bug real, mais severo, encontrado no smoke test seguinte** (agora `PUT` real
    depois do fix do schema): 400 "DynamoDB rejected IdentityStore.updateConditional:
    ValidationException". Causa real (via `aws logs`/leitura do código, não só suposição):
    `DynamoDbIdentityStore.updateConditional` (`src/modules/identity/persistence/
    dynamodb-identity-store.ts`) usava o nome de atributo `count` **direto** (sem placeholder
    `ExpressionAttributeNames`) numa `ConditionExpression` — `count` é palavra reservada do
    DynamoDB. Isso quebra **toda rota HTTP autenticada** (`items-handler`, `reminders-handler`,
    `notifications-handler`, `test-ping-handler` — todas usam `TenantQuotaService.consume()`),
    mas só na **segunda** chamada da mesma tenant dentro da mesma janela de 60s (a primeira
    usa `putIfAbsent`, sem essa `ConditionExpression`; só a partir da segunda o
    `updateConditional` é exercitado). Bug pré-existente desde M1, nunca pego por nenhum teste
    porque `InMemoryIdentityStore` (fake) não interpreta `ConditionExpression` como o DynamoDB
    real — só um teste contra DynamoDB Local real pegaria isso. Corrigido (placeholder
    `#count`) + novo teste de integração real
    (`test/integration-dynamodb/quota.dynamodb.test.ts`, Camada 2, roda no job `dynamodb-integration`
    da CI — passou de verdade contra DynamoDB Local real, não pude rodar localmente por falta de
    Docker nesta máquina). **Verificado corrigido em produção real**: duas chamadas `PUT`
    consecutivas (mesma janela de 60s) contra `exptrk-dev-notifications-handler` real, ambas
    200 — a segunda é exatamente o caminho `updateConditional` que antes quebrava sempre.
    255/255 testes, typecheck/lint/check-boundaries/validate-schemas/check-docs limpos.

  **Rota fechada e totalmente verificada em produção real** (`GET`/`PUT` funcionando, ambos os
  bugs pós-deploy corrigidos e confirmados via `aws lambda invoke` real).
- **Camada 3 de teste** (sandbox AWS efêmero: IAM negativo real, redrive de DLQ real, invocação
  real do EventBridge Scheduler) — pendência estrutural desde M3.5, nunca fechada por falta de
  ambiente de teste efêmero dedicado (distinto do ambiente `dev` real já em uso).
- **Full-audit round1** (9 eixos, ver histórico abaixo): só o eixo Engenharia de Contexto bateu o
  gate de 9,0. Os outros 8 têm achados reais classificados como impedimento externo (parecer
  jurídico, DPA de fornecedor) ou escopo de produto maior (control plane multi-tenant, DSR/purge)
  — não reabrir rodadas só para tentar melhorar nota, só se houver achado novo real.
- **Trace real X-Ray/ADOT**: **CONFIRMADO nesta sessão** via `aws xray get-trace-summaries` —
  traces reais existem para `exptrk-dev-reminder-producer` (sem `HasFault`/`HasError`), provando
  que a instrumentação ADOT está gerando telemetria de verdade, não só configurada. Não visto
  ainda no console web (só via CLI) e não confirmado especificamente para o caminho
  SQS→Lambda→DynamoDB ponta-a-ponta (só para uma invocação single-function) — refinamento
  possível, não bloqueante.

---

Design `APPROVED` (seção histórica abaixo) foi implementado de ponta a ponta nesta sessão:
`src/shared/observability/context.ts` (`runWithContext`/`getContext` via `AsyncLocalStorage` +
`correlationIdFromSqsRecord`), `SecureLogger` integrado (contexto ambiente mesclado, explícito
sempre vence), `buildOutboxRecord` copiando `event.correlationId` para `OutboxRecord`
(`outboxRecordCorrelationId` com fallback `eventId`), wiring por-record nos 12 handlers Lambda
(fontes por tipo de evento conforme o design: `MessageAttributes.correlationId` nas filas SQS
que o próprio relay/sweeper alimenta — ver achado novo abaixo —, `SequenceNumber` nos handlers
Streams, novo UUID nos produtores EventBridge Scheduler, `requestContext.requestId` nos 3
handlers HTTP), propagação real via `MessageAttributes.correlationId` no `SendMessageCommand`.
`tenantId` aninhado via `runWithContext` composto em `reminder-dispatch-handler`,
`ses-callback-handler` e `notification-router-handler` — **não** nos 3 handlers HTTP
(`items-handler`/`reminders-handler`/`test-ping-handler`), decisão deliberada aceita pelo Codex
como follow-up não bloqueante (aninhar exigiria tocar 12 funções `handleXxx` em 3 módulos sem
duplicar a chamada `resolver.resolve()`, que bate no DynamoDB — não é ponto-fix trivial).

Infra Terraform: `infra/modules/lambda-function` ganhou `adot_layer_arn` (sem default) +
`layers`/`AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler`; novo módulo `infra/modules/alert-topic`
(SNS→e-mail); `alarm_actions` wired em todos os alarmes existentes
(`reminder-observability` + os 4 `sqs-worker-queue`). `terraform test` verde em todos os módulos
afetados + raiz (mock_provider/plan real contra `claude-dev`, nunca apply);
`terraform plan -var-file=env/dev.tfvars` real: **0 a destruir/substituir** (só `layers`/
`alarm_actions`, atributos mutáveis).

Revisão de implementação via protocolo Claude↔Codex (`AGENTS.md` §4, mesmo padrão de M3.5):
7,4 → 8,8 → **9,1/10 final**, 3 rondas reais. Achados reais corrigidos: causalidade
outbox→SQS→reminder-dispatch quebrada (handler ignorava o `MessageAttributes.correlationId`
que o relay já propagava — corrigido, extraído para `correlationIdFromSqsRecord()` testável);
4 handlers batch com `try/catch` fora do `runWithContext` (logs de falha perdiam o contexto —
corrigido, `try/catch` agora fica dentro); fallback de Streams usando a fonte errada
(`eventId` do sweeper em vez de `SequenceNumber` — corrigido); teste de partial batch failure
exigido pelo design §5 estava ausente (3 records, 2º falha — adicionado, exigiu extrair
`dispatch-outbox-relay-processor.ts`/`notification-email-outbox-relay-processor.ts` sem efeitos
colaterais de topo para ficarem unit-testáveis).

**[Correção de 2026-08-23: o parágrafo abaixo já está RESOLVIDO — preservado como histórico do
achado, não como pendência vigente. `producer.ts`'s `DispatchCommand` já emite
`messageVersion`/`messageId`/`createdAt`/`correlationId` reais desde o commit `dd90174`
(2026-08-21, revisão Claude↔Codex 9,2/10, `test/unit/reminder/producer.test.ts` prova que um
`DispatchCommand` real construído pelo producer satisfaz seu próprio schema) — ver linha 611-614
acima, que já registrava isso corretamente. Este bloco ficou contraditório internamente com aquele
por nunca ter sido atualizado após o fix — corrigido agora (achado de manutenção de contexto,
`AGENTS.md` §6), sem reabrir a decisão em si.]**

**Achado novo e real, descoberto durante a revisão, registrado como pendência separada — não é
escopo de M5, mas é bloqueante para prontidão operacional real do Reminder Dispatch**:
`schemas/queues/reminder-dispatch.v1.json` exige (via `allOf` de `command-envelope.v1.json`)
os campos de envelope `messageVersion`/`messageId`/`createdAt`/`correlationId` no corpo da
mensagem SQS — mas o `DispatchCommand` real construído em
`src/workers/reminder-producer/producer.ts` (e serializado como o body real via
`buildOutboxRecord`'s `payload: event.data` → relay's `JSON.stringify(payload)`) nunca teve
esses campos, só `commandType`/`tenantId`/`deduplicationKey`/`data`. Isso significa que
`reminder-dispatch-handler.ts`'s validação de schema contra o corpo real **falharia sempre**
em produção real (mensagem tratada como poison/schema-invalid) — bug pré-existente a M5, nunca
exercitado por nenhum teste (`test/integration/reminder-engine.test.ts` chama `dispatchOccurrence()`
diretamente, nunca passa pelo handler/JSON.parse/validate; `test/contract/schemas.test.ts` só
valida um exemplo de envelope escrito à mão, nunca o objeto real). **Divergência temporária e
consciente do design M5 registrada aqui**: para este contrato legado específico, a fonte real do
`correlationId` no `reminder-dispatch-handler` é `MessageAttributes.correlationId` (que o
relay/sweeper já propaga corretamente), não `record.body` como o design prescreve em geral para
SQS — isso não é evidência de que o envelope atual está correto, é uma exceção temporária até o
bug ser corrigido.

**Próxima ação real (histórica — RESOLVIDA em `dd90174`, 2026-08-21, ver correção acima)**: o
parágrafo original pedia decidir o formato de wire completo e adicionar um teste de contrato real
producer→schema. Ambos feitos: `DispatchCommand` ganhou os campos de envelope reais, revisado via
protocolo Claude↔Codex (9,2/10), e `test/unit/reminder/producer.test.ts` cobre exatamente o gap
citado (prova que um comando real construído pelo producer satisfaz `reminder-dispatch.v1.json`).

**Ainda não feito (pendências explícitas do design, registradas como critério de aceite, não
"resolvido" por este `terraform plan`)**: confirmação manual da subscription SNS→e-mail (passo
humano — `infra/env/dev.tfvars`'s `alert_email`/`adot_layer_arn` são placeholders/valores a
verificar antes de um `apply` real via pipeline: e-mail real do operador, e o ARN/versão real da
ADOT layer publicada pela AWS no momento do primeiro `cd.yml` que tocar isso); teste real de
alarme→e-mail; trace real X-Ray/ADOT verificado em ambiente real (mesma pendência estrutural de
Camada 3 de M3.5/M4).

---

## Status M5 (2026-08-20, histórico — superado pela seção acima): design APPROVED (Claude 9,1 / Codex 9,3, 4 rondas reais) — implementação ainda não começou

`docs/architecture/m5-observability-design.md` está **APPROVED** (protocolo `AGENTS.md` §4).
Escopo: correlationId/tenantId contextual via `AsyncLocalStorage` (granularidade por-record em
handlers batch, propagado ponta a ponta via `DomainEvent.correlationId` — já obrigatório, sem
mudança de schema — copiado explicitamente para `OutboxRecord`, nunca lido de contexto ambiente
no momento do envio); tracing distribuído via **ADOT Lambda layer exportando para X-Ray**
(não `aws-xray-sdk-core`, SDK legado em manutenção — achado real da revisão do Codex, corrigido
na ronda 1→2); alerta real de alarme via **SNS→e-mail** com confirmação manual da subscription
registrada como critério de aceite explícito (não fechado só pelo `terraform apply`). ADR
formal: `docs/architecture/adr/ADR-0010-observability-correlation-tracing-alerting.md`.
Histórico completo das 4 rondas (nota 6,8→8,6→8,9→9,3): `docs/architecture/reviews/
m5-observability-design/codex-round{1,2,3,4}.txt`.

**Limite explícito registrado no design, não pendência a "resolver"**: APIs são HTTP API
(D-011), sem segment X-Ray nativo do API Gateway — a borda HTTP de entrada é correlacionada por
log (`correlationId`), não por span de tracing; migrar para REST API só por isso foi
explicitamente rejeitado como desproporcional a este estágio.

**Nada foi implementado ainda** — design apenas, nenhum commit de código/infra desta sessão além
dos documentos de design/ADR/decisions-log. Próxima ação real: implementar seguindo o mesmo
padrão de M3→M3.5→M4 (lógica pura → adapters/infra → testes) — a ordem sugerida pelo próprio
design é: (1) `runWithContext`/`getContext` em `src/shared/observability/` + testes de
isolamento ALS; (2) `buildOutboxRecord` copiando `correlationId` + testes de causalidade
outbox→relay→SQS + partial batch failure; (3) wiring por-record nos 12 handlers Lambda; (4)
ADOT layer + `infra/modules/lambda-function` (`adot_layer_arn`, sem default, pinado por
região+arquitetura); (5) `infra/modules/alert-topic` (SNS→e-mail) + `alarm_actions` nos alarmes
existentes; (6) confirmação manual da subscription + teste real de alarme→e-mail (passo que
depende do usuário, mesmo padrão do spike SES pendente de M4).

## Status M4 (2026-08-20, histórico — superado pela seção acima quanto à próxima ação): design APPROVED + implementação completa (Camada 1 + adapters + workflows + handlers Lambda + infra Terraform) — só falta o spike de sandbox e a rota HTTP de preferências

`docs/architecture/m4-notification-engine-design.md` está **APPROVED** (protocolo `AGENTS.md` §4, nota cega Claude 9,3/10 · Codex 9,4/10, 4 rodadas reais). Nesta sessão, M4 foi implementado de ponta a ponta seguindo o mesmo padrão de M3→M3.5 (lógica pura → adapters → composition-root workflows → handlers Lambda finos → infra Terraform), tudo commitado e pushado em `develop`, CI verde (workflow 32413826928, `conclusion: success`).

**Código de aplicação** (`src/modules/notification/`):
- `domain/` — `NotificationPreferences`, `NotificationEntitlements`, `NotificationAttempt` (+ `NotificationAttemptLookup`, ponteiro tenant-scoped, + `leaseExpiresAt`), `NotificationIntent` estendido (`kind: REPLACEMENT | CORRECTIVE`, `recipientUserId`, `routedChannels`, `cancelledChannels`).
- `ports/` — `NotificationRecipientResolver`, `EmailProviderAdapter`, `NotificationStore` (com `queryAttemptsByIntent`).
- `application/` — lógica pura (`notification-router.ts`, `quiet-hours.ts`, `corrective-intent-service.ts`, `email-delivery.ts`, `ses-callback-processor.ts`) + os 3 workflows composition-root reais: `notification-router-workflow.ts` (`routeNotificationIntent`), `email-delivery-workflow.ts` (`processEmailDelivery`), `ses-callback-workflow.ts` (`processSesCallback`) — cada um carrega entidades com leitura consistente e produz UMA `TransactWriteItems`.
- `persistence/` — `DynamoDbNotificationStore`, `DynamoDbNotificationRecipientResolver` (validação tenant-scoped em duas camadas).
- `providers/ses-email-adapter.ts` — `SesEmailAdapter` real via `@aws-sdk/client-sesv2` (nova dependência instalada), classifica falhas em CONCLUSIVE_RETRYABLE/CONCLUSIVE_TERMINAL/AMBIGUOUS.

**2 bugs reais pegos pelos testes antes de qualquer deploy**: intent REPLACEMENT/CORRECTIVE usava a versão obsoleta do item/policy em vez da atual; schema `notification-email-deliver.v1` (existente desde M3) não carregava `attemptId`, necessário para o worker saber qual `NotificationAttempt` atualizar — ambos corrigidos.

**Handlers Lambda** (`src/runtime/aws/handlers/`): `notification-router-handler.ts`, `notification-email-outbox-relay-handler.ts`, `email-delivery-handler.ts`, `ses-callback-handler.ts` (inclui parser do envelope real SNS/SES) — todos finos, mesmo padrão de `dispatch-outbox-relay-handler.ts`. `outbox-sweeper-handler.ts` generalizado para cobrir os dois destinations (reminder + notification-email) na mesma role privilegiada. `scripts/build-lambdas.ts` atualizado e verificado (12 handlers empacotam com esbuild sem erro).

**Infra Terraform** (`infra/`): módulo `reminder-queue` renomeado para `sqs-worker-queue` (genérico, SIDs sem nome de reminder — achado real da crítica cruzada de M4) e reusado para as 3 novas filas (`router`, `email-deliver`, `ses-callback`); novo módulo `ses-notifications` (SES Configuration Set → SNS → policy restrita ao topic ARN exato, nunca wildcard); 4 novos módulos `lambda-function` com IAM mínimo (nenhum dos 4 tem acesso a GSI3/GSI6); event source mappings com `ReportBatchItemFailures`. Nova variável `ses_from_address` (sem default — falha rápido até a verificação real de identidade SES). `terraform test` do módulo novo (4/4) e da stack raiz (10/10, isolamento de GSI3/GSI6 e alarmes de DLQ estendidos para os 4 novos componentes) verificados com `AWS_PROFILE=claude-dev`; `terraform plan` real: 48 a adicionar, 11 a atualizar in-place, **0 a destruir/substituir**. CI (`ci.yml`, plan-only) verde.

223/223 testes de aplicação, typecheck/lint/check-boundaries/check-docs/validate-schemas limpos em cada commit.

**Ainda NÃO feito** (próxima ação real, nenhuma bloqueante para considerar M4 "codado"):
1. **Spike de validação das tags SES em sandbox real** — `ses-callback-workflow.ts` já assume que as tags (`et_attempt_id`/`et_intent_id`/`et_tenant_id`) sobrevivem nos eventos SES reais de `DELIVERY`/`BOUNCE`/`COMPLAINT`; isso nunca foi provado contra a API real. Requer uma identidade SES verificada (manual, fora do Terraform) antes de rodar.
2. **Rota HTTP de preferências** (`PUT /notifications/preferences`) — o runtime depende de `NotificationPreferences` existir (via onboarding), mas não há endpoint para o usuário editar depois. Não bloqueia o exit criterion se um usuário de teste for criado via fixture/migração.
3. Template real de e-mail (hoje é um placeholder em `ses-email-adapter.ts`/`composition/notification.ts`) — versionado, localizado, per `templateId`+`templateVersion`.
4. Camada 3 (sandbox AWS efêmero) — mesma pendência estrutural de M3.5, nunca fechada por falta de ambiente de teste efêmero disponível nesta sessão.

Depois disso, M4 está pronto para ser considerado "implementado" no sentido pleno do design aprovado.

**Reforço explícito do usuário (2026-08-20) sobre a infra desta fase de runtime**: toda implantação na AWS é via **Terraform modularizado** (novos módulos ou reuso disciplinado dos existentes em `infra/modules/`, seguindo boas práticas — nunca um bloco monolítico de recursos soltos) e **só via pipeline** (`ci.yml` plan-only em PR, `cd.yml` apply em push a `main`, OIDC) — nunca `terraform apply` local. Já era a política vigente (ADR-0009, `AGENTS.md` §7), mas o usuário pediu para reafirmar antes da fase de infra de M4 (filas, SNS, SES, EventBridge Scheduler) começar.

## Decisão do usuário (2026-08-20): Observabilidade world-class é o passo seguinte após M4 (implementação, não só design)

**O usuário decidiu que, assim que a implementação de M4 estiver concluída (não apenas o design, que já está aprovado), o próximo passo é um milestone/ADR dedicado de Observabilidade** (correlationId/tenant propagado automaticamente no logger, tracing distribuído ponta a ponta API→SQS→Lambda→DynamoDB, destino real de notificação para alarmes) — não abrir isso em paralelo a M4, só depois.

Motivação (levantada nesta sessão, ver `docs/engineering/joint-review-criteria.md`): o tema "logging/tracing world class" não tem eixo próprio no full-audit — está fatiado em 3 critérios diferentes, cada um com achado real abaixo do gate:
- **Qualidade/Debuggability** (7.7/7.5): `SecureLogger` não propaga `correlationId`/tenant automaticamente ao contexto — precisa de mecanismo de logger contextual (ex. `AsyncLocalStorage`), não ponto-fix.
- **Segurança/Logging Seguro & Incident Response** (~5.4, bem abaixo do gate): alarmes existem mas sem destino de notificação real (SNS/PagerDuty/Slack — decisão deliberadamente adiada, `infra/lib/reminder-observability.ts:11-15`); eventos de auth negada não geram trilha de segurança dedicada.
- **Tracing distribuído**: não existe nenhuma menção a X-Ray/OpenTelemetry no código nem nos critérios formais — maior lacuna real, nenhum span cobre o pipeline ponta a ponta.

Nenhum desses 3 é corrigível como ponto-fix isolado — um milestone dedicado resolveria os três de uma vez em vez de remendar cada eixo separadamente. Avaliar no início dessa sessão futura se precisa do protocolo Claude↔Codex (§4, provavelmente sim — decisão de arquitetura transversal) antes de desenhar.

## Status mais recente (2026-08-20 — leia isto primeiro, supera tudo abaixo)

**Os 9 eixos formais do full-audit round1 (`docs/engineering/joint-review-criteria.md`) estão TODOS concluídos.** Resultado real (nota cega Claude↔Codex, `AGENTS.md` §4, sem arredondar):

| Eixo | Nota final (mais baixa dos dois lados) | Gate ≥9.0? | Classificação do que falta |
|---|---:|---|---|
| Engenharia de Contexto | Claude 9,08 / Codex 9,09 | **Sim** (5 rodadas reais) | — fechado |
| Arquitetura | ver `full-audit-round1-arquitetura-summary.md` | Não | acompanhar summary — achado real de cold-start corrigido |
| Qualidade de Engenharia | ver `full-audit-round1-qualidade-summary.md` | Não | acompanhar summary |
| Segurança da Informação e AppSec | ver `full-audit-round1-seguranca-summary.md` | Não | acompanhar summary |
| Privacidade e Governança de Dados | ver `full-audit-round1-privacidade-summary.md` | Não | endpoints DSR/purge são escopo M4+ |
| Operações/SRE e Continuidade | ver `full-audit-round1-operacoes-summary.md` | Não | acompanhar summary |
| Governança de IA e Controles Internos | ver `full-audit-round1-governanca-ia-summary.md` | Não | acompanhar summary |
| Governança Jurídica, Contratual e de Terceiros | Codex 5,015/10 | Não | 2/8 critérios são impedimento externo genuíno (parecer jurídico, DPA de fornecedor não contratado); os demais são escopo de produto/processo maior. 2 fixes reais aplicados nesta sessão (LICENSE + `docs/engineering/third-party-inventory.md`). |
| Governança de Produto e Serviço Multi-tenant | Codex 4,65/10 | Não | 1 achado de concorrência real corrigido (`TenantQuotaService` tinha lost-update sob consumo concorrente — ver `full-audit-round1-produto-summary.md`); o resto é feature de produto ainda não construída (control plane de tenant, DSR/purge, ferramenta de suporte, métricas), consistente com o estágio pré-produção. |

Só o eixo Contexto bateu o gate formal de 9.0 dos dois lados. Os outros 8 ficaram honestamente abaixo, cada achado remanescente classificado como impedimento externo real ou escopo maior — **não é falha do protocolo, é o resultado esperado de auditar um projeto pré-produção sem usuários reais, sem parecer jurídico contratado e sem frontend**: a maior parte das lacunas exige trabalho que não é ponto-fix de uma sessão de engenharia (feature de produto, contrato real, decisão de negócio). Não reabrir rodadas adicionais desses 8 eixos só para tentar empurrar a nota — só reabrir se houver achado NOVO e real, ou se o projeto avançar de estágio (ex. primeiro usuário real destrava reavaliar Privacidade/Jurídico/Produto).

**Trabalho real aplicado nesta sessão além de nota/documentação** (não apenas avaliação):
- `LICENSE` + `package.json` (`license: UNLICENSED`) — antes inexistentes.
- `docs/engineering/third-party-inventory.md` — inventário versionado de fornecedores, novo.
- **Bug de concorrência real corrigido**: `TenantQuotaService.consume()` (`src/modules/identity/application/quota.ts`) fazia read-modify-write sobre um `PutCommand` incondicional, permitindo lost-update sob consumo concorrente da mesma quota. Corrigido com `IdentityStore.updateConditional()` (CAS via `ConditionExpression`) + loop de retry limitado (20 tentativas). Teste de regressão novo prova a propriedade (25 chamadas concorrentes, `limit=10` → exatamente 10 passam). Suite: 137/137 (era 136/136), typecheck/lint/check-boundaries limpos.

**Migração CDK→Terraform (ADR-0009) e primeiro deploy AWS real já concluídos numa sessão anterior a esta** (ver `docs/architecture/adr/ADR-0009-cdk-to-terraform-migration.md`, `infra/`, `.github/workflows/{ci,cd}.yml`) — CDK removido, 95 recursos reais provisionados na conta `975707451904`/`us-east-1` via pipeline (nunca `apply` local). As seções "Mudança de rumo em G8/deploy" e "Próxima ação obrigatória (histórico)" abaixo descrevem esse trabalho como pendente — **estão desatualizadas nesse ponto específico**, preservadas como histórico de como a decisão foi tomada, não como próximo passo.

### Possíveis próximas ações reais (nenhuma delas obrigatória — julgamento do usuário)

1. Retomar M4 (Notification Engine) — é o próximo marco estrutural de produto (`implementation-blueprint.md` §19), e resolveria diretamente vários achados abaixo do gate nos eixos Produto/Privacidade (endpoints DSR, control plane de tenant, ferramenta de suporte dependem de mais superfície HTTP/produto existir).
2. Fechar os 2 fixes documentais restantes do eixo Jurídico que ainda são corrigíveis sem parecer jurídico (ex. matriz de responsabilidades regulatória, calendário de revisão) — impacto pequeno na nota, mas genuinamente ponto-fix.
3. Se o usuário quiser badge/relatório consolidado do full-audit (nota por eixo, achados corrigidos, achados pendentes) num único documento novo — ainda não existe um `docs/engineering/reviews/full-audit-round1-CONSOLIDATED.md`, só os 9 summaries individuais.

---

## Próxima ação obrigatória (2026-08-19, superada pela seção acima quanto ao full-audit — preservada como histórico da decisão original)

**A próxima sessão deve COMEÇAR (antes de qualquer outra coisa, inclusive antes de retomar G8/Camada 3 abaixo) rodando o processo formal de nota do protocolo Claude↔Codex (`AGENTS.md` §4) contra os 9 eixos já formalizados em `docs/engineering/joint-review-criteria.md`** (Arquitetura, Qualidade de Engenharia, Engenharia de Contexto, Segurança/AppSec, Privacidade e Governança de Dados, Operações/SRE e Continuidade de Negócio, Governança de IA e Controles Internos, Governança Jurídica/Contratual/Terceiros, Governança de Produto e Serviço Multi-tenant — **não** o eixo FinOps, que segue deliberadamente sem critérios).

Para cada eixo: nota inicial cega de ambos (Claude e Codex, sem ver a nota um do outro) contra o estado REAL do repositório (não contra intenção documentada) → proposta de correção pontual para cada achado abaixo de 9.0 → réplica → tréplica → repetir até nota ≥9.0 de ambos em todo eixo, sem arredondar (8.99 não vira 9) — mesmo protocolo já usado em M3.5 (design 9.0/9.3, implementação 5.8→7.4→9.3 em 3 rodadas reais).

**Única exceção ao "chegar a 9.0"**: quando o achado que impede a nota tem um impedimento real e externo que não pode ser resolvido nesta sessão. Nesse caso, registrar explicitamente qual achado ficou abaixo de 9.0, por quê, e o que destravaria a correção — nunca arredondar/ignorar/fingir que fechou. Eixos sem esse tipo de impedimento (ex. Contexto, Qualidade de Engenharia, Governança de IA) não têm desculpa para não chegar a 9.0 — se a nota vier baixa, é achado real a corrigir, não celebrar como "descoberta interessante" e deixar aberto.

Registrar o resultado de cada eixo (nota final, achados corrigidos, achados com impedimento real) em `docs/engineering/reviews/full-audit-round1-<eixo>-*` (mesmo padrão de nomenclatura já usado para `security-axis-criteria-round1-*` etc.) e um resumo consolidado no topo deste arquivo ao final.

## Mudança de rumo em G8/deploy (2026-08-19, decidida ao final desta sessão — NÃO implementada ainda)

**Credenciais AWS reais já existem** — perfil AWS CLI `claude-dev` (conta `975707451904`, `us-east-1`), confirmado funcional (`aws sts get-caller-identity --profile claude-dev`). Isso desbloqueia G8/Camada 3 em tese, **mas o usuário decidiu explicitamente NÃO fazer deploy manual via `cdk deploy` a partir da CLI** — quando perguntado, a resposta foi: **"não usamos isso. Temos que criar uma pipeline e o deploy será feito por lá via terraform. vamos continuar na próxima sessão."**

Isso muda o próximo passo real de G8/M3.5 — **não** é mais "rodar `cdk bootstrap`/`cdk deploy` localmente" como as seções abaixo (histórico) ainda descrevem. É uma decisão nova, não totalmente especificada ainda, que precisa ser esclarecida no início da próxima sessão antes de qualquer implementação (nível 5-6 de `docs/engineering/change-risk-scale.md` — mudança de ferramenta de infra é decisão Type 1, protocolo Claude↔Codex provavelmente aplicável):

- O projeto usa **AWS CDK** (`infra/lib/*.ts`, `aws-cdk-lib`) desde M1 para toda a infraestrutura. A instrução de usar Terraform não especificou se isso **substitui** CDK, **coexiste** com ele (ex. Terraform só para a pipeline/bootstrap de conta, CDK continua definindo os recursos da aplicação), ou se o CDK deveria ser **reescrito** em Terraform/HCL — não presumir nenhuma dessas opções sem perguntar.
- "Pipeline" aqui não foi definida — GitHub Actions (já existe um esqueleto em `.github/workflows/deploy-dev.yml`, feito para CDK+OIDC, provavelmente precisa ser refeito para Terraform), outra ferramenta, ou algo já decidido em outro lugar que esta sessão não viu.
- **Antes de escrever qualquer HCL**: perguntar ao usuário o escopo exato (CDK vs Terraform vs coexistência), se há um repositório/padrão de pipeline de referência (ex. o projeto irmão `event-discovery-platform` já tem `infrastructure/terraform/` com módulos e OIDC — pode ser o padrão a seguir, mas não presumir sem confirmar), e revisar `docs/engineering/change-risk-scale.md`/`AGENTS.md` §4 para decidir se isso precisa de ADR formal antes de implementar.

---

## Histórico (2026-08-19, sessão de implementação M3.5 — superado pela seção acima, preservado como contexto de G8)

Milestone M3.5 (runtime real do Reminder Engine / fechamento de G8): design **APPROVED** (Claude 9.0/Codex 9.3, `docs/architecture/m3.5-runtime-design.md`) e implementação **revisada e aprovada pelo protocolo Claude↔Codex** (`AGENTS.md` §4, 3 rodadas: 5.8 → 7.4 → **9.3/10 final**, achados reais corrigidos a cada rodada — ver `docs/architecture/reviews/m3.5-runtime-design/codex-output-implementation-*.txt`). Tudo mergeado em `main` (PRs #2 e #3): wiring CDK completo (fila+DLQ+Streams+4 EventBridge Schedules, zero placeholder `501`), 8 handlers Lambda reais, 5 adapters DynamoDB reais, outbox relay+sweeper, ciclo de vida completo dos ponteiros GSI6 (`WORKSTATE#CLAIMED`/`WORKSTATE#DST_PENDING`).

**Camada 2 do plano de testes do design (DynamoDB Local via Testcontainers) executada e verde nesta sessão** — Docker Desktop foi instalado nesta mesma sessão. `test/integration-dynamodb/` (rodar com `npm run test:dynamodb`, requer Docker; job `dynamodb-integration` no CI, não bloqueante de `guardrails`) prova o exit criterion do M3 (materialize→claim→outbox→relay→dispatch→reconciliação) contra DynamoDB Local real, não fakes. 150 testes de Camada 1 + 2 de Camada 2, tudo verde.

**[Correção pós-sessão: credenciais AWS já existem — perfil `claude-dev` — e a rota de deploy mudou para pipeline+Terraform, ver seção "Mudança de rumo" acima. O parágrafo abaixo é histórico, preservado como contexto do que ainda falta tecnicamente, não como plano de ação vigente.]**

**Pendente real, única coisa que falta para declarar G8 tecnicamente fechado**: **Camada 3 (sandbox AWS efêmero)** — não executada. Sem ela faltam: teste negativo de IAM real (`AccessDenied` em GSI3/GSI6 para role tenant-facing), redrive de DLQ real, invocação real do EventBridge Scheduler (o `Input` usa `<aws.scheduler.scheduled-time>`, sintaxe confirmada correta pela documentação AWS na revisão do Codex, mas nunca invocada de verdade). Infra de deploy já preparada: `cdk.json` + `infra/bin/app.ts` (stack `ExpirationTrackerStack-Dev`, `us-east-1` — confirmado pelo usuário como escolha de ambiente dev descartável, **não** a decisão definitiva de região de produção, que segue pendente por LGPD), `aws-cdk` CLI instalado, `.github/workflows/deploy-dev.yml` (pipeline manual via OIDC, com os 4 passos de setup de conta documentados como pré-requisito — provider OIDC, IAM role, `cdk bootstrap`, variável `AWS_DEPLOY_ROLE_ARN` — nenhum feito ainda).

**Próxima ação real**: (1) confirmar/configurar credenciais AWS (`aws sts get-caller-identity`); (2) `cdk bootstrap aws://<conta>/us-east-1` uma vez; (3) `cdk deploy` real (local, via CLI — o pipeline GitHub Actions é para depois, quando OIDC estiver configurado); (4) Camada 3 de testes contra os recursos reais implantados; (5) só então atualizar `ENGINEERING.md`/`ARCHITECTURE STATUS` declarando G8 fechado — não antes.

---

## Próxima ação obrigatória (histórico — superada pela seção acima, preservada como contexto de G8)

Engineering Maturity Review concluída (checkpoints 0, 1, 2-9, 12; ver `ENGINEERING.md` na raiz para o relatório completo). Veredito: `ENGINEERING FOUNDATION STATUS: NOT APPROVED`, bloqueador único e conhecido: **G8 (recuperação real de falha assíncrona)**.

**Decisão do usuário (2026-08-19)**: tratar o fechamento pleno de G8 como **novo milestone dedicado** (mesma disciplina de M0-M3: pesquisa/design → implementação → teste real → revisão Claude+Codex), não como remediação de sessão. Escopo desse milestone, per `ENGINEERING.md` (seção "Decisão pendente: escopo de G8"):

- Adapters DynamoDB reais implementando os ports (`ReminderStore`, `ExpirationStore`, `IdentityStore`) contra AWS real — hoje só existem fakes em memória para teste.
- Handlers Lambda reais substituindo os placeholders `exports.handler = async () => ({statusCode: 501})` em `infra/lib/expiration-tracker-stack.ts`.
- Filas SQS + DLQ com redrive policy para o pipeline producer→dispatch.
- EventBridge Scheduled Rule disparando o `ReminderProducer` periodicamente (a cada minuto) e a `ReminderReconciliation` periodicamente.
- Testes de fault injection contra esse runtime real (timeout de dependência, poison message, redrive).

Antes de começar esse milestone: ler `docs/engineering/reviews/checkpoint-12-redteam/summary.md` (red team formal já identificou 5 P1 relacionados: pipeline sem recuperação, idempotência não provada no limite do efeito externo, false-green CI, concorrência/estado obsoleto entre renew/cancel/materialização/dispatch/reconciliation, blast radius cross-tenant do GSI3 via workers privilegiados) — usar como input de design, não redescobrir do zero.

Trabalho já feito nesta sessão de engenharia (não repetir): CI real corrigido e confirmado verde em 5 execuções; branch `develop` estabelecida como padrão de trabalho (`AGENTS.md` §3), `main` protegida; `dependency-cruiser` como enforcement real de boundary (achou e corrigiu 2 violações genuínas de arquitetura); testes de `reconciliation.ts`/`producer.ts` que não existiam; tentativa de fechar a vulnerabilidade de devDependency (EX-001) via upgrade do Vitest foi revertida por quebrar CI real (bug upstream do npm, não repetir sem verificar correção).

---

**Correção de 2026-08-19 (Engineering Maturity Review, Checkpoint 2-9)**: as seções abaixo (escritas ao longo das sessões de M0-M3) afirmam "nada foi commitado" e citam contagens de teste por marco que, somadas, não batem com a realidade medida agora. Estado real verificado por execução: M0-M3 **já está commitado** num único commit (`154d6e0`), e `npm test` roda **123 testes** no total (19 arquivos), não a soma das contagens individuais citadas abaixo. As seções não foram reescritas (preservadas como histórico de sessão), mas não devem ser lidas como estado de commit/contagem de teste vigente — confiar em `git log`/`npm test` reais, não nesses números. Ver `docs/engineering/03-repository-baseline.md` e `docs/engineering/reviews/checkpoint-02-09-consolidated/` para a análise completa desta divergência.

Projeto: micro-SaaS de controle de vencimentos/renovações. Pasta: `c:\Users\Usuario\Desktop\projects\expiration-tracker\`. Repo GitHub: `marcelo-jgoncalves/expiration-tracker` (privado).

Mapa completo de documentação, status vigente e regra de precedência: `docs/architecture/README.md`. Regras de processo e ferramentas: `AGENTS.md`. Log cronológico de sessões: `docs/architecture/session-log.md`.

## Status atual

```text
DESIGN MATURITY STATUS: APPROVED (arquitetura conceitual + Implementation Blueprint)
ARCHITECTURE STATUS: NOT APPROVED
```

Todo o processo de design (Fases 0-3 do prompt mestre + os 14 entregáveis das seções 35-52 + threat model seção 33 + Implementation Blueprint seção 60) está completo e aprovado — ver `ARCHITECTURE.md` na raiz para o documento consolidado. `ARCHITECTURE STATUS: NOT APPROVED` é o estado normativo correto até haver implementação real testada sob falha/carga (rubrica B, `requirements.md` §13.1) — **não é reprovação de mérito, e não muda com a conclusão do blueprint**: o blueprint é design detalhado, não evidência operacional.

## Concluído nesta sessão — Implementation Blueprint (seção 60) — APPROVED

`docs/architecture/implementation-blueprint.md`. Componentes/módulos (Identity, Expiration, Reminder, Notification, Document, Audit + workers assíncronos), interfaces concretas, eventos/schemas reais (grounded em `data-model.md`), ordem de deploy, milestones M0-M7, critérios de aceite técnicos por componente, e as 7 lacunas do `threat-model.md` incorporadas como requisito desde o início (não apêndice). Processo: 2 propostas independentes (Claude/Codex) → crítica cruzada (17 problemas reais encontrados, incluindo um erro técnico presente nas duas propostas — chave do GSI3 do scheduler não era consultável) → convergência → 5 rodadas de nota cega com correção pontual a cada achado (cabeçalho prematuro, contradição de kill switch, tabela incompleta, decisões Type 1 não propagadas às seções operativas, mapeamento de estado da Step Functions incompleto). **Nota final: Claude 9.20 / Codex 9.2 (exato)** — ambos ≥9.0 sem arredondar, 8 rodadas totais, nenhum gate violado. Decisão Type 1 nova registrada: chave global do GSI3 (`GSI3PK=DUE#yyyyMMddHHmm#NN`, exceção documentada à regra de toda chave começar por `TENANT#tenantId`) — a decisão está fechada no blueprint; falta só o registro mecânico em `data-model.md` (não bloqueia implementação).

## Concluído nesta sessão — M0 "Guardrails e contratos" (implementation-blueprint.md §19)

Todas as entregas de M0 implementadas e testadas (53 testes, `npm test`/`typecheck`/`lint`/`validate-schemas` verdes): estrutura TypeScript (`src/shared/*`, alinhada a `implementation-blueprint.md` §2), schemas JSON (`schemas/{events,queues,api}` + `sensitive-fields.json`, validados via Ajv em `src/shared/contracts/schema-validator.ts`), `SecureLogger`+`Redactor` central (`src/shared/observability/`, corpus de teste com valores canário provando que nada vaza), configuração tipada fail-fast (`src/shared/config/config.ts`), taxonomia de erro normalizada retryable/terminal (`src/shared/errors/app-error.ts`), idempotência via `PutItem attribute_not_exists(PK)` (`src/shared/idempotency/idempotency.ts`, chaves por operação conforme `data-model.md` §4), OCC com `ConditionExpression: version=:expected` (`src/shared/dynamodb/occ.ts`, `data-model.md` §5), outbox transacional (`src/shared/outbox/outbox.ts`, shape de `implementation-blueprint.md` §5.3), pipeline supply-chain (`.github/workflows/ci.yml`: npm ci imutável, actions pinadas por SHA, SBOM CycloneDX, audit, gate de schema). `AGENTS.md` §7 atualizado com comandos/convenções (número de seção corrigido em auditoria posterior; à época da escrita era §6, antes de `AGENTS.md` ganhar a seção de estratégia de branch como novo §3). Nada foi commitado (working tree aberto para revisão).

Judgment calls (blueprint estava silente): Ajv+ajv-formats para validação de JSON Schema; Vitest como test runner; ESLint `no-console` (com exceção para `src/shared/observability/**`) como o mecanismo que faz "chamada direta a `console.*` falhar no lint" (`implementation-blueprint.md` §14.1); idempotência/OCC/outbox construídos como builders puros de parâmetros DynamoDB (sem `@aws-sdk` ainda) para ficarem testáveis sem tabelas reais, que só existem a partir de M1; SLSA/assinatura de artefato adiada para M1+ (não há alvo de deploy ainda); SHAs de actions no CI pinados no momento da escrita — revisar antes do primeiro run real.

## Concluído nesta sessão — M1 "Foundation, Identity e isolamento" (implementation-blueprint.md §19)

Todas as entregas implementadas e testadas (89 testes, `npm test`/`typecheck`/`lint`/`validate-schemas` verdes): `src/modules/identity/{domain,application,ports,persistence,http}` (resolver central, matriz de autorização como código, `IdentityMapping`/`User`/`DeviceSession`/`TenantQuota` via portas SDK-agnósticas) e `infra/{lib,bin}` (`ExpirationTrackerTable`, `ExpirationTrackerAuth`, `ScopedLambdaFunction`, `ExpirationTrackerApi` com a rota `GET /test/ping`). Suíte cross-tenant negativa em `test/integration/cross-tenant.test.ts` (9 casos, exit criterion do marco) e synth de infra em `test/infra/stack.test.ts` (6 casos, via `aws-cdk-lib/assertions`, sem AWS CLI). Detalhe completo em `docs/architecture/session-log.md`.

Judgment calls (blueprint silente ou pendência externa já conhecida): (1) MFA implementado como prop configurável (`OFF`/`OPTIONAL`/`REQUIRED`, default `OPTIONAL`) pois UNK-006 segue pendente de pesquisa externa — não bloqueava M1; (2) CSP/CloudFront Response Headers Policy **não implementado nesta sessão** — não há distribuição CloudFront/frontend ainda no repositório, e o texto do blueprint (§4.2) coloca CSP no contexto do SPA estático servido por CloudFront; tratado como pertencente ao milestone que introduzir o frontend, não forçado em M1 (revisar se essa leitura estiver errada); (3) sessão/revogação modelada como campo `globalLogoutAfter` no item `User` + item filho `DeviceSession` (`TENANT#t#USER#u`/`SESSION#<deviceId>`) em vez de uma entidade `Session` de primeira classe — `data-model.md` não define uma; (4) `ScopedLambdaFunction` mantém a lista de entidades por capability como metadado/documentação, mas o IAM real concedido é table-level (`grantReadWriteData`) — DynamoDB IAM não expressa restrição por SK/entidade da forma que a sintaxe do blueprint sugere visualmente; per-entity IAM mais fino fica como follow-up; (5) `TenantQuota` implementado como janela fixa (fixed-window), não sliding-window/leaky-bucket — mais simples e ainda satisfaz "decremento atômico, sem race condition" do `data-model.md`; (6) BFF de sessão (`/session/refresh`, `/session/logout`) **não implementado como rota HTTP nesta sessão** — o Cognito client já está configurado para o padrão (client secret, tokens de vida curta), mas os endpoints do BFF em si ficam para quando a Expiration/Notification API skeleton crescer além da rota de teste; revisar se isso deveria ter sido parte do exit criterion. `cdk synth` real via CLI não foi executado (o pacote `aws-cdk` CLI não está instalado, só a lib `aws-cdk-lib`); a sintetização foi verificada programaticamente via `Template.fromStack` nos testes, que é equivalente para fins de validação estática.

## Concluído nesta sessão — M2 "Expiration core e Audit" (implementation-blueprint.md §19)

Todas as entregas implementadas e testadas (134 testes, `npm test`/`typecheck`/`lint`/`validate-schemas` verdes): `src/modules/expiration/{domain,application,ports,http}` — CRUD/renew (`ExpirationService`: createItem/getItem/updateItem/archiveItem/deleteItem/renewItem/listDashboard), OCC via `shared/dynamodb/occ.ts`, `ItemDueDateChanged` por outbox (`shared/outbox/outbox.ts`) na MESMA `TransactWriteItems` do item quando `dueDate` muda (updateItem e renewItem), `AuditEvent` append-only gravado em toda mutação na mesma transação, dashboard via GSI1. `renewItem` cria um item sucessor (`renewedFromId`) em vez de mutar `dueDate` no agregado de origem, que transiciona para `RENEWED`; é idempotente via `IdempotencyStore` de M0. Rotas HTTP CDK adicionadas em `infra/lib/api.ts`/`expiration-tracker-stack.ts` (`ItemsHandler`, mesmo authorizer JWT de M1). Suíte de integração `test/integration/expiration-lifecycle.test.ts` prova o exit criterion do marco end-to-end via handlers HTTP reais. Detalhe completo em `docs/architecture/session-log.md`.

Judgment calls (blueprint silente): (1) evento `ItemDueDateChanged` segue exatamente o schema já existente desde M0 (`schemas/events/item-due-date-changed.v1.json`: `itemId`/`previousDueDate`/`newDueDate`/`itemVersion`, `additionalProperties: false`) em vez do exemplo mais rico do texto do blueprint §8.3 (que inclui `timeZone`/`reminderPolicyId`/`changeReason`) — o schema já testado/versionado é a fonte de verdade de contrato per `AGENTS.md` §7, o exemplo em prosa não; campos adicionais ficam para quando M3 (Reminder) precisar deles, exigindo `.v2` aditivo; (2) `renewItem` também dispara `ItemDueDateChanged` (para o item novo, `previousDueDate: null`) — o blueprint só descreve esse evento no contexto de `updateItem`, mas renovação também é uma "mudança de vencimento" do ponto de vista do futuro `ReminderProducer` (M3), e a alternativa (renovação silenciosa) deixaria o dashboard/scheduler sem sinal de que um novo item precisa de agendamento; (3) `archiveItem` usa a ação de autorização `item:update` (não uma ação dedicada — a matriz de M1 não define uma para archive) enquanto `deleteItem` usa `item:delete` (ADMIN_ROLES), seguindo a granularidade que já existe; (4) idempotência de renovação aceita uma `idempotencyKey` explícita do chamador (header `Idempotency-Key`) com fallback determinístico `itemId|expectedVersion|cycle` quando ausente, já que o blueprint define a CHAVE de dedupe mas não de onde ela vem por HTTP; (5) `ExpirationStore.transactWrite` foi adicionado ao port (não existe em `IdentityStore`) porque nenhuma escrita de M1 precisava de `TransactWriteItems` multi-item — a fake em memória (`test/unit/expiration/in-memory-store.ts`) só entende as duas formas exatas de `ConditionExpression` que este código produz (mesma limitação documentada, mesmo espírito de `InMemoryIdentityStore`).

## Concluído nesta sessão — M3 "Reminder Engine" (implementation-blueprint.md §19)

Todas as entregas implementadas e testadas (123 testes, `npm test`/`typecheck`/`lint`/`validate-schemas` verdes): `src/modules/reminder/{domain,application,ports,http}` (policies CRUD, `ReminderMaterializer` com conversão local→UTC IANA-aware — DST tratado explicitamente, horário inexistente e ambíguo — reagindo a `ItemDueDateChanged` via `cancelStaleOccurrences`) e `src/workers/{reminder-producer,reminder-dispatch,reminder-reconciliation}` (lógica pura testável com relógio falso). GSI3 com shard versionado (`shardFnVersion`) e producer com janela de lookback `[M-5min, M]`; dispatch faz `CLAIMED→TRIGGERED`+`NotificationIntent`+outbox numa única transação; reconciliação é um único job (claim-expiry + DST). Exit criterion provado end-to-end em `test/integration/reminder-engine.test.ts`. **Bug real de infraestrutura corrigido**: `Table.grantReadWriteData`/`grantReadData` do CDK sempre incluíam `<tableArn>/index/*`, vazando `dynamodb:Query` no GSI3 para QUALQUER função da tabela (inclusive as tenant-facing de M1/M2) — a salvaguarda de isolamento documentada desde M1 nunca foi de fato aplicada. Corrigido em `infra/lib/dynamo-table.ts` com `PolicyStatement`s explícitos; teste de isolamento novo em `test/infra/stack.test.ts` prova via CDK synth que só `ReminderProducer` referencia `/index/GSI3`. Detalhe completo em `docs/architecture/session-log.md`.

Judgment calls (blueprint silente): (1) `occurrenceId` derivado deterministicamente (hash da chave de idempotência de data-model.md §4) em vez de UUID + registro `IdempotencyStore` separado — o próprio `putIfAbsent` condicional já garante a idempotência de materialização, mesmo padrão que data-model.md documenta para `WebhookInbox`; (2) cancelamento de ocorrência stale não remove `GSI3PK`/`GSI3SK` (o builder de `occ.ts` é SET-only, sem REMOVE) — deixa um ponteiro órfão no índice, mas o `Query` condicional `SCHEDULED→CLAIMED` do producer falha sobre ele de forma inofensiva; (3) tolerância de dispatch (`toleranceMs`, default 30min) e TTL de claim (default 2min) não estão fixados no blueprint — valores razoáveis documentados no código, revisar contra dados reais de produção; (4) reconciliação DST/claim-expiry recebe os candidatos como parâmetro (batch) em vez de fazer sua própria varredura via GSI6 — a wiring desse índice de "políticas ativas"/"claims expirados" real fica como follow-up de infra, o mecanismo de reconciliação em si (o que a tarefa pediu) está implementado e testado; (5) Lambda handlers reais (bundling com `@aws-sdk`) não foram escritos — mesmo estágio que M0-M2, CDK usa código inline placeholder via `ScopedLambdaFunction`; a lógica testável é o entregável real desta fase, igual às anteriores.

## Próxima ação obrigatória (histórico — superada pela seção do topo)

**Superada em 2026-08-19**: a Engineering Maturity Review identificou G8 (recuperação real de falha assíncrona) como bloqueador de engenharia — o milestone de runtime real (adapters/handlers/filas/EventBridge, ver seção do topo) é pré-requisito antes de M4 fazer sentido operacionalmente, ainda que M4 não dependa dele estruturalmente. Lista original preservada abaixo como histórico, não como próxima ação vigente.

1. **M4 — Notification Engine** (`implementation-blueprint.md` §19, depende de M3 ✅): router de `NotificationIntent`→canal, delivery workers (email/WhatsApp stub-first), `NotificationAttempt`, resolução de destinatário/template.
2. Decidir e fechar os itens abaixo (BFF de sessão como rotas reais, CSP/CloudFront quando o frontend existir) antes de considerar a lacuna de "session theft" do threat model totalmente fechada — ainda não resolvido, re-flagueado a cada sessão desde M1 para não se perder: M1 fechou o mecanismo de revogação/matriz de autorização, não o endpoint BFF completo; M2/M3 não tinham escopo de frontend/sessão (confirmado no blueprint) então também não o resolveram.
3. **Ratificar formalmente em `data-model.md` a exceção do GSI3** (chave global do scheduler, já decidida e justificada em `implementation-blueprint.md` §9.2/§23.3 item 10) — passo de manutenção documental, não nova rodada de debate. M3 já corrigiu o enforcement real do isolamento em IAM; falta só o registro mecânico no documento.
4. Wiring real do GSI6 (ou índice equivalente) para alimentar a reconciliação de M3 com o batch real de "políticas ativas"/"claims a verificar" em produção — hoje o mecanismo de reconciliação recebe esse batch como parâmetro injetado (testável), a query real fica pendente.
5. Testes de carga real (cenários de drenagem do pico extremo, `capacity-model.md`, com SLO de drenagem UNK-CAP-006 a formalizar em `slo.md` antes do gate de M7), teste de restore real (gate já definido em `disaster-recovery.md` §6), exercício do runbook de credencial comprometida.
6. Reavaliação sob rubrica (B) — Operational Evidence — só então `ARCHITECTURE STATUS` pode legitimamente virar `APPROVED`. **Não declarar isso antes de haver evidência operacional real.** Implementar M0/M1/M2/M3 não é evidência operacional.
7. Decisões ainda pendentes de pesquisa externa (não bloqueiam M4 estruturalmente, mas bloqueiam habilitar os canais/features específicos, ver `implementation-blueprint.md` §23.3): provider inicial de e-mail, BSP WhatsApp (pricing real, UNK-003), modelo Bedrock específico, região AWS (bloqueante para LGPD/transferência internacional), MFA obrigatório vs. opcional (UNK-006), ferramenta de backup S3 (RPO≤24h), ferramenta de assinatura/provenance do pipeline de CI.

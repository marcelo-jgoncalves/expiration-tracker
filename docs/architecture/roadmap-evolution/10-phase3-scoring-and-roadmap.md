---
status: draft
owner: Marcelo
authority: informativo (síntese da Fase 3 — roadmap proposto, ADRs formais e milestones reais só nascem com decisão explícita do Marcelo, ver nota de escopo no final)
---

# Fase 3 — Executive Summary, Feature Score e Roadmap Revisado

Síntese final da evolução estratégica do roadmap, consolidando os 7 clusters de domínio da Fase
2b (`03` a `09`) e a pesquisa de mercado da Fase 2a (`02`) num roadmap executável. Este documento
cobre os entregáveis A (executive summary), D (feature score), G (roadmap revisado) e H
(dependency graph) do prompt estratégico. Os demais entregáveis (E, F, I-Q) estão em
`11-phase3-impacts-and-closing.md`.

## A. Executive Summary

O prompt estratégico propôs evoluir o Expiration Tracker de "cadastre uma data e receba um
lembrete" para "vendor/employee document compliance leve", sem virar ERP/GRC/CLM. Depois de
auditar o código real (Fase 1), pesquisar 6 concorrentes reais (Fase 2a) e fechar 7 decisões de
domínio via protocolo Claude↔Codex completo (Fase 2b, todas ≥9,0 dos dois lados), a conclusão é:
**a tese comercial do prompt é validada por evidência de mercado real, não especulação** — os
concorrentes mais diretos (TrustLayer, Certificial) já cobram literalmente por "vendor rastreado"
e já implementam guest upload sem conta como hook de aquisição gratuito.

Mudanças relevantes que a evidência real produziu em relação ao prompt original:
- **Billing por `TrackedSubject` deve vir ANTES de Organization/Membership**, não depois (o
  prompt original sequenciava "M12 Commercial Accounts" como último bloco) — porque billing por
  sujeito rastreado não depende de multiusuário existir, e é o modelo dominante de mercado.
- **Guest upload deve ficar no tier gratuito**, não atrás de billing pago — 3 concorrentes
  independentes (TrustLayer, Certificial, bcs) usam isso como hook de aquisição gratuito.
- **Custom fields genérico fica rejeitado por padrão** — risco de complexidade já documentado por
  um concorrente líder (myCOI), valor já servido por alternativas mais baratas (`tags`, `notes`,
  texto livre).
- **Digest fica como questão aberta**, não decidida — nenhum concorrente pesquisado o menciona,
  nem a favor nem contra.
- Em 3 dos 7 clusters, a mecânica do Reminder Engine/pipeline de M6 já existente foi reaproveitada
  sem criar motor paralelo, mas em pontos-chave (GSI de lookup, agregados de notificação já em
  produção) a decisão final foi **não generalizar componentes já verificados em produção**, e sim
  criar extensões/agregados-irmãos — mesmo princípio que o próprio projeto já aplicou em M7.

Nenhuma implementação de código começou. Este documento é o roadmap proposto para decisão do
Marcelo — não autorização de trabalho.

## D. Feature Score

Escala 0-10 por critério; **complexidade e risco: 10 = favorável/baixo** (convenção do prompt
estratégico). Nota ponderada dá peso maior a valor, retenção, ticket, aquisição e reutilização
horizontal. Notas são julgamento de engenharia calibrado pela evidência das Fases 1-2, não medição
precisa — tratar como ordenação relativa, não valor absoluto.

| Capacidade | Valor | Retenção | Ticket | Aquisição | Diferenciação | Reuso horizontal | Complexidade (10=baixo) | Risco (10=baixo) | Suporte | Fit arquitetural | Nota ponderada |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `TrackedSubject` | 9 | 8 | 9 | 7 | 6 | 9 | 6 | 7 | 8 | 9 | **8,1** |
| `RequirementAssignment` (estado MISSING) | 9 | 8 | 6 | 8 | 8 | 8 | 6 | 7 | 7 | 8 | **7,8** |
| Guest upload/magic link | 9 | 8 | 6 | 9 | 7 | 8 | 5 | 6 | 6 | 8 | **7,5** |
| Automated document chasing | 8 | 9 | 6 | 6 | 7 | 8 | 6 | 7 | 7 | 8 | **7,4** |
| Entitlement/`UsageQuota` mínimo (por `TrackedSubject`) | 7 | 5 | 9 | 4 | 5 | 7 | 7 | 8 | 8 | 9 | **6,9** |
| Escalation (`ASSIGNEE`/`WATCHERS`, lista fechada) | 6 | 6 | 3 | 3 | 4 | 7 | 8 | 9 | 8 | 9 | **6,0** |
| CSV import | 8 | 5 | 4 | 6 | 4 | 6 | 5 | 6 | 6 | 7 | **5,9** |
| Billing/provider externo | 6 | 4 | 9 | 5 | 3 | 6 | 5 | 6 | 6 | 8 | **5,8** |
| Organization/Membership/RBAC | 5 | 5 | 7 | 3 | 3 | 5 | 3 | 3 | 6 | 9 | **4,4** |
| WhatsApp (canal, já parcialmente scaffolded) | 5 | 5 | 4 | 4 | 4 | 6 | 7 | 8 | 6 | 9 | **5,5** |
| CSV export | 5 | 4 | 2 | 2 | 3 | 6 | 8 | 9 | 7 | 8 | **4,8** |
| Digest (questão aberta) | 4 | 5 | 2 | 2 | 2 | 5 | 5 | 7 | 6 | 6 | **4,1** |
| Custom fields genérico (rejeitado) | 3 | 3 | 3 | 2 | 3 | 6 | 2 | 4 | 3 | 5 | **3,1** |

> Nota Organization/Membership/RBAC: complexidade e risco corrigidos para 3 (não 6) na revisão de
> coerência final — a nota original contradizia o próprio texto do roadmap, que chama essa
> migração de "a mais real e arriscada" e "maior risco estrutural" (seção L e milestone M13
> abaixo). Achado real da revisão adversarial final deste pacote, não erro silenciosamente
> corrigido.

## G. Roadmap revisado (milestone-a-milestone)

Nomenclatura: M0-M5 concluídos, M6=Document upload (concluído), M7=Extraction (design aprovado),
M8=Hardening operacional (não iniciado) — numeração real já estabelecida. Milestones novos abaixo
começam em **M9**, ordem determinada pela evidência das Fases 1-2, não pela ordem original do
prompt estratégico (ver mudanças na Executive Summary).

### M9 — Commercial Domain Foundation

**Objetivo**: introduzir o átomo comercial validado por mercado (`TrackedSubject`) e o mecanismo
de requisito ausente (`RequirementAssignment`), com controle de custo mínimo desde o primeiro dia.

**Business value**: desbloqueia toda a tese comercial de "vendor/document compliance" — sem isso,
nenhuma das demais capacidades tem onde se ancorar. Base de billing futuro.

**Scope**: `TrackedSubject` (agregado raiz, cluster 1); `RequirementAssignment` (coleção sob a
partição do subject, cluster 1); `ExpirationItem.subjectId?` opcional; `notes?` em ambos
(emenda do cluster 6); `Entitlement`/`UsageQuota` mínimo local com plano default/free e limite de
`ACTIVE_TRACKED_SUBJECTS` (cluster 3, sem provider externo ainda); `ItemWatch` + audiences
`ASSIGNEE`/`WATCHERS` (cluster 5, parte não-chasing).

**Out of scope**: `RequirementDefinition`/`RequirementTemplate` (deferidos), custom fields
genérico (rejeitado), `EXTERNAL_CONTACT` como audience de `ExpirationItem` comum (só chasing),
billing provider externo, Organization/Membership.

**Domain changes**: 2 agregados raiz novos + 1 agregado-coleção (`ItemWatch`); GSI7 novo
(subject listing); novas actions de autorização `subject:*`/`requirement:*`.

**Infrastructure changes**: edição de `infra/modules/dynamo-table` (GSI7); novo tipo de quota em
`TenantQuotaService`.

**API changes**: `POST/GET/PATCH/DELETE /subjects`, `POST/GET/PATCH /subjects/{id}/requirements`.

**Security**: isolamento multi-tenant padrão (resolver deriva `tenantId`, nunca aceita do
cliente) — mesmo padrão de todo módulo existente, sem superfície nova de risco.

**Observability**: métricas `subjects_created`, `requirements_missing_count` por tenant.

**Tests**: unit (domínio/estado MISSING→SATISFIED), integration (DynamoDB real, GSI7),
contract (schemas novos), cross-tenant negativo (mesmo padrão de `cross-tenant.test.ts`).

**Migration**: nenhuma — campo novo opcional em `ExpirationItem`, zero dado a migrar (confirmado
com evidência real no cluster 1).

**Dependencies**: nenhuma (base do roadmap).

**Acceptance criteria**: "Um `RequirementAssignment` sem `linkedItemId` aparece como `MISSING` no
dashboard do subject." "Adicionar/remover watcher não muda a versão OCC de `ExpirationItem`."
"Exceder `ACTIVE_TRACKED_SUBJECTS` do plano free retorna erro fail-closed, nunca cria o subject
parcialmente."

### M10 — Guest Collection & Automated Chasing

**Objetivo**: permitir que um terceiro sem conta envie documento via link seguro, e que o sistema
cobre automaticamente antes do vencimento — o núcleo de valor comercial validado por 3
concorrentes reais.

**Business value**: reduz trabalho manual de cobrança (a dor mais citada nos concorrentes
pesquisados); é o hook de aquisição gratuito validado por mercado.

**Scope**: `DocumentRequest` + `DocumentSubmission` (cluster 2); token opaco `selector.secret` +
ponteiro tenantless (cluster 2); generalização mínima do pipeline M6 (`UploadActor`, quarantine
key canônica `anchor/<ITEM|SUBMISSION>/...`); `DocumentChasingOccurrence`/`DocumentChasingIntent`
(cluster 4, agregados-irmãos, reaproveitando GSI3); `EXTERNAL_CONTACT` como audience só neste
fluxo (cluster 5).

**Out of scope**: `ExternalContact` como entidade completa (snapshot inline no v1);
`submitterMessage?` em `DocumentSubmission` (achado colateral do cluster 6, não decidido);
digest.

**Domain changes**: 4 agregados novos (`DocumentRequest`, `DocumentSubmission`,
`DocumentChasingOccurrence`, `DocumentChasingIntent`); 1 exceção tenantless nova (ponteiro de
guest token, mesmo padrão de `IdentityMapping`); novo comando `document-chasing.dispatch.v1`.

**Infrastructure changes**: nova rota pública `authorization_type=NONE` no API Gateway (primeira
do projeto); **WAF obrigatório antes de expor a rota** (pré-requisito, não item de M8); rate
limit por token e por IP.

**API changes**: `GET/POST /guest/document-requests/{token}[/uploads]`.

**Security**: maior superfície de risco do roadmap — token hasheado com pepper versionado,
resposta genérica anti-enumeration, `timingSafeEqual`, fail-closed em qualquer ambiguidade.
**Gate explícito pré-implementação**: verificar/corrigir política IAM de namespace tenantless
(`GUESTTOKEN#*`/`IDENTITY#*` excluído de handlers tenant-facing comuns) — residual real
registrado no cluster 2, nunca verificado.

**Observability**: `document_requests_created/completed/overdue`, `guest_upload_failures`,
`chasing_messages_sent`, alarmes de GSI3 segmentados por `entityType` (residual do cluster 4).

**Tests**: unit, integration, **security** (guest token replay/enumeration/cross-tenant —
capability de teste genuinamente nova, não existe hoje), end-to-end (fluxo completo do prompt
estratégico §62).

**Migration**: janela de compatibilidade temporária no parser de quarantine key (formato antigo +
novo), removida depois que eventos/slots em voo do fluxo autenticado esgotarem.

**Dependencies**: M9 (`RequirementAssignment` deve existir).

**Acceptance criteria**: "Um token de convite expirado retorna 401/403 genérico, nunca revela se
o `RequirementAssignment` existe." "Reprocessar o mesmo `DocumentSubmission` não gera duas
promoções para `CLEAN`." "GSI3 continua drenando dentro do SLO já modelado com o volume de
chasing incluído (mini-revisão de capacidade real, não estimativa)."

### M11 — Bulk Operations (CSV import)

**Objetivo**: importar `TrackedSubject`+`RequirementAssignment` em massa via CSV.

**Business value**: reduz fricção de onboarding para clientes que já têm planilha — citado no
prompt como "funcionalidade de altíssimo valor".

**Scope**: fluxo assíncrono completo (cluster 7) — upload→fila→worker→preview em S3→commit
transacional; dedupe por `externalId`; quotas `IMPORT_*` novas. **CSV export incluído neste
milestone** (baixa complexidade/risco per feature score — síncrono, consulta `TrackedSubject`/
`RequirementAssignment` já existentes, stream CSV) — aplica a mesma regra de escapagem de
formula injection já decidida no cluster 7 para qualquer output CSV baixável.

**Out of scope**: XLSX import/export (milestone futura); merge/update de linha divergente
(rejeitada por padrão no v1).

**Domain changes**: `ImportJob` (DynamoDB); plano linha-a-linha (S3); registros de dedup
tenantless-scoped por tenant.

**Infrastructure changes**: reaproveita `sqs-worker-queue`; novo bucket ou prefixo S3 para
artefatos de import (retenção curta).

**API changes**: `POST /imports/csv/reservations`, `POST /imports/{jobId}/commit`,
`GET /imports/{jobId}`.

**Security**: formula injection mitigada na EXPORTAÇÃO (não na entrada — achado real do cluster
7); limites de tamanho/linha antes de processar; parser streaming estrito.

**Observability**: `import_rows_processed/rejected`, `import_jobs_committed/failed`.

**Tests**: unit (parsing/dedupe), integration (worker real), security (formula injection em
qualquer export downstream), teste de idempotência (reenvio do mesmo CSV).

**Migration**: nenhuma (feature nova, sem dado legado).

**Dependencies**: M9 (`TrackedSubject`/`RequirementAssignment` devem existir).

**Acceptance criteria**: "Um import de 1.000 linhas com 20 inválidas produz relatório
determinístico sem duplicar registro em retry." "Reenviar o mesmo CSV não cria segundo lote de
subjects." "Um valor de `TrackedSubject.displayName` começando com `=` exportado em CSV vem
sempre escapado (prefixo apostrophe), nunca interpretado como fórmula ao abrir em planilha."

### M12 — Commercial Monetization (Billing)

**Objetivo**: converter/expandir limites pagos via provider externo, cobrando por
`TrackedSubject` ativo.

**Business value**: primeira receita recorrente real — objetivo comercial central do projeto.

**Scope**: `Plan`/`Subscription`/`BillingWebhookInbox` (cluster 3); expansão de `Entitlement`
para planos pagos; integração com provider externo (Stripe ou similar, decisão de fornecedor
fora deste roadmap).

**Out of scope**: billing engine próprio (nunca — decisão explícita do prompt); billing por
assento (métrica secundária, não principal); Organization como pré-requisito (não é).

**Domain changes**: 3 agregados novos; nenhuma mudança em `TrackedSubject`/`RequirementAssignment`
(billing referencia por `tenantId`, não introduz acoplamento novo no domínio core).

**Infrastructure changes**: endpoint de webhook (segunda rota pública do projeto, depois da de
guest upload em M10) — mesma disciplina de WAF/rate-limit.

**Security**: webhook precisa de verificação de assinatura do provider (nunca confiar em payload
não assinado); idempotência de evento de webhook (`BillingWebhookInbox`).

**Observability**: `subscription_status_changed`, `entitlement_limit_reached`,
`billing_webhook_failures`.

**Tests**: contract (schema de webhook do provider), unit (cálculo de entitlement),
integration (fluxo completo checkout→webhook→entitlement atualizado).

**Migration**: nenhuma.

**Dependencies**: M9 (`Entitlement`/`UsageQuota` mínimo já precisa existir — este milestone só
EXPANDE, não introduz do zero).

**Acceptance criteria**: "Cancelamento de assinatura no provider reduz `Entitlement` do tenant em
até N minutos, nunca instantaneamente destrutivo (grace period)." "Webhook duplicado (retry do
provider) não aplica o mesmo efeito duas vezes."

### M13 — Commercial Accounts (Organization/Membership/RBAC)

**Objetivo**: destravar múltiplos usuários por conta, quando (e só quando) houver venda B2B real
exigindo isso.

**Business value**: exclusivamente uma condição de venda B2B específica — não valor comercial
proativo por si só (evidência de mercado: nenhum concorrente vende multiusuário como diferencial
central).

**Scope**: `Organization`, `Membership`, migração de `tenantId=userId` para
`tenantId=organizationId` (plano de 3 fases de `evolution.md`, **corrigido** per achado do
cluster 3 — ver `11-phase3-impacts-and-closing.md` §correção de `evolution.md`); RBAC
`OWNER|MEMBER|VIEWER` (mais `ADMIN` se necessário, decidido só quando Membership for real).

**Out of scope**: SSO enterprise, white-label, `MANAGER` role antecipado.

**Domain changes**: o mais invasivo do roadmap — migração de chave física (PK/GSI/S3/
idempotência/outbox), não só atributo novo.

**Infrastructure changes**: nenhuma tabela nova, mas rematerialização de item existente em massa.

**Security**: SCALE-004 (critério de saída já existente em `requirements.md`) precisa passar
ampliado; validação de isolamento entre múltiplos usuários do mesmo tenant.

**Observability**: contagem de registros migrados vs. esperados (critério de conclusão já
definido em `evolution.md`).

**Tests**: teste de migração dedicado (contagem antes/depois), teste de isolamento
multi-usuário, rollback do backfill testado antes do cutover.

**Migration**: a mais real e arriscada do roadmap — ver correção pendente registrada no cluster
3, a formalizar como revisão de `evolution.md` antes de qualquer código.

**Dependencies**: gatilho comercial explícito ("primeira venda B2B exigindo múltiplos usuários
por conta", `evolution.md:13`) — nunca estágio numérico. Tecnicamente independente de M9-M12
(pode acontecer em paralelo se o gatilho disparar antes).

**Acceptance criteria**: "100% dos registros migrados, contagem antes/depois idêntica."
"Teste de isolamento SCALE-004 ampliado passa." "Rollback via alias
`oldUserTenantId→organizationId` funciona antes do cutover final."

## H. Dependency graph

```text
TrackedSubject + RequirementAssignment (M9)
        ↓                              ↓
Guest Collection & Chasing (M10)   CSV import (M11)
        ↓                              ↓
        └──────────────┬───────────────┘
                        ↓
         Entitlement mínimo (M9) já existe
                        ↓
        Commercial Monetization / Billing (M12)

Organization/Membership/RBAC (M13)
   — dependência única: gatilho comercial B2B real (evolution.md:13), não uma dependência
     técnica de M9-M12
   — tecnicamente independente do restante do roadmap; pode ser priorizado a qualquer momento,
     inclusive antes ou em paralelo a M9-M12, se o gatilho comercial disparar primeiro
```

Nenhum milestone novo depende de M7 (Extraction) ou M8 (Hardening) estarem prontos — são trilhas
paralelas do backend (extração de documento vs. domínio comercial), mas M10 (guest upload)
reaproveita o pipeline de M6 (já concluído) e se beneficiaria de M7 estar pronto para
extração automática de dados do documento enviado pelo convidado (não é dependência dura — M10
funciona com confirmação 100% manual se M7 ainda não existir).

## Nota de escopo

Este roadmap é proposta para decisão do Marcelo, não autorização de implementação (§57 do prompt
estratégico: "não comece a implementar automaticamente todos os milestones novos"). Números de
milestone (M9-M13) são de trabalho, não compromisso final até formalizados em ADR.

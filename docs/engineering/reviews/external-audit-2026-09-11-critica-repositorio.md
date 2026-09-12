# Expiration Tracker — Auditoria Crítica do Repositório

**Data da auditoria:** 2026-09-11  
**Branch analisada:** `develop`  
**Repositório:** `marcelo-jgoncalves/expiration-tracker`  
**Objetivo:** nova auditoria ampla após uma sequência extensa de implementações realizadas desde a rodada anterior.

---

## 1. Resumo executivo

O Expiration Tracker evoluiu de uma arquitetura muito boa com vários gaps estruturais para uma plataforma tecnicamente madura, com boa parte dos problemas difíceis já resolvidos.

A conclusão principal desta auditoria é:

> **O projeto melhorou muito mais do que deteriorou. A arquitetura central continua sólida, e as implementações recentes preservaram os padrões difíceis do sistema — OCC, fencing, tenant isolation, outbox, idempotência, transações e revisão adversarial. Os principais riscos atuais estão concentrados em alguns invariantes ainda não fechados e na diferença entre "testado/mocado" e "provado no ambiente AWS real".**

Avaliação geral provisória desta auditoria:

**≈ 8,2/10**

Essa nota é uma avaliação técnica desta rodada e **não** uma nota formal do protocolo Claude↔Codex.

---

## 2. Evidência objetiva observada no HEAD atual

No HEAD analisado em 11/09/2026:

- `2.905` testes backend passaram.
- `247` arquivos de teste backend passaram.
- `332` testes frontend passaram.
- `46` arquivos de teste frontend passaram.
- `138` testes Playwright passaram.
- job de DynamoDB integration passou.
- Terraform validate/test/plan passou.
- build de frontend passou.
- branch `main` está protegida.
- CI recente está verde.

O build do frontend produziu aproximadamente:

```text
index.js
436,81 kB
123,23 kB gzip

CSS
36,46 kB
6,28 kB gzip
```

---

# 3. Evolução positiva desde a auditoria anterior

Vários dos problemas relevantes identificados nas auditorias anteriores foram efetivamente atacados.

### Antes

```text
Scan periódico
→ risco de starvation

API_REQUEST
→ Get + TransactWrite em toda request

Reminder Dispatch
→ Query + N+1 + serialização

Lambda
→ x86_64 / tuning genérico

rollback
→ inventário manual

IAM
→ Scan generalizado
```

### Estado atual

```text
MaintenanceDueIndex / GSI8
→ 9/9 workers migrados

API_REQUEST
→ EphemeralTelemetryMutation

Reminder Dispatch
→ Get direto + leituras paralelas
→ bounded concurrency

Lambdas
→ ARM64

rollback manifest
→ gerado automaticamente

IAM
→ Scan removido das permissões tenant-facing gerais
→ workers especiais explicitamente autorizados
```

Também foram implementados, entre outros:

- Requirement Templates;
- bulk import;
- OCR/IA integrado ao Document Lifecycle;
- busca e filtros;
- compliance dashboard;
- relatórios;
- dossiê PDF/XLSX;
- scheduled reports;
- metadata configurável;
- WhatsApp;
- quotas de storage;
- guest credential delivery;
- dezenas de telas do frontend;
- RBAC e UX multi-account;
- propagação de `AuthorizedTenantId`;
- novos controles de retenção;
- Activity Log;
- External Share Link em evolução.

---

# 4. Achados críticos — P0 / Pilot Readiness

## P0.1 — Upload real browser → S3 permanece bloqueado por CSP/CORS

### Estado observado

O frontend utiliza o fluxo correto conceitualmente:

```text
Browser
↓
API
↓
reserveFiles()
↓
presigned S3 URL
↓
Browser PUT → S3
↓
confirm
```

Entretanto, a CSP da SPA atualmente contém:

```text
connect-src 'self'
```

em:

```text
infra/modules/spa-hosting/variables.tf
```

Ao mesmo tempo, o bucket de quarentena em:

```text
infra/modules/document-buckets/main.tf
```

não possui configuração CORS.

### Consequência

O fluxo tende a falhar em navegador real:

```text
Frontend
↓
reserve funciona
↓
presigned URL funciona
↓
browser tenta PUT
↓
CSP bloqueia
```

e/ou:

```text
browser preflight
↓
S3
↓
sem CORS adequado
↓
browser bloqueia
```

### Superfícies afetadas

- upload autenticado;
- A07;
- A12 / Document Detail;
- Guest Upload;
- G02;
- qualquer fluxo browser → presigned S3.

### Por que os testes atuais não detectam

Os testes Playwright executados no CI usam BFF mockado.

Eles validam bem:

```text
React
routing
states
RBAC
accessibility
UX
contracts simulados
```

Mas não validam diretamente:

```text
CloudFront real
CSP real
API Gateway real
presigned S3 real
CORS real
cookies reais
Hosted UI real
```

### Recomendação

Abrir uma rodada arquitetural dedicada Claude↔Codex.

Alternativa mais natural, preservando a arquitetura atual:

```text
SPA origin
↓
CSP autoriza somente o endpoint necessário
↓
S3 CORS autoriza somente app-origin
↓
PUT presigned
```

Alternativa de maior impacto:

```text
Browser
↓
same-origin upload endpoint / proxy
↓
S3
```

Essa alternativa altera mais profundamente arquitetura, custo e tráfego.

### Classificação

**P0 — blocker de piloto real.**

---

## P0.2 — GuestSession não está vinculada ao token da URL

Arquivo principal:

```text
src/modules/document-archive/http/document-archive-guest-handlers.ts
```

### Estado observado

O path contém um credential/token, mas a mutação efetiva utiliza a `GuestSession` armazenada em cookie.

O próprio código documenta o problema.

### Cenário de falha

```text
/guest/request/TOKEN-A
↓
cria SESSION-A
↓
cookie global

abre outra aba

/guest/request/TOKEN-B
↓
cria SESSION-B
↓
sobrescreve cookie

volta para aba TOKEN-A
↓
submit
↓
cookie = SESSION-B
↓
operação pode ocorrer no Request B
```

### Risco

Não é necessariamente um vazamento cross-tenant clássico, mas é um problema grave de **integridade contextual**.

O usuário pode acreditar que está enviando evidência para uma solicitação enquanto o backend atua sobre outra.

Em um produto de documentos/compliance, isso é grave.

### Recomendação

Criar vínculo verificável:

```text
Path Credential A
↕
GuestSession A
```

Cada mutação deve provar que a sessão pertence ao credential/request representado pelo path.

Possibilidades:

- registrar `credentialSelectorHash`/request identity na sessão e comparar;
- vincular explicitamente sessão e `documentRequestId`;
- utilizar uma estratégia de cookie escopado/identidade de sessão compatível com múltiplas abas.

### Classificação

**P0 — não lançar Guest Flow sem corrigir.**

---

## P0.3 — `DocumentRequestSeries` ainda permite séries inválidas ou duplicadas

Arquivo:

```text
src/modules/document-archive/application/document-request-recurrence-service.ts
```

### Estado observado

`createSeries()` ainda não garante transacionalmente:

```text
Subject existe
AND
Requirement existe
AND
Requirement pertence ao Subject
AND
não existe outra série ACTIVE para o Requirement
```

O próprio código registra essa lacuna.

### Estado possível hoje

```text
Requirement R1
├── Series S1 ACTIVE
└── Series S2 ACTIVE
```

Também existe risco de criar uma série apontando para Requirement inválido por chamada direta à API, ignorando validações da UI.

### Recomendação

Criar um fence transacional de unicidade e existência.

Exemplo conceitual:

```text
SERIESACTIVE#REQUIREMENT#<requirementId>
↓
seriesId
```

Transação:

```text
ConditionCheck Subject
ConditionCheck Requirement
Put Series
Put ActiveSeriesPointer IF NOT EXISTS
```

Ao cancelar:

```text
Update Series -> CANCELLED
Delete ActiveSeriesPointer
```

Tudo na mesma transação.

### Classificação

**P0 — correção de domínio.**

---

## P0.4 — `ReminderPolicy` permite N policies enquanto frontend modela 1

Arquivo:

```text
src/modules/reminder/application/reminder-policy-service.ts
```

### Estado observado

A UI trabalha conceitualmente com:

```text
Item
↓
Reminder Policy
```

Mas o backend permite:

```text
Item
├── Policy 1
├── Policy 2
└── Policy N
```

porque o pointer atual é por policy:

```text
POLICYREF#<policyId>
```

e não existe uniqueness fence.

`getPolicyForItem()` reconhece esse fato e escolhe deterministicamente a policy válida mais recentemente atualizada.

Isso resolve a apresentação, mas não o domínio.

### Risco

Duas ou mais policies podem permanecer válidas e potencialmente gerar lembretes duplicados, enquanto a UI exibe apenas uma.

### Decisão necessária

Escolher explicitamente um dos modelos:

#### Modelo A — 1:1

```text
Item → exatamente uma ReminderPolicy
```

Implementar uniqueness fence transacional.

#### Modelo B — 1:N

```text
Item → várias ReminderPolicies
```

Então:

- API;
- UI;
- rotas;
- domínio;
- materializer

devem assumir N explicitamente.

### Avaliação

O estado atual é o pior meio-termo:

> backend permite N, frontend modela 1.

### Classificação

**P0 — resolver antes de clientes reais.**

---

## P0.5 — Falta um System E2E real contra `dev`

### Problema

A suíte atual é forte, mas o E2E browser principal é fortemente apoiado em mocks.

Consequentemente:

```text
code
✅

unit tests
✅

component tests
✅

mocked browser E2E
✅

CI
✅
```

pode coexistir com:

```text
browser real → CloudFront → API Gateway → S3
❌
```

### Recomendação

Criar uma pequena suíte de **Real System E2E**, contra `dev`.

Não precisa replicar os 138 Playwright atuais.

Sugestão: 8–12 jornadas críticas.

### Jornada documental principal

```text
login real
↓
organization selection
↓
create Subject
↓
create Requirement
↓
create Request
↓
generate guest link
↓
guest opens link
↓
REAL presigned upload to S3
↓
review
↓
accept
↓
renew
```

### Jornada reminder

```text
create expiration
↓
configure reminder
↓
trigger pipeline
↓
NotificationIntent
```

### O que essa suíte deve provar

- Hosted UI real;
- cookies reais;
- CloudFront routing;
- CSP;
- CORS;
- API Gateway;
- BFF;
- S3 presigned;
- upload real;
- headers;
- redirects;
- tenant context.

### Nova classificação de evidência sugerida

```text
UNIT TESTED
↓
INTEGRATION TESTED
↓
MOCKED BROWSER E2E
↓
DEPLOYED
↓
REAL SYSTEM E2E
↓
OPERATIONALLY PROVEN
```

### Classificação

**P0 — Pilot Readiness.**

---

## P0.6 — Branch protection exige somente `guardrails`

### Estado observado

Workflow atual possui pelo menos:

```text
guardrails
dynamodb-integration
frontend
Validate Infra (Terraform)
```

Todos passaram no HEAD auditado.

Entretanto a proteção de `main` observada exige somente:

```text
guardrails
```

### Risco

Teoricamente:

```text
guardrails ✅
frontend ❌
Terraform ❌
DynamoDB integration ❌
```

pode não ser bloqueado pela configuração atual de required checks.

Isso é incompatível com a intenção operacional registrada no projeto:

> merge para `main` apenas com CI verde.

### Recomendação

Criar um gate agregador:

```text
guardrails ──────────────┐
dynamodb-integration ────┤
frontend ────────────────┼→ CI_REQUIRED
infra ───────────────────┘
```

Branch protection exige apenas:

```text
CI_REQUIRED
```

Esse padrão reduz o risco de esquecer de adicionar um novo job aos required checks no futuro.

### Classificação

**P0/P1 alto — recomendável antes do piloto.**

---

## P0.7 — WhatsApp não está completamente operacional para usuário real

### Estado positivo

Já existem:

- adapter Meta;
- webhook;
- quotas;
- kill switch;
- delivery;
- preferences;
- opt-in domain/service.

### Gap encontrado

`WhatsAppOptInService.recordOptIn()` ainda não possui rota HTTP real acessível ao usuário.

A própria classe registra explicitamente que ainda não está wired.

Busca por `recordOptIn(` não revelou caller de produção.

### Estado real

```text
WhatsApp engine
✅

usuário consegue registrar opt-in real
❌
```

Além disso, permanecem pendências já registradas:

- infraestrutura das fatias finais ainda não aplicada integralmente em `dev`;
- requisitos jurídicos/privacidade Meta;
- credenciais reais dependentes desse fechamento.

### Recomendação

Não considerar o roadmap item como simplesmente “DONE”.

Classificar como:

> **ENGINEERING IMPLEMENTED / PRODUCT NOT YET E2E READY**

Criar:

- rota HTTP de opt-in;
- UI correspondente;
- evidência real em `dev`;
- fluxo opt-in → router → provider → callback.

### Classificação

**P0 se WhatsApp fizer parte do piloto.**

---

# 5. Achados importantes — P1

## P1.1 — `RequestContext` continua caro

Arquivo:

```text
src/modules/identity/application/resolve-request-context.ts
```

### Estado observado

O fluxo ainda tende a executar:

```text
bootstrap user
↓
OnboardingStateResolver
↓
GSI4
↓
hidrata memberships
↓
resolveActiveMembership
↓
resolveWorkingOrganization
```

mesmo quando:

```text
organizationIdHint
```

já vem do BFF.

### Consequência

Requests comuns de negócio pagam custos de resolução de onboarding/organização que não deveriam ser necessários no hot path.

### Fast path recomendado

Quando `organizationIdHint` existir:

```text
userId
+
organizationId
↓
parallel read / BatchGet
├── Membership
├── TenantLifecycle
└── DeviceSession, quando necessário
```

GSI4/onboarding deve ficar para:

- login;
- org picker;
- usuário sem organização;
- recuperação.

### Classificação

**P1 forte — performance/latência.**

---

## P1.2 — Reminder Producer não sustenta o SLO extremo declarado

Arquivo:

```text
src/workers/reminder-producer/producer.ts
```

Infra:

```text
reserved_concurrent_executions = 2
```

### Estado observado

Ainda existe um padrão essencialmente sequencial:

```text
for minute
  for generation
    for shard
      await queryGsi3

      for row
        await Get
        await TransactWrite
```

Enquanto `slo.md` declara:

```text
1.000.000 ocorrências
≥99% em 5 minutos
≈3.333 agendamentos/s
```

### Inconsistência

```text
SLO de escala muito alta
+
runtime que não foi implementado para essa escala
```

### Duas soluções defensáveis

#### A — Construir Producer horizontal

```text
Coordinator
↓
SQS partition/page work
↓
N workers
```

#### B — Rebaixar o SLO

O estado atual não deveria continuar indefinidamente.

### Classificação

**P1 — não bloqueia primeiros clientes, bloqueia afirmação de scale readiness.**

---

## P1.3 — Capacity Model está desatualizado em relação ao produto real

Arquivo:

```text
docs/architecture/capacity-model.md
```

### Problema

O modelo ainda assume conceitos anteriores como:

```text
tenant = usuário individual
Organization = futuro
8 itens por usuário
4,8 documentos por usuário
```

O produto atual contém:

```text
Organization
Membership
Subjects
Requirements
Documents
DocumentVersions
DocumentFiles
DocumentRequests
DocumentRequestSeries
Reviews
Imports
Reports
Dossiers
Shares
WhatsApp
Guest Sessions
Storage quotas
```

### Recomendação

Criar **Capacity Model v2**.

Modelo sugerido:

```text
Organizations
× Members/org
× Subjects/org
× Requirements/Subject
× Documents/Subject
× Versions/Document
× Files/Version
× Requests/Requirement
× Notification attempts
× OCR pages
× Reports
× Guest flows
```

A partir daí recalcular:

- DynamoDB volume;
- GSI volume;
- S3;
- SQS;
- Lambda throughput;
- API RPS;
- logs;
- backup;
- purge;
- OCR/LLM;
- custo.

### Classificação

**P1 — necessário antes de voltar a afirmar Stage 3/4/5.**

---

## P1.4 — Não existe load testing real no repositório

Não foi encontrada evidência de:

- k6;
- Artillery;
- autocannon;
- vegeta;
- harness de carga dedicado.

### Gap

Existe:

```text
architecture
↓
capacity assumptions
↓
implementation
```

mas falta:

```text
LOAD TEST
↓
measured evidence
```

### Recomendação

Criar programa de performance/load testing em estágios:

#### Stage A — API paths

- BFF/session;
- item list;
- document list;
- search;
- dashboard.

#### Stage B — async throughput

- Reminder Producer;
- Dispatch;
- Outbox;
- scheduled reports;
- imports.

#### Stage C — storage/document pipeline

- reserve;
- upload;
- malware;
- extraction;
- review.

#### Stage D — adversarial/noisy-neighbor

- tenant skew;
- quota abuse;
- guest rate limits.

### Classificação

**P1.**

---

## P1.5 — Frontend chegou ao ponto de justificar route-level code splitting

Arquivo:

```text
frontend/src/App.tsx
```

### Estado atual

As telas são majoritariamente importadas de forma eager.

Bundle principal:

```text
436,81 kB raw
123,23 kB gzip
```

Ainda não é um tamanho grave.

O risco é crescimento contínuo.

### Recomendação

Introduzir:

```text
React.lazy()
+
route-level code splitting
+
Suspense/loading boundaries
+
bundle size budget
```

Adicionar um gate de regressão, por exemplo:

- limite do entry bundle;
- limite por chunk;
- alerta de crescimento percentual.

### Classificação

**P1 — fazer agora é barato e previne dívida.**

---

## P1.6 — `reset-dev-data.ts` está com drift de filas

Arquivo:

```text
scripts/reset-dev-data.ts
```

### Filas que o script conhece

12 filas base.

### Filas identificadas na infraestrutura atual mas ausentes do reset

```text
dossier-export
guest-credential-issuance
import-parse-dispatch
report-subscription-delivery
requirement-evidence-refresh
whatsapp-deliver
```

### Risco

```text
reset-dev-data --confirm
↓
DynamoDB limpo
S3 limpo
filas conhecidas limpas
↓
script termina verde
↓
filas novas mantêm mensagens antigas
```

Isso pode deixar `dev` em estado contaminado sem indicar falha.

### Recomendação

Não apenas atualizar manualmente a lista.

Preferir:

```text
Terraform
↓
generated queue inventory
↓
reset-dev-data consome inventário
```

ou criar:

```text
CI check
Terraform queue inventory
↕
reset allowlist
```

### Classificação

**P1.**

---

## P1.7 — Coverage existe, mas não há política de coverage

Arquivo:

```text
vitest.config.ts
```

Existe:

```text
coverage.provider = v8
```

Mas:

- CI normal não executa coverage;
- não há `coverage.thresholds`.

### Recomendação

Não usar simplesmente uma meta global arbitrária.

Adotar cobertura orientada a risco.

### Thresholds altos em

```text
authorization
tenant fencing
OCC
idempotency
quota
guest auth
token handling
billing futuro
```

### Mais flexível em

```text
composition roots
thin AWS adapters
UI glue
```

Também considerar **mutation testing** em funções críticas, que pode trazer mais valor que perseguir line coverage extrema.

### Classificação

**P1.**

---

## P1.8 — Real System E2E deve virar gate de Definition of Done para features infra-dependent

Uma lição importante desta auditoria:

```text
code
✅
unit
✅
Playwright mocked
✅
Codex review
✅
CI
✅
```

não significa necessariamente:

```text
infra real
✅
```

### Nova regra sugerida

> Uma feature que atravessa fronteiras de infraestrutura não pode ser considerada `E2E PROVEN` usando somente mocks dessas fronteiras.

### Exemplos

#### Upload

Deve provar:

```text
CloudFront real
+
CSP real
+
API real
+
presign real
+
S3/CORS real
```

#### WhatsApp

Deve provar:

```text
opt-in real
+
router
+
provider/test number
+
callback
```

#### Guest flow

Deve provar:

```text
cookie real
+
CloudFront
+
API Gateway
+
S3
```

### Classificação

**P1 de governança, mas com efeito P0 em pilot readiness.**

---

# 6. Achados de hardening — P2

## P2.1 — Dois boundaries async ainda dependem demais de TypeScript

Arquivos citados:

```text
src/runtime/aws/handlers/dispatch-outbox-relay-processor.ts
src/runtime/aws/handlers/reminder-reconciliation-handler.ts
```

### Estado

Alguns envelopes internos ainda dependem de:

```text
unmarshall
↓
TypeScript cast
```

sem o mesmo runtime schema validation usado em outras partes do sistema.

### Recomendação

Padronizar boundary validation com schema runtime.

### Classificação

**P2.**

---

## P2.2 — IP bruto é persistido na PK do guest rate limiter

Arquivo:

```text
src/modules/document-archive/application/document-archive-guest-rate-limiter.ts
```

Atual:

```text
DOCARCHIVEGUESTIP#<raw-ip>#RATE
```

### Recomendação

Trocar por:

```text
HMAC(pepper, ip)
```

Benefícios:

- preserva determinismo;
- preserva rate limiting;
- reduz dado pessoal legível;
- melhora privacy by design.

### Classificação

**P2.**

---

## P2.3 — Supply chain está controlada, mas ainda possui findings

CI atual mostrou:

```text
produção:
2 moderate

incluindo dev:
11 vulnerabilidades
4 moderate
5 high
2 critical
```

Os findings high/critical observados estão em dependências de desenvolvimento e já possuem triagem/exceções registradas.

As moderate de produção também estão registradas.

### Recomendação

Antes de piloto:

- tentar remover production moderates quando houver upgrade razoável;
- evitar `--force` cego;
- manter exceções com data de expiração;
- continuar SBOM.

### Classificação

**P2 / hardening pré-piloto.**

---

## P2.4 — Context engineering melhorou, mas `NEXT_SESSION_PROMPT.md` cresce novamente

### Melhoria já realizada

`scripts/check-doc-drift.ts` agora mede:

- linhas;
- bytes;
- palavras.

Isso corrige o antigo falso negativo de linhas gigantes.

### Novo estado

`NEXT_SESSION_PROMPT.md` já está novamente próximo de:

```text
~28 kB
```

com limite:

```text
30 kB
```

### Recomendação

Promover detalhes históricos dos blocos frontend para:

```text
decisions-log
session-log
frontend implementation history
```

e deixar `NEXT_SESSION_PROMPT.md` apenas com:

```text
Block 0 ✅
Block 1 ✅
...
Block 7 ✅
Block 8 ← atual

gaps atuais
next action
```

### Classificação

**P2.**

---

# 7. Pontos que estão realmente fortes

## 7.1 Concorrência e consistência

O padrão:

```text
read
↓
OCC
↓
ConditionCheck
↓
TransactWriteItems
↓
Outbox
```

está amplamente disseminado.

Isso é um ponto forte real da base de código.

---

## 7.2 Tenant isolation

A propagação de:

```text
AuthorizedTenantId
```

para key builders e serviços transforma parte da segurança de:

> "lembre de passar o tenant correto"

em:

> "o tipo exige tenant autorizado".

Excelente direção.

---

## 7.3 Document Lifecycle

O domínio atual:

```text
Requirement
→ Request
→ Guest Upload
→ Review
→ DocumentVersion
→ Validity
→ Renewal
→ History
```

está bem estruturado e coerente.

---

## 7.4 Epistemic integrity

A distinção:

```text
AI suggested
!=
human confirmed
```

continua sendo uma das melhores decisões do projeto.

---

## 7.5 Storage quota

O modelo atual:

```text
usedBytes
+
reservedBytes
+
transactional capacity hold
```

é sólido e evita overcommit concorrente.

---

## 7.6 Retention

A migração para GSI8 e adoção de TTL/purge nas entidades mais recentes corrigiram uma fraqueza importante das versões anteriores.

---

## 7.7 Rollback

O inventário de Lambdas deixou de depender de lista manual e passou a ser gerado.

Isso corrige a **classe** de problema, não apenas um bug isolado.

Esse padrão deveria ser replicado em outros inventários, especialmente filas.

---

# 8. Avaliação por eixo

| Eixo | Nota aproximada | Observação |
|---|---:|---|
| Arquitetura | **8,9** | Excelente estrutura; alguns invariantes ainda abertos |
| Correção / concorrência | **8,5** | Muito forte, penalizada por guest/series/policy |
| Segurança | **8,5** | Bom isolamento; resíduos em guest/privacy e gates |
| Multi-tenancy | **9,0** | Um dos pontos mais fortes |
| Async / reliability | **8,6** | Muito forte; Producer e alguns boundaries ainda limitam |
| Performance | **7,4** | Dispatch e ARM64 melhoraram; Producer/RequestContext/load test permanecem |
| Testes | **8,6** | Grande cobertura; falta System E2E real e coverage policy |
| CI/CD | **8,0** | Workflow excelente; required checks incompletos |
| Operações / DR | **7,3** | Rollback melhorou; faltam drills reais e escala comprovada |
| Frontend engineering | **8,4** | Evolução enorme; upload real e bundle strategy pendentes |
| Privacidade | **7,0** | Retenção melhorou; DSR/vendor/processos ainda faltam |
| Supply chain | **8,0** | Boa disciplina e SBOM; findings conhecidos permanecem |
| Context/docs | **8,0** | Guardrails melhores; acúmulo voltou a aparecer |
| Governança IA | **7,5** | Processo sofisticado, ainda suscetível a overclaim de DONE |

### Nota agregada desta auditoria

**≈ 8,2/10**

---

# 9. Roadmap recomendado

## P0 — antes de clientes reais

1. Resolver CSP + S3 CORS / arquitetura real de upload browser.
2. Vincular GuestSession ao credential/token/request correto.
3. Enforçar invariantes de `DocumentRequestSeries`.
4. Decidir e enforçar cardinalidade de `ReminderPolicy`.
5. Criar Real System E2E contra `dev`.
6. Fechar WhatsApp opt-in + deploy + E2E, se WhatsApp fizer parte do piloto.
7. Criar aggregate required CI check para `main`.

---

## P1 — world-class engineering antes de escalar

8. Implementar RequestContext fast path.
9. Redesenhar Reminder Producer para horizontalização ou revisar SLO.
10. Criar Capacity Model v2.
11. Criar programa de load testing.
12. Introduzir route-level code splitting e bundle budget.
13. Gerar inventário de filas para `reset-dev-data`.
14. Definir política real de coverage.
15. Fazer tuning sistemático de concurrency.
16. Runtime validation dos envelopes internos.
17. RPO/restore/game-day drills.

---

## P2 — hardening contínuo

18. HMAC dos IPs usados em rate limit.
19. Reduzir vulnerabilities de produção.
20. Recompactar continuamente o contexto.
21. FinOps real por tenant.
22. DSR automation.
23. Crypto-shredding dedicado quando justificado.

---

# 10. Mudança sugerida no Definition of Done

A sequência recente mostrou que "E2E" precisa ser qualificado.

Sugestão de estados:

```text
DESIGNED
↓
IMPLEMENTED
↓
UNIT TESTED
↓
INTEGRATION TESTED
↓
MOCKED BROWSER E2E
↓
DEPLOYED
↓
REAL SYSTEM E2E
↓
OPERATIONALLY PROVEN
↓
USER VALIDATED
```

Regra adicional:

> **Uma feature que atravessa fronteiras de infraestrutura só pode receber `REAL SYSTEM E2E` quando as dependências reais do ambiente forem exercitadas.**

Mocks continuam úteis, mas não substituem evidência real de:

- CloudFront;
- Cognito;
- API Gateway;
- S3;
- CORS/CSP;
- cookies;
- provider externo;
- filas;
- Step Functions;
- callbacks.

---

# 11. Ordem sugerida para a IA engenheira

A próxima IA que assumir o projeto deveria trabalhar nesta ordem:

```text
1. CSP/CORS / upload architecture
2. GuestSession binding
3. DocumentRequestSeries invariant
4. ReminderPolicy invariant
5. Real System E2E foundation
6. Aggregate CI required gate
7. WhatsApp opt-in/E2E
8. RequestContext fast path
9. Reminder Producer
10. Capacity Model v2
11. Load test program
12. Frontend code splitting
13. Generated queue inventory
14. Coverage policy
15. Remaining hardening
```

---

# 12. Diretriz de execução recomendada

Para cada item P0/P1:

1. Confirmar o HEAD atual antes de agir.
2. Ler decisão/ADR/documentação normativa relacionada.
3. Verificar se o gap ainda existe no código real.
4. Para decisão arquitetural nível 5–6, executar Claude↔Codex.
5. Implementar.
6. Adicionar testes.
7. Rodar o gate local completo aplicável.
8. Deployar em `dev` quando necessário.
9. Executar evidência real, não apenas mocks.
10. Atualizar:
   - decisions-log;
   - NEXT_SESSION_PROMPT;
   - documentos normativos afetados;
   - Definition of Done/evidence state.
11. Só então marcar como concluído.

---

# 13. Conclusão

O Expiration Tracker está hoje muito mais próximo de um produto profissional do que de uma prova de conceito.

Apesar do volume enorme de implementações recentes, **não foi observada degradação generalizada da arquitetura central**.

Não foram encontrados sinais de:

- spaghetti architecture;
- abandono de tenant isolation;
- writes indiscriminados sem OCC;
- atalhos generalizados em idempotência;
- permissões cross-tenant óbvias;
- colapso de modularidade;
- "AI code slop" generalizado.

Os principais problemas atuais são concentrados e tratáveis.

Os quatro mais importantes são:

```text
1. upload real bloqueado por CSP/CORS
2. identidade contextual de GuestSession
3. invariantes de unicidade em recurrence/reminders
4. ausência de E2E realmente integrado à AWS
```

Do ponto de vista de world-class engineering, continuam como principais dívidas:

```text
RequestContext hot path
Reminder Producer
Capacity Model v2
Load testing real
```

### Recomendação principal

**Não continuar expandindo cegamente o frontend antes de fechar CSP/CORS e GuestSession binding.**

Esses dois problemas já afetam jornadas consideradas implementadas e aumentariam retrabalho caso mais telas sejam construídas sobre fluxos que ainda não funcionam integralmente no ambiente real.

---

## Estado recomendado do projeto após esta auditoria

```text
Arquitetura central: FORTE
Backend: MADURO
Multi-tenancy: MUITO FORTE
Document lifecycle: FORTE
Frontend: AVANÇADO
CI: FORTE, GATE INCOMPLETO
Performance: BOA, NÃO PROVADA EM ESCALA
Operabilidade: INTERMEDIÁRIA/AVANÇADA
Pilot readiness: CONDITIONAL GO
```

### Condição para transformar em GO

Fechar prioritariamente:

```text
CSP/CORS
GuestSession binding
Series uniqueness
ReminderPolicy cardinality
Real System E2E
CI aggregate gate
```

Depois disso, o projeto estará em posição muito mais defensável para iniciar piloto com clientes reais.

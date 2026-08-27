# Expiration Tracker — Plano Mestre dos Próximos Dias + Prompt para IA Engenheira

> **Objetivo deste arquivo:** servir como handoff para uma nova sessão da IA engenheira, consolidando as próximas frentes do Expiration Tracker após a forte evolução recente do repositório.
>
> **Repositório:** `https://github.com/marcelo-jgoncalves/expiration-tracker`
>
> **Branch base:** `develop`
>
> **Data-base desta consolidação:** 2026-08-27
>
> **Observação crítica:** o estado do repositório muda rapidamente. Este arquivo define prioridades e regras de trabalho, mas a IA deve confirmar o estado real de `develop` antes de assumir qualquer tarefa como pendente ou concluída.

---

# Parte I — Ideia geral para os próximos dias

## 1. Mudança de fase do projeto

O Expiration Tracker já não está numa fase em que o principal risco é “falta de feature”.

O projeto já possui, em graus diferentes de maturidade:

```text
arquitetura de domínio
infraestrutura AWS
CI/CD
observabilidade
Full BFF
autenticação
frontend real
Core Expiration Vertical Slice
reminder pipeline
document workflows
guest workflows
OCR/extraction M7
Visual Language + Design System
testes adversariais
Claude↔Codex
```

Portanto, a recomendação é que os próximos dias sejam tratados como um:

# **Consolidation + Pilot Readiness Program**

e NÃO como:

```text
nova sequência de grandes features
```

A prioridade deve mudar de:

```text
“o que mais podemos construir?”
```

para:

```text
“o que ainda impede este produto de ser colocado com segurança nas mãos dos primeiros clientes?”
```

---

# 2. Princípios do programa

## P1 — Nenhuma nova grande feature sem reduzir um risco concreto

Priorizar:

```text
correctness
operational evidence
privacy
tenant isolation
identity/admin
frontend consistency
documentation truth
pilot readiness
```

antes de:

```text
billing completo
novos canais
novos dashboards
novas automações
novas integrações
features cosméticas
```

## P2 — User Validation permanece pausada, não cancelada

User Validation continua sendo necessária.

Porém, enquanto não há disponibilidade para organizar participantes, ela NÃO bloqueia:

```text
hardening técnico
LGPD readiness
tenant isolation
operational drills
Design System rollout
RBAC/admin foundations
GTR-01
documentação
```

O projeto deve avançar de maneira que o trabalho permaneça útil mesmo depois de User Validation.

## P3 — Design System pode evoluir sem virar “Final Design”

A direção atual conhecida no repositório é:

```text
Operational Calm
Remindax-inspired
```

com status:

```text
APPROVED AS VISUAL LANGUAGE + DESIGN SYSTEM FOUNDATION
— PROVISIONAL PENDING USER VALIDATION
```

Essa condição deve continuar verdadeira.

O Design System pode ser refinado, normalizado, aplicado, testado, migrado e documentado, mas não deve ser chamado de `FINAL DESIGN SYSTEM`, `USER-VALIDATED` ou `FINAL HIGH-FIDELITY UI` sem evidência real.

---

# 3. Ordem recomendada de execução

Minha sugestão é trabalhar em **6 waves pequenas**, mergeáveis e verificáveis:

```text
WAVE 0 — State & Documentation Reconciliation
        ↓
WAVE 1 — Design System Reconciliation + Frontend Conformance
        ↓
WAVE 2 — Operational / M7 / Recovery Evidence
        ↓
WAVE 3 — Privacy + LGPD + Tenant Isolation Readiness
        ↓
WAVE 4 — Identity / Organization / Admin / RBAC Readiness
        ↓
WAVE 5 — GTR-01 + Guest Trust Readiness
        ↓
WAVE 6 — Pilot Readiness Gate Review
```

Essas waves podem ter algum paralelismo técnico quando não alterarem os mesmos arquivos, mas cada uma deve possuir PR e Definition of Done próprios.

---

# 4. WAVE 0 — State & Documentation Reconciliation

## Objetivo

Antes de abrir novas frentes, determinar o estado real do projeto.

Há histórico de drift entre `docs/architecture/README.md`, `docs/frontend/README.md`, `NEXT_SESSION_PROMPT.md`, README da raiz, documentos históricos e código real.

### Entregas

1. verificar `develop`;
2. identificar PRs abertas;
3. verificar deploy `dev`;
4. verificar quais blockers estão realmente fechados;
5. verificar status real de M7;
6. verificar Design System mais recente;
7. corrigir documentação corrente stale;
8. preservar documentos históricos como históricos;
9. atualizar painel/status se existir;
10. produzir backlog dos próximos milestones.

### Gate

Nenhuma task deve ser carregada para as Waves seguintes apenas porque um documento antigo diz que ela está pendente.

---

# 5. WAVE 1 — Design System Reconciliation + Frontend Conformance

## Objetivo

O Design System foi aprimorado recentemente. A tarefa não é redesenhá-lo de novo. É reconciliar as definições mais recentes com o frontend real e garantir conformidade consistente.

### 5.1 Descobrir a fonte vigente

Localizar tokens atuais, components atuais, CSS foundations, Visual Language document, Design System decisions, latest commits, visual tests e screenshots.

Se houver definições mais recentes que `docs/frontend/visual-language-and-design-system.md`, usar a fonte mais atual conforme a hierarquia de autoridade de `AGENTS.md`.

### 5.2 Audit de conformidade

Para cada surface de PRODUÇÃO atualmente existente — Overview, Expiration Collection, Expiration Detail, Create, Renew e qualquer nova surface real adicionada posteriormente — verificar:

```text
semantic tokens
typography
spacing
surface treatment
status
urgency
forms
buttons
notices
errors
loading
empty state
responsive behavior
focus
contrast
target size
icons
table/list semantics
```

### 5.3 Não migrar prototype-only screens automaticamente

```text
production surface exists
→ adapt to Design System

prototype-only surface
→ leave until its real vertical slice is implemented or User Validation demands it
```

### 5.4 Token migration

Se o Design System refinado tiver tokens renomeados, substituídos, novos semantic aliases ou tokens deprecated, criar uma matriz:

```text
old token
→ new token
→ usage sites
→ migration status
```

Eliminar duplicações e dead tokens quando seguro.

### 5.5 Source of truth visual

Evitar hard-coded hex, arbitrary px, feature-local variants e duplicated status mapping.

Preferir semantic token + shared primitive + small feature composition.

### 5.6 Epistemic Integrity visual

Garantir que nenhuma melhoria visual reintroduza:

```text
CLEAN = aprovado
SATISFIED = em dia
scheduled = delivered
UNKNOWN_OUTCOME = failed
```

### 5.7 Remindax direction

Preservar `Operational Calm + Remindax-inspired atmosphere + identidade própria`, verificando light surfaces, low visual noise, moderate density, clear hierarchy, restrained accent e professional SaaS appearance, sem copiar layout, paleta, componentes ou assets do Remindax.

### 5.8 Visual regression

Revalidar desktop, mobile, dense collection, form validation, OCC, UNKNOWN_OUTCOME, focus e long text.

Nunca atualizar snapshot cegamente.

### 5.9 Accessibility

Reexecutar keyboard, focus, zoom 200%, narrow viewport, contrast, status without color, forms, reduced motion e forced colors quando prático.

Planejar smoke com leitor de tela real antes do Pilot.

### Status final

```text
APPROVED AS DESIGN SYSTEM RECONCILIATION + PRODUCTION CONFORMANCE
— PROVISIONAL PENDING USER VALIDATION
```

---

# 6. WAVE 2 — Operational / M7 / Recovery Evidence

## Objetivo

Transformar `design + code + automated tests` em `evidence in real AWS behavior`.

### 6.1 M7 E2E real

Provar em `dev`:

```text
clean document
→ ExtractionStarter
→ Step Functions
→ Textract
→ parser
→ Bedrock if enabled
→ validation
→ persisted result
```

e também degraded paths.

### 6.2 Feature gate

Provar:

```text
gate off
→ zero unintended real traffic

gate on
→ expected traffic only
```

### 6.3 Happy-path real

Não aceitar apenas Lambda unit tests, Terraform plan ou Step Functions validation. Executar documento real/sintético em ambiente `dev`.

### 6.4 Degraded paths

Provar, quando aplicáveis:

```text
Textract failure
Bedrock failure
validation failure
timeout
malformed extraction
duplicate event
retry
DLQ
```

### 6.5 Reminder pipeline drill

Executar:

```text
policy
→ materialization
→ occurrence
→ dispatch
→ provider
→ persisted outcome
```

incluindo falha/retry.

### 6.6 DLQ / replay drill

Para filas críticas:

```text
inject controlled failure
→ DLQ
→ alarm
→ runbook
→ safe replay
```

Provar que replay não duplica side effects.

### 6.7 Restore drill

Executar restore real conforme `disaster-recovery.md`, medindo RPO observed, RTO observed, passos manuais/automáticos e gaps.

### 6.8 Load test

Executar carga realista em ambiente apropriado e validar API, DynamoDB, queues, workers, BFF e frontend critical reads contra SLO/capacity model.

### 6.9 Credential compromise drill

Executar exercício:

```text
credential leak
→ detect
→ revoke
→ rotate
→ investigate
→ document
```

sem expor credenciais reais.

### 6.10 Alarm validation

Para alarmes críticos, não basta existir Terraform. Provar que disparam.

### Status esperado

```text
OPERATIONAL EVIDENCE PACKAGE COMPLETE
```

Não promover `Operational Architecture` para APPROVED se os gates normativos ainda não forem satisfeitos.

---

# 7. WAVE 3 — Privacy + LGPD + Tenant Isolation Readiness

## Objetivo

Preparar o sistema para armazenar documentos empresariais que podem conter dados pessoais reais.

LGPD não exige infraestrutura dedicada por cliente. O modelo shared multi-tenant continua válido desde que isolamento, segurança, governança e direitos sejam provados.

### 7.1 Tenant isolation — threat model executável

Criar/verificar testes negativos de:

```text
Tenant A → item Tenant B
Tenant A → document Tenant B
Tenant A → submission Tenant B
Tenant A → presigned URL Tenant B
Tenant A → requirement Tenant B
Tenant A → reminder Tenant B
Tenant A → import/export Tenant B
Tenant A → extraction result Tenant B
```

Todos devem falhar.

### 7.2 Tenant context

Confirmar que `tenantId` não vem confiavelmente do browser, é derivado do contexto autenticado/autorizado e é propagado para persistence, events, queues e idempotency.

### 7.3 DynamoDB

Auditar PK/SK, GSIs, queries, batch operations e conditional writes para cross-tenant exposure.

Nenhuma query tenant-scoped deve depender apenas de filtragem pós-query.

### 7.4 S3

Auditar object key, presigned URL, KMS, quarantine, clean bucket e extraction transient.

Tenant A nunca deve conseguir gerar URL para objeto de Tenant B.

### 7.5 Async boundaries

Mensagens SQS/EventBridge/Step Functions devem carregar tenant context apropriado. Workers precisam validar esse contexto antes de side effects.

### 7.6 Logs

Verificar redaction real para CPF, email, document identifiers, tokens, guest secrets, OCR text e extracted personal data.

Nenhum `EXTRACTION_TRANSIENT` deve cair em logs/traces/DLQ.

### 7.7 Retention implementation

Verificar em código o suporte real às classes de retenção definidas no design, como:

```text
ACCOUNT_ACTIVE
CORE_USER_DATA
USER_DOCUMENT
LEGAL_EVIDENCE
DELIVERY_RECORD
TRANSIENT
SECURITY_AUDIT
QUOTA_TELEMETRY
EXTRACTION_TRANSIENT
```

Implementar o que estiver faltando para `retentionClass`, `purgeAfter`, `legalHold` e purge worker quando já autorizado pelo design normativo.

### 7.8 DSR — Data Subject Requests

Verificar implementação real de access/export/deletion.

Se ainda for design-only, criar milestone separado antes de Pilot com dados pessoais reais.

### 7.9 Deletion propagation

Excluir deve considerar DynamoDB, S3, indexes, derived data, notifications, links, extraction artifacts e providers, com idempotência.

### 7.10 Restore after deletion

Provar política de restore → denylist/tombstone → post-restore purge, se isso estiver no design atual.

### 7.11 Região AWS

Inventariar current region, Cognito, DynamoDB, S3, KMS, Textract, Bedrock/model, CloudWatch, backups e providers.

Registrar data residency, service availability, cross-region behavior, cost, latency e legal implication.

### 7.12 Transferência internacional

Especial atenção para Bedrock, Textract, email provider e future subprocessors.

Produzir inventário técnico. A validação jurídica final é humana.

### 7.13 Subprocessor register

Criar/atualizar tabela com provider, service, purpose, data category, region/country, retention, encryption, subprocessor role e DPA status.

### 7.14 RIPD readiness

A IA pode preparar inventário, template, mapear riscos, medidas e fluxos, mas não pode fingir legal approval, DPO approval, RIPD approval ou DPA signature.

### 7.15 DPA / privacy documentation

Preparar checklist técnico para Terms, Privacy Notice, Data Processing Agreement, Subprocessor list, Security appendix, Incident notification e Deletion/retention.

### 7.16 Incident response privacy

Runbook deve incluir cross-tenant exposure, document leak, wrong presigned URL, compromised guest token e OCR/log leakage.

### Status esperado

```text
TECHNICAL LGPD + TENANT ISOLATION READINESS COMPLETE
— LEGAL SIGN-OFF PENDING
```

---

# 8. WAVE 4 — Identity / Organization / Admin / RBAC Readiness

## Objetivo

Autenticação já está madura. O próximo problema é como clientes empresariais terão múltiplos usuários, admins e permissões dentro do mesmo tenant.

Há design de Organization/Membership/RBAC, mas não assumir implementação sem verificar o código atual.

### 8.1 Separar dois tipos de admin

#### Tenant Admin

Administrador de uma empresa cliente. Pode convidar usuários, remover usuário, atribuir role e administrar configuração da própria organização.

#### Platform Staff / Platform Admin

Equipe que administra a plataforma Expiration Tracker. Pode possuir algum tipo de acesso cross-tenant.

Esses modelos têm riscos completamente diferentes.

### 8.2 Tenant Admin primeiro

Para Pilot B2B, priorizar Organization, Membership, Invitation, roles, role binding e tenant switching se aplicável, antes de um painel super-admin.

### 8.3 Roles

Verificar modelo aprovado. Não inventar permissões com base apenas em nomes como OWNER/MEMBER/VIEWER sem conferir os documentos vigentes.

### 8.4 Permission-based authorization

Preferir autorização por capacidade/permissão real. Evitar lógica espalhada como `if role === "ADMIN"` quando matriz de autorização já existe.

### 8.5 Invite lifecycle

Cobrir invite, expiry, accept, revoke, duplicate invite, account already exists e account does not exist.

### 8.6 Removal

Remover membership não deve apagar organization data nem deixar sessão com acesso antigo.

### 8.7 Role change

Mudança de role deve refletir autorização rapidamente e de maneira segura. Verificar cache/session claims.

### 8.8 Tenant migration

Se o estado real ainda for `tenantId = userId` e o B2B exigir `tenantId = organizationId`, tratar a transição como Type 1/arquitetural.

Não codificar silenciosamente.

### 8.9 Platform Staff

O repositório já registrou anteriormente ausência de conceito maduro de platform staff cross-tenant.

Não inventar “super admin” genérico.

Antes de implementar, responder por que precisamos, quais ações, qual auditoria, qual aprovação, qual break-glass e qual acesso a documentos.

### 8.10 Support access

Se necessário no futuro, preferir mecanismo altamente auditado:

```text
support session
explicit tenant
time limited
reason required
audit event
least privilege
```

### 8.11 Admin UI

Só implementar frontend admin depois dos contratos e autorização estarem fechados, aplicando o Design System vigente.

### Status esperado

```text
APPROVED AS TENANT IDENTITY + ADMIN + RBAC FOUNDATION
```

Platform staff pode permanecer deferred se não for necessário para Pilot.

---

# 9. WAVE 5 — GTR-01 + Guest Trust Readiness

## Objetivo

Antes de qualquer piloto com fornecedores/terceiros reais, resolver `GTR-01`.

O guest precisa saber quem está pedindo, o que está pedindo, por que e qual prazo.

### 9.1 Requester identity

Backend real deve fornecer identidade confiável da organização solicitante.

Não usar string fixa do protótipo.

### 9.2 Anti-phishing

Guest flow deve apresentar organization identity, request context, document requirement, deadline e safe origin/domain sem expor informação que permita enumeration.

### 9.3 Anti-enumeration

Preservar comportamento unificado para invalid/expired/revoked/not found quando isso fizer parte da política vigente.

### 9.4 Guest privacy

Guest não deve receber dados internos desnecessários do tenant.

### 9.5 Design System

Adaptar guest surface ao Visual Language vigente, preservando `trust > visual flourish`.

### 9.6 Mobile

Guest flow deve ser excelente em mobile.

### Status esperado

```text
APPROVED AS GUEST TRUST + REQUESTER IDENTITY FOUNDATION
GTR-01 RESOLVED
```

---

# 10. WAVE 6 — Pilot Readiness Gate Review

Depois das waves anteriores, criar uma revisão única de readiness.

## 10.1 Gate categories

### Product

```text
core workflow usable
reminders real
document workflow real
guest workflow if in pilot
```

### Identity

```text
login
tenant
membership/admin if B2B
```

### Security

```text
tenant isolation
IAM
KMS
session
guest tokens
```

### Privacy

```text
retention
DSR
region
subprocessors
RIPD readiness
```

### Operations

```text
alarms
runbooks
restore
DLQ
replay
load
rollback
```

### Frontend

```text
Design System conformance
a11y
mobile
error/recovery
```

### Documentation

```text
current state consistent
deployment instructions current
runbooks executable
```

## 10.2 Pilot classifications

```text
READY
READY WITH EXPLICIT LIMITATION
NOT READY
NOT APPLICABLE
```

## 10.3 Controlled Pilot

O primeiro Pilot pode ter escopo deliberadamente menor.

Hipótese a avaliar:

```text
Vencimentos
Reminders
Documents
Internal Operator
```

e excluir temporariamente M7 AI extraction, Guest external workflow, billing automation ou platform staff se isso acelerar aprendizado sem comprometer segurança.

---

# Parte II — Prompt para a IA Engenheira

# 11. Missão

Atue como **Principal Software Architect / Principal Product Engineer / Security Engineer / SRE / Frontend & Design Systems Engineer / Privacy Engineering Lead** responsável por organizar e executar o próximo programa de consolidação do Expiration Tracker.

Repositório:

```text
https://github.com/marcelo-jgoncalves/expiration-tracker
```

Branch base:

```text
develop
```

Sua missão NÃO é abrir imediatamente outra grande feature.

Sua missão é:

> **reconciliar o estado atual do repositório, atualizar o backlog real e conduzir o projeto em milestones pequenos rumo a Pilot Readiness.**

---

# 12. Resultado esperado da primeira sessão

Na primeira sessão desta missão:

```text
repository reconnaissance
↓
state reconciliation
↓
backlog update
↓
dependency map
↓
priority map
↓
execute the highest-priority bounded milestone
```

Não tente implementar todas as Waves num único PR.

---

# 13. Documento canônico do programa

Criar:

```text
docs/engineering/pilot-readiness-program.md
```

ou caminho mais apropriado segundo a organização atual do repositório.

Se já existir mecanismo canônico equivalente, usar o existente e não criar backlog concorrente.

Cada item precisa conter:

```text
ID
Wave
Title
Problem
Evidence
Current state
Desired state
Dependencies
Risk
Priority
User/Pilot impact
Implementation status
Verification
PR
Final status
```

---

# 14. Primeiro ato obrigatório — ler AGENTS.md

Leia integralmente `AGENTS.md` antes de qualquer alteração.

Também revisar, no mínimo:

```text
ARCHITECTURE.md
NEXT_SESSION_PROMPT.md
docs/architecture/README.md
docs/frontend/README.md
docs/architecture/privacy-lgpd.md
docs/architecture/threat-model.md
docs/architecture/disaster-recovery.md
docs/architecture/incident-runbooks.md
docs/architecture/slo.md
docs/architecture/capacity-model.md
docs/frontend/interface-quality-standard.md
docs/frontend/visual-language-and-design-system.md
docs/frontend/core-expiration-vertical-slice.md
docs/frontend/frontend-production-foundation.md
docs/architecture/roadmap-evolution/05-domain-model-organization-billing.md
```

e qualquer documento mais recente que os superseda.

---

# 15. Código é fonte primária de implementação

Para saber se algo existe, inspecione código, tests, Terraform, CI e deploy.

Não marque tarefa como concluída só porque um documento afirma isso.

Não marque como pendente só porque documento histórico afirma isso.

---

# 16. Git/deploy baseline

Antes de qualquer mudança:

```bash
git status
git branch --show-current
git log -10 --oneline
git pull
```

Verificar PRs abertas e branches relevantes.

Quando credenciais e política permitirem, verificar ambiente `dev`.

Nunca violar política de deploy/Terraform do repo.

---

# 17. Autonomia operacional

O agente principal possui autonomia para:

```text
create branch
edit code
edit docs
run tests
create tests
commit
push
open PR
review
fix
merge
update develop
cleanup merged branches
```

sem pedir autorização intermediária.

Interromper apenas quando houver missing credentials, permission denied, required legal decision, business decision sem regra aprovada, destructive operation com impacto incerto, external human approval ou risco a trabalho não relacionado.

---

# 18. Subagentes

A autonomia pertence ao agente principal.

Por padrão:

```text
RESEARCH fork        → READ-ONLY
RECONNAISSANCE fork  → READ-ONLY
CODE REVIEW fork     → READ-ONLY
CODEX fork           → READ-ONLY
```

Só `IMPLEMENTATION` explicitamente delegado pode escrever.

---

# 19. Claude↔Codex

Milestones relevantes devem seguir o protocolo do projeto:

```text
Round A — Claude
Round B — Codex adversarial
Round C — Reconciliation
Round D — Fresh verification
```

Continue E/F/... se houver achados novos relevantes.

Use processo proporcional ao risco conforme `AGENTS.md`; não transformar mudança mecânica trivial em revisão máxima se o padrão do repo não exigir.

---

# 20. Finding discipline

Todo finding real deve conter:

```text
Evidence
Severity
Root cause
Fix
Regression test
```

---

# 21. Wave 0 primeiro

Antes de escolher código novo, resolver:

```text
documentation drift
status drift
unknown open PRs
unknown deploy state
unknown latest Design System definition
```

---

# 22. Design System reconciliation

Se o Design System foi alterado depois do documento atualmente conhecido, não tentar voltar à versão anterior.

Usar a definição mais recente aprovada e criar migração de conformidade.

Visual work NÃO pode alterar silenciosamente journey, information architecture, domain semantics, business rule ou state meaning.

---

# 23. Design conformance gates

Para surfaces reais, exigir:

```text
semantic tokens
contrast
focus
mobile
long content
density
status semantics
forms
errors
loading
visual regression
```

---

# 24. Privacy gates

Qualquer mudança envolvendo documento, OCR ou tenant precisa perguntar:

```text
Can another tenant access it?
Can it leak to logs?
How is it deleted?
How long is it retained?
What region processes it?
Does a subprocessador see it?
```

---

# 25. Tenant isolation gates

FAIL se tenant ID for aceito cegamente do request, se cross-tenant key puder ser construída, se presigned URL cruzar tenant, se worker confiar em message sem scope ou se cache/idempotency key não for tenant-scoped.

---

# 26. Operational gates

FAIL se critical workflow puder falhar silenciosamente, não tiver alarm, não tiver replay/recovery ou depender de restore nunca testado.

---

# 27. Identity gates

FAIL se role change deixar privilégio stale indefinidamente, tenant admin puder cruzar tenant, removed member mantiver acesso, invite puder ser replayado ou platform admin virar bypass não auditado.

---

# 28. GTR-01

Se external guest flow fizer parte do Pilot, GTR-01 é bloqueante.

---

# 29. User Validation stays paused

Não iniciar participant recruitment, interviews ou user sessions até nova instrução explícita do usuário.

Preservar hypotheses pendentes.

---

# 30. No new large feature by default

Durante este programa, qualquer nova capacidade grande precisa provar que bloqueia Pilot ou fecha risco crítico de security/privacy/operations.

Caso contrário:

```text
DEFER
```

---

# 31. M7

Antes de adicionar mais IA, provar o pipeline atual E2E.

Não aumentar complexidade antes de evidência operacional.

---

# 32. Design System scope

Ajustar todas as surfaces reais existentes.

Não implementar prototype-only surfaces apenas para completar o visual.

---

# 33. Operational evidence

Resultados de drills devem registrar:

```text
date
environment
scenario
expected
observed
metrics
failures
recovery
follow-up
```

---

# 34. Production evidence vs design

Nunca escrever `PROVEN` quando só há `DESIGNED`, `UNIT TESTED` ou `PLAN VALIDATED`.

---

# 35. Quality target

Usar os standards existentes.

Não criar score novo sem necessidade.

Onde existir threshold `>= 9.0`, preservar conforme documento normativo.

---

# 36. PR discipline

Cada Wave ou sub-milestone deve gerar PR pequeno o suficiente para revisão real.

Evitar PR misturando Design System migration, DSR, Organization/RBAC e M7 recovery ao mesmo tempo.

Sequência inicial possível:

```text
PR-A — Current-state/docs reconciliation
PR-B — Design System conformance rollout
PR-C — M7 E2E operational evidence fixes
PR-D — operational drills / guardrails
PR-E — LGPD tenant-isolation technical gaps
PR-F — DSR/retention if separate
PR-G — Organization/Membership/RBAC foundation
PR-H — GTR-01
```

Adaptar ao estado real.

---

# 37. Definition of Done por frente

## Design System

```text
existing behavior preserved
visual/a11y tests pass
screens inspected
dense dataset works
mobile works
no semantic regression
docs updated
Codex passes
```

## Privacy

```text
tenant negative tests exist
storage scope verified
async scope verified
logging verified
retention truth documented
known legal tasks separated
```

## Operations

```text
real environment evidence exists
failure path exercised
alarm/recovery works
runbook matches reality
```

## Identity/RBAC

```text
tenant boundaries explicit
role matrix explicit
invite lifecycle tested
removal/revocation tested
session/auth interaction tested
audit events present
```

---

# 38. Documentation governance

Depois de cada milestone, atualizar apenas current-state docs:

```text
NEXT_SESSION_PROMPT.md
relevant README/index
project-status panel if applicable
```

Não reescrever documentos históricos.

`check-docs` não substitui semantic verification.

---

# 39. CI / Merge

Não mergear enquanto checks relevantes estiverem vermelhos.

CI-only bugs são findings reais.

Quando todos os gates estiverem satisfeitos, fazer merge automaticamente conforme a política do repositório.

Depois:

```bash
git checkout develop
git pull
git status
```

e smoke tests pertinentes.

---

# 40. Backlog update

Após cada merge, marcar cada item como:

```text
DONE
PARTIAL
BLOCKED
DEFERRED
```

com evidência e PR.

---

# 41. Pilot scope recommendation

Ao chegar à Wave 6, não assumir que todo recurso precisa entrar no primeiro piloto.

Uma hipótese razoável a avaliar:

```text
Core Expirations
+
Reminders
+
Documents
+
one company/tenant
+
small number of users
```

com M7 optional/off, Guest optional, Billing manual/off e Platform Admin deferred se isso reduzir risco.

---

# 42. Final deliverable do programa

Criar:

```text
docs/engineering/pilot-readiness-assessment.md
```

com:

```text
Executive Summary
Pilot Scope
Technical Gates
Security
Tenant Isolation
LGPD
Identity/RBAC
Operations
Frontend/Design System
Known Limitations
Legal/Human Actions
Evidence
GO / CONDITIONAL GO / NO-GO
```

---

# 43. Status final esperado

O objetivo dos próximos dias não é forçar:

```text
PUBLIC PRODUCTION READY
```

O objetivo é chegar honestamente a:

```text
TECHNICALLY READY FOR CONTROLLED PILOT
— WITH EXPLICIT PRODUCT/LEGAL LIMITATIONS
```

ou identificar exatamente o que ainda impede esse status.

---

# 44. Pergunta obrigatória ao final de cada Wave

> **Esta Wave reduziu um risco real para o primeiro cliente, ou apenas aumentou a quantidade de software?**

Se a resposta for a segunda, reavaliar escopo.

---

# 45. Princípio final

O Expiration Tracker já provou que consegue construir software sofisticado.

A prioridade agora é provar que esse software é:

```text
safe
isolated
recoverable
observable
legally preparable
administrable
consistent
usable
pilotable
```

com a menor complexidade adicional possível.

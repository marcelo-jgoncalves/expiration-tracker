# BLOCKER-B — Mission Brief (texto original, verbatim)

> Este arquivo é uma cópia literal do prompt de missão recebido do Marcelo na sessão de 2026-08-24 que iniciou o trabalho em BLOCKER-B. Persistido aqui porque o texto original só existia no histórico de conversa de uma sessão específica — uma sessão nova (outra máquina/conta) não tem acesso a esse histórico. Ver `docs/architecture/blocker-b-recon-handoff.md` para o estado de reconhecimento/gap analysis já produzido a partir deste brief. Não editar o conteúdo abaixo para "atualizar" — é um registro do pedido original; mudanças de escopo/decisão vão no handoff ou em ADR, não aqui.

---

# Missão

Atue como **Principal Backend Engineer / Cloud Engineer / Software Architect / SRE / Product Engineer** responsável por resolver de forma definitiva o próximo blocker crítico do **Expiration Tracker**:

# **BLOCKER-B — End-to-End Reminder Delivery**

Repositório:

```text
https://github.com/marcelo-jgoncalves/expiration-tracker
```

Branch principal de desenvolvimento:

```text
develop
```

A missão é transformar o atual suporte a `ReminderPolicy` em um pipeline realmente funcional de produção:

```text
ExpirationItem
      ↓
ReminderPolicy
      ↓
materialização
      ↓
Reminder
      ↓
scheduler / dispatcher
      ↓
delivery
      ↓
result
      ↓
retry / failure handling
      ↓
observability
```

O objetivo é que a aplicação possa sustentar honestamente a promessa:

> **"Cadastre um vencimento e o sistema poderá avisá-lo antes da data."**

Sem simulações, sem estados falsamente positivos e sem depender de execução manual invisível.

---

# 1. Contexto atual do projeto

O projeto já concluiu formalmente:

```text
Context / Task Model                         ✅
Conceptual Model + IA                        ✅
Semantic Integrity Amendment                ✅
Critical User Journeys                       ✅
Screen + State Inventory                     ✅
Low-Fidelity Wireframes                      ✅
Interaction Prototype                        ✅
Heuristic + Accessibility Evaluation         ✅
Validation Readiness                         ✅
Frontend Production Foundation               ✅
Full BFF                                     ✅
Core Expiration Production Vertical Slice    ✅
```

O milestone anterior terminou como:

```text
APPROVED AS CORE EXPIRATION PRODUCTION VERTICAL SLICE
```

O frontend real já possui:

```text
Expiration Collection
Expiration Detail
Create Expiration
Renew Expiration
```

integrados através de:

```text
React frontend
↓
Full BFF
↓
API
↓
Domain/Application layer
↓
Persistence
```

---

# 2. Estado conhecido dos blockers

Continuam conhecidos:

```text
BLOCKER-A
Document read/list observability
```

```text
BLOCKER-B
Reminder materialization / actual delivery
```

```text
BLOCKER-C
External document/compliance closure
```

```text
GTR-01
Guest requester identity
```

Esta missão é dedicada principalmente a:

# **BLOCKER-B**

Não expandir desnecessariamente para os demais blockers.

---

# 3. Por que BLOCKER-B é crítico

Hoje, salvar/configurar uma `ReminderPolicy` não deve ser interpretado automaticamente como:

```text
reminder scheduled
```

nem como:

```text
reminder guaranteed
```

O projeto adota como regra permanente:

# **Epistemic Integrity**

Portanto:

```text
ReminderPolicy saved
≠
Reminder materialized
≠
Reminder scheduled
≠
Reminder delivered
```

A missão é construir a cadeia real entre essas etapas e permitir que o sistema represente honestamente o estado de cada uma.

---

# 4. Objetivo do milestone

Ao final, deve existir um fluxo end-to-end real:

```text
ExpirationItem
↓
ReminderPolicy
↓
materialization
↓
scheduled reminder
↓
worker/dispatcher
↓
delivery attempt
↓
provider result
↓
success / retry / terminal failure
↓
observability
```

com:

```text
idempotency
retries
failure handling
concurrency safety
tenant isolation
security
observability
tests
```

---

# 5. Autonomia operacional obrigatória

Você deve trabalhar de forma **autônoma**.

Não esperar autorização do usuário para:

* inspecionar código;
* criar branch;
* alterar código;
* criar migrations;
* alterar Terraform;
* criar recursos AWS;
* criar testes;
* corrigir bugs encontrados;
* alterar documentação;
* executar Claude↔Codex;
* criar commits;
* fazer push;
* abrir PR;
* responder findings;
* atualizar PR;
* fazer merge;
* atualizar `develop`;
* remover branch após merge.

Fluxo esperado:

```text
inspect
↓
plan
↓
branch
↓
implement
↓
test
↓
Claude self-review
↓
Codex adversarial review
↓
reconcile
↓
regression
↓
commit
↓
push
↓
PR
↓
final review
↓
merge
↓
update develop
↓
final verification
```

Não interrompa para pedir aprovação intermediária.

---

# 6. Quando interromper

Somente interrompa se houver impedimento externo real:

```text
credentials unavailable
permission denied
branch protection requiring unavailable human approval
merge blocked externally
missing cloud/account access
risk of destroying unrelated work
irreconcilable external conflict
```

Dúvidas normais de implementação NÃO justificam interromper.

Faça a melhor decisão com base em:

```text
code
tests
architecture docs
ADRs
repository conventions
```

---

# 7. Regra para subagentes / forks

Autonomia operacional pertence ao **agente principal**.

Subagentes ou forks usados para:

```text
research
reconnaissance
review
Codex audit
```

são:

# **READ-ONLY por padrão**

Eles não podem:

```text
edit files
commit
push
open PR
merge
```

salvo delegação explícita do agente principal para uma tarefa de implementação claramente delimitada.

Especialmente:

```text
RESEARCH fork → read-only
RECONNAISSANCE fork → read-only
CODE REVIEW fork → read-only
CODEX fork → read-only
IMPLEMENTATION fork → write only if explicitly delegated
```

Não permitir que a autonomia global desta missão seja herdada automaticamente por forks auxiliares.

---

# 8. Respeitar AGENTS.md

Antes de qualquer alteração:

leia integralmente:

```text
AGENTS.md
```

Depois leia:

```text
docs/frontend/README.md
NEXT_SESSION_PROMPT.md
docs/architecture/README.md
```

e todos os documentos relevantes apontados por eles.

Se alguma instrução operacional deste prompt divergir explicitamente de `AGENTS.md`:

> siga `AGENTS.md`.

---

# 9. Verificar baseline

Antes de alterar:

```bash
git status
git branch --show-current
git log -5 --oneline
git pull
```

Confirmar:

```text
branch = develop
working tree clean
latest merged milestones present
```

Não sobrescrever trabalho externo.

---

# 10. Primeiro passo técnico — reconnaissance

Antes de decidir arquitetura, investigue o estado real de:

```text
ReminderPolicy
Reminder
scheduler
workers
queues
EventBridge
SQS
SNS
SES
email delivery
notification adapters
cron/event scheduling
retry infrastructure
DLQ
outbox/inbox patterns
idempotency store
observability
```

Determine exatamente:

```text
what exists
what is partially implemented
what is dead code
what is design-only
what is actually wired
```

Não confiar apenas em documentação histórica.

Código atual é fonte primária.

---

# 11. Investigue o domínio atual

Leia todas as entidades/serviços relevantes.

Entenda:

```text
ReminderPolicy fields
Reminder entity/state
ExpirationItem lifecycle
renewal semantics
archive semantics
timezone assumptions
tenant scope
scheduled date calculation
channels
recurrence behavior
```

Não redesenhar o domínio sem necessidade.

---

# 12. Identifique a lacuna exata

Documente explicitamente:

```text
Current State
Desired State
Missing Links
```

Exemplo conceitual:

```text
policy saved
↓
NO automatic materialization
↓
therefore no delivery
```

ou o fluxo real que o código revelar.

---

# 13. Não assumir arquitetura de scheduler

Não decidir automaticamente por:

```text
EventBridge Scheduler
EventBridge Rule
SQS delay
Lambda cron
Step Functions
DynamoDB polling
```

Primeiro descubra o que já existe.

Depois escolha a solução que melhor respeite:

```text
existing architecture
low operational cost
serverless model
scale needs
reliability
simplicity
AWS-native capabilities
side-business maintenance burden
```

---

# 14. Princípio de simplicidade operacional

Este é um micro-SaaS / side-business.

Não construir uma plataforma de notification orchestration de escala enterprise se o problema puder ser resolvido por algo muito menor.

Priorizar:

```text
correct
observable
cheap
simple
recoverable
```

sobre:

```text
maximally generic
multi-provider abstraction explosion
premature scale
```

---

# 15. Definir o source of truth

A arquitetura deve estabelecer claramente:

> Qual registro representa a intenção de lembrete?

e:

> Qual registro representa uma entrega real agendada?

e:

> Qual registro representa uma tentativa de entrega?

Evitar que um único status tente representar tudo.

---

# 16. Materialização

Implementar caminho real de:

```text
ReminderPolicy
↓
Reminder(s)
```

A materialização deve considerar:

```text
due date
lead time
timezone
policy state
item state
tenant
renewal cycle
archive state
```

---

# 17. Evitar duplicações

Materialização deve ser idempotente.

Rodar o processo duas vezes NÃO pode criar lembretes duplicados para:

```text
same item
same cycle
same policy
same intended occurrence
```

---

# 18. Idempotency identity

Definir uma identidade lógica clara, por exemplo conceitualmente:

```text
tenant
+
expiration item
+
cycle
+
policy
+
scheduled occurrence
```

Não copiar este formato cegamente.

Derive a chave correta do domínio real.

---

# 19. Renewal semantics

Renovar um vencimento cria um novo ciclo.

Verifique cuidadosamente:

```text
old cycle reminders
new cycle reminders
pending reminders
delivered reminders
future reminders
```

A renovação NÃO pode produzir reminders contraditórios entre ciclos.

---

# 20. Policy updates

Defina comportamento para:

```text
policy created
policy changed
policy disabled
policy deleted
```

Perguntas que precisam ser respondidas:

```text
Do future materialized reminders change?
Are they cancelled?
Recreated?
Versioned?
```

Não deixar comportamento implícito.

---

# 21. Expiration updates

Verifique o que acontece se:

```text
due date changes
item archived
item renewed
item deleted
```

Não entregar lembretes obsoletos.

---

# 22. Timezone

Timezone é crítico.

Identifique explicitamente:

```text
where due date lives
whether it is a date or timestamp
tenant/user timezone
scheduler timezone
UTC conversion
DST behavior if applicable
```

Não usar `new Date("YYYY-MM-DD")` de forma ingênua.

O projeto já encontrou bug real de timezone anteriormente.

Trate isso adversarialmente.

---

# 23. Delivery channel

Descubra o canal real atualmente previsto.

Pode ser:

```text
email
```

ou outro já definido.

Não adicionar automaticamente:

```text
WhatsApp
SMS
push
Telegram
```

se não estiverem aprovados.

Evitar product creep.

---

# 24. Provider

Se já existir provider escolhido:

use-o.

Se não existir:

faça decisão mínima e documentada.

Critérios:

```text
cost
reliability
AWS integration
simplicity
sandbox/testing
bounce/error visibility
```

---

# 25. Delivery abstraction

Pode existir uma interface conceitual:

```text
NotificationSender
```

ou equivalente.

Mas só crie abstração se:

```text
it simplifies tests
decouples provider
matches repository architecture
```

Não criar um framework de plugins.

---

# 26. Scheduler/dispatcher

A arquitetura precisa garantir que reminders vencidos sejam processados mesmo se:

```text
worker fails
deployment happens
temporary AWS error occurs
delivery provider is unavailable
```

Não depender de execução única irrepetível.

---

# 27. At-least-once vs exactly-once

Assuma realisticamente que infraestrutura distribuída tende a:

```text
at-least-once execution
```

Proteja side effects com idempotência.

Não afirmar `exactly once` sem prova real.

---

# 28. Delivery idempotency

Duas execuções do mesmo reminder NÃO devem gerar dois e-mails equivalentes inadvertidamente.

Defina:

```text
delivery attempt identity
```

e comportamento de replay.

---

# 29. Retry policy

Defina classes de erro:

```text
retryable
non-retryable
terminal
```

Exemplos conceituais:

```text
provider timeout → retry
temporary AWS failure → retry
invalid email → terminal
malformed request → terminal
```

Derive do provider real.

---

# 30. Backoff

Use backoff apropriado.

Evitar:

```text
tight retry loops
```

---

# 31. Maximum attempts

Defina limite explícito.

Depois do limite:

```text
terminal failure
```

ou:

```text
DLQ / manual intervention
```

conforme arquitetura.

---

# 32. DLQ

Se houver processamento assíncrono:

avaliar DLQ.

Se o padrão do projeto já usa DLQ:

reutilize.

---

# 33. Poison message

Um reminder permanentemente inválido não deve bloquear o restante da fila.

---

# 34. Failure state

O domínio/sistema precisa distinguir pelo menos semanticamente:

```text
scheduled
processing
delivered
failed-retryable
failed-terminal
```

ou modelo equivalente.

Não inventar estados se domínio atual já possuir melhores.

---

# 35. Não confundir delivery com acknowledgment

Para e-mail, por exemplo:

```text
provider accepted
≠
recipient read
```

e possivelmente:

```text
provider accepted
≠
mailbox delivered
```

Use o nível de certeza que o provider realmente fornece.

---

# 36. Epistemic Integrity

Preserve:

```text
Scheduled
≠ Delivered
```

```text
Provider accepted
≠ User read
```

```text
Retry scheduled
≠ Delivery guaranteed
```

---

# 37. Observability

BLOCKER-B não está resolvido se o sistema envia reminders mas ninguém consegue saber se o pipeline está funcionando.

Criar observabilidade suficiente.

---

# 38. Métricas mínimas

Avalie pelo menos:

```text
reminders materialized
reminders due
delivery attempts
delivery successes
delivery failures
retries
terminal failures
queue age
DLQ depth
worker errors
```

Adapte ao desenho real.

---

# 39. Alarmes

Criar alarmes úteis para:

```text
delivery failures
DLQ non-zero
worker errors
pipeline stopped
oldest pending reminder too old
```

Evitar alert fatigue.

---

# 40. Logging

Logs estruturados devem conter identificadores técnicos suficientes:

```text
tenantId
itemId
cycleId
reminderId
attemptId
```

quando seguros.

Nunca registrar:

```text
tokens
session cookies
email body containing sensitive data
secrets
```

---

# 41. Correlation

Propague IDs suficientes para reconstruir:

```text
policy
→ reminder
→ delivery attempt
```

---

# 42. Auditability

Quando uma entrega ocorrer, deve ser possível responder:

```text
What was scheduled?
When?
Why?
For which item?
Which policy caused it?
What happened?
```

---

# 43. Security

Verifique:

```text
tenant isolation
IAM least privilege
KMS
Secrets Manager / Parameter Store if applicable
queue permissions
scheduler permissions
provider credentials
```

---

# 44. IAM

Workers e schedulers devem ter apenas permissões necessárias.

Não usar:

```text
Resource: "*"
```

sem justificativa forte.

---

# 45. Multi-tenancy

Nenhum worker pode materializar ou enviar reminder de outro tenant por erro de query/chave.

Criar testes específicos.

---

# 46. Recipient identity

Descubra como o destinatário é determinado atualmente.

Não inventar:

```text
send to whoever created the item
```

sem contrato de domínio.

Se o produto ainda não possui destinatário formal suficiente, isso é um finding de domínio importante.

Resolva da forma mínima coerente com o modelo atual ou registre impedimento real.

---

# 47. Email/template content

Se e-mail for o canal:

use template simples.

Não fazer branding/high-fi agora.

Conteúdo mínimo deve dizer:

```text
what is expiring
when
context
safe link/action if applicable
```

---

# 48. Links em reminder

Se incluir links para app:

usar URL segura, configurada por ambiente.

Não incluir tokens sensíveis.

---

# 49. Unsubscribe/preferences

Não inventar unsubscribe global se o reminder é funcional/transacional e o domínio não prevê isso.

Mas respeite qualquer preference/disable já definida.

---

# 50. ReminderPolicy e delivery truth

Depois desta missão, a UI futura deve poder distinguir, se contratos permitirem:

```text
policy configured
reminder scheduled/materialized
delivery completed
delivery failed
```

Não é obrigatório implementar a UI completa neste milestone.

---

# 51. Escopo frontend

A prioridade é resolver BLOCKER-B backend/infrastructure end-to-end.

No frontend, faça apenas o mínimo necessário para integrar o comportamento real se já houver surface apropriada e madura.

Não criar um novo grande vertical visual.

---

# 52. Se implementar frontend nesta missão

Limite-se a algo como:

```text
configure reminder policy
show factual reminder state/history
```

somente se:

```text
contracts are real
UX docs already support it
scope remains controlled
```

---

# 53. Não fazer high-fi

Continua proibido cristalizar:

```text
brand
visual design
final design system
polish
animations
```

---

# 54. BLOCKER-B Definition

Antes de implementar, formalize a definição exata de "BLOCKER-B resolved".

Algo equivalente a:

```text
A persisted reminder policy can automatically cause
a real reminder occurrence to be created, scheduled,
processed and delivered through a production-capable path,
with idempotency, retry, failure handling and observability.
```

---

# 55. Não declarar BLOCKER-B resolvido parcialmente

Não considerar resolvido se apenas:

```text
Reminder records are generated
```

mas não entregues.

Nem se:

```text
emails can be sent manually
```

mas não agendados.

Nem se:

```text
scheduler exists
```

mas não há recovery/observability.

---

# 56. Reconciliação histórica

Leia documentos anteriores onde BLOCKER-B aparece.

Atualize status apenas após implementação completa.

Não alterar retrospectivamente documentos históricos que devam permanecer como registro do estado anterior.

---

# 57. Arquitetura de referência

Produza diagrama baseado no código real.

Exemplo conceitual:

```text
ExpirationItem
      │
      ▼
ReminderPolicy
      │
      ▼
Materializer
      │
      ▼
Reminder Store
      │
      ▼
Scheduler / Queue
      │
      ▼
Worker
      │
      ▼
Notification Provider
      │
      ▼
Delivery Result
```

Não use esse desenho se a arquitetura real melhor for diferente.

---

# 58. Materialization strategy

Avalie explicitamente duas classes de arquitetura:

### A. Materialização antecipada

```text
policy/item change
↓
future reminder records created
```

### B. Materialização just-in-time

```text
periodic scheduler
↓
find due policies/items
↓
create/send reminders
```

ou arquitetura híbrida.

Escolha com evidência.

---

# 59. Critérios da escolha

Considere:

```text
correctness
renewal behavior
policy changes
query cost
failure recovery
operational simplicity
idempotency
AWS costs
```

---

# 60. Não fazer polling caro

Se uma arquitetura exigir varredura frequente de toda a tabela:

questione custo e escalabilidade.

Use índices/partições apropriadas.

---

# 61. DynamoDB

Se reminders usam DynamoDB:

modelar queries a partir de access patterns reais.

Evitar Scan para hot path.

---

# 62. TTL

Não usar TTL como mecanismo preciso de scheduler.

DynamoDB TTL não garante execução pontual.

---

# 63. EventBridge Scheduler

Se considerar EventBridge Scheduler, avalie:

```text
per-reminder schedule cost
quotas
update/cancel behavior
operational simplicity
retry/DLQ support
```

Não escolhê-lo automaticamente.

---

# 64. Queue-based architecture

Se usar SQS:

avaliar:

```text
delay limits
visibility timeout
redrive
deduplication if FIFO
```

---

# 65. Cron/materializer

Se usar cron:

garantir que processamento seja:

```text
repeatable
idempotent
partitionable if needed
```

---

# 66. Backfill

A implementação deve considerar policies existentes antes do deploy.

Pergunta:

> O que acontece com ReminderPolicies já salvas?

Defina estratégia de:

```text
backfill
materialization
migration
```

---

# 67. Deploy safety

Evite que o primeiro deploy dispare subitamente milhares de reminders antigos ou vencidos.

Criar proteção para backfill.

---

# 68. Historical due reminders

Defina comportamento para reminder cujo intended delivery time já passou.

Possibilidades:

```text
skip
deliver immediately
within grace window
manual backfill
```

Escolha explicitamente.

---

# 69. Grace window

Se fizer sentido, documente uma janela de atraso aceitável.

Não inventar silenciosamente.

---

# 70. Exactly one logical notification

O principal invariant:

> Para uma mesma ocorrência lógica de reminder, falhas/retries não podem causar duplicação de comunicação ao usuário além do modelo explicitamente aceito.

Teste concorrência.

---

# 71. Race conditions

Codex deve atacar especialmente:

```text
two materializers
two workers
retry vs successful completion
policy update during delivery
renewal during materialization
archive during scheduled processing
```

---

# 72. Optimistic concurrency

Use OCC onde necessário.

Não sobrescrever estado novo com worker atrasado.

---

# 73. State transitions

Defina transições válidas.

Exemplo conceitual:

```text
SCHEDULED
→ PROCESSING
→ DELIVERED
```

ou:

```text
SCHEDULED
→ PROCESSING
→ RETRY_PENDING
→ PROCESSING
→ FAILED
```

Adapte ao domínio real.

---

# 74. Invalid transitions

Teste que:

```text
DELIVERED → PROCESSING
```

não ocorra indevidamente.

---

# 75. Provider timeout ambiguity

Se ocorrer timeout após chamada ao provider:

isso pode gerar:

```text
UNKNOWN_OUTCOME
```

Não converter automaticamente em:

```text
FAILED
```

se não for possível provar.

Esse ponto é crítico para evitar envio duplicado no retry.

---

# 76. Provider idempotency

Se o provider suportar idempotency keys:

avalie uso.

Se não suportar:

modele o risco explicitamente.

---

# 77. UNKNOWN_OUTCOME em delivery

Se necessário, introduza estado explícito para:

```text
provider result unknown
```

com processo de reconciliação.

Não fazer blind retry se isso puder duplicar envio.

---

# 78. Provider reconciliation

Se provider tiver API de consulta por message/request id:

use-a onde isso reduzir risco.

---

# 79. Bounce / rejection

Se e-mail:

defina o que fazer com:

```text
hard bounce
soft bounce
suppression
rejected
```

Não precisa construir marketing-email platform.

Mas erros permanentes precisam parar de retryar.

---

# 80. Local/dev environment

Criar estratégia segura para desenvolvimento.

Evitar envio real acidental em testes.

Pode usar:

```text
fake provider
in-memory adapter
sandbox provider
```

conforme arquitetura.

---

# 81. Test provider

Testes devem ser determinísticos.

Não depender de provider externo real na suíte unitária.

---

# 82. Integration testing

Ter testes da integração real até o limite razoável:

```text
materialization
queue/scheduler
worker
provider adapter
persistence
```

---

# 83. Testes obrigatórios — materialização

Cobrir pelo menos:

```text
policy creates correct reminder
same process twice does not duplicate
different cycles create separate occurrences
disabled policy creates nothing
archived item does not create invalid reminder
renewed item respects cycle semantics
```

---

# 84. Testes obrigatórios — concurrency

Cobrir:

```text
two simultaneous materializers
two simultaneous workers
retry racing with success
```

---

# 85. Testes obrigatórios — delivery

Cobrir:

```text
success
retryable failure
terminal failure
timeout/unknown outcome if applicable
max retries
DLQ/redrive if applicable
```

---

# 86. Testes obrigatórios — tenant isolation

Prove que tenant A não consegue afetar reminder de tenant B.

---

# 87. Testes obrigatórios — timezone

Cobrir datas próximas de:

```text
midnight
UTC offset boundaries
```

e DST se o domínio/mercado exigir.

---

# 88. Renewal tests

Especialmente:

```text
old cycle has future reminder
item renewed
old reminder cancelled/skipped
new cycle gets correct reminder
```

conforme decisão arquitetural.

---

# 89. Policy change tests

Cobrir:

```text
lead time changed
policy disabled
policy re-enabled
```

---

# 90. Backfill tests

Se houver backfill:

teste que não cause duplicate delivery.

---

# 91. Infrastructure

Se novos recursos AWS forem necessários:

usar Terraform seguindo padrões existentes.

---

# 92. Terraform

Cobrir:

```text
queues
DLQ
scheduler
Lambda
IAM
alarms
KMS
environment configuration
```

apenas se realmente usados.

---

# 93. Infra isolation

Respeitar:

```text
dev
prd
```

e convenções atuais.

---

# 94. Cost analysis

Documentar uma estimativa qualitativa/quantitativa simples:

```text
cost per 1k reminders
idle monthly cost
major cost drivers
```

Não precisa ser análise financeira extensa.

Mas confirme que a arquitetura permanece adequada a side-business.

---

# 95. Observability tests

Quando possível, teste emissão de:

```text
metrics
logs
failure signals
```

---

# 96. Operational runbook

Criar ou atualizar runbook para:

```text
reminder pipeline stopped
DLQ has messages
provider outage
high failure rate
stuck processing
manual replay
```

---

# 97. Manual replay

Se existir mecanismo de replay:

deve preservar idempotência.

Não permitir replay que envie duplicado indiscriminadamente.

---

# 98. Recovery

Defina como recuperar:

```text
stuck reminder
worker crashed after provider call
database succeeded but queue failed
queue succeeded but state update failed
```

Esse é um dos principais focos do Codex.

---

# 99. Failure atomicity

Analise cuidadosamente boundaries entre:

```text
DB state
queue/scheduler
provider call
delivery state
```

Não assumir transação distribuída inexistente.

---

# 100. Outbox

Se existir risco de dual-write relevante:

avalie transactional outbox ou padrão equivalente.

Não implementar automaticamente.

Use apenas se necessário para garantir correctness.

---

# 101. Documentation principal

Criar:

```text
docs/architecture/reminder-delivery-pipeline.md
```

ou caminho equivalente consistente com o repositório.

---

# 102. Estrutura sugerida

## 1. Executive Summary

## 2. BLOCKER-B Definition

## 3. Baseline

## 4. Existing Implementation

## 5. Gap Analysis

## 6. Domain Model

## 7. Architecture Decision

## 8. Materialization

## 9. Scheduling

## 10. Delivery

## 11. Idempotency

## 12. Retry

## 13. UNKNOWN_OUTCOME

## 14. State Machine

## 15. Renewal Semantics

## 16. Policy Update Semantics

## 17. Timezone

## 18. Multi-Tenancy

## 19. Security

## 20. Observability

## 21. Failure Recovery

## 22. Backfill

## 23. Cost

## 24. Testing

## 25. Operational Runbook

## 26. Claude Review

## 27. Codex Review

## 28. Reconciliation

## 29. Verification

## 30. Final BLOCKER-B Status

---

# 103. ADR

Se uma nova decisão arquitetural significativa for tomada:

crie ADR conforme padrão do projeto.

Por exemplo, escolha entre:

```text
EventBridge Scheduler
periodic materializer
queue-based scheduler
```

pode justificar ADR.

---

# 104. Atualizar documentação de estado

Ao concluir:

atualizar semanticamente:

```text
NEXT_SESSION_PROMPT.md
docs/architecture/README.md
docs/frontend/README.md
```

e outros índices relevantes.

---

# 105. Não deixar drift

Não permitir que documentos continuem dizendo:

```text
BLOCKER-B open
```

se ele estiver de fato resolvido.

Mas também não declarar:

```text
BLOCKER-B resolved
```

se pipeline ainda não for end-to-end real.

---

# 106. Claude↔Codex obrigatório

Use protocolo completo.

No mínimo:

```text
Round A — Claude implementation + self-review
Round B — Codex independent adversarial review
Round C — Claude reconciliation
Round D — Codex fresh re-review
```

Se Round D encontrar findings relevantes:

continue:

```text
Round E
Round F
...
```

até estabilizar.

---

# 107. Claude Round A

Claude deve revisar:

```text
domain semantics
architecture
materialization
scheduler
delivery
idempotency
concurrency
retries
failure atomicity
timezone
multi-tenancy
security
observability
Terraform
tests
```

---

# 108. Codex Round B — adversarial checklist

Codex deve tentar encontrar pelo menos:

1. duplicate reminder materialization;
2. duplicate delivery;
3. race between two materializers;
4. race between workers;
5. retry after actual provider success;
6. provider timeout causing duplicate delivery;
7. invalid state transition;
8. delivered reminder being reprocessed;
9. renewal leaving stale old-cycle reminders;
10. policy update not affecting future reminders correctly;
11. disabled policy still delivering;
12. archived item still delivering;
13. due-date update producing stale notification;
14. timezone off-by-one;
15. DST error if applicable;
16. scan-based hot path;
17. DynamoDB TTL used as precise scheduler;
18. cross-tenant access;
19. overly broad IAM;
20. secret leakage;
21. queue without DLQ where needed;
22. poison message retry loop;
23. infinite retries;
24. premature terminal failure;
25. wrong classification of provider errors;
26. DB/queue dual-write loss;
27. worker crash between provider call and state commit;
28. unsafe manual replay;
29. non-idempotent backfill;
30. first deploy sending historical reminders unexpectedly;
31. provider accepted incorrectly displayed as user received/read;
32. reminder scheduled incorrectly displayed as delivered;
33. logs containing sensitive content;
34. missing metrics;
35. missing alarm for stuck pipeline;
36. environment misconfiguration;
37. provider used in tests accidentally sending real mail;
38. Terraform missing dependency/order;
39. expensive architecture unnecessary for product scale;
40. BLOCKER-B falsely marked resolved.

---

# 109. Round C

Para cada finding:

```text
Finding
Evidence
Severity
Accepted / Rejected / Partial
Fix
Regression test
```

Rejeições precisam de evidência técnica.

---

# 110. Round D

Codex deve revisar código real depois das correções.

Não aceitar apenas explicação textual.

---

# 111. Severity

Use sistema de severidade do projeto.

Qualquer finding capaz de:

```text
silently lose reminders
duplicate notifications
cross tenants
misrepresent delivery
disable the pipeline silently
```

deve ser tratado como severidade alta.

---

# 112. Quality Gate RB-G1 — Materialization

FAIL se policy válida não puder produzir reminder real automaticamente.

---

# 113. RB-G2 — Duplicate Safety

FAIL se retry/concurrency puder produzir duas notificações equivalentes indevidamente.

---

# 114. RB-G3 — Renewal Safety

FAIL se reminder do ciclo antigo puder continuar sendo enviado indevidamente após renovação.

---

# 115. RB-G4 — Retry Safety

FAIL se retry puder causar side effect duplicado sem proteção.

---

# 116. RB-G5 — Failure Visibility

FAIL se pipeline puder parar silenciosamente.

---

# 117. RB-G6 — Tenant Isolation

FAIL se qualquer processamento puder cruzar tenants.

---

# 118. RB-G7 — Epistemic Integrity

FAIL se estado reportado for mais forte que a evidência real.

---

# 119. RB-G8 — Time Correctness

FAIL se timezone puder mudar o dia lógico do reminder.

---

# 120. RB-G9 — Operational Recovery

FAIL se mensagens stuck/failed não tiverem caminho de recuperação.

---

# 121. RB-G10 — Backfill Safety

FAIL se deploy/backfill puder disparar lembretes históricos inesperados.

---

# 122. RB-G11 — Security

FAIL para IAM excessivo, secret leakage ou exposição indevida.

---

# 123. RB-G12 — Test Coverage

FAIL se critical delivery paths não tiverem regression coverage.

---

# 124. RB-G13 — Cost / Operational Complexity

FAIL se arquitetura adicionar complexidade operacional desproporcional sem necessidade.

---

# 125. RB-G14 — Documentation Truth

FAIL se documentação afirmar resolução maior que a implementação real.

---

# 126. Definition of Done — BLOCKER-B

BLOCKER-B só pode ser considerado:

```text
RESOLVED
```

se for demonstrado que:

1. ReminderPolicy real pode originar materialização automática;
2. reminder occurrence possui identidade idempotente;
3. scheduling/dispatch ocorre automaticamente;
4. worker real processa reminder;
5. provider real ou production-capable adapter é chamado;
6. success é persistido;
7. retryable failure é retentado;
8. terminal failure é registrado;
9. concurrency não duplica envio;
10. renewal não deixa reminder obsoleto;
11. policy disable/update tem comportamento definido;
12. timezone foi validado;
13. tenant isolation foi testado;
14. pipeline é observável;
15. stuck/failure possui recovery path;
16. backfill é seguro;
17. infraestrutura é versionada;
18. testes passam;
19. Claude↔Codex final passa;
20. documentação é atualizada.

---

# 127. Se provider externo não puder ser provisionado

Se credenciais/provider real forem o único impedimento:

implemente toda a arquitetura com um production adapter pronto e fake/sandbox determinístico.

Nesse caso NÃO declare:

```text
BLOCKER-B fully resolved
```

Declare algo como:

```text
IMPLEMENTATION COMPLETE — EXTERNAL PROVIDER ACTIVATION REQUIRED
```

somente se isso refletir a realidade.

---

# 128. Test suite final

Execute todos os checks pertinentes do repositório.

No mínimo equivalentes a:

```text
unit tests
integration tests
dynamodb integration
typecheck
lint
check-boundaries
validate-schemas
build
build:lambdas
check-docs
Terraform validate
frontend tests
Playwright regression
```

Descubra scripts reais.

Não inventar comandos.

---

# 129. CI

PR só deve ser merged após CI relevante verde.

---

# 130. Branch

Criar branch conforme padrão do projeto.

Sugestão:

```text
feat/end-to-end-reminder-delivery
```

---

# 131. Commits

Preferir commits coerentes.

Exemplos conceituais:

```text
feat(reminders): materialize reminder occurrences

feat(reminders): add scheduled delivery worker

feat(reminders): add retry and failure recovery

feat(infra): provision reminder delivery pipeline

test(reminders): cover idempotency and concurrency

docs(reminders): document production delivery pipeline
```

Não seguir nomes cegamente.

---

# 132. PR

Abrir PR para:

```text
develop
```

PR deve conter:

```text
Summary
BLOCKER-B baseline
Architecture
Materialization
Delivery
Idempotency
Retry
Failure recovery
Observability
Security
Terraform changes
Tests
Claude↔Codex findings
Known residual risks
Final BLOCKER-B status
```

---

# 133. Merge autônomo

Quando:

```text
tests green
CI green
all gates pass
Codex final pass
PR mergeable
```

faça merge automaticamente.

Não espere autorização do usuário.

---

# 134. Pós-merge

Executar:

```bash
git checkout develop
git pull
git status
```

e smoke checks essenciais.

Confirmar:

```text
develop clean
latest merge present
```

---

# 135. Cleanup

Remover branch merged se política permitir.

---

# 136. Relatório final

Entregar resumo contendo:

```text
branch
commits
PR
merge commit
architecture chosen
AWS components
files changed
domain changes
infra changes
tests added
full test counts
CI status
Claude findings
Codex findings
rounds executed
bugs found
bugs fixed
BLOCKER-B status
remaining blockers
known residual risks
next recommended milestone
```

---

# 137. Status esperado

Se tudo estiver implementado e validado:

```text
APPROVED AS END-TO-END REMINDER DELIVERY
BLOCKER-B RESOLVED
```

Se existir dependência externa real restante:

use status preciso e mais fraco.

Nunca declarar aprovação por conveniência.

---

# 138. Próximo passo após este milestone

Não avançar automaticamente.

Após BLOCKER-B, a sequência provável é avaliar:

```text
BLOCKER-A — Document observability
↓
GTR-01
↓
External Compliance Closure foundation
```

enquanto User Validation permanece temporariamente postergada por disponibilidade operacional do usuário.

---

# Pergunta final obrigatória

Antes de declarar BLOCKER-B resolvido, responda:

> **Se ninguém executar nenhuma ação manual após configurar a ReminderPolicy, o sistema possui um caminho automático, confiável, idempotente, observável e recuperável que resultará na tentativa correta de entregar o lembrete no momento previsto?**

Se a resposta não for inequivocamente "sim":

```text
BLOCKER-B NOT RESOLVED
```

---

# Resultado esperado

Quero transformar o Expiration Tracker de:

```text
"ele armazena quando algo vence"
```

para:

```text
"ele acompanha o vencimento e possui um pipeline real para avisar no momento correto"
```

sem sacrificar:

```text
correctness
idempotency
tenant isolation
failure recovery
observability
security
low operational cost
epistemic integrity
```

Trabalhe de forma autônoma, siga `AGENTS.md`, utilize o protocolo Claude↔Codex completo, faça commits, abra PR e faça merge quando todos os critérios forem satisfeitos, sem esperar autorização intermediária.

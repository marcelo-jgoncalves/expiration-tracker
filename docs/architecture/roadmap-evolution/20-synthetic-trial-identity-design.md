# Expiration Tracker
## Especificação de Implementação de Identidade Global para Synthetic Trials

**Status:** Proposta arquitetural v1  
**Contexto:** Synthetic Persona Evaluation Framework  
**Projeto:** Expiration Tracker  
**Data:** 2026-08-30

---

# 1. Objetivo

Implementar uma identidade global capaz de correlacionar toda a execução de um teste sintético, desde o navegador até os processos assíncronos do Expiration Tracker.

A necessidade central é responder de forma objetiva:

> **“Tudo o que aconteceu no sistema durante esta execução específica pertence a qual trial?”**

A solução deverá permitir rastrear uma jornada completa envolvendo:

```text
Browser
   ↓
BFF/API
   ↓
Domain operation
   ↓
DynamoDB
   ↓
Transactional Outbox
   ↓
Event
   ↓
SQS
   ↓
Worker
   ↓
New state / New event
   ↓
Oracle / Report
```

O objetivo não é alterar o comportamento da aplicação.

A identidade deverá servir exclusivamente para:

- observabilidade;
- correlação;
- auditoria;
- debugging;
- geração de relatórios;
- classificação de falhas;
- construção de oracles;
- comparação entre trials;
- análise Claude–Codex.

---

# 2. Princípio arquitetural principal

A identidade do trial deve existir como:

> **execution metadata**

e **não como atributo funcional do domínio**.

Portanto, evitar:

```ts
interface ExpirationItem {
  id: string;
  title: string;
  expiresAt: string;

  // NÃO fazer isto:
  syntheticTrialId: string;
}
```

O correto é algo conceitualmente semelhante a:

```ts
interface ExecutionContext {
  correlationId: string;
  traceId?: string;

  evaluationRunId?: string;
  trialId?: string;
  scenarioId?: string;
}
```

Em uma execução normal de produção:

```text
evaluationRunId = undefined
trialId = undefined
scenarioId = undefined
```

Durante um teste sintético:

```text
evaluationRunId = eval-20260830-001
trialId         = trial-000184
scenarioId      = renew-expiring-document
```

Regra:

> **A presença de metadata sintética nunca poderá alterar lógica de negócio.**

---

# 3. Hierarquia de identidades

A solução deverá distinguir quatro níveis.

```text
EvaluationRunId
      │
      ├── TrialId #1
      ├── TrialId #2
      ├── TrialId #3
      └── TrialId #N
```

Dentro de cada trial:

```text
TrialId
   │
   ├── CorrelationId A
   ├── CorrelationId B
   ├── CorrelationId C
   └── CorrelationId N
```

Dentro de cada request/operação distribuída:

```text
CorrelationId
      ↓
TraceId
      ↓
SpanId
```

## 3.1 `evaluationRunId`

Responde:

> Qual execução completa do benchmark/evaluation é esta?

Exemplo:

```text
eval-20260830-nightly-004
```

Pode agrupar dezenas ou centenas de trials.

---

## 3.2 `trialId`

Responde:

> Qual sessão individual da persona é esta?

Exemplo:

```text
trial-01J6WJ8R8Y4J8P7M5G5F5R0A3N
```

É a identidade principal do Synthetic Persona Framework.

---

## 3.3 `correlationId`

Responde:

> Qual request/operação técnica é esta?

O Expiration Tracker já possui correlation IDs.

Um mesmo trial poderá possuir vários `correlationId`.

Exemplo:

```text
trialId = T42

correlationId = C1
correlationId = C2
correlationId = C3
```

---

## 3.4 `traceId` e `spanId`

Respondem:

> Qual trecho desta execução distribuída está sendo observado?

Devem continuar usando tracing padrão já existente, como X-Ray/OpenTelemetry quando aplicável.

---

# 4. Modelo final recomendado

```text
EvaluationRunId
"Qual benchmark/evaluation?"

        ↓

TrialId
"Qual sessão individual?"

        ↓

CorrelationId
"Qual request/operação?"

        ↓

TraceId / SpanId
"Qual trecho distribuído?"
```

Essa hierarquia deverá ser preservada em toda a arquitetura.

---

# 5. Nomenclatura recomendada

Recomendação inicial:

```text
evaluationRunId
trialId
scenarioId
correlationId
traceId
```

Evitar nomes extremamente específicos como:

```text
syntheticPersonaTrialId
```

porque a infraestrutura poderá ser reutilizada futuramente para:

- synthetic personas;
- release qualification;
- chaos drills;
- AWS E2E;
- Claude–Codex evaluations;
- benchmark regressions.

`trialId` deverá significar:

> uma execução individual dentro de uma avaliação controlada.

---

# 6. Formato dos identificadores

Recomendação:

- IDs opacos;
- não sequenciais externamente;
- sem informação pessoal;
- sem significado de negócio;
- globalmente únicos.

Boas opções:

```text
UUIDv7
```

ou:

```text
ULID
```

UUIDv7 é particularmente adequado por combinar:

- unicidade;
- ordenação temporal;
- ampla interoperabilidade.

Exemplo:

```text
01990da4-7f15-76d2-a90e-1df33f37f012
```

Os nomes amigáveis podem existir apenas no relatório:

```text
evaluationRun:
  id: 01990da4-...
  name: nightly-persona-regression
```

---

# 7. Creation Authority

Somente o framework de avaliação deverá criar:

```text
evaluationRunId
trialId
scenarioId
```

A aplicação não deverá gerar `trialId`.

Fluxo:

```text
Synthetic Framework
      ↓
creates evaluationRunId
      ↓
creates Trial
      ↓
creates trialId
      ↓
launches browser
```

O Expiration Tracker apenas:

> recebe, valida, propaga e registra a metadata.

---

# 8. Browser → BFF

Durante um trial, o browser deverá incluir metadata em cada request pertencente à jornada.

Modelo conceitual:

```http
X-Evaluation-Run-Id: <uuid>
X-Evaluation-Trial-Id: <uuid>
X-Evaluation-Scenario-Id: renew-expiring-document
```

Por exemplo:

```text
X-Evaluation-Run-Id
X-Evaluation-Trial-Id
X-Evaluation-Scenario-Id
```

## Importante

Esses headers deverão ser:

- opcionais;
- ignorados em tráfego comum;
- permitidos somente em ambientes autorizados;
- tratados como metadata;
- proibidos de controlar comportamento funcional.

---

# 9. Como o browser deverá injetar os headers

Há duas estratégias válidas.

## Estratégia A — Playwright context headers

O framework inicializa o browser context com:

```ts
extraHTTPHeaders: {
  'X-Evaluation-Run-Id': evaluationRunId,
  'X-Evaluation-Trial-Id': trialId,
  'X-Evaluation-Scenario-Id': scenarioId,
}
```

Vantagens:

- simples;
- consistente;
- não exige alteração de código React;
- funciona para todas as requests originadas pelo browser context.

Esta deverá ser a estratégia preferencial.

---

## Estratégia B — instrumentação do BFF client

A aplicação adicionaria metadata via API client.

Não é recomendada como primeira opção porque:

- aumenta acoplamento entre teste e frontend;
- contamina código de aplicação;
- cria risco de esquecer paths;
- não é necessária se Playwright puder controlar headers.

Recomendação:

> **Preferir Playwright/browser context injection.**

---

# 10. Validação no BFF

O BFF deverá possuir middleware equivalente a:

```text
EvaluationContextMiddleware
```

Responsabilidades:

1. ler headers;
2. validar formato;
3. validar se ambiente permite evaluation metadata;
4. construir `EvaluationContext`;
5. anexá-lo ao `RequestContext`;
6. propagar para logging/tracing;
7. nunca alterar autorização ou comportamento.

Exemplo conceitual:

```ts
interface EvaluationContext {
  evaluationRunId?: string;
  trialId?: string;
  scenarioId?: string;
}
```

E:

```ts
interface RequestContext {
  correlationId: string;
  identity: IdentityContext;
  organization?: OrganizationContext;
  evaluation?: EvaluationContext;
}
```

---

# 11. Environment Gate

A aplicação deverá possuir uma configuração explícita:

```text
EVALUATION_CONTEXT_ENABLED=true|false
```

Recomendação:

```text
local/test/dev = true
prod           = false
```

ou, quando produção precisar futuramente suportar testes controlados:

```text
prod = false por padrão
```

e habilitação excepcional via mecanismo administrativo seguro.

Nesta fase do projeto:

> **não há razão para aceitar evaluation headers em produção.**

---

# 12. Fail-closed para metadata inválida

Se evaluation metadata estiver habilitada e um header estiver presente mas inválido:

```text
X-Evaluation-Trial-Id: invalid!!!
```

duas estratégias são possíveis.

## Recomendada

Rejeitar a request:

```text
400 INVALID_EVALUATION_CONTEXT
```

durante ambientes de teste.

Razão:

- evita rastros silenciosamente corrompidos;
- aumenta confiabilidade da evidência;
- evita trials parcialmente rastreados.

---

# 13. Evaluation metadata não deve conceder confiança

Regra obrigatória:

```text
evaluation metadata
      ≠
authentication
      ≠
authorization
      ≠
feature flag
      ≠
test bypass
```

Nunca implementar:

```ts
if (trialId) {
  bypassAuth();
}
```

Nunca:

```ts
if (evaluationRunId) {
  disableValidation();
}
```

Nunca:

```ts
if (scenarioId === 'something') {
  forceSuccess();
}
```

A presença dos IDs deve alterar apenas:

- logs;
- traces;
- metadados de eventos;
- capacidades de busca/auditoria.

---

# 14. Propagação para serviços de domínio

O domínio não deverá conhecer Synthetic Persona Framework.

A metadata deverá viajar em uma abstração genérica:

```ts
interface ExecutionMetadata {
  correlationId: string;
  evaluationRunId?: string;
  trialId?: string;
  scenarioId?: string;
}
```

Serviços de aplicação podem receber:

```ts
command.execute(input, context)
```

onde:

```ts
context.executionMetadata
```

é separado de:

```ts
input
```

Isso evita poluir DTOs funcionais.

---

# 15. Propagação para Transactional Outbox

Este é um dos pontos mais importantes.

Quando uma operação produzir um evento no transactional outbox, o evento deverá possuir metadata.

Exemplo:

```json
{
  "eventType": "ExpirationItemRenewed",
  "eventId": "...",
  "occurredAt": "...",
  "aggregateId": "...",

  "metadata": {
    "correlationId": "...",
    "causationId": "...",
    "evaluationRunId": "...",
    "trialId": "...",
    "scenarioId": "..."
  },

  "payload": {}
}
```

A metadata não deverá fazer parte de `payload`.

Separação:

```text
payload   = fato de negócio
metadata  = contexto de execução
```

---

# 16. `causationId`

Recomenda-se aproveitar a implementação para introduzir ou padronizar:

```text
causationId
```

quando aplicável.

Exemplo:

```text
HTTP Request C1
      ↓
Event E1
      ↓
Worker W1
      ↓
Event E2
```

Pode ser representado como:

```text
E1.correlationId = C1
E1.causationId   = C1

E2.correlationId = C2
E2.causationId   = E1.eventId
```

Enquanto:

```text
trialId = T42
```

permanece igual em toda a cadeia.

Isso melhora significativamente reconstrução causal.

---

# 17. Propagação para SQS

Quando o outbox publisher enviar uma mensagem, a metadata deverá ser preservada.

Duas opções:

## Body

```json
{
  "metadata": {
    "trialId": "...",
    "evaluationRunId": "..."
  }
}
```

## Message Attributes

```text
EvaluationRunId
TrialId
ScenarioId
CorrelationId
```

Recomendação:

> usar metadata no envelope da mensagem e, quando útil, duplicar identificadores principais como SQS Message Attributes para facilitar observabilidade.

O envelope continua sendo fonte canônica.

---

# 18. Workers

Todo worker deverá possuir um padrão consistente de entrada:

```ts
const executionContext = extractExecutionMetadata(message);
```

Ao iniciar processamento:

```text
worker logger context:
  trialId
  evaluationRunId
  scenarioId
  correlationId
  traceId
```

Se o worker produzir:

- mutation;
- event;
- new SQS message;
- notification intent;
- async occurrence;

a metadata deverá continuar sendo propagada.

---

# 19. Forks assíncronos

Um único evento pode gerar múltiplas cadeias.

Exemplo:

```text
Trial T42
   ↓
ExpirationItemRenewed
   ├── reminder reconciliation
   ├── audit event
   └── notification process
```

Todos devem preservar:

```text
trialId = T42
```

Mas poderão possuir:

```text
correlationId diferentes
traceId diferentes
```

Isso é esperado.

---

# 20. Persistir Trial ID nas entidades?

Recomendação:

> **não persistir `trialId` como atributo de entidades funcionais por padrão.**

Evitar:

```text
ExpirationItem.trialId
ReminderPolicy.trialId
Subject.trialId
```

Porém pode haver exceções para entidades técnicas ou envelopes de auditoria.

Exemplos aceitáveis:

```text
OutboxEvent.metadata.trialId
AuditEvent.metadata.trialId
NotificationAttempt.telemetry.trialId
```

desde que a informação esteja claramente fora da semântica funcional.

---

# 21. Audit Events

Como o sistema já possui conceito de auditabilidade, evaluation metadata deverá ser anexada aos audit events.

Exemplo:

```json
{
  "actor": "...",
  "action": "ExpirationItemRenewed",
  "resource": "...",

  "execution": {
    "correlationId": "...",
    "evaluationRunId": "...",
    "trialId": "..."
  }
}
```

Isso permitirá correlacionar:

```text
o que o browser tentou
+
o que o sistema auditou
```

---

# 22. Logging estruturado

Todos os logs relevantes deverão usar campos estruturados.

Exemplo:

```json
{
  "level": "INFO",
  "message": "Reminder occurrence claimed",

  "correlationId": "...",
  "evaluationRunId": "...",
  "trialId": "...",
  "scenarioId": "...",

  "occurrenceId": "...",
  "tenantId": "..."
}
```

Não fazer:

```text
"[trial T42] reminder claimed..."
```

A metadata deve ser campo estruturado para permitir queries.

---

# 23. CloudWatch

Campos recomendados:

```text
evaluationRunId
trialId
scenarioId
correlationId
```

CloudWatch Logs Insights poderá executar queries como:

```text
filter trialId = "T42"
| sort @timestamp asc
```

Objetivo:

> reconstruir toda a execução de uma persona sem precisar conhecer previamente cada correlation ID.

---

# 24. X-Ray / tracing

Sempre que possível, adicionar:

```text
evaluation.run_id
evaluation.trial_id
evaluation.scenario_id
```

como annotations/tags pesquisáveis.

Importante distinguir:

- annotations pesquisáveis;
- metadata não indexada;
- baggage distribuído.

Quando OpenTelemetry estiver envolvido, nomes semanticamente neutros são preferíveis.

---

# 25. OpenTelemetry Baggage

Se o projeto futuramente usar OpenTelemetry de forma mais ampla, a metadata poderá ser propagada via baggage:

```text
evaluation.run_id
evaluation.trial_id
evaluation.scenario_id
```

Mas:

> baggage não deverá ser a única forma de propagação através de filas/eventos.

O envelope dos eventos deve continuar carregando a metadata explicitamente.

---

# 26. NotificationIntent e NotificationAttempt

O framework precisará saber se uma ação humana levou a:

```text
NotificationIntent
```

e depois:

```text
NotificationAttempt
```

Recomendação:

- não adicionar `trialId` como regra de negócio;
- permitir que execution metadata seja preservada em metadata técnica dessas entidades/eventos.

Assim poderá ser consultado:

```text
Trial T42
   ↓
NotificationIntent NI-88
   ↓
NotificationAttempt NA-91
```

Isso será especialmente importante para:

- reminder;
- document chasing;
- guest submission;
- notificações futuras.

---

# 27. Browser Telemetry

O Synthetic Persona Framework deverá registrar localmente:

```text
evaluationRunId
trialId
scenarioId
personaId
seed
```

junto com:

- Playwright trace;
- screenshots;
- browser console;
- network log;
- actions;
- observations.

Cada request deverá poder ser ligada ao `trialId`.

Estrutura futura:

```text
runs/
  <evaluationRunId>/
    manifest.json

    trials/
      <trialId>/
        trial.json
        actions.jsonl
        browser-trace.zip
        screenshots/
        network.jsonl
        system-events.jsonl
        oracle.json
        report.md
```

---

# 28. Trial Manifest

Exemplo:

```json
{
  "evaluationRunId": "...",
  "trialId": "...",
  "scenarioId": "renew-expiring-document",

  "persona": {
    "id": "low-tech-owner",
    "version": "1.2"
  },

  "seed": 827716,

  "application": {
    "commit": "abc123"
  },

  "agent": {
    "provider": "anthropic",
    "model": "...",
    "adapterVersion": "..."
  }
}
```

Esse arquivo será a raiz de toda auditoria.

---

# 29. Trial Collector

Será necessário futuramente um componente:

```text
Trial Evidence Collector
```

Responsável por coletar evidências relacionadas a:

```text
trialId
```

a partir de:

- browser;
- BFF;
- CloudWatch;
- X-Ray;
- DynamoDB técnico;
- outbox;
- filas;
- audit events;
- notification intents;
- workers.

Resultado:

```text
system-events.jsonl
```

ou estrutura equivalente.

---

# 30. Final State Resolver

O framework não deverá assumir que o fim do browser significa fim do trial.

Exemplo:

```text
browser terminou
     ↓
worker ainda processando
```

Será necessário resolver:

```text
Trial quiescence
```

ou:

```text
expected async completion
```

por cenário.

Exemplos:

```yaml
completion:
  type: immediate
```

ou:

```yaml
completion:
  type: async
  waitFor:
    - event: ReminderOccurrenceProcessed
  timeout: 30s
```

O `trialId` permitirá saber quais processos pertencem ao trial enquanto o framework espera.

---

# 31. Trial Quiescence

Uma possibilidade futura:

O framework considera que uma cadeia terminou quando:

```text
não existem eventos pendentes relacionados ao trial
+
não existem workers ativos conhecidos
+
oracle condition está estável
```

Isso deverá ser implementado com cautela para não criar falsa certeza.

Melhor abordagem inicial:

> cada cenário declara explicitamente quais estados assíncronos espera observar.

---

# 32. Oracles

Com a identidade global, um oracle poderá combinar:

```text
Browser evidence
+
API/domain state
+
Async evidence
```

Exemplo:

```yaml
oracle:
  required:
    - oldExpirationItem.status == RENEWED
    - newExpirationItem.status == ACTIVE
    - renewalRelation.exists == true

  forbidden:
    - duplicateRenewal.exists == true
```

E todas as evidências serão filtradas por:

```text
trialId
```

---

# 33. Perceived Success vs Actual Success

Uma das principais vantagens da implementação será detectar:

```text
perceived success
≠
actual system success
```

Exemplo:

```text
UI:
"Renovação realizada com sucesso"

Sistema:
worker downstream falhou

Oracle:
FAIL
```

Essa discrepância deverá ser registrada como finding de alta relevância.

---

# 34. Classificação de falhas

A identidade global permitirá classificar falhas com maior precisão.

## AGENT_PERCEPTION / PRODUCT_UX

```text
browser não encontrou ação
backend nunca recebeu request
```

## PRODUCT_FUNCTIONAL

```text
browser executou ação
request chegou
backend retornou erro funcional inesperado
```

## PRODUCT_ASYNC_RUNTIME

```text
request correta
event criado
SQS recebeu
worker falhou
```

## HARNESS_FAILURE

```text
produto terminou corretamente
framework perdeu evidência
```

## GRADER_FAILURE

```text
estado correto
oracle interpretou incorretamente
```

## ENVIRONMENT_FAILURE

```text
dependência dev indisponível
```

O `trialId` reduz drasticamente ambiguidade entre essas classes.

---

# 35. Segurança

## 35.1 Trust boundary

Headers de evaluation context devem ser considerados:

```text
untrusted input
```

mesmo em `dev`.

Validar:

- tamanho;
- formato;
- charset;
- quantidade;
- ausência de CRLF injection.

---

## 35.2 Não permitir mudança de comportamento

Hard requirement:

> **Trial ID muda observabilidade, nunca comportamento.**

Criar teste específico que prove isso.

---

## 35.3 Produção

Recomendação inicial:

```text
prod:
EVALUATION_CONTEXT_ENABLED=false
```

Se futuramente produção precisar ser avaliada:

- usar credenciais específicas;
- assinatura/HMAC da metadata;
- allowlist administrativa;
- short-lived tokens;
- monitoramento dedicado.

Não implementar isso nesta fase.

---

## 35.4 Não incluir PII no ID

Nunca gerar:

```text
trial-marcelo-company-x
```

ou:

```text
trial-user@example.com
```

IDs devem ser opacos.

---

# 36. Privacidade

Evaluation metadata não deve incluir:

- nome;
- email;
- telefone;
- conteúdo documental;
- CPF/CNPJ;
- dados pessoais.

O vínculo entre:

```text
trialId
```

e:

```text
persona
```

fica no framework, não necessariamente no produto.

---

# 37. Retention

Como evaluation logs poderão ser volumosos, definir retenção.

Exemplo inicial:

```text
PR smoke:
7 dias

Nightly:
30 dias

Release benchmark:
90 dias

Selected evidence:
indefinido/versionado
```

A política final poderá ser decidida quando o framework existir.

---

# 38. Schema versioning

Evaluation metadata deverá possuir versão de schema.

Exemplo:

```json
{
  "schemaVersion": 1,
  "evaluationRunId": "...",
  "trialId": "...",
  "scenarioId": "..."
}
```

Isso evita breaking changes futuros.

---

# 39. Compatibilidade retroativa

Eventos antigos sem metadata deverão continuar funcionando.

Portanto:

```ts
evaluationRunId?: string
trialId?: string
scenarioId?: string
```

sempre opcionais no runtime da aplicação.

O framework, por outro lado, poderá exigir presença obrigatória para trials sintéticos.

---

# 40. Implementação em fases

## Fase 1 — Context Contract

Criar:

```text
EvaluationContext
ExecutionMetadata
schema validation
```

Sem alterar comportamento.

Aceite:

- unit tests;
- schema tests;
- nenhuma mudança no domínio.

---

## Fase 2 — HTTP propagation

Implementar:

```text
Playwright headers
      ↓
BFF middleware
      ↓
RequestContext
```

Aceite:

- mesmo `trialId` aparece em múltiplas requests do browser;
- cada request mantém `correlationId` próprio.

---

## Fase 3 — Logs e tracing

Adicionar:

```text
evaluationRunId
trialId
scenarioId
```

a:

- structured logs;
- X-Ray annotations;
- audit metadata.

Aceite:

```text
filter trialId = X
```

retorna requests relacionadas.

---

## Fase 4 — Outbox/Event Envelope

Propagar metadata:

```text
RequestContext
      ↓
Domain/Application operation
      ↓
Outbox metadata
```

Aceite:

- evento mantém `trialId`;
- payload funcional permanece inalterado.

---

## Fase 5 — Queue propagation

Preservar:

```text
event
→ SQS
→ worker
```

Aceite:

- worker log contém `trialId`;
- downstream events preservam `trialId`.

---

## Fase 6 — Async chain coverage

Cobrir primeiro:

```text
ExpirationItem
→ Outbox
→ Worker
```

Depois:

```text
Reminder
Notification
Document/OCR
Submission
Chasing
```

---

## Fase 7 — Evidence Collector

Criar ferramenta capaz de buscar:

```text
trialId
```

e reconstruir cadeia completa.

Resultado inicial:

```text
trial-system-events.jsonl
```

---

## Fase 8 — Oracle integration

Permitir que graders consultem:

```text
trialId
```

para verificar estado real.

---

## Fase 9 — Synthetic Persona Framework

Somente então conectar:

```text
Persona
+
Scenario
+
Trial
+
Browser Agent
+
Evidence Collector
+
Oracle
+
Report
```

---

# 41. Ordem recomendada de adoção no Expiration Tracker

Começar por um fluxo pequeno e síncrono:

```text
Create Expiration Item
```

Depois:

```text
Renew Expiration Item
```

Depois:

```text
Subject requirement link/unlink
```

Depois adicionar assíncronos:

```text
Reminder
```

Depois:

```text
Document / OCR
```

E por último:

```text
External submission / document chasing
```

Isso reduz risco e complexidade incremental.

---

# 42. Primeiro vertical slice recomendado

## Scenario técnico

```text
Create Expiration Item
```

Fluxo:

```text
Playwright
   ↓
POST BFF
   ↓
Application service
   ↓
DynamoDB
   ↓
Outbox
```

O trial deve produzir:

```text
evaluationRunId = R1
trialId = T1
```

E verificar:

```text
Browser request
  trialId=T1

BFF log
  trialId=T1

Domain operation log
  trialId=T1

Outbox event
  metadata.trialId=T1
```

Critério:

> 100% da cadeia observável preserva o mesmo `trialId`.

---

# 43. Segundo vertical slice recomendado

```text
Renew Expiration Item
```

Além da propagação, verificar:

```text
old item = RENEWED
new item = ACTIVE
renewal relation = exists
```

e correlacionar tudo com:

```text
trialId
```

Esse slice começa a demonstrar valor real de oracle.

---

# 44. Terceiro vertical slice recomendado

Fluxo assíncrono:

```text
Reminder
```

Objetivo:

```text
browser/API action
    ↓
domain state
    ↓
outbox
    ↓
SQS
    ↓
worker
    ↓
NotificationIntent
```

Critério:

> todo evento relevante é pesquisável pelo mesmo `trialId`.

Esse será o verdadeiro teste da arquitetura.

---

# 45. Mutations para testar a infraestrutura

A nova infraestrutura deverá possuir mutation tests conceituais.

## Mutation 1

Remover propagação BFF → Outbox.

Esperado:

```text
teste falha
```

## Mutation 2

Worker não copia trialId para evento downstream.

Esperado:

```text
teste falha
```

## Mutation 3

Browser envia trialId inválido.

Esperado:

```text
400
```

## Mutation 4

Evaluation metadata tenta alterar autorização.

Esperado:

```text
nenhuma diferença funcional
```

## Mutation 5

Uma request do mesmo trial recebe novo correlationId.

Esperado:

```text
PASS
```

Isto prova que trial e correlation IDs são conceitos independentes.

---

# 46. Testes necessários

## Unit

- EvaluationContext parser
- ID validators
- execution metadata merge
- event metadata serialization
- worker metadata extraction

## Contract

- BFF header contract
- event envelope
- SQS envelope
- audit metadata

## Integration

- BFF → application service
- application service → outbox
- outbox → SQS
- SQS → worker
- worker → downstream event

## E2E local

```text
Playwright
→ BFF
→ local runtime
→ local datastore
```

## AWS dev

```text
Browser
→ BFF real
→ Lambda
→ DynamoDB
→ Outbox
→ SQS
→ Worker
```

---

# 47. Critérios de qualidade

A implementação deverá respeitar a Research & Quality Baseline e o Test Engineering Standard existente.

## CQ-01 — Domain purity

Evaluation metadata não faz parte de entidades de negócio.

## CQ-02 — Behavior neutrality

A presença de `trialId` não muda comportamento.

## CQ-03 — End-to-end propagation

Metadata não pode ser perdida em boundaries relevantes.

## CQ-04 — Optionality

Tráfego normal continua funcionando sem evaluation metadata.

## CQ-05 — Structured observability

Metadata aparece como campo estruturado.

## CQ-06 — Async preservation

Outbox/event/SQS/worker preservam metadata.

## CQ-07 — Security isolation

Clientes comuns não ganham poder por enviar headers.

## CQ-08 — Reproducibility

Um trial pode ser reconstruído a partir de seu `trialId`.

## CQ-09 — Auditability

Evidências podem ser coletadas automaticamente.

## CQ-10 — Evidence honesty

Ausência de metadata em parte da cadeia deve ser tratada como falha de observabilidade, não ignorada.

---

# 48. Hard Gates

## HG-TID-01

`trialId` nunca altera autorização.

## HG-TID-02

`trialId` nunca altera validação funcional.

## HG-TID-03

Evaluation metadata não é campo funcional do domínio.

## HG-TID-04

Browser, BFF e outbox preservam `trialId`.

## HG-TID-05

Workers assíncronos preservam `trialId`.

## HG-TID-06

Cada request continua possuindo `correlationId` próprio.

## HG-TID-07

Eventos downstream preservam causalidade.

## HG-TID-08

Metadata inválida não é silenciosamente aceita.

## HG-TID-09

Tráfego sem metadata continua funcionando normalmente.

## HG-TID-10

Production side effects especiais por trial são proibidos.

## HG-TID-11

Evaluation IDs não contêm PII.

## HG-TID-12

É possível reconstruir uma cadeia assíncrona completa por `trialId`.

---

# 49. Targets quantitativos iniciais

| Métrica | Target |
|---|---:|
| Requests do trial com trialId correto | 100% |
| Outbox events originados pelo trial com trialId | 100% |
| SQS messages da cadeia com trialId | 100% |
| Worker logs correlacionáveis | 100% |
| Downstream events com trialId preservado | 100% |
| Trial IDs inválidos aceitos | 0 |
| Mudanças funcionais causadas por metadata | 0 |
| PII em IDs | 0 |
| Cadeias sem classificação | <1% |
| Reconstruction success | 100% nos cenários suportados |

---

# 50. Integração futura com Claude–Codex

O protocolo Claude–Codex deverá avaliar a implementação com evidência concreta.

Exemplo:

```yaml
criterion: HG-TID-05

requirement:
  Workers preserve trialId across async boundaries.

evidence:
  - src/runtime/evaluation-context.ts
  - src/outbox/event-envelope.ts
  - src/workers/reminder-dispatch/...
  - tests/evaluation-context/async-propagation.spec.ts

claude:
  status: PASS

codex:
  status: PASS
```

Afirmações como:

```text
"parece bem propagado"
```

não contam como evidência.

---

# 51. Relatório futuro por trial

A infraestrutura deverá tornar possível gerar algo como:

```text
TRIAL T42

Evaluation Run:
nightly-persona-regression

Persona:
low-tech-owner

Scenario:
renew-expiring-document

Browser actions:
17

HTTP requests:
11

Domain mutations:
3

Outbox events:
4

SQS messages:
4

Workers executed:
3

Warnings:
1

Errors:
0

Final Domain State:
PASS

UX Outcome:
PASS

Oracle:
PASS
```

---

# 52. Exemplo de reconstrução

```text
EvaluationRun R7
      ↓
Trial T42
      ↓
Request C1
      ↓
ExpirationItem created
      ↓
Outbox E1
      ↓
SQS M1
      ↓
Worker correlation C2
      ↓
ReminderOccurrence
      ↓
Outbox E2
      ↓
Worker correlation C3
      ↓
NotificationIntent
```

Todos compartilham:

```text
evaluationRunId = R7
trialId = T42
```

Enquanto:

```text
correlationId
traceId
spanId
```

mudam conforme a execução.

---

# 53. Resultado arquitetural desejado

```text
Synthetic Persona Framework
          │
          │ creates
          ▼
 EvaluationRunId + TrialId
          │
          ▼
       Browser
          │
          ▼
         BFF
          │
          ▼
    RequestContext
          │
          ▼
 Application Service
          │
          ▼
 Transactional Outbox
          │
          ▼
         Event
          │
          ▼
          SQS
          │
          ▼
        Worker
          │
          ▼
  downstream state/events
          │
          ▼
 Evidence Collector
          │
          ▼
        Oracle
          │
          ▼
      Trial Report
```

---

# 54. Decisões recomendadas

## Adotar

- `evaluationRunId`
- `trialId`
- `scenarioId`
- UUIDv7
- Playwright extraHTTPHeaders
- BFF middleware
- execution metadata genérica
- metadata separada de payload
- propagação por outbox
- propagação por SQS
- structured logs
- X-Ray annotations
- evidence collector
- hard gate de neutralidade funcional

## Evitar

- adicionar trialId em entidades de domínio;
- lógica condicional específica para testes;
- bypass de auth;
- bypass de validação;
- IDs contendo PII;
- confiar apenas em correlationId;
- confiar apenas em X-Ray;
- confiar apenas em browser trace;
- aceitar silently metadata corrompida.

---

# 55. Recomendação final

A implementação deve ser tratada como uma extensão da infraestrutura de observabilidade distribuída do Expiration Tracker.

Ela não deve ser implementada como um “hack para testes”.

O desenho correto é:

> **uma identidade de avaliação opcional, neutra e propagável, capaz de atravessar requests, eventos e workers sem contaminar a semântica de negócio.**

A hierarquia fundamental deverá ser:

```text
EvaluationRunId
        ↓
TrialId
        ↓
CorrelationId
        ↓
TraceId / SpanId
```

Com isso, o Synthetic Persona Evaluation Framework poderá futuramente produzir evidência muito mais forte:

```text
o que a persona fez
        +
o que a interface mostrou
        +
o que o sistema realmente executou
        +
qual foi o estado final
```

Essa correlação será especialmente importante no Expiration Tracker por causa de sua arquitetura fortemente assíncrona, baseada em:

- transactional outbox;
- filas;
- workers;
- reminders;
- OCR;
- notifications;
- document chasing;
- reconciliation.

A implementação desta identidade global deverá, portanto, ser considerada uma **capacidade habilitadora central** para o futuro framework de personas sintéticas.

---

**Status:** Implementation Design v1  
**Próximo passo recomendado:** revisar esta especificação usando o protocolo Claude–Codex antes de incorporá-la ao roadmap e, posteriormente, criar um vertical slice mínimo `Browser → BFF → Outbox → Worker → Evidence Collector`.

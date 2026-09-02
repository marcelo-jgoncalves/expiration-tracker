# Auditoria de Performance — Expiration Tracker

**Data:** 2026-09-02
**Branch analisada:** `develop`
**Objetivo:** reavaliar o projeto sob a perspectiva de performance e escalabilidade, buscando um padrão de engenharia **world class**.

---

## Visão executiva

O projeto evoluiu bastante desde a auditoria anterior e várias lacunas antigas já foram corrigidas. Ao mesmo tempo, a expansão para Multi-User B2B, domínio documental, novos workers e retenção LGPD criou novos caminhos de execução que merecem uma revisão específica.

A conclusão geral é:

> **A arquitetura geral está muito forte, mas a performance ainda não pode ser chamada de world class.**

Não porque o sistema esteja necessariamente lento hoje — ainda não há carga real suficiente para afirmar isso — mas porque existem gargalos estruturais confirmados no código e, principalmente, porque os SLOs mais ambiciosos ainda não possuem evidência de carga que prove que o runtime atual os sustenta.

Esta análise se baseia no `develop` atual. Não foram executados load tests reais contra a AWS nesta rodada; por isso é importante separar achados estruturais confirmados de hipóteses que ainda exigem validação empírica.

| Prioridade | Achado | Avaliação |
|---|---|---|
| 🔴 P0 | RequestContext continua caro demais | Confirmado |
| 🔴 P0 | `API_REQUEST` quota ainda adiciona Get + TransactWrite em toda request | Confirmado |
| 🔴 P0 | Reminder Producer não sustenta estruturalmente o SLO de 1M/5min | Confirmado |
| 🔴 P0 | Reminder Dispatch tem N+1 + processamento serial | Confirmado |
| 🔴 P0 | Workers com `Scan` podem nunca alcançar o fim da tabela | Confirmado e potencialmente funcional |
| 🔴 P0 | Capacity Model ficou desatualizado depois do B2B/Document Archive | Confirmado |
| 🟠 P1 | Lambdas usam tuning excessivamente uniforme | Confirmado |
| 🟠 P1 | BFF mantém um hop completo adicional | Confirmado; impacto precisa ser medido |
| 🟠 P1 | Consumers SQS/Streams processam batches serialmente | Confirmado |
| 🟠 P1 | Frontend não possui ainda disciplina formal de performance | Confirmado |
| 🟡 P2 | Provisioned Concurrency / Arm64 / pre-warm etc. | Só após benchmark |

---

# 1. O que melhorou muito desde a auditoria anterior

Várias conclusões da auditoria anterior já foram resolvidas.

A sessão duplicada no frontend foi eliminada; há agora uma query de sessão compartilhada. O touch da sessão BFF foi coalescido. O antigo `UserProfile` saiu do hot path. O dashboard ganhou paginação real com cursor e limite. O runtime também foi atualizado para Node.js 24.

Isso significa que não faz sentido repetir o roadmap de performance anterior. Precisamos atacar o que ainda existe e o que surgiu depois.

---

# 2. RequestContext virou o maior gargalo do caminho HTTP

Este é um dos achados mais importantes.

Hoje uma requisição normal vinda do BFF possui `X-Organization-Id`, portanto já sabemos qual organização o usuário selecionou.

Mesmo assim, o `RequestContextResolver` executa primeiro:

```text
Cognito sub
↓
IdentityMapping
↓
GlobalUser
↓
OnboardingStateResolver
↓
GSI4 MembershipByUser
↓
hidrata TODAS as memberships
↓
depois resolve novamente a Membership escolhida
↓
TenantLifecycleRecord
```

O `OnboardingStateResolver` consulta o GSI4 e depois faz `Promise.all()` de todos os `Membership` encontrados, porque corretamente não confia no GSI eventualmente consistente para autorização.

Depois disso, quando existe `organizationIdHint`, `resolveWorkingOrganization()` busca novamente a Membership escolhida e também o `TenantLifecycleRecord`.

Portanto, para um usuário com uma única organização, já há leitura redundante. Para alguém pertencente a 10 organizações, o custo do RequestContext aumenta com as 10 memberships.

## Como eu redesenharia

No caminho normal BFF:

```text
organizationIdHint presente
        ↓
IdentityMapping
        ↓
userId conhecido
        ↓
PARALELO
├── GlobalUser
├── Membership(userId, organizationId)
├── TenantLifecycleRecord
└── DeviceSession, se necessário
        ↓
RequestContext
```

Sem GSI4. Sem reconstruir onboarding. Sem hidratar todas as organizações.

O `OnboardingStateResolver` continua existindo para login, onboarding, ausência de organização selecionada, telas de seleção e recuperação de estado.

Eu iria ainda além: Membership + TenantLifecycle são dois keys conhecidos. Eles podem ser lidos em uma única operação `BatchGetItem` com leitura consistente, preservando a segurança atual.

**Classificação: P0.**

---

# 3. A quota `API_REQUEST` ainda cobra caro por cada requisição

Esse é exatamente o item D-D que a auditoria anterior havia deixado aberto.

Hoje, após construir `RequestContext`, as rotas fazem:

```text
Get TenantQuota
↓
TransactWriteItems
   ├─ atualização da quota
   └─ ConditionCheck TenantLifecycle
↓
operação de negócio
```

Para quotas economicamente importantes isso é excelente:

- AI_CALL;
- UPLOAD_BYTES;
- IMPORT_ROWS;
- NOTIFICATION_EMAIL.

Mas `API_REQUEST` é diferente.

Estamos transformando uma simples leitura HTTP em uma mutação transacional no DynamoDB.

Isso prejudica latência, custo, contenção, write amplification e capacidade de burst.

## Solução recomendada

A auditoria anterior aprovou a ideia de uma lane `EphemeralTelemetryMutation` específica para `API_REQUEST`, sem usar a mesma transação de dados de negócio.

```text
API_REQUEST
→ mecanismo barato

AI_CALL / UPLOAD / IMPORT / NOTIFICATION
→ mecanismo forte/fenced
```

**Classificação: P0 imediato.**

---

# 4. Quanto custa hoje um simples GET?

Um `GET /items/{id}`, em condições normais, pode envolver aproximadamente:

```text
Browser
↓
CloudFront
↓
API Gateway BFF
↓
BFF Lambda
↓
DynamoDB Session
↓
HTTPS
↓
API Gateway Resource
↓
JWT Authorizer
↓
Resource Lambda
↓
IdentityMapping
↓
GlobalUser
↓
GSI4 memberships
↓
Membership hydration
↓
Membership novamente
↓
TenantLifecycle
↓
Quota Get
↓
Quota TransactWrite
↓
ExpirationItem Get
↓
response
```

Ou seja: para ler um registro simples, podemos chegar perto de dez operações DynamoDB entre BFF/context/quota/dado, além de dois caminhos API Gateway/Lambda.

Isso não é aceitável como desenho final se queremos p95 de 500–800 ms em escala.

A boa notícia é que não precisamos sacrificar segurança para melhorar isso.

---

# 5. O Reminder Producer atual não sustenta o próprio SLO extremo

O SLO aprovado afirma:

> 1.000.000 de ocorrências, ≥99% publicadas em até 5 minutos.

Isso significa aproximadamente **3.333 agendamentos/s** e até 5.000 intents/s com fan-out.

O runtime atual trabalha assim:

```text
6 minutos de lookback
    ×
4 shards
    ↓
24 queries GSI3
```

Mas elas são executadas em loops sequenciais.

Cada `queryGsi3()` drena todas as páginas daquela partition key antes de retornar.

Depois, para cada ReminderOccurrence:

```text
GetItem
↓
TransactWrite claim + outbox
↓
próxima ocorrência
```

também sequencialmente.

O shard count default continua sendo 4 e o Reminder Producer usa concorrência reservada 2.

## Arquitetura que eu avaliaria

```text
Scheduler 1/min
      ↓
Producer Coordinator
      ↓
SQS
├── shard 0 / minute X / page A
├── shard 1 / minute X / page A
├── shard 2 / minute X / page A
├── shard 3 / minute X / page A
...
      ↓
Producer Shard Workers
      ↓
bounded parallel claims
      ↓
Outbox
```

Se houver `LastEvaluatedKey`, o worker publica uma continuação para a próxima página.

Isso preserva OCC e outbox, mas remove o gargalo central.

## Decisão necessária

Temos duas opções honestas:

**A.** manter o SLO 1M/5min e construir a arquitetura capaz de prová-lo;

ou

**B.** admitir que esse SLO era teórico e reduzi-lo.

Pela filosofia atual do projeto, a recomendação é **A**.

---

# 6. Reminder Dispatch também possui N+1 estrutural

O SQS entrega batches de até 10 mensagens, mas o handler processa uma por vez:

```ts
for (const record of event.Records) {
    await ...
}
```

E cada `dispatchOccurrence()` precisa primeiro localizar a ocorrência:

```text
Query TODOS OCC# do item
↓
.find(occurrenceId)
↓
Get ExpirationItem
↓
Get ReminderPolicy
↓
TransactWriteItems
```

## Mudança recomendada

O Producer já conhece a ocorrência exata.

Um `reminder.dispatch.v2` deveria transportar algo equivalente a:

```text
occurrencePk
occurrenceSk
itemId
policyId
versions...
```

No dispatch:

```text
BatchGet
├── occurrence
├── item
└── policy
↓
validar
↓
TransactWrite
```

Ou, como melhoria intermediária:

```text
Get occurrence
↓
Promise.all([
  Get item,
  Get policy
])
```

Depois, processar o batch com concorrência limitada, calibrada por benchmark.

---

# 7. Os novos workers de manutenção têm um problema ainda mais sério

Vários workers fazem algo como:

```ts
ScanCommand({
    FilterExpression: ...,
    Limit: 100
})
```

e drenam no máximo 25 páginas por execução.

No DynamoDB, `FilterExpression` é aplicado depois da leitura e `Limit` representa itens avaliados.

Portanto:

```text
100 itens avaliados
×
25 páginas
=
2.500 posições da tabela
```

por execução.

Se a execução seguinte começa novamente do início, registros posteriores podem nunca ser examinados.

## Consequência

```text
dia 1 → primeiros 2.500
dia 2 → primeiros 2.500
dia 3 → primeiros 2.500
...
```

Isso pode deixar candidatos antigos permanentemente sem processamento.

Esse padrão aparece em múltiplos workers de retenção, Requirement Reindex e recorrência.

## Solução world class

Criar um índice esparso global de trabalho futuro:

```text
MaintenanceDueIndex

PK
WORK#REQUIREMENT_EXPIRY#<shard>

SK
2026-09-10T00:00:00Z#tenant#entity
```

Outros namespaces:

```text
WORK#DELIVERY_PURGE#...
WORK#CORE_PURGE#...
WORK#SERIES_DUE#...
WORK#AUDIT_PURGE#...
WORK#QUOTA_PURGE#...
```

E então:

```text
Query dueAt <= now
```

em vez de:

```text
Scan tabela inteira
→ filtra
```

Esse é um caso claro de decisão Type 1.

---

# 8. O Capacity Model precisa ser refeito

O `capacity-model.md` ainda parte de premissas antigas como:

```text
tenant = usuário individual
8 items por usuário
4,8 documentos por usuário
Organization = futuro
```

O produto atual já exige modelar:

```text
Organizations
Members / Organization
Organizations / User

Subjects / Organization
Requirements / Subject
Documents / Subject
Versions / Document
Files / Version

Requests / Subject
Recurring Series
Reviews
Guest Uploads

Audit Events
Notification Intents
Chasing Intents

OCR pages
Storage / Organization
```

Sem isso, afirmações de capacidade por estágio ficam baseadas em um produto antigo.

A recomendação é refazer o capacity model antes de qualquer novo scale proof.

---

# 9. Lambda: 256 MB para quase tudo não é world class

O módulo compartilhado define por padrão:

```text
memory = 256 MB
timeout = 10 s
```

Isso é ótimo para padronização inicial, mas ruim como tuning final.

Eu dividiria as funções em classes:

```text
Interactive HTTP
BFF
Short I/O Worker
High-throughput Worker
Maintenance Worker
Extraction/OCR
CPU-heavy parser
```

e faria benchmark em diferentes configurações de memória.

Não existe razão para assumir que BFF, PDF parser, purge worker e producer tenham o mesmo ponto ótimo.

---

# 10. Arm64 merece um benchmark formal

A arquitetura default continua x86_64.

Não faria migração em massa. Rodaria uma matriz de benchmark:

```text
x86 / 256
x86 / 512
x86 / 1024

arm64 / 256
arm64 / 512
arm64 / 1024
```

Há ainda o detalhe de que a layer ADOT é arquitetura-específica.

---

# 11. ADOT deve ser medido, não removido

Não recomendo remover observabilidade.

Mas todas as Lambdas recebem ADOT e isso possui custo de CPU, memória e duração.

Eu faria A/B em `dev`:

```text
HTTP Lambda + ADOT
HTTP Lambda sem ADOT

worker + ADOT
worker sem ADOT
```

Medindo:

```text
InitDuration
Duration
PostRuntimeExtensionsDuration
MaxMemoryUsed
p95
p99
```

Depois decidiríamos por classe de Lambda.

---

# 12. BFF: motivo real para reabrir a discussão

O BFF possui justificativa de segurança forte e isso deve ser preservado.

O caminho atual é:

```text
browser
↓
CloudFront
↓
BFF API Gateway
↓
BFF Lambda
↓
HTTP fetch
↓
Resource API Gateway
↓
JWT Authorizer
↓
Resource Lambda
```

Existe portanto um hop completo adicional.

## Recomendação

Primeiro corrigir:

1. RequestContext;
2. quota;
3. Lambda tuning.

Depois medir novamente.

Se o BFF ainda representar parcela relevante do p95, abrir uma decisão Type 1 para avaliar algo como:

```text
cookie opaco
↓
API Gateway
↓
Lambda Authorizer
    ↓
session + organization + role
↓
Resource Lambda
```

mantendo login/session no BFF.

Essa mudança exigiria revisar CSRF, revogação, troca de Organization, cache de autorização, Membership revocation e lifecycle.

---

# 13. SQS: capacidade disponível ainda não explorada

Os event source mappings usam batch size 10, mas não exploram tuning refinado de concorrência.

A ordem recomendada é:

```text
primeiro load test
↓
bounded batch concurrency
↓
MaximumConcurrency
↓
reserved concurrency
↓
medir
```

Provisioned Mode apenas se houver evidência de necessidade.

---

# 14. Outbox Relay também é serial

O relay processa registros de DynamoDB Streams sequencialmente.

Esse mesmo relay transporta:

- Reminder Dispatch;
- Document Chasing;
- Import Commit;
- Reminder Materialization.

Isso cria potencial para head-of-line blocking.

Primeiro eu adicionaria concorrência limitada dentro do batch. Só separaria lanes se testes mostrarem interferência real entre workloads.

---

# 15. DynamoDB continua sendo uma excelente escolha

Não trocaria DynamoDB.

A modelagem possui vários fundamentos fortes:

- single-table deliberado;
- índices por access pattern;
- sparse indexes;
- OCC;
- outbox;
- PAY_PER_REQUEST;
- paginação real em várias superfícies.

O problema não é o DynamoDB. São algumas access patterns atuais.

Antes de testes extremos, também devemos verificar o warm throughput da tabela e dos GSIs para não confundir capacidade não aquecida com limitação da aplicação.

---

# 16. Frontend: momento ideal para estabelecer performance foundation

Antes de o frontend crescer muito, eu colocaria:

```text
route lazy loading
bundle budgets
Web Vitals
performance regression tests
```

Metas de referência:

```text
LCP <= 2,5 s
INP <= 200 ms
CLS <= 0,1
```

no p75, separado mobile/desktop.

Lighthouse em CI é útil, mas performance realmente world class exige posteriormente RUM.

---

# 17. O que já é excelente

O desenho já possui:

- upload direto para S3;
- quarentena fora do request HTTP;
- OCR/IA assíncronos;
- OCC;
- outbox transacional;
- partial batch failure;
- paginação no dashboard;
- idempotência;
- cache isolado por tenant;
- strong reads onde autorização exige;
- DynamoDB on-demand;
- sharding no scheduler;
- observabilidade distribuída;
- Node.js 24.

Essa base é muito melhor que a média de um micro-SaaS.

O problema é que correção e segurança receberam engenharia world class; performance ainda não passou pela mesma disciplina empírica.

---

# 18. O que eu NÃO faria

Evitaria uma reação do tipo:

- colocar Redis;
- colocar ElastiCache;
- colocar DAX;
- aumentar todas Lambdas para 1 GB;
- usar Provisioned Concurrency em tudo;
- trocar DynamoDB;
- tirar strong consistency da autorização;
- remover BFF e mandar token Cognito ao browser;
- fazer `Promise.all()` indiscriminado;
- usar Parallel Scan como solução definitiva.

São soluções que podem mascarar o problema ou criar outro.

---

# 19. Roadmap de performance recomendado

Criaria uma iniciativa formal:

> **World-Class Performance Program**

com esta ordem:

```text
PERF-0
Capacity Model 2026 + Performance Evidence Harness
        ↓
PERF-1
Eliminar Scan-based maintenance starvation
        ↓
PERF-2
RequestContext fast path
        ↓
PERF-3
Implementar D-D / API_REQUEST lightweight quota
        ↓
PERF-4
Reminder Producer horizontal
        ↓
PERF-5
Reminder Dispatch v2 + bounded concurrency
        ↓
PERF-6
SQS / Streams concurrency tuning
        ↓
PERF-7
Lambda Power Tuning + arm64 + ADOT benchmark
        ↓
PERF-8
Medir custo real do BFF hop
        ↓
PERF-9
Decidir arquitetura BFF somente com dados
        ↓
PERF-10
Frontend performance foundation
        ↓
PERF-11
Extreme-scale certification tests
```

---

# 20. PERF-0: primeiro precisamos de evidência

Criar um harness de teste de carga contra `dev` ou, idealmente, ambiente `perf`.

Cenários HTTP:

```text
GET dashboard
GET item
GET document
GET subject
GET requirements

create
update
renew

document upload reserve
document commit
review/accept
```

Cenários assíncronos:

```text
10k reminders
100k reminders
1M reminders
```

Medir:

```text
Browser/BFF
API Gateway
BFF Lambda
Resource API Gateway
Resource Lambda
RequestContext
Quota
Business operation
DynamoDB
```

Não apenas duração total.

---

# 21. Métricas recomendadas

Exemplo para HTTP:

```text
request_context_ms
quota_ms
business_read_ms
bff_proxy_ms
```

Pipeline:

```text
producer_partitions_scanned
producer_pages
producer_rows
producer_claims
producer_claims_per_second

outbox_iterator_age
sqs_oldest_message_age
dispatch_messages_per_second
intent_creation_latency
```

Lambda:

```text
Duration
InitDuration
Throttles
ConcurrentExecutions
MaxMemoryUsed
PostRuntimeExtensionsDuration
```

Evitaria `tenantId` como dimensão CloudWatch de alta cardinalidade; tenant específico deve ficar em logs/traces.

---

# 22. Critério para chamar o projeto de world class

Gate formal recomendado:

> **Nenhuma afirmação de performance é `OPERATIONALLY PROVEN` apenas porque a arquitetura parece escalável.**

Precisamos demonstrar:

```text
API p95/p99
sob carga realista

+

burst do scheduler

+

backpressure

+

cold/warm Lambda

+

DynamoDB consumed capacity

+

SQS drain

+

Core Web Vitals
```

---

# Avaliação final

Separando qualidade arquitetural geral de maturidade específica de performance:

- **Arquitetura geral:** excelente.
- **Correção sob concorrência:** excelente.
- **Segurança:** muito forte.
- **Performance by design:** boa, com algumas decisões excelentes.
- **Performance provada:** ainda insuficiente.
- **Escalabilidade do scheduler em relação ao SLO declarado:** insuficiente hoje.
- **Hot path HTTP:** mais caro que deveria.
- **Maintenance processing:** possui uma lacuna estrutural urgente.

A avaliação atual é de aproximadamente **7/10 em performance engineering**, com potencial real para 9+/10 porque os problemas são identificáveis e a arquitetura modular permite corrigi-los sem desmontar o produto.

Os cinco trabalhos que mais mudariam o patamar do sistema são:

1. **eliminar os `Scan` periódicos e criar a access pattern global de trabalho devido;**
2. **criar o fast path do RequestContext;**
3. **remover a transação da quota `API_REQUEST`;**
4. **horizontalizar o Reminder Producer e eliminar o N+1 do Dispatch;**
5. **criar um programa real de load testing + Lambda/DynamoDB tuning que transforme SLOs teóricos em evidência.**

## Conclusão

Esses trabalhos deveriam ser feitos agora, ainda durante a pré-produção. São exatamente o tipo de mudanças profundas que ficam mais caras depois que existem clientes, dados reais e compatibilidade a preservar.

O objetivo não deve ser “otimizar o que parece lento”, mas transformar performance em uma propriedade arquitetural verificável do Expiration Tracker:

```text
DESIGNED
↓
IMPLEMENTED
↓
LOAD TESTED
↓
OPERATIONALLY PROVEN
↓
REGRESSION GUARDED
```

Esse é o caminho mais coerente para que o projeto possa ser considerado realmente **world class também em performance**.

# Pesquisa de estratégias de performance — Expiration Tracker

Cruzei os gargalos encontrados na auditoria com a implementação atual do repositório e com documentação oficial atualizada de AWS, DynamoDB, Lambda, API Gateway, React, TanStack Query e ADOT.

A conclusão ficou mais clara: **não há razão para redesenhar a arquitetura do Expiration Tracker**. O melhor caminho é reduzir o número de operações síncronas necessárias para responder a uma chamada e depois otimizar o runtime das Lambdas. Em vários casos, o próprio código já possui a estrutura necessária; falta apenas tirar trabalho do hot path.

---

## Resultado executivo

| Tema | Estratégia recomendada | Decisão |
|---|---|---|
| `/bff/session` duplicado | Uma única query/cache compartilhado | **Implementar** |
| Session write por request | Sliding expiration com threshold | **Implementar** |
| `ConsistentRead` da sessão | Manter | **Não alterar** |
| Cache da sessão na memória Lambda | Não usar | **Descartar** |
| RequestContext pesado | Criar fast path | **Implementar** |
| Membership/tenant lifecycle | Continuar autoritativos | **Manter** |
| Quota `API_REQUEST` transacional | Retirar do GET comum | **Implementar** |
| Quotas pagas/IA/SMS/etc. | Manter precisão transacional | **Manter** |
| Dashboard ilimitado | Cursor + limit | **Implementar** |
| Lambda 256 MB para tudo | Benchmark por função | **Medir e alterar** |
| Node 20 | Migrar diretamente para Node 24 | **Implementar** |
| ADOT 1-30-0 | Atualizar + instrumentação seletiva | **Implementar/testar** |
| x86_64 | Testar ARM64/Graviton | **Benchmark** |
| React eager routes | `React.lazy()` por rota | **Implementar** |
| TanStack `staleTime=0` | Estratégia por tipo de dado | **Implementar** |
| SQS batch/concurrency | Testes progressivos | **Benchmark** |
| N+1 na renovação | `BatchGetItem` | **Implementar se cardinalidade justificar** |
| Remover BFF/API Gateway hop | Não agora | **Descartar por enquanto** |

---

# 1. PERF-01 — Unificar a sessão no frontend

A pesquisa reforçou bastante esse achado.

Hoje o `AuthProvider` chama `fetchSessionInfo()` ao iniciar, mas guarda apenas algo equivalente a “autenticado ou não”; ele descarta os outros dados retornados. Depois, somente quando `ProtectedRoute` libera a árvore autenticada, `ActiveOrganizationProvider` é montado e executa **outra** query para `/bff/session`, explicitamente com `staleTime: 0`.

Referência:
- https://raw.githubusercontent.com/marcelo-jgoncalves/expiration-tracker/main/frontend/src/auth/AuthContext.tsx

Portanto, o desenho atual é aproximadamente:

```text
GET /bff/session
       ↓
AUTHENTICATED
       ↓
monta ActiveOrganizationProvider
       ↓
GET /bff/session
       ↓
organizationId
       ↓
GET dashboard
```

## Estratégia recomendada

Eu faria a sessão inteira ser uma **query TanStack única e canônica**.

```text
sessionQuery
   ↓
AuthProvider
   ↓
ActiveOrganizationProvider
   ↓
demais consumidores
```

O TanStack Query considera os dados stale por padrão e permite usar `staleTime` justamente para impedir refetches desnecessários.

Referência:
- https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults

Há ainda um detalhe importante: **um cache curto da sessão no frontend não enfraquece a autorização do backend**. A UI pode considerar a resposta válida por 30 ou 60 segundos, por exemplo, enquanto cada operação real continua passando pelo BFF, que valida a sessão authoritative no servidor.

Assim, eu usaria algo inicialmente nessa ordem de grandeza:

```text
session staleTime: 30–60 segundos
```

e invalidaria explicitamente a query quando houver:

```text
logout
logout all
troca de organização
401
```

O valor deve ser testado, mas a arquitetura é segura porque esse cache controla estado de UI, não autorização.

**Prioridade: máxima. Complexidade: baixa.**

---

# 2. PERF-02 — Session Touch Coalescing

Este é provavelmente um dos maiores ganhos de backend com uma alteração relativamente pequena.

O código confirma explicitamente:

> “Bumps idle TTL on every successful resolution”

Depois de validar a sessão, o BFF calcula um novo `purgeAfterTtl` e executa um `updateConditional`. Se houver uma corrida concorrente, ainda pode ser necessário reler o item.

Referência:
- https://raw.githubusercontent.com/marcelo-jgoncalves/expiration-tracker/main/src/modules/bff/application/bff-auth-service.ts

A leitura inicial também usa strongly consistent read. Esse tipo de leitura custa o equivalente ao dobro da eventually consistent para o mesmo tamanho de item.

Referência:
- https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html

## Não recomendo mudar o `ConsistentRead`

Sessão, revogação e logout são casos nos quais consistência forte possui valor real.

A otimização correta não é:

```text
strong read → eventual read
```

É:

```text
strong read + write por request
           ↓
strong read + write ocasional
```

## Sliding expiration com threshold

Suponha, apenas para ilustrar, um idle timeout de 30 minutos.

Em vez de renovar:

```text
30:00
request
→ volta para 30:00

29:55
request
→ volta para 30:00
```

podemos renovar somente quando restarem, por exemplo, menos de 5 minutos:

```text
remaining > threshold
    ↓
não escreve

remaining <= threshold
    ↓
renova TTL
```

Isso transforma dezenas ou centenas de escritas de uma sessão ativa em pouquíssimas.

A segurança continua preservada porque o código já verifica explicitamente `purgeAfterTtl`; ele corretamente **não depende da exclusão automática do DynamoDB TTL**, que pode ocorrer dias depois do timestamp de expiração.

Referência:
- https://raw.githubusercontent.com/marcelo-jgoncalves/expiration-tracker/main/src/modules/bff/application/bff-auth-service.ts

## O que eu não faria

Não colocaria a sessão em uma variável global da Lambda para economizar DynamoDB. A própria AWS recomenda não armazenar no execution environment dados de usuário ou informações com implicações de segurança, pois ambientes podem ser reutilizados entre invocações.

Referência:
- https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html

Portanto:

```text
DynamoDB continua source of truth
+
ConsistentRead continua
+
touch passa a ser coalescido
```

Esse me parece o desenho certo.

**Prioridade: máxima. Complexidade: baixa/média.**

---

# 3. PERF-03 — RequestContext Fast Path

A pesquisa reforçou que esse é provavelmente o maior problema estrutural de latência do backend.

O `RequestContextResolver` atualmente recompõe vários aspectos da identidade e organização durante requests normais.

Referência:
- https://raw.githubusercontent.com/marcelo-jgoncalves/expiration-tracker/main/src/modules/identity/application/resolve-request-context.ts

Mas existe uma informação arquitetural muito importante: **o browser não controla diretamente a organização enviada à Resource API**. O BFF deriva o contexto organizacional da sessão e encaminha internamente esse valor.

Isso permite otimizar sem passar a confiar no cliente.

## Eu dividiria o RequestContext em duas categorias

| Informação | Hot path normal |
|---|---|
| JWT/identidade autenticada | Sim |
| Membership do usuário | Sim |
| Tenant lifecycle | Sim |
| Organização selecionada | Já conhecida via BFF |
| Onboarding discovery | **Não** |
| Descoberta de organizações disponíveis | **Não** |
| `createProfileIfAbsent` | **Não** |
| Bootstrap de identidade | Normalmente **não** |

Onboarding e discovery pertencem principalmente a login, onboarding, criação/seleção de organização e fluxos excepcionais.

Uma leitura de dashboard não deveria repetir todo esse processo.

## Segurança continua existindo

Eu manteria:

```text
usuário autenticado
       ↓
membership ainda ACTIVE?
       ↓
tenant ainda ACTIVE?
       ↓
operação
```

Isso preserva os controles que realmente podem revogar acesso.

O próprio API Gateway também consegue validar assinatura, issuer, audience, expiração e scopes de um JWT antes de a Lambda ser chamada.

Referência:
- https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html

## Outra oportunidade: `BatchGetItem`

Se continuarmos precisando de, por exemplo:

```text
GlobalUser
Membership
TenantLifecycle
```

e as chaves forem conhecidas, um `BatchGetItem` pode buscar vários itens numa única chamada, inclusive com leitura consistente quando necessário, em vez de serializar diversos `GetItem`.

Isso não deve substituir uma boa modelagem, mas pode reduzir round-trips.

## O que eu evitaria inicialmente

Não colocaria membership em um cache de vários minutos nem adicionaria um Lambda Authorizer com cache apenas para ganhar performance.

Isso cria uma pergunta de segurança complicada:

> “Quanto tempo depois de remover um membro ele ainda poderia continuar acessando?”

A primeira otimização deve remover trabalho que **não precisa existir**, antes de tornar autorização authoritative em cache.

**Prioridade: máxima. Complexidade: média.**

---

# 4. PERF-04 — Separar throttling técnico de quota comercial

Este foi um dos resultados mais fortes da pesquisa.

O próprio código define `API_REQUEST` como uma quota anti-DoS, hoje aplicada nas rotas de items, inclusive GETs.

Referência:
- https://raw.githubusercontent.com/marcelo-jgoncalves/expiration-tracker/main/src/modules/identity/application/quota.ts

Mas a implementação da quota utiliza leitura seguida de lógica transacional.

DynamoDB cobra operações transacionais com o dobro das unidades correspondentes por item.

Referência:
- https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Constraints.html

Ou seja, estamos usando um mecanismo de garantia forte para algo cujo objetivo é basicamente:

> “Não deixe alguém martelar a API.”

## Para proteção técnica

API Gateway HTTP API já possui throttling por rota baseado em token bucket e retorna `429 Too Many Requests` quando os limites são ultrapassados.

Referência:
- https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-throttling.html

Portanto eu usaria:

```text
API Gateway
    ↓
throttling técnico / proteção da API
```

e não:

```text
cada GET
 ↓
DynamoDB
 ↓
transaction
 ↓
DynamoDB
```

## Uma ressalva importante

O throttling de rota do API Gateway não é uma quota precisa **por tenant**; trata-se de proteção de stage/route e é best-effort.

Por isso a decisão deveria ser:

| Necessidade | Solução |
|---|---|
| Proteger API contra bursts | API Gateway |
| Limitar uso genericamente | API Gateway |
| Quota comercial de IA | DynamoDB authoritative |
| Limite de SMS/WhatsApp | DynamoDB authoritative |
| Limite de e-mails pagos | DynamoDB authoritative |
| Limite de extrações | DynamoDB authoritative |
| Quota exata por plano | DynamoDB authoritative |
| GET comum | **sem TransactWrite de quota** |

Aliás, o próprio `TenantQuotaService` documenta o mecanismo como importante para admissão antes de chamadas pagas como Textract/Bedrock.

Essa é exatamente a função em que uma quota forte faz sentido.

## Se realmente quisermos rate limit por tenant

A alternativa mais barata seria pesquisar/implementar um contador com `UpdateItem` condicional por janela. DynamoDB suporta incremento atômico com `ADD` ou `SET ... if_not_exists`.

Referência:
- https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_UpdateItem.html

Mas eu só faria isso se houver um requisito real de isolamento por tenant. Para o estágio inicial do produto, provavelmente seria engenharia desnecessária.

**Prioridade: máxima. Potencial de ganho: muito alto.**

---

# 5. PERF-05 — O dashboard já tem o access pattern correto; falta limitá-lo

Aqui a pesquisa melhorou a conclusão original.

O projeto **já possui uma GSI adequada** para o dashboard:

```text
TENANT
+
STATUS
+
dueDate
```

e `listDashboard()` já aceita `limit`.

Referência:
- https://raw.githubusercontent.com/marcelo-jgoncalves/expiration-tracker/main/src/modules/expiration/application/expiration-service.ts

Portanto, não precisamos redesenhar DynamoDB.

O problema é mais simples: o HTTP handler não força uma paginação/limite adequado.

## Estratégia

Para Overview:

```text
ACTIVE
ordenado por dueDate
limit = 20/30/50
```

Isso é exatamente o tipo de query que DynamoDB executa bem.

Para a coleção completa:

```text
limit=50
cursor=<opaque>
```

usando `LastEvaluatedKey`.

DynamoDB limita uma Query a páginas de até 1 MB e utiliza `LastEvaluatedKey`/`ExclusiveStartKey` para continuar a leitura.

Referência:
- https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Query.html

E há um detalhe importante: **não devemos resolver isso fazendo uma query enorme e depois usando FilterExpression**. O filtro acontece depois da leitura e não reduz a capacidade consumida pela query.

Referência:
- https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.FilterExpression.html

A GSI atual já é justamente a solução superior.

**Prioridade: máxima. Complexidade: baixa/média.**

---

# 6. Correção importante: Node 20 → Node 24

Esta pesquisa mudou uma recomendação da auditoria anterior.

Eu havia sugerido Node 22.

**Hoje eu recomendo migrar diretamente para Node.js 24.**

Em 31 de agosto de 2026:

| Runtime | Depreciação AWS |
|---|---:|
| Node 20 | 30/04/2026 — já depreciado |
| Node 22 | 30/04/2027 |
| **Node 24** | **30/04/2028** |

Referência:
- https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html

Node 24 está GA e em Active LTS para Lambda. A AWS também introduziu nele uma nova implementação do Runtime Interface Client.

Referência:
- https://aws.amazon.com/blogs/compute/node-js-24-runtime-now-available-in-aws-lambda/

Node 26 apareceu agora em agosto de 2026, mas ainda está em **public preview**, então eu não o usaria na aplicação.

Referência:
- https://aws.amazon.com/blogs/compute/introducing-public-preview-runtimes-on-aws-lambda-starting-with-node-js-26-and-python-3-15/

Portanto:

```text
Node 20
   ↓
Node 24
```

sem parada intermediária no 22.

---

# 7. ADOT: há uma atualização que eu faria imediatamente

O repositório fixa em dev:

```text
aws-otel-nodejs-amd64-ver-1-30-0
```

Referência:
- https://raw.githubusercontent.com/marcelo-jgoncalves/expiration-tracker/main/infra/env/dev.tfvars

Em **11 de agosto de 2026**, o projeto ADOT publicou `1-30-2`, atualizando o collector e corrigindo **27 CVEs, incluindo duas críticas**.

Referência:
- https://github.com/aws-observability/aws-otel-lambda/blob/main/CHANGELOG.md

Portanto esta deixou de ser apenas uma otimização.

Eu atualizaria:

```text
1-30-0
   ↓
1-30-2
```

após teste no ambiente dev.

## E existe um ganho de performance possível

A linha atual permite controlar:

```text
OTEL_NODE_ENABLED_INSTRUMENTATIONS
```

e o próprio changelog menciona isso como otimização para cold start.

Então, em vez de carregar tudo, podemos testar algo como:

```text
aws-lambda
aws-sdk
http
```

e incluir outras instrumentações somente onde forem efetivamente necessárias.

Eu também alteraria o módulo Terraform para permitir:

```text
adot_enabled = true/false
```

por Lambda.

Não para desligar observabilidade arbitrariamente, mas para podermos medir:

```text
ADOT completo
vs
ADOT seletivo
vs
sem ADOT
```

em funções específicas.

---

# 8. Lambda: memória deve virar resultado de benchmark

A AWS confirma que CPU disponível para Lambda cresce proporcionalmente à memória.

Referência:
- https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/cost-and-performance-optimization.html

Portanto 256 MB não é necessariamente o ponto mais barato.

Eu testaria pelo menos:

| Memória | Objetivo |
|---:|---|
| 256 MB | baseline atual |
| 512 MB | primeiro candidato |
| 1024 MB | CPU adicional |
| ~1769 MB | aproximadamente 1 vCPU |

E compararia:

```text
Duration
Init Duration
p50
p95
p99
GB-s/request
custo por 1.000 requests
```

O resultado pode perfeitamente ser algo como:

```text
256 MB → 300 ms
512 MB → 140 ms
```

e a opção maior acabar apresentando preço-performance melhor.

Os números acima são apenas ilustração; precisamos obter os reais.

---

# 9. ARM64/Graviton merece entrar no experimento

O ambiente atual está claramente usando layer ADOT `amd64`, portanto o caminho atual é x86_64.

Referência:
- https://raw.githubusercontent.com/marcelo-jgoncalves/expiration-tracker/main/infra/env/dev.tfvars

AWS recomenda considerar ARM64/Graviton para Lambda e afirma que ele pode oferecer melhor relação preço/performance, desde que dependências sejam compatíveis. Também recomenda testar as duas arquiteturas porque o resultado varia por workload.

Referência:
- https://docs.aws.amazon.com/lambda/latest/dg/foundation-arch.html

Para o Expiration Tracker, TypeScript/Node + AWS SDK tende a ser um candidato interessante porque não há, à primeira vista, uma dependência nativa pesada que impeça ARM.

Eu acrescentaria ao Power Tuning:

```text
Node 24 x86_64
vs
Node 24 arm64
```

Não faria a migração global sem benchmark.

---

# 10. React: route-level code splitting é recomendável

O `App.tsx` importa estaticamente todas as páginas:

```text
Overview
Items
ItemDetail
CreateItem
Subjects
Members
Settings
...
```

Referência:
- https://raw.githubusercontent.com/marcelo-jgoncalves/expiration-tracker/main/frontend/src/App.tsx

React possui `lazy()` exatamente para postergar o carregamento de código até o primeiro render daquele componente.

Referência:
- https://pt-br.react.dev/reference/react/lazy

Assim:

```text
const Settings = lazy(() => import("./routes/Settings"))
```

faz com que um usuário abrindo Overview não precise baixar o código de Settings, Members, RenewItem etc.

Isso deve ser feito agora, enquanto a aplicação ainda é relativamente pequena, porque impede que o bundle inicial vá crescendo silenciosamente com cada nova feature.

---

# 11. TanStack Query: cache deve refletir o domínio

Hoje `staleTime: 0` aparece explicitamente na sessão, e o QueryClient global não define uma política geral de freshness.

Referência:
- https://raw.githubusercontent.com/marcelo-jgoncalves/expiration-tracker/main/frontend/src/auth/ActiveOrganizationContext.tsx

Eu não colocaria um único `staleTime` global.

Usaria algo como ponto inicial para benchmark:

| Informação | `staleTime` inicial |
|---|---:|
| Session/UI | 30–60 s |
| Overview | 15–30 s |
| Item detail | 30–60 s |
| Members | 30–60 s |
| Configurações pouco mutáveis | 2–5 min |

Mutations fariam invalidation seletiva.

Assim um:

```text
PATCH item
```

invalida:

```text
item/{id}
dashboard
items collection
```

sem transformar cada navegação normal em uma consulta nova.

Isso é precisamente o modelo que TanStack Query foi projetado para suportar.

Referência:
- https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults

---

# 12. SQS/Lambda: não escolher batch size por intuição

O batch atual de `10` é bastante conservador.

AWS permite até **10.000 mensagens por batch em Standard SQS**. Para batch acima de 10, é necessário configurar uma batching window mínima de 1 segundo. A própria AWS observa que batches maiores podem melhorar eficiência em workloads rápidos ou com alto overhead.

Referência:
- https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html

Mas eu **não configuraria 10.000**.

Faria testes:

| Teste | Batch | Concorrência |
|---|---:|---:|
| A | 10 | baseline |
| B | 25 | controlada |
| C | 50 | controlada |
| D | 100 | controlada |

e mediria:

```text
messages/s
ApproximateAgeOfOldestMessage
Lambda duration
DynamoDB throttling
SES/provider throttling
erro por batch
custo por 1.000 mensagens
```

Lambda também possui `MaximumConcurrency` específico para event sources SQS, permitindo controlar quanto aquela fila pode escalar sem necessariamente depender apenas da reserved concurrency da função.

Referência:
- https://docs.aws.amazon.com/cli/latest/reference/lambda/create-event-source-mapping.html

O projeto já usa partial batch responses, o que é uma boa base para esse aumento de eficiência.

---

# 13. O N+1 da renovação pode ser corrigido elegantemente

O código atual confirma:

```text
const sourcePointers = await queryByPk(...)

for (const pointer of sourcePointers) {
    const sourcePolicy = await store.get(...)
}
```

Referência:
- https://raw.githubusercontent.com/marcelo-jgoncalves/expiration-tracker/main/src/modules/expiration/application/expiration-service.ts

Isso serializa uma consulta DynamoDB por policy.

A alternativa natural é:

```text
Query pointers
      ↓
BatchGet policies
      ↓
validar todas
```

O ganho talvez seja pequeno enquanto um item tiver duas ou três policies, portanto eu colocaria isso abaixo dos P0.

Mas é um ótimo cleanup depois que os problemas do hot path forem resolvidos.

---

# 14. Eu não removeria o BFF

A pesquisa não encontrou justificativa para desmontar:

```text
Browser
 ↓
BFF
 ↓
Resource API
```

apenas para eliminar um hop.

A separação atual entrega propriedades importantes de segurança: tokens Cognito ficam server-side, organização ativa é derivada da sessão, e o browser não possui controle direto desses dados.

Além disso, substituir o segundo API Gateway por cadeias síncronas de Lambda→Lambda tende a aumentar acoplamento.

Eu só voltaria a essa discussão **depois** de eliminar:

```text
sessão duplicada
session touch por request
RequestContext excessivo
quota transacional
dashboard ilimitado
```

Se depois disso os traces mostrarem que:

```text
BFF → API Gateway → Resource Lambda
```

é responsável por uma parcela material do p95, então podemos estudar um `/bff/bootstrap` ou endpoint agregado para o primeiro carregamento.

Mas isso seria otimização orientada por medição, não arquitetura antecipada.

---

# Nova ordem de implementação

Depois desta pesquisa, eu mudaria ligeiramente a sequência da auditoria:

1. **PERF-00 — Baseline de performance**: spans/metrics para separar BFF session read, session touch, RequestContext, quota, domínio e proxy.
2. **PERF-01 — Single Session Query**: eliminar a segunda `/bff/session`.
3. **PERF-02 — Session Touch Coalescing**: manter strong read, eliminar writes constantes.
4. **PERF-04 — API Quota Redesign**: tirar a quota DynamoDB transacional dos GETs comuns.
5. **PERF-03 — RequestContext Fast Path**: retirar onboarding/bootstrap/profile do fluxo recorrente mantendo membership/lifecycle authoritative.
6. **PERF-05 — Dashboard Pagination**: `limit` + cursor aproveitando a GSI já existente.
7. **PERF-06 — Runtime modernization**: Node 24 + ADOT 1-30-2 + instrumentação seletiva.
8. **PERF-07 — Lambda benchmark**: memória + x86_64 versus ARM64.
9. **PERF-08 — Frontend delivery**: lazy routes + política de `staleTime`.
10. **PERF-09 — Async throughput**: SQS batch/concurrency.
11. **PERF-10 — DynamoDB N+1 cleanup**: BatchGet na renovação.

---

# Conclusão

A pesquisa reforçou bastante a auditoria original e, em alguns pontos, tornou as recomendações mais específicas.

O que eu considero mais importante é que **não precisamos sacrificar nenhuma das características profissionais do projeto — OCC, idempotência, transações de negócio, revogação de sessão, tenant lifecycle, transaction outbox etc. — para obter uma melhoria grande de performance**.

O alvo é remover garantias do lugar errado:

```text
segurança necessária           → permanece
consistência necessária        → permanece
transações de negócio          → permanecem
idempotência                   → permanece

bootstrap repetido             → sai
write de sessão por request    → sai
quota cara em GET              → sai
download de tela não visitada  → sai
query ilimitada                → sai
```

Isso é particularmente bom para o Expiration Tracker porque significa que podemos deixá-lo **mais rápido, mais barato e mais escalável sem simplificar a engenharia que diferencia o projeto**.

E a descoberta mais concreta nova desta rodada é a combinação **Node 24 + atualização imediata do ADOT 1-30-2**: além de performance/runtime, há uma atualização de segurança publicada em **11 de agosto de 2026** que torna esse trabalho mais urgente.

O próximo passo natural agora é transformar esta pesquisa em um **plano técnico de implementação**, especificando para cada PERF exatamente o que alterar no código, critérios de aceite, testes antes/depois e quais mudanças podem ser feitas independentemente sem misturar várias otimizações na mesma medição.

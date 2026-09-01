# Auditoria de performance — Expiration Tracker

Fiz a avaliação considerando o código atual do repositório, a arquitetura documentada pelo próprio projeto e práticas atuais das tecnologias envolvidas — AWS Lambda, DynamoDB, API Gateway, SQS, CloudFront, React/Vite, TanStack Query e OpenTelemetry/ADOT.

Minha conclusão principal é esta: **a arquitetura do Expiration Tracker é boa e profissional, mas atualmente privilegia fortemente consistência, segurança e garantias operacionais, pagando por isso com várias operações síncronas repetidas no caminho crítico de praticamente toda requisição**. O maior ganho de performance provavelmente não virá de trocar tecnologias, mas de **reduzir trabalho redundante**.

O projeto já reconhece uma limitação importante: embora o desenho arquitetural esteja aprovado, ainda faltam evidências operacionais e testes reais de carga/falha para validar os SLOs propostos. Portanto, esta é uma auditoria arquitetural e estática bastante completa; números reais de p95/p99 ainda precisarão ser obtidos do ambiente implantado.

Referência:
- https://github.com/marcelo-jgoncalves/expiration-tracker/blob/main/ARCHITECTURE.md

---

## 1. Contextualização do projeto

O Expiration Tracker está estruturado como um micro-SaaS serverless para gerenciamento de vencimentos e renovações de documentos, contratos, certificados, seguros, licenças e itens semelhantes, com lembretes e processamento assíncrono.

A arquitetura usa principalmente:

| Camada | Implementação |
|---|---|
| Frontend | React + Vite + React Router + TanStack Query |
| Edge | CloudFront + S3 |
| BFF | API Gateway HTTP API + Lambda |
| Backend | Lambdas TypeScript/Node |
| Banco | DynamoDB single-table |
| Assíncrono | SQS + EventBridge |
| Autenticação | Cognito + sessão mantida pelo BFF |
| Documentos | S3 + Textract/Bedrock |
| Observabilidade | CloudWatch/X-Ray + ADOT/OpenTelemetry |
| Infra | Terraform |

É uma arquitetura coerente para o objetivo do produto: baixo custo ocioso, capacidade de crescer progressivamente e engenharia suficientemente robusta para um produto comercial.

Referência:
- https://github.com/marcelo-jgoncalves/expiration-tracker

Há várias decisões que eu **manteria**:

- DynamoDB on-demand;
- single-table orientado a access patterns;
- transaction outbox;
- idempotência dos workers;
- optimistic concurrency control;
- SQS com DLQ;
- partial batch failure;
- clientes AWS criados fora do handler;
- bundles separados por Lambda.

Essas decisões dão uma base muito boa.

O problema aparece na composição delas no caminho síncrono.

---

# 2. O principal gargalo arquitetural

Hoje, uma requisição autenticada comum se parece aproximadamente com isto:

```text
Browser
   ↓
CloudFront
   ↓
API Gateway BFF
   ↓
BFF Lambda
   ↓
DynamoDB → carregar sessão com ConsistentRead
   ↓
DynamoDB → atualizar idle TTL da sessão
   ↓
API Gateway da Resource API
   ↓
Resource Lambda
   ↓
resolver identidade / onboarding / membership / tenant lifecycle
   ↓
DynamoDB → ler quota
   ↓
DynamoDB → TransactWrite para consumir quota
   ↓
DynamoDB → finalmente consultar o dado solicitado
   ↓
resposta inteira no caminho inverso
```

O problema não é nenhuma operação isoladamente. É a **amplificação de operações de controle antes de chegar ao dado de negócio**.

Isso explica por que eu não começaria tentando otimizar a query de itens ou adicionando algum cache sofisticado. Há ganhos muito maiores disponíveis antes disso.

---

# 3. Achados prioritários

| Prioridade | Achado | Impacto potencial |
|---|---|---:|
| **P0** | Frontend consulta `/bff/session` duas vezes durante o bootstrap | Muito alto |
| **P0** | BFF faz strong read + escrita de sessão praticamente a cada request | Muito alto |
| **P0** | Resource API reconstrói contexto/autorização com vários acessos ao DynamoDB | Muito alto |
| **P0** | Quota persistente faz read + transação DynamoDB em praticamente todo request | Muito alto |
| **P0** | Dashboard não impõe paginação/limite no handler | Muito alto com crescimento |
| **P1** | Todas as Lambdas usam 256 MB por padrão | Alto |
| **P1** | Node.js 20 já está depreciado no Lambda | Alto / tecnológico |
| **P1** | ADOT é aplicado indiscriminadamente a todas as Lambdas | Médio/alto em cold start |
| **P1** | Todas as páginas React são importadas eager | Médio |
| **P1** | Workers usam batch/concurrency conservadores para o SLO extremo definido | Alto em bursts |
| **P2** | Algumas operações fazem N+1 no DynamoDB | Médio |
| **P2** | TanStack Query praticamente sem política de `staleTime` | Médio |
| **P2** | Bundle Lambda pode ser reduzido/medido melhor | Médio |
| **P3** | Build das dezenas de Lambdas é sequencial | CI, não runtime |

---

# 4. P0 — O frontend consulta a sessão duas vezes no início

Este foi um dos achados mais claros no código.

O `AuthContext` executa `fetchSessionInfo()` durante sua inicialização. Só depois que a autenticação passa para `AUTHENTICATED` o `ProtectedRoute` permite montar o restante da aplicação.

Então o `ActiveOrganizationContext` é montado e executa **novamente** `fetchSessionInfo()` por meio do TanStack Query, com `staleTime: 0`.

Referência:
- https://raw.githubusercontent.com/marcelo-jgoncalves/expiration-tracker/main/frontend/src/auth/AuthContext.tsx

Ou seja:

```text
App inicia
 ↓
GET /bff/session
 ↓
usuário autenticado
 ↓
ActiveOrganizationProvider monta
 ↓
GET /bff/session novamente
 ↓
organizationId disponível
 ↓
GET /items/dashboard
```

Isso cria um waterfall justamente na primeira renderização, quando a latência é mais perceptível para o usuário.

E `/bff/session` não é uma chamada barata, pois passa pelo mecanismo de sessões persistidas do BFF.

## Recomendo

Transformar a sessão em **uma única query compartilhada**.

`AuthContext`, `ActiveOrganizationContext` e qualquer componente interessado na sessão deveriam consumir o mesmo estado/cache.

O TanStack Query já foi projetado exatamente para isso.

A documentação atual confirma que queries são consideradas stale por padrão e recomenda configurar `staleTime` quando refetches frequentes não são necessários.

Referência:
- https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults

Aqui eu não colocaria um `staleTime` enorme, porque sessão possui implicações de segurança. Algo curto pode ser suficiente, mas o principal ganho nem depende disso:

**duas partes da aplicação não deveriam fazer duas requests simultâneas para obter exatamente a mesma informação**.

## Impacto esperado

É uma das alterações de melhor relação esforço/benefício da auditoria.

Ela elimina uma viagem completa ao backend durante o carregamento inicial.

---

# 5. P0 — A sessão do BFF gera escrita demais

A store de sessão usa:

```text
GetItem
ConsistentRead = true
```

para recuperar a sessão.

Isso é defensável para sessão e revogação: consistência importa.

Referência:
- https://github.com/marcelo-jgoncalves/expiration-tracker/blob/main/src/modules/bff/persistence/dynamodb-session-store.ts

O problema está no passo seguinte.

Ao resolver uma sessão válida, o BFF renova seu idle timeout e executa uma atualização condicional. Em condições de concorrência ainda existe releitura e resolução de colisão.

Referência:
- https://github.com/marcelo-jgoncalves/expiration-tracker/blob/main/src/modules/bff/application/bff-auth-service.ts

Portanto, um usuário abrindo uma tela que dispara várias APIs pode produzir algo conceitualmente parecido com:

```text
request 1 → Get session → Write session
request 2 → Get session → Write session
request 3 → Get session → Write session
request 4 → Get session → Write session
...
```

Não gosto dessa característica para um SaaS que pode ter interfaces relativamente “chatty”.

Strongly consistent reads também custam o dobro da capacidade de leitura equivalente no DynamoDB.

Referência:
- https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html

## Eu manteria a leitura consistente

Eu **não sacrificaria segurança trocando simplesmente para eventual consistency**.

Mudaria a política de sliding expiration.

Por exemplo, se a sessão possui 30 minutos de idle timeout, não é necessário mover o TTL alguns segundos para frente a cada request.

Conceitualmente:

```text
if (tempo restante do idle timeout < limite_de_renovacao):
    renovar sessão
else:
    somente ler
```

Um limite de alguns minutos poderia fazer com que a esmagadora maioria das requests fosse somente leitura.

O valor exato precisa respeitar o modelo de segurança definido pelo projeto.

## Resultado

Passaríamos de:

> 1 session write por request

para:

> zero session writes na maioria das requests e uma atualização periódica por sessão ativa.

Esse é um ganho de performance **e de custo**.

---

# 6. P0 — O `RequestContextResolver` faz trabalho demais em toda requisição

Este provavelmente é o achado arquitetural mais importante.

Antes de uma operação de negócio, o resource backend reconstrói o contexto do usuário. O resolver percorre aspectos como:

- identidade global;
- estado do usuário;
- device/session quando aplicável;
- onboarding;
- membership;
- lifecycle do tenant;
- criação/verificação de profile.

Referência:
- https://raw.githubusercontent.com/marcelo-jgoncalves/expiration-tracker/main/src/modules/identity/application/resolve-request-context.ts

Individualmente, as verificações fazem sentido.

O problema é fazê-las **todas novamente** para:

```text
GET dashboard
GET item
GET items
PATCH item
...
```

Esse padrão é seguro, porém adiciona vários round-trips ao DynamoDB a toda operação.

## Eu criaria um `RequestContext` fast path

O backend não deve confiar cegamente no browser, mas o BFF já é um boundary confiável.

Para uma chamada depois que usuário e organização já foram selecionados, deveria ser possível chegar a algo mais próximo de:

```text
JWT validado
       ↓
organizationId escolhido pelo BFF
       ↓
membership válida?
       ↓
tenant ativo?
       ↓
executar domínio
```

E evitar repetir, em todas as requests, operações como:

```text
resolver onboarding global
createProfileIfAbsent
descobrir novamente organização ativa
...
```

O onboarding pertence principalmente ao fluxo de entrada/seleção da organização, não ao hot path de uma consulta normal de dashboard.

`createProfileIfAbsent` também é um forte candidato a sair do hot path e ocorrer na criação/login/onboarding ou apenas num fallback quando realmente necessário.

## Importante

Isso não significa enfraquecer autorização.

A membership e o lifecycle do tenant ainda podem permanecer authoritative.

O objetivo é separar:

**informações que precisam ser revalidadas em toda request**

de

**informações que já foram estabelecidas e não precisam ser redescobertas em toda request**.

Hoje essas duas categorias estão misturadas.

---

# 7. P0 — A quota do DynamoDB está no caminho de todas as APIs

O `TenantQuotaService` é bastante robusto, porém pesado.

O consumo atual envolve uma leitura do estado da quota seguida por uma transação condicional, com mecanismo de retry em contenção.

Referência:
- https://raw.githubusercontent.com/marcelo-jgoncalves/expiration-tracker/main/src/modules/identity/application/quota.ts

E o handler de itens chama essa quota antes das operações normais.

Referência:
- https://raw.githubusercontent.com/marcelo-jgoncalves/expiration-tracker/main/src/modules/expiration/http/item-handlers.ts

Isso significa que um simples:

```text
GET /items
```

pode precisar:

```text
DynamoDB Get quota
        +
TransactWriteItems
        +
query real do DynamoDB
```

além de todo o RequestContext anterior.

Para mim, esse mecanismo é sofisticado demais para uma quota genérica de API.

## Minha recomendação

Separaria dois conceitos.

Para proteção genérica contra excesso de requests, usaria o throttling já disponível na camada HTTP/API Gateway.

Manteria a quota persistente de negócio para operações em que ela realmente importa financeiramente ou comercialmente, por exemplo:

```text
extração por IA
upload/processamento de documento
WhatsApp/SMS
e-mail
exportações pesadas
alguma funcionalidade limitada pelo plano
```

Nesses casos a forte garantia transacional tem valor.

Para uma leitura normal do dashboard, o custo de uma transação persistente por request é difícil de justificar.

## Se a quota por tenant realmente precisar existir em todas as chamadas

Ainda assim eu reavaliaria o algoritmo para algo baseado em um `UpdateItem` atômico/contador, eventualmente com bucket temporal ou sharding, em vez de `Get + TransactWrite` para cada chamada.

Esse ponto sozinho pode retirar uma quantidade significativa de DynamoDB do hot path.

---

# 8. P0 — O dashboard pode crescer sem limite

O serviço de domínio já aceita `limit`.

O handler do endpoint de dashboard, entretanto, chama:

```text
listDashboard(...)
```

sem fornecer `limit` nem cursor.

Referência:
- https://raw.githubusercontent.com/marcelo-jgoncalves/expiration-tracker/main/src/modules/expiration/http/item-handlers.ts

Isso significa que a API está conceitualmente preparada para paginação, mas a interface principal pode pedir todo o conjunto daquela partição/status.

No frontend, os elementos recebidos são posteriormente ordenados, filtrados, agrupados e renderizados.

Referência:
- https://raw.githubusercontent.com/marcelo-jgoncalves/expiration-tracker/main/frontend/src/routes/Overview.tsx

Com 20 documentos isso é irrelevante.

Com 5.000, deixa de ser.

O custo cresce em todas as camadas:

```text
DynamoDB read
      ↓
Lambda memory/serialization
      ↓
API Gateway payload
      ↓
BFF
      ↓
internet
      ↓
JSON.parse
      ↓
arrays JS
      ↓
React
      ↓
DOM
```

## Recomendo dois endpoints/conceitos distintos

O Overview não precisa carregar o inventário inteiro.

Por exemplo:

```text
/dashboard?status=ACTIVE&limit=30
```

com os itens de interesse mais próximos do vencimento.

Na tela de inventário:

```text
limit=50
cursor=...
```

usando `LastEvaluatedKey`.

TanStack Query pode implementar isso muito bem com paginação ou infinite query.

Se, futuramente, clientes tiverem milhares de itens visíveis ao mesmo tempo, aí sim vale adicionar virtualização no frontend.

---

# 9. P1 — As Lambdas estão dimensionadas uniformemente em 256 MB

O módulo Terraform define atualmente **256 MB como memória padrão**, e várias funções herdam esse valor.

Referência:
- https://raw.githubusercontent.com/marcelo-jgoncalves/expiration-tracker/main/infra/modules/lambda-function/variables.tf

Isso me parece um candidato fortíssimo a otimização.

Em Lambda, memória não representa apenas memória: **CPU aumenta proporcionalmente à memória configurada**.

A própria AWS recomenda testar configurações diferentes e aponta o AWS Lambda Power Tuning como ferramenta para encontrar o melhor equilíbrio entre duração e custo.

Referência:
- https://docs.aws.amazon.com/lambda/latest/dg/configuration-memory.html

Portanto:

```text
256 MB mais barato por ms
```

não significa necessariamente:

```text
256 MB mais barato por request
```

Se 512 ou 1024 MB reduzirem uma Lambda de, por exemplo, centenas de milissegundos para muito menos, o custo final pode ser semelhante ou até inferior.

## Eu faria Power Tuning especialmente em

- BFF;
- item/read API;
- reminder dispatch;
- extração/processamento de documentos;
- qualquer Lambda com ADOT e várias dependências.

Não recomendo aumentar todas cegamente.

Recomendo **deixar de usar 256 MB como tamanho universal**.

---

# 10. P1 — Node.js 20 precisa sair agora

O projeto fixa Node 20 tanto no `package.json` quanto no build e no runtime Lambda.

Referência:
- https://github.com/marcelo-jgoncalves/expiration-tracker/blob/main/package.json

Em **31 de agosto de 2026**, isso já merece atenção imediata: a AWS marca o runtime `nodejs20.x` como depreciado desde **30 de abril de 2026**.

A AWS indica bloqueio de criação de novas funções com esse runtime a partir de 1º de fevereiro de 2027 e bloqueio de updates a partir de 3 de março de 2027.

Referência:
- https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html

Eu migraria para **Node.js 22** agora.

Node 24 pode ser avaliado posteriormente, principalmente verificando compatibilidade com a versão da layer ADOT utilizada.

Isso não é apenas uma otimização de performance; tornou-se dívida tecnológica com prazo.

---

# 11. P1 — ADOT em todas as Lambdas merece benchmark

O módulo Lambda injeta a layer ADOT e:

```text
AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler
```

em todas as funções criadas pelo módulo.

Referência:
- https://raw.githubusercontent.com/marcelo-jgoncalves/expiration-tracker/main/infra/modules/lambda-function/main.tf

Observabilidade é importante e eu **não removeria OpenTelemetry simplesmente para ganhar alguns milissegundos**.

Mas instrumentar tudo indiscriminadamente possui custo de inicialização.

Isso é particularmente relevante em funções pequenas, onde o código de negócio pode levar menos tempo para inicializar que a própria instrumentação.

Atualizações do AWS Distro for OpenTelemetry acrescentaram mecanismos para limitar as instrumentações carregadas justamente com foco em melhorar cold start, através de configurações como `OTEL_NODE_ENABLED_INSTRUMENTATIONS`.

Referência:
- https://github.com/aws-observability/aws-otel-lambda/blob/main/CHANGELOG.md

## Recomendo um benchmark

```text
BFF + ADOT completo
BFF + ADOT seletivo
```

mantendo apenas instrumentações que realmente geram valor, por exemplo Lambda, AWS SDK e HTTP, conforme a necessidade real do projeto.

Depois comparar:

```text
INIT Duration
Duration warm
p95
p99
tamanho do bundle
```

---

# 12. O build das Lambdas tem coisas boas — e uma oportunidade

O projeto usa esbuild para produzir um bundle separado por handler.

Isso é **bom para cold start**, e a AWS SDK v3 também se beneficia de bundling porque reduz resolução de módulos e I/O durante a inicialização.

Referência:
- https://github.com/marcelo-jgoncalves/expiration-tracker/blob/main/scripts/build-lambdas.ts

Eu **não externalizaria o AWS SDK apenas porque o Lambda possui SDK no runtime**.

Ter sua versão controlada e bundleada é uma decisão mais previsível.

Por outro lado:

```text
minify: false
sourcemap: external
```

estão configurados no build.

Como o Terraform arquiva o diretório de saída, vale verificar quanto os `.map` estão adicionando ao ZIP de cada Lambda.

Eu adicionaria ao build:

```text
esbuild metafile
bundle-size report
compressed zip size
```

e um budget por Lambda.

Se o source map não for necessário dentro do runtime, pode permanecer como artefato de CI/observabilidade em vez de entrar no pacote da função.

Esse é um ganho secundário, mas fácil de medir.

---

# 13. P1 — O frontend está enviando código demais inicialmente

O `App.tsx` importa estaticamente as páginas:

```text
Overview
Items
ItemDetail
Settings
...
```

em vez de carregá-las por rota.

Referência:
- https://raw.githubusercontent.com/marcelo-jgoncalves/expiration-tracker/main/frontend/src/App.tsx

Com Vite/React, é simples transformar isso em dynamic imports com `React.lazy`.

O efeito seria:

```text
login/dashboard
   ↓
baixar somente código necessário para dashboard

usuário abre configurações
   ↓
baixar chunk de configurações
```

em vez de colocar tudo no grafo inicial.

Vite suporta naturalmente code splitting por imports dinâmicos.

Referência:
- https://vite.dev/guide/build

Eu adicionaria também um budget de JavaScript comprimido no CI.

Esse ganho tende a ficar cada vez maior conforme novas funcionalidades forem adicionadas ao SaaS.

---

# 14. TanStack Query está subutilizado para performance

O projeto já escolheu uma excelente ferramenta para isso.

Mas várias queries não estabelecem uma estratégia de freshness, portanto seguem perto do comportamento padrão `staleTime = 0`.

A documentação do TanStack explica que queries são consideradas stale por padrão e podem ser refetched dependendo de mounts/reconexões e outras condições.

Referência:
- https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults

No projeto eu diferenciaria dados.

```text
Session                  → compartilhada; política curta
Dashboard                → 15–60 s, por exemplo
Item details             → algum staleTime
Configurações estáticas  → minutos
```

Valores são exemplos a serem validados, não regras.

Depois das mutations:

```text
create
update
renew
archive
```

o frontend executaria `invalidateQueries` seletivamente.

Assim conseguimos consistência percebida pelo usuário sem transformar cada navegação numa round-trip.

---

# 15. P1 — O SLO de burst precisa de um teste específico

A arquitetura cita um cenário extremamente exigente de até **1 milhão de occurrences simultâneas drenadas em cinco minutos**.

Referência:
- https://github.com/marcelo-jgoncalves/expiration-tracker/blob/main/ARCHITECTURE.md

Ao mesmo tempo, o reminder dispatch usa atualmente:

```text
SQS batch size = 10
reserved concurrency = 10
```

e outros workers também possuem limites bastante conservadores.

Referência:
- https://raw.githubusercontent.com/marcelo-jgoncalves/expiration-tracker/main/infra/main.tf

A AWS permite batches bem maiores em SQS Standard e oferece controles explícitos de concorrência do event source mapping.

Ela também escala consumidores Lambda automaticamente, dentro dos limites configurados.

Referência:
- https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html

Não estou dizendo que `10/10` está errado.

Estou dizendo que **não há base para acreditar que ele satisfaz aquele SLO extremo sem um benchmark**.

O ótimo pode ser, por exemplo:

```text
batch 25
batch 50
batch 100
```

com concorrências diferentes.

Mas isso precisa considerar:

```text
DynamoDB
SES
WhatsApp futuro
outros provedores
limites downstream
idempotência
retry
DLQ
```

A implementação atual já possui `ReportBatchItemFailures`, o que torna o projeto bem preparado para aumentar batch sem reprocessar desnecessariamente registros bem-sucedidos.

Referência:
- https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-parameters.html

---

# 16. P2 — Existe um N+1 real na renovação

Encontrei também um caso mais tradicional de performance.

No fluxo de `completeRenewal`, o serviço obtém pointers para policies e depois executa algo equivalente a:

```text
for each pointer:
    await store.get(pointer)
```

sequencialmente.

Referência:
- https://raw.githubusercontent.com/marcelo-jgoncalves/expiration-tracker/main/src/modules/expiration/application/expiration-service.ts

Isso é um N+1.

Provavelmente hoje o número de policies por item é pequeno e não chega a ser perceptível, mas o padrão pode ser melhorado usando:

```text
BatchGetItem
```

ou, se a cardinalidade for garantidamente muito pequena, `Promise.all` com limite conhecido.

É uma otimização válida, porém está muito abaixo dos problemas do hot path de autenticação/contexto.

---

# 17. BFF → Resource API adiciona um hop, mas eu não mexeria nisso primeiro

O BFF usa `fetch()` para encaminhar a request para outra HTTP API.

Referência:
- https://github.com/marcelo-jgoncalves/expiration-tracker/blob/main/src/modules/bff/application/proxy-service.ts

Portanto existe:

```text
browser
→ API Gateway
→ BFF Lambda
→ API Gateway
→ resource Lambda
```

Isso naturalmente custa mais que:

```text
browser
→ API Gateway
→ Lambda
```

Mas eu **não eliminaria a arquitetura BFF agora**.

Ela está fazendo um trabalho importante de segurança, sessão e isolamento das credenciais.

Antes disso, eliminaria:

- duplicate session request;
- session write por request;
- contexto excessivo;
- quota transacional por GET;
- dashboard ilimitado.

Depois dessas alterações, eu mediria novamente.

Se o segundo API Gateway ainda representar uma parcela relevante do p95, aí sim avaliaria um endpoint agregado específico no BFF, como um `/bff/home`, em vez de desmontar toda a separação arquitetural.

---

# 18. CloudFront está essencialmente no caminho certo

Para os assets da SPA há `CachingOptimized` e compressão habilitada; para o BFF o cache está desabilitado, o que é apropriado para conteúdo autenticado e dependente de sessão.

Referência:
- https://raw.githubusercontent.com/marcelo-jgoncalves/expiration-tracker/main/infra/modules/spa-hosting/main.tf

Eu apenas verificaria no processo de deploy se existe uma distinção explícita:

```text
/assets/app-ABCD123.js
Cache-Control: public, max-age=31536000, immutable

index.html
Cache-Control: no-cache
```

Os bundles Vite possuem hash e são ideais para cache longo.

Já o `index.html` deve buscar rapidamente a versão atual.

Isso evita tanto desperdício quanto clientes presos em versões antigas.

---

# 19. Como eu mediria antes e depois

A observabilidade atual permite fazer isso muito bem.

Eu colocaria spans/métricas de aplicação nas fases críticas e usaria uma matriz de testes.

| Área | Métrica que interessa |
|---|---|
| Browser | LCP, INP, tamanho JS, waterfall |
| API Gateway | Latency e IntegrationLatency |
| BFF | p50/p95/p99 e INIT Duration |
| Sessão | tempo Get, touch e número de writes |
| RequestContext | duração total e por etapa |
| Quota | duração, retries e contenção |
| DynamoDB | latency, consumed capacity, throttles |
| Lambda | Duration, INIT, MaxMemoryUsed, concurrency |
| SQS | backlog, age of oldest message, drain time |
| CloudFront | cache-hit ratio |
| Workers | records/s e erro parcial |

E testaria pelo menos estes cenários numa única campanha de performance:

1. primeiro carregamento autenticado;
2. navegação depois do warm-up;
3. dashboard com poucos, centenas e milhares de itens;
4. múltiplas requests concorrentes do mesmo tenant;
5. concorrência durante refresh da sessão;
6. renovação com várias reminder policies;
7. burst dos reminders;
8. cold starts do BFF e principais handlers;
9. warm starts;
10. diferentes memórias Lambda e configurações ADOT.

Isso produziria evidência suficiente para deixar de trabalhar com hipóteses.

---

# 20. Ordem em que eu implementaria

Eu faria a otimização em quatro etapas, nessa ordem.

## Fase A — remover desperdícios óbvios

- unificar `/bff/session`;
- adicionar limite/paginação ao dashboard;
- migrar Node 20 → 22;
- instrumentar tempos internos do BFF/RequestContext/quota.

## Fase B — atacar o hot path

- tornar o session touch periódico em vez de por request;
- criar o fast path do RequestContext;
- retirar a quota transacional de GETs normais;
- mover `createProfileIfAbsent` para fora do fluxo recorrente.

## Fase C — otimizações de runtime/UI

- Lambda Power Tuning por função;
- ADOT seletivo;
- route-level lazy loading;
- `staleTime`/invalidations apropriados;
- bundles e source maps auditados.

## Fase D — escalabilidade assíncrona

- benchmark sistemático de batch/concurrency SQS;
- teste do cenário extremo definido pela arquitetura.

Eu evitaria misturar essas fases em uma grande refatoração.

Especialmente Fase A e B devem ser medidas antes/depois para sabermos quanto cada alteração efetivamente removeu.

---

# 21. Avaliação final

Eu classificaria a arquitetura atual aproximadamente assim:

| Aspecto | Avaliação |
|---|---:|
| Arquitetura geral | **Muito boa** |
| Escalabilidade estrutural | **Muito boa** |
| Confiabilidade | **Excelente** |
| Segurança/isolamento | **Muito boa** |
| Uso do DynamoDB | **Bom**, mas com excesso no hot path |
| Backend synchronous performance | **Precisa otimização** |
| Frontend startup | **Precisa otimização** |
| Assíncrono | **Bem desenhado, ainda não comprovado por carga** |
| Observabilidade | **Boa base** |
| Evidência empírica de performance | **Ainda insuficiente** |

O mais interessante é que **eu não encontrei uma arquitetura errada que precise ser substituída**.

Encontrei uma arquitetura bastante madura que sofreu um fenômeno comum em sistemas projetados com muita preocupação com correção: várias pequenas garantias foram sendo adicionadas ao caminho crítico e, juntas, passaram a produzir uma quantidade excessiva de trabalho.

Isso é uma situação muito melhor do que ter que redesenhar o sistema.

---

# 22. Os cinco trabalhos que eu abriria primeiro no backlog

1. **PERF-01 — Single Session Bootstrap**  
   Uma única obtenção da sessão no frontend, compartilhada entre autenticação e organização ativa.

2. **PERF-02 — Session Touch Coalescing**  
   Renovar o idle timeout apenas quando atingir um threshold, preservando a política de segurança.

3. **PERF-03 — Request Context Fast Path**  
   Eliminar onboarding/profile discovery e outras resoluções desnecessárias das requests normais.

4. **PERF-04 — API Quota Redesign**  
   Tirar `Get + TransactWrite` de requests normais e manter quotas fortes somente onde possuem significado comercial/custo.

5. **PERF-05 — Bounded Dashboard**  
   Cursor + limite no backend, paginação no frontend e consulta de Overview limitada aos itens relevantes.

Eu considero **PERF-01 a melhor implementação inicial**, porque é simples, pouco invasiva e já remove uma chamada inteira de um caminho que hoje é caro.

Mas **PERF-02, PERF-03 e PERF-04 são onde acredito que esteja a maior redução absoluta de latência backend**.

E um trabalho independente deve entrar imediatamente:

**migrar as Lambdas de Node 20 para Node 22**, porque o runtime utilizado pelo projeto já passou da data de depreciação da AWS em 30 de abril de 2026.

Referência:
- https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html

---

# Conclusão executiva

**Eu manteria Lambda, DynamoDB, BFF, single-table, SQS e a arquitetura serverless atual. A estratégia correta é emagrecer o caminho crítico, não trocar a arquitetura.**

As maiores oportunidades de ganho estão em:

1. reduzir chamadas duplicadas no frontend;
2. reduzir leituras/escritas de sessão por request;
3. simplificar a reconstrução de contexto de autorização;
4. remover a quota transacional do caminho de leituras comuns;
5. limitar e paginar o dashboard;
6. dimensionar Lambdas por benchmark em vez de configuração uniforme;
7. otimizar cold start e bundle;
8. testar empiricamente capacidade dos workers SQS.

O projeto já possui uma base arquitetural forte. A próxima etapa correta é transformar essas hipóteses em **medições reproduzíveis de latência, throughput e custo**, aplicar as otimizações de maior impacto e comparar os resultados antes/depois.

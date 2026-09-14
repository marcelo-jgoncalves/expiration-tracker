# PERF-13 — DynamoDB/Capacity Model v2

Análise de capacidade e padrões de acesso do DynamoDB, item "personas small/medium/large;
Contributor Insights; separar cold table capacity de bottleneck real" do Ciclo C
(`docs/engineering/performance/TODO.md`). Diferente de PERF-11/PERF-12, este item **não** depende
da quota de concorrência Lambda travada em 10 (`PERF-01-account-quotas.md`) — é uma tarefa de
análise de capacidade/padrão de acesso do DynamoDB, não de carga real. Executado só com
`aws dynamodb`/`aws cloudwatch` (perfil `claude-dev`, conta 975707451904, `us-east-1`), sem tocar
Terraform nem alterar capacidade/config de nenhuma tabela.

## 1. Inventário das tabelas

`aws dynamodb list-tables` (conta/região do ambiente dev) devolve, além de tabelas de outros
projetos pessoais não relacionados (`marcelo-goncalves-blog-*`, `financial-intelligence-*`,
`terraform-lock-stocks-ranking`), exatamente **3 tabelas do expiration-tracker**:

| Tabela | Módulo Terraform | Billing mode | Propósito |
|---|---|---|---|
| `exptrk-dev-table` | `infra/modules/dynamo-table` | `PAY_PER_REQUEST` (on-demand, D-014) | Tabela principal single-table design — todo o domínio de negócio (Item, Subject, Requirement, Reminder, etc.) |
| `exptrk-dev-bff-session` | `infra/modules/bff-session-table` | `PAY_PER_REQUEST` | Sessões do BFF (cookies `__Host-et_session`) |
| `exptrk-dev-guest-credential-delivery` | `infra/modules/guest-credential-delivery-table` | não inspecionada em detalhe (fora do escopo do handler `TABLE_NAME`) | Entrega de credenciais de guest access |

O `TABLE_NAME` injetado nos handlers (`infra/main.tf:42`, `common_env`) aponta para
`module.table.table_name`, isto é, `exptrk-dev-table` — confirma que é essa a tabela que concentra
o tráfego de negócio medido em PERF-04/PERF-05.

**`exptrk-dev-table` (single-table design, confirma ADR-0009)**:

- Chave primária: `PK` (hash) + `SK` (range), ambas string.
- **9 GSIs** (GSI1–GSI9), todas `ALL` projection exceto GSI3 e GSI8 (`KEYS_ONLY`, tabelas
  tenantless de scheduler/maintenance — isoladas via IAM dedicado, nunca na policy geral;
  `infra/modules/dynamo-table/main.tf:1-25` documenta o motivo).
- `billing_mode = PAY_PER_REQUEST` (on-demand) — decisão D-014, sem provisionamento manual.
- PITR habilitado, SSE (chave gerenciada AWS), Streams `NEW_IMAGE`, TTL em `purgeAfterTtl`.
- `aws dynamodb describe-table` (14/09/2026): `ItemCount: 64`, `TableSizeBytes: 25797` (~25 KB).

> **Caveat honesto**: `ItemCount`/`TableSizeBytes` do `describe-table` são estimativas que a AWS
> atualiza aproximadamente a cada 6 horas, não em tempo real — não usar para decisões finas de
> capacidade, só como ordem de grandeza. 64 itens é consistente com o tenant de teste do PERF-04
> (7 Items + 2 Subjects + registros de auditoria/GSI/organization/membership associados) — ainda
> assim uma tabela "fria" por volume.

## 2. Contributor Insights

Estado antes desta tarefa: `DISABLED` nas 3 tabelas (`describe-contributor-insights`). É um
recurso de diagnóstico somente leitura — não altera capacidade nem comportamento da tabela, custo
adicional pequeno (cobrança por regra do CloudWatContributor Insights) — mesma categoria do
monitoramento read-only já feito em PERF-02. É um toggle simples via CLI
(`aws dynamodb update-contributor-insights`), **não** um recurso gerenciado por Terraform neste
repo (não existe `aws_dynamodb_contributor_insights` em `infra/`), então habilitá-lo aqui não é
uma mudança de infraestrutura versionada — decisão: habilitar.

Ação executada: `update-contributor-insights --contributor-insights-action ENABLE` nas 3 tabelas
(`exptrk-dev-table`, `exptrk-dev-bff-session`, `exptrk-dev-guest-credential-delivery`). Confirmado
`ENABLED` ~90s depois via `describe-contributor-insights`, com as 4 regras padrão criadas
(`PKC`/`SKC`/`PKT`/`SKT` — most-accessed e throttled keys por partition/sort key).

**Resultado (honesto)**: capacidade habilitada e verificada, **sem dados ainda**. Checado via
`aws cloudwatch list-metrics --namespace AWS/DynamoDB --metric-name MostAccessedKeys` logo após a
ativação — nenhuma métrica publicada. Contributor Insights precisa de tráfego real fluindo através
da regra para começar a publicar métricas (normalmente leva alguns minutos de tráfego contínuo, não
só o intervalo de propagação da regra), e a Seção 3 abaixo (métricas de `ConsumedCapacity`) mostra
que o tráfego real no ambiente dev, mesmo nos dias de pico, é de dezenas a poucas centenas de
requisições — provavelmente insuficiente para popular hot-key data de forma significativa no curto
prazo. Isto é **"capability verified, no data yet"**, não "nenhum problema encontrado" — não há
achado de hot key/hot partition a reportar porque não há volume suficiente para produzi-lo, não
porque foi descartado. Contributor Insights fica habilitado (é barato, reversível, e vai continuar
coletando); uma sessão futura com mais tráfego acumulado (ou durante um load test real, quando a
quota de concorrência Lambda for resolvida) deve reconsultar
`list-contributor-insights`/`MostAccessedKeys`/`ThrottledKeys` no CloudWatch.

## 3. Personas small/medium/large — modelagem por leitura de código

**Importante**: esta seção é raciocínio arquitetural a partir do desenho de chaves real no código
(`src/modules/*/persistence/dynamodb-*-store.ts`, `src/shared/dynamodb/`,
`infra/modules/dynamo-table/main.tf`), **não** medição empírica em escala. Gerar de fato um tenant
"large" via API do produto seria pesado/lento e se sobrepõe ao território de load testing (PERF-11),
hoje bloqueado pela quota de concorrência Lambda travada em 10 (PERF-01) — fora do escopo desta
tarefa, que é só análise de capacidade.

### Padrão de chaves observado

- **Chave primária (PK/SK) da tabela base**: `PK = TENANT#<tenantId>#<ENTITY>#<entityId>`
  (confirmado em múltiplos stores — `dynamodb-expiration-store`, workers de purge/reindex,
  `idempotency.ts`, `activity-service.ts` etc.). **Não é `tenantId` sozinho** — cada entidade
  (Item, Subject, Requirement, DocumentVersion, ...) tem seu próprio valor de PK dentro do
  namespace do tenant. Isso já distribui a carga de escrita de um tenant entre muitas partition
  keys físicas em vez de concentrar tudo numa única partição por tenant.
- **GSI1 (exemplo real, `organization.ts:81`)**: `GSI1PK = TENANT#<tenantId>#ITEMSTATUS#ACTIVE`
  — aqui sim a granularidade é "todos os itens ACTIVE de um tenant" compartilham a mesma partition
  key do índice, não por entidade individual. Mesmo padrão em GSI1 para Requirements
  (`REQSTATUS#<status>`).
- **GSI8 (MaintenanceDueIndex)**: `PK = WORK#<workerType>` — tenantless por design, granularidade é
  por *tipo de worker* (10 workers cadastrados), não por tenant; SK carrega `<dueAtIso>#TENANT#...`
  para ordenação global por vencimento.
- **Idempotência**: `PK = TENANT#<tenantId>#IDEMPOTENCY#<operation>` — uma partição por
  (tenant, tipo de operação), mais estreita que a chave de entidade.

### Personas definidas

| Persona | Volume por tenant | Base | 
|---|---|---|
| **Small** | ~10 itens (7 Items + 2 Subjects + afins) | Tenant de teste real do PERF-04 |
| **Medium** | ~1.000 itens/tenant | Estimativa de tenant PME ativo |
| **Large** | ~50.000 itens/tenant | Estimativa de tenant enterprise/portfólio grande |

### Avaliação de risco de hot partition

- **Tabela base (PK/SK por entidade)**: risco **baixo** em qualquer persona. Como o PK já é
  granular por entidade (`TENANT#t#ITEM#<itemId>`, não `TENANT#t` sozinho), mesmo na persona large
  (50k itens) a carga de leitura/escrita de um tenant se espalha por até 50k partition keys físicas
  distintas — não há concentração estrutural num único hot key pela chave primária. Throughput
  on-demand escala por partição individualmente; o desenho evita o antipadrão clássico "PK = tenant
  id" que concentraria todo o tráfego de um tenant grande numa partição só.
- **GSI1 (`ITEMSTATUS#ACTIVE` / `REQSTATUS#<status>`)**: risco **moderado, dependente de escala e
  de padrão de escrita, não de leitura**. Toda vez que um Item de um tenant grande é criado ou tem
  seu status alterado para/de ACTIVE, a entrada do GSI1 é reescrita sob a mesma `GSI1PK` que todos
  os outros itens ACTIVE do mesmo tenant. Na persona large (50k itens, boa parte provavelmente
  ACTIVE), isso concentra logicamente muitas entradas sob uma única partition key do índice. Em
  regime de leitura (listar itens ativos) isso é o padrão de acesso pretendido e o comportamento
  correto de uma GSI — o risco real é de **escrita concorrente em rajada** nessa mesma partition
  key (ex.: uma reconciliação em lote que atualiza milhares de itens ACTIVE de um único tenant
  grande quase simultaneamente). DynamoDB on-demand tem adaptive capacity que ajuda a absorver
  picos numa única partition key, mas ainda existe um teto físico por partição (não documentado
  publicamente com precisão pela AWS, historicamente da ordem de milhares de WCU/partição) — um
  tenant *large* com um job de atualização em massa poderia, em tese, esbarrar nesse teto antes de
  qualquer outro tenant sentir efeito (isolamento é por partição física, não hard-limit por tenant).
  Isso é uma hipótese de risco a validar com um load test real (PERF-11, bloqueado hoje), não um
  problema observado — o volume atual (Seção 3, tenant small) é ordens de magnitude abaixo do que
  seria necessário para expor esse comportamento.
- **GSI8 (`WORK#<workerType>`)**: risco **baixo a moderado**, mas por design deliberado e já
  mitigado — é `KEYS_ONLY` (menor custo por escrita/leitura), sparse (só itens elegíveis aparecem),
  e cada worker já lê com `Query` + `LeadingKeys` restrito ao seu próprio namespace
  (`gsi8_read` no Terraform). Mesmo assim, na persona large, um único worker (ex.:
  `document_file_reconciliation`) processando itens vencidos de **todos os tenants** ao mesmo tempo
  concentra leitura numa única partition key global (`WORK#DOCUMENT_FILE_RECONCILIATION`) — esse é
  o padrão intencional de um "índice de fila", não um bug, mas é o ponto de maior concentração
  estrutural de tráfego do modelo hoje. Ordenado por `dueAtIso` (D-170), então o worker sempre lê
  o início do range — não é um hot key único parado, é uma partição de índice ativa por design.
- **GSI3 (scheduler)**: mesmo padrão de concentração que GSI8 (tenantless, `KEYS_ONLY`), mesma
  mitigação (IAM restrito a um único consumidor, ReminderProducer).

### Billing mode: on-demand é adequado para as 3 personas?

Sim, com uma ressalva. `PAY_PER_REQUEST` (D-014) é a escolha correta para small/medium — tráfego
baixo e imprevisível, sem necessidade de gerenciar auto-scaling. Para a persona large **com padrão
de rajada previsível e repetido** (ex.: reconciliação diária em lote de um tenant de 50k itens),
on-demand ainda funciona (ele escala automaticamente), mas cada rajada nova para uma partition key
"fria" fica sujeita ao limite inicial de burst do on-demand (o "warm throughput" de uma partição só
cresce depois que ela já viu tráfego sustentado) — não é uma limitação que provisioned capacity +
auto-scaling resolveria melhor de graça, porque auto-scaling reage com atraso a picos súbitos
também. Não há evidência hoje (Seção 4) de que isso seja um problema real — é uma reavaliação a
fazer se/quando existir um tenant de fato grande em produção.

## 4. Cold table capacity vs. bottleneck real

Pergunta: a lentidão observada em PERF-04 (`subjects-handler` p95=647ms, `items-handler`
p95=1005ms) é causada por capacidade/throttling do DynamoDB, ou é outra coisa?

**Métricas reais do CloudWatch, `exptrk-dev-table`, últimos 7 dias (07/09 a 14/09/2026,
`us-east-1`, perfil `claude-dev`)**:

| Métrica | Resultado |
|---|---|
| `ThrottledRequests` (Sum, period=1d) | **`Datapoints: []`** — zero throttling em qualquer dia da janela |
| `ReadThrottleEvents` / `WriteThrottleEvents` | **`Datapoints: []`** — idem |
| `SystemErrors` | **`Datapoints: []`** — nenhum erro de sistema do DynamoDB |
| `ConsumedReadCapacityUnits` (Sum diário) | pico de **1056** no dia 13/09 (dia de maior atividade — sessão de seed do PERF-04); demais dias entre 0 e ~250; `Maximum` (por datapoint de 5 min) nunca passou de **4.0** |
| `ConsumedWriteCapacityUnits` (Sum diário) | pico de **293** no dia 13/09; demais dias 0–15; `Maximum` por datapoint de 5 min nunca passou de **10.0** |

**Conclusão**: a tabela está estruturalmente "fria" — nenhum indício de throttling, nenhum erro de
sistema, consumo de capacidade ordens de magnitude abaixo de qualquer limite relevante de uma
tabela on-demand (limite de burst de partição é de milhares de RCU/WCU; aqui o pico observado foi
de dígitos simples por período de 5 minutos). **A latência p95 medida em PERF-04
(subjects-handler 647ms, items-handler 1005ms) não é explicada por capacidade/throttling do
DynamoDB** — as métricas eliminam essa hipótese com evidência direta, não por suposição. A causa
provável está em outra camada (cold start de Lambda, overhead de resolução de
RequestContext/autorização, lógica de negócio, latência de rede do BFF) — decidir a causa exata é
escopo de outros itens do plano (PERF-05 Power Tuning, instrumentação de spans PERF-02), não deste
item, mas esta análise já separa com evidência real: **não é capacidade fria da tabela**.

## Arquivos

- `docs/engineering/performance/results/PERF-13-dynamodb-capacity.md` — este documento.
- Contributor Insights habilitado (via CLI, não Terraform) em `exptrk-dev-table`,
  `exptrk-dev-bff-session`, `exptrk-dev-guest-credential-delivery` — estado vivo na conta AWS, não
  versionado em código.

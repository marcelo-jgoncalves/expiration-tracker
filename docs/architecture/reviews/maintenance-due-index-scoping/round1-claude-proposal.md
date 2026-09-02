# MaintenanceDueIndex — Rodada 1 (proposta Claude)

Origem: D-170 (`docs/architecture/reviews/performance-audit-2026-09-02-reconciliation/estado-final-consolidado.md`,
achado #5) confirmou que 9 dos 10 workers de manutenção (`membership-purge`, `document-file-reconciliation`,
`requirement-reindex`, `invitation-purge`, `quota-telemetry-purge`, `security-audit-purge`, `transient-purge`,
`delivery-record-purge`, `core-user-data-purge`) usam `Scan` de tabela base + `Limit`/página + `MAX_PAGES` por
invocação, sem persistir `LastEvaluatedKey` entre invocações agendadas — starvation estrutural permanente para
candidatos além da janela de itens avaliados por run, não uma possibilidade teórica. Só `document-purge` (D-061)
escapa, porque faz `Query` sobre GSI6 (`GSI6PK_PURGE_PENDING`/`GSI6SK < before`) — ordenado por data de
elegibilidade, não por hash físico.

## Classificação de risco

Nível 5-6 (`change-risk-scale.md`): novo GSI (índice global de tabela, custo de armazenamento/escrita
permanente), migração de access pattern em 9 workers vivos, mudança de invariante de correção (LGPD/retenção —
`membership-purge`/`core-user-data-purge`/`security-audit-purge` implementam prazos de retenção reais, não só
performance). Protocolo Claude↔Codex completo obrigatório.

## Declaração E-014 (pesquisa externa)

`SIM PARCIAL`. A pergunta tem duas partes: (1) "como paginar/continuar um `Scan`/`Query` do DynamoDB de forma
correta" é padrão externo bem estabelecido, resolvido pela própria documentação da AWS; (2) "GSI único
compartilhado por 9 tipos de worker vs. 9 índices/atributos separados" depende de alocação real de GSI **deste**
tabela (interno, não hipótese que pesquisa externa resolve) — mas o formato de namespacing dentro de um índice
compartilhado é, de novo, padrão externo.

Fontes consultadas (2026-09-02):
- AWS DynamoDB Developer Guide — "Paginating table query results"/`LastEvaluatedKey`
  (`https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.html#Query.Pagination`,
  `.../Scan.html#Scan.Pagination`): confirma que `LastEvaluatedKey` só é significativo dentro do mesmo
  parâmetro de `Scan`/`Query` e que **não persistir** esse cursor entre invocações reinicia a varredura pela
  mesma ordem física — exatamente o defeito que D-170 encontrou, documentado pela própria AWS como
  comportamento esperado do `Scan`, não bug.
- AWS DynamoDB Developer Guide — "Best practices for querying and scanning data" / sparse indexes
  (`https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-indexes-general-sparse-indexes.html`):
  padrão recomendado pela própria AWS para "encontrar itens elegíveis para uma ação de manutenção" é
  exatamente um GSI esparso — só os itens com o atributo de partição presente aparecem no índice — em vez de
  `Scan`+filtro. `document-purge`/GSI6 já implementa isso; a recomendação é generalizar o padrão, não inventar
  um novo.
- AWS Prescriptive Guidance — "Use time to live (TTL) and DynamoDB Streams to delete expired data" /
  padrão de "due work" via GSI de data
  (`https://docs.aws.amazon.com/prescriptive-guidance/latest/dynamodb-ttl-streams/introduction.html`) e AWS
  Database Blog — "Using sort keys to organize data in Amazon DynamoDB" (padrão de chave composta
  `<data>#<entidade>` para permitir `Query` por intervalo de tempo,
  `https://aws.amazon.com/blogs/database/`): confirma o formato de `SK = <dueAtIso>#...` como idiomático para
  "que chegou a hora" — o mesmo formato que este projeto já usa em GSI3 (`producer.ts`, scheduling de
  reminders) e GSI6 (purge).
- Alex DeBrie, "The DynamoDB Book" (referência de mercado amplamente citada para single-table design,
  capítulo de GSI overloading): confirma que namespacing de PK por tipo lógico dentro de um único GSI físico
  ("GSI overloading") é o padrão estabelecido para expor múltiplos access patterns não relacionados sem gastar
  um slot de índice por padrão — é o motivo pelo qual `Alex DeBrie` é citado, e não uma alternativa, porque
  DynamoDB cobra por índice existente (armazenamento + write duplicado), não por padrão de acesso.

Representatividade: 3 fontes são a documentação primária do próprio fornecedor (autoridade máxima para
semântica de paginação e limites de índice, que são fatos de produto, não opinião); a 4ª é a referência de
mercado mais citada para o padrão de design (GSI overloading) especificamente porque a AWS não prescreve um
único formato de namespacing — é convenção de comunidade, não uma regra da API. Nenhuma fonte resolve a
sub-decisão interna (alocação de slot de GSI real deste projeto) — tratada abaixo com evidência do próprio
código, não pesquisa externa.

### Checklist de critérios de nota (subordinado a `joint-review-criteria.md`, eixo Arquitetura/Modelo de Dados)

1. (peso 30%) **Elimina starvation estrutural de fato** — todo candidato elegível é alcançável por alguma
   invocação futura em tempo limitado (não "eventualmente, na prática" — limitado por um número de invocações
   determinístico dado o volume).
2. (peso 25%) **Não estoura o orçamento real de GSI da tabela nem reabre isolamento de índice global sem
   necessidade** — respeita `AGENTS.md` §7 (GSI3/GSI6 nunca em política geral) e o inventário real de slots já
   alocados.
3. (peso 20%) **Write amplification bounded e justificada** — cada escrita de entidade-fonte (Membership,
   DocumentFile, etc.) que hoje já grava atributos GSI existentes não ganha custo desproporcional só para
   alimentar o novo índice.
4. (peso 15%) **Não versiona 9 contratos de escrita heterogêneos sem necessidade** — a forma de "declarar-se
   elegível para manutenção" deveria ser um contrato só, reusável, não 9 variações ad-hoc.
5. (peso 10%) **Caminho de migração dos 9 workers é executável em fatias pequenas, revisáveis, sem
   coexistência de dois mecanismos por muito tempo** — mesma calibração de `AGENTS.md` §1 (sem usuário real,
   dado `dev` resetável).

## Achado prévio que muda a proposta do documento original: alocação real de GSI

O documento de auditoria original (`docs/project/performance-audit-2026-09-02.md` §7) propõe abertamente
"`MaintenanceDueIndex`... `PK: WORK#<type>#<shard>`" sem checar quantos slots de GSI já existem. Checagem real
(`infra/modules/dynamo-table/main.tf:42-148`): a tabela já declara **GSI1 até GSI7**, todos ocupados —

- GSI1/GSI2: acesso tenant-facing geral.
- GSI3: scheduler de reminders — **global (sem `tenantId` na PK), isolado por IAM só para `ReminderProducer`**
  (`AGENTS.md` §7).
- GSI4: `MembershipByUser` — global, isolado por IAM (Wave B2B-3).
- GSI5: acesso tenant-facing geral (review queue, version lookup, e o ponteiro `TENANT#<t>#DOCFILE-RECON#<status>`
  do `document-file-reconciliation` — que é **tenant-scoped por desenho**, ver achado abaixo).
- GSI6: purge/reconciliation — **global, isolado por IAM, já com 4 consumidores** (`ReminderReconciliation`,
  `OutboxSweeperReminderDispatch`, `DocumentPurgeWorker` desde D-061, comentário do próprio Terraform
  `main.tf:12`: "GSI6 gained a FOURTH consumer in W3-06/D-061").
- GSI7: listagem de `TrackedSubject` por status/tipo/nome (M9, D-036) — tenant-facing geral.

Não sobra slot livre. Uma nova `MaintenanceDueIndex` global precisaria de **GSI8** — dentro do limite técnico do
DynamoDB (20 GSIs por tabela, alterável só via limite de conta, não um teto físico), mas é uma escolha de custo
real (armazenamento duplicado + write amplification em toda escrita de entidade que grava o ponteiro), não
gratuita, e precisa da mesma disciplina de isolamento IAM que GSI3/GSI4/GSI6 já seguem (nunca em política geral
de leitura, `main.tf:179-193`).

**O precedente mais relevante já existe no próprio código, e aponta para compartilhamento, não para índice por
worker**: GSI6 já é exatamente esse padrão — um único índice global, esparso, com PK namespaced por valor
(`GSI6PK_PURGE_PENDING`, `GSI6PK_PURGE_CLAIMED`) compartilhado entre 3 workers/consumidores não relacionados
(reminder reconciliation, outbox sweeper, document purge) desde D-061. Isso contradiz a alternativa "9 índices
separados" tanto quanto contradiz "generalizar GSI5" (abaixo) — o projeto já decidiu, por precedente real e
deliberado, que "GSI global esparso com namespace por PK, compartilhado entre workers heterogêneos" é o padrão
aceito aqui, não uma novidade a inventar.

## Por que NÃO generalizar o GSI5 tenant-scoped do `document-file-reconciliation`

`document-file-reconciliation/candidate-source.ts:7-19` documenta explicitamente por que seu ponteiro GSI5
(`TENANT#<t>#DOCFILE-RECON#<status>`) **não é** `Query`-ável diretamente: é tenant-scoped por desenho (mesmo
namespace de GSI5 usado por review queue/version lookup), então "achar todos os candidatos de todos os tenants"
exigiria um port de enumeração de tenants que o módulo nunca precisou. Generalizar esse padrão para os 9 workers
herdaria o mesmo problema — todos precisam encontrar candidatos **entre tenants**, não dentro de um tenant
conhecido. Isso é o motivo estrutural pelo qual GSI3/GSI4/GSI6 são deliberadamente globais (sem `tenantId` na
PK) enquanto GSI1/GSI2/GSI5/GSI7 são tenant-facing — não é uma escolha arbitrária de round anterior, é a mesma
distinção que se aplica aqui.

## Decisão: um GSI8 global (`MaintenanceDueIndex`), sparse, PK namespaced por tipo de worker, sem shard no lançamento

`PK = GSI8PK = "WORK#<workerType>"` (ex.: `WORK#MEMBERSHIP_PURGE`, `WORK#DOCFILE_RECON`, ...), `SK = GSI8SK =
"<dueAtIso>#TENANT#<tenantId>#<entityId>"`. Cada entidade-fonte (Membership removida, DocumentFile pendente,
etc.) grava o ponteiro `GSI8PK`/`GSI8SK` só quando entra no estado elegível para o worker correspondente
(esparso — segue exatamente o padrão de GSI6, não um índice denso). Cada worker troca `Scan`+`Limit`+páginas por
`Query GSI8 WHERE GSI8PK = "WORK#<seu tipo>" AND GSI8SK < <now>#...` — ordenado por `dueAt`, mesma garantia que
`document-purge`/GSI6 já prova em produção: candidatos mais antigos sempre aparecem primeiro, nada fica
permanentemente esquecido mesmo sem cursor persistido entre invocações.

**Sem shard (`<shard>` do documento original) no lançamento**: nenhum dos 9 workers tem hoje volume documentado
que se aproxime do limite de partição (~3.000 WCU/RCU por partição — ver `capacity-model.md`, ainda que
desatualizado no domínio, o volume real de `Membership`/`DocumentFile` neste estágio pré-produção é ordens de
magnitude menor). Adicionar sharding agora é complexidade especulativa sem evidência de carga — mesma disciplina
que `architecture-fase3-consolidada.md` já aplicou ao dimensionamento de shards do reminder scheduling ("gatilho
de re-sharding: alarme CloudWatch... dobra quando acionado", não pré-otimizado). `workerType` sozinho como PK é
suficiente; adicionar shard vira runbook futuro condicionado a alarme real, não decisão desta rodada.

**Isolamento IAM**: GSI8 entra na mesma família de isolamento de GSI3/GSI4/GSI6 (`AGENTS.md` §7,
`main.tf:179-193`) — nunca na política geral de leitura; cada worker Lambda ganha uma política escopada só ao
índice GSI8, mesmo padrão de `grantGsi3ReadTo`/`grantGsi6ReadTo`. `infra/tests/stack.tftest.hcl` ganha caso novo
provando o isolamento, espelhando os testes existentes de GSI3/GSI6.

**Contrato de escrita único, reusado pelos 9**: em vez de 9 formatos ad-hoc, um helper compartilhado em
`src/shared/dynamodb/` (paralelo a `occ.ts`) — `maintenanceDueKeys(workerType, dueAtIso, tenantId, entityId)` —
usado pelos 9 módulos-fonte ao gravar/atualizar o item elegível, e removido (ou virado `undefined`, DynamoDB
remove o atributo) quando o item deixa de ser elegível (processado, ou muda de estado). Mantém a mesma
disciplina de "todo campo GSI é escrito dentro do `TransactWriteItems` do agregado", já convenção do projeto
(`AGENTS.md` §7).

## Migração dos 9 workers

Cada worker migra em fatia própria e revisável (nível 3-4 cada, decisão de design já aprovada nesta rodada —
não reabre protocolo por worker): (1) módulo-fonte passa a gravar `GSI8PK`/`GSI8SK` nas transições relevantes;
(2) candidate-source do worker troca `ScanCommand` por `QueryCommand` sobre GSI8; (3) para trás, os itens já
existentes em `dev` sem o ponteiro precisam de um backfill one-shot (dado sintético, resetável — `AGENTS.md`
§1, sem shim de compatibilidade dupla). Ordem recomendada: `membership-purge` primeiro (retenção LGPD real, já
tem `Scan` mais estudado nesta sessão), depois os 8 restantes em qualquer ordem — não há dependência entre eles.

## O que esta rodada NÃO decide

Não decide a implementação real (fora de escopo, `AGENTS.md` explicitamente pede design-only). Não decide se
`document-purge`/GSI6 deveria migrar para GSI8 por consistência — está fora do escopo do achado (não sofre do
bug), mudá-lo seria custo sem benefício de correção; fica como nota, não decisão.

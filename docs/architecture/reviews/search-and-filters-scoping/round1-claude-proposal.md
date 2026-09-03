# Busca e Filtros Documentais (Roadmap P0.5) — Round 1 Proposal

> Escopo desta decisão: **design apenas**, não implementação (mesmo padrão de D-121/D-122/D-192/
> D-193). Origem: Fase 2 do plano de divide-and-conquer do item de roadmap P0.5 ("Busca e filtros
> documentais"). Fase 1 (escopo) encontrou: nenhum endpoint de listagem hoje suporta busca ou
> multi-filtro (todos são single-parent-id ou single-status); GSI1-9 já estão todos claimados
> (GSI1/2/5/7/9 tenant-facing, GSI3/4/6/8 isolados por IAM — confirmado por leitura direta de
> `infra/modules/dynamo-table/main.tf`, `tenant_facing_index_names = ["GSI1","GSI2","GSI5","GSI7","GSI9"]`);
> "responsável" não existe em `Document`/`DocumentVersion`/`Requirement`/`TrackedSubject` hoje;
> vocabulário de validade (válido/vencendo/vencido/permanente/aguardando revisão) está espalhado
> por 4-5 enums diferentes, parcialmente derivados, parcialmente persistidos.

## Classificação de risco

**Nível 5-6** (`change-risk-scale.md`): a parte de busca/filtro cross-entity é, na melhor das
hipóteses, uma decisão de modelo de dados fundamental (nível 6, se resultar num novo mecanismo de
projeção materializada) — na pior, ainda nível 5 (novo access pattern/GSI). A parte de
"responsável" toca `EntityKey`s existentes (`Document`/`Requirement`) e potencialmente reabre uma
decisão de produto já registrada como deliberadamente adiada (`tracked-subject.ts`). Protocolo
Claude↔Codex obrigatório para o design completo.

## Achado que corrige o enquadramento da Fase 1 (verificado por leitura direta, não presumido)

**"Responsável" já existe no código — em `ExpirationItem`, não em `Document`/`Requirement`.**
`src/modules/expiration/domain/expiration-item.ts` tem `assigneeUserId?: string` desde antes desta
fase, e D-122/D-125 (`docs/architecture/reviews/responsibility-reassignment-scoping/`,
`APPROVED` 9,1/9,1, **implementado**) já resolveu — via protocolo completo, com pesquisa externa
real (Jira/GitHub/Linear) — o que acontece quando o usuário responsável por um `assigneeUserId` é
removido da Organization (`ResponsibilityReassignmentRequiredError`, precondição best-effort via
`AssignedActiveItemsLookup`, GSI1 já existente). Isto muda o enquadramento do ponto 2 do brief: a
pergunta não é "este produto pode ter um responsável sem reabrir uma decisão de produto genuína" —
já pode, e já tem, para `ExpirationItem`. A pergunta real é se o MESMO mecanismo (campo opcional +
reatribuição best-effort) se estende a `Requirement`/`Document` sem reabrir nada, ou se há uma
diferença material. Endereçado na Decisão 2 abaixo.

O docblock de `tracked-subject.ts` ("Sem `ownerUserId`/`assigneeUserId` — modelar responsável
interno antes de existir um segundo usuário real... violaria 'evidência antes de mecanismo'") está
**desatualizado como justificativa geral**: um segundo usuário real (Organization/Membership) já
existe desde D-086 (Wave B2B-6+), muito antes de D-122 usá-lo para `ExpirationItem`. A frase
continua correta para `TrackedSubject` especificamente (nenhum achado novo pede um responsável no
nível de Subject — o roadmap fala de responsável por documento/requisito, não por
empresa/fornecedor/funcionário rastreado), mas não pode ser citada como "o produto ainda não tem
usuário real o suficiente para isso" — esse motivo não existe mais desde D-086. Registrar como
correção de comentário stale (nível 1-2, mecânico), não como parte desta decisão de design.

## Pesquisa externa considerada (E-014)

**SIM PARCIAL.**

- **Padrão externo estabelecido (informa o design)**: "busca full-text/multi-facet sobre um
  domínio com várias entidades relacionadas" é um problema resolvido de forma conhecida por (1)
  serviços de busca dedicados (Elasticsearch/OpenSearch, Algolia) e (2) projeções materializadas
  "read model" num datastore primário (o padrão CQRS popularizado por Fowler/Vernon, e
  documentado como receita concreta para DynamoDB pela própria AWS: "Building a search engine
  with Amazon DynamoDB Streams and Amazon OpenSearch Service" (AWS Database Blog/AWS
  Prescriptive Guidance, consultado 2026-09-03) e o padrão "materialized view via DynamoDB
  Streams" do AWS Prescriptive Guidance "DynamoDB design patterns" (consultado 2026-09-03) — a
  própria AWS recomenda OpenSearch quando a necessidade é full-text/relevância, e projeção
  materializada em DynamoDB quando a necessidade é filtro estruturado por atributos conhecidos
  sobre um único item por entidade. Ambas as fontes convergem no critério decisivo: **é ranking
  de relevância textual livre (full-text) ou é filtro estruturado por facetas conhecidas
  (status/tag/responsável/tipo)?** Este produto precisa da segunda coisa (roadmap fala de
  "busca por nome" — prefixo/substring sobre um campo conhecido — e "filtros" por
  válido/vencendo/vencido/tag/responsável, nunca relevância de texto livre multi-campo). Isso
  resolve a pergunta "OpenSearch ou projeção" a favor de projeção — não é preferência de escala,
  é a faceta certa da pesquisa para o tipo de busca que o roadmap pede.
- **Interno (não informado por pesquisa)**: nome/formato do GSI ou da tabela de projeção, layout
  de PK/SK, qual worker faz a convergência — decisão interna, resolvida pelo precedente já
  `APPROVED` deste projeto (D-193's `requirement-evidence-refresh` outbox→worker→re-derive-fresh,
  não pela pesquisa de mercado).

### Checklist de critérios (subordinado aos eixos de `joint-review-criteria.md`)

1. (25%) A solução certa para o TIPO de busca que o roadmap pede de fato (filtro estruturado
   multi-faceta + prefixo de nome), não uma solução genérica de "full-text search" importada por
   inércia de mercado.
2. (25%) Nenhum GSI restrito (GSI3/4/6/8) é reaproveitado; se um GSI novo for necessário, a
   revisão de `data-model.md` (citada abaixo) é respeitada explicitamente, não contornada.
3. (20%) Proporcional à escala real (dev, sem usuário real, `TenantEntitlement` free = teto baixo
   de Subjects/Documents) — nem builda infraestrutura sem uso real que a justifique, nem finge que
   um scan completo sem paginação é uma solução aceitável para sempre.
4. (15%) "Responsável" e "estado de validade unificado" não reabrem uma decisão de produto que só
   Marcelo pode tomar — ou, se reabrirem de fato, isso é nomeado explicitamente como bloqueio, não
   decidido por Claude+Codex.
5. (15%) O plano de fatias resultante é executável independentemente por uma fase futura sem
   precisar re-derivar a estrutura (mesmo padrão de D-193's "próxima fase" já demonstrado como
   reutilizável).

## Regra de governança citada literalmente (respeitada por construção neste design)

`docs/architecture/data-model.md` linha 93: **"Nenhum novo access pattern entra em produção sem
revisão explícita do modelo de dados — mesmo que 'caiba' tecnicamente num GSI existente. [...] Se
a resposta for a segunda [espremido por conveniência], criar novo GSI (até o limite prático de
~20 por tabela) ou reconsiderar particionamento, nunca sobrecarregar um índice com um propósito
que ele não foi desenhado para servir."** Nenhuma opção abaixo propõe reaproveitar GSI1/2/5/7/9
para um propósito novo, nem tocar GSI3/4/6/8 (isolados por IAM, fora de cogitação por precedente
já `APPROVED`). Onde um índice novo é necessário, é um GSI10 dedicado, nomeado e revisado aqui —
exatamente o caminho que a regra prescreve, nunca o atalho que ela proíbe.

## Decisão 1 — Mecanismo de busca/filtro: bounded scan-and-filter agora, projeção materializada como fatia futura nomeada (nunca construída "só por via das dúvidas")

**MVP (esta fase implementa)**: generalizar o precedente já `APPROVED` e em produção de
`import-parse-service.ts` (pré-carrega TODOS os `TrackedSubject` ATIVOS de um tenant via UMA
`Query` em GSI7, nunca uma leitura por linha — seguro porque `TenantEntitlement` limita o teto a
um número pequeno) para um novo endpoint HTTP `GET /documents/search` (nome de rota ilustrativo)
que:

1. Resolve o escopo via os índices JÁ existentes e JÁ tenant-facing — `GSI1` (Document/Requirement
   por status, `DOCSTATUS#`/`REQSTATUS#`), `GSI2` (Document por Subject) — nunca um `Scan` da
   tabela inteira.
2. Aplica filtros estruturados (tag, responsável, tipo, `UnifiedValidityState` — Decisão 3) e
   correspondência por nome (prefixo/substring sobre `displayNameNormalized`/nome do documento)
   **em memória, sobre o resultado já paginado da Query**, nunca uma segunda leitura por item.
3. **Paginação explícita e obrigatória** (nunca um "retorna tudo" implícito) — mesmo contrato de
   `LastEvaluatedKey`/cursor já usado no resto da API; um filtro que reduz o resultado a poucos
   itens de uma página grande simplesmente pagina de novo, nunca finge que uma página vazia
   significa "não há mais resultados" (o mesmo bug de classe que `responsibility-reassignment`'s
   Rodada 3 já corrigiu para paginação de contagem real).
4. **Teto explícito e documentado** de itens escaneados por requisição (ex. N páginas de GSI1/
   GSI2 antes de devolver "refine sua busca" — nunca um scan sem fim escondido atrás de um filtro
   que nunca casa). Aceitável precisamente porque não há usuário real e `TenantEntitlement` já
   limita o volume por tenant — esta é uma escolha de proporcionalidade calibrada pela escala
   REAL de hoje, revisitada quando o teto de entitlement mudar (gatilho nomeado na Decisão 4).

Isto **não é um GSI novo, não é infraestrutura de busca nova** — é a composição de índices já
aprovados com filtro/paginação em memória, o mesmo nível de mecanismo que `import-parse-service.ts`
já usa em produção hoje. Nível 4 de `change-risk-scale.md` (heurística interna sem contrato
externo novo) para a maior parte, nível 5 apenas se o endpoint precisar combinar Document+
Requirement+ExpirationItem numa única resposta (múltiplas Queries compostas — endereçado no
checklist de fatias, Decisão 4).

**Fatia futura, nomeada mas NÃO construída agora** (gatilho explícito, não "quando parecer
necessário"): se o teto de `TenantEntitlement` subir substancialmente (ex. plano pago com centenas
de Subjects/Documents por tenant) OU uso real em produção mostrar custo de leitura problemático
nesse endpoint, a fatia seguinte é uma projeção materializada `SearchableDocument` (um item por
Document+Requirement combinando nome/tags/responsável/`UnifiedValidityState`/subjectId,
atualizado por um outbox event no mesmo `TransactWriteItems` do agregado de origem → worker que
**relê o agregado fresco e re-deriva, nunca aplica o payload do evento** — a MESMA forma de
`requirement-evidence-refresh` de D-193, incluindo o worker de reparo diário via `Scan` filtrado
por `entityType`, precedente já `APPROVED` de `scanRequirementsWithEvidence`), servida por um
**GSI10 dedicado** (`GSI10PK=TENANT#t#SEARCHSTATUS#<validityState>`, `GSI10SK` composto por nome
normalizado para prefixo — formato exato fica para o design daquela fase, não desta). Full-text
real (OpenSearch) só entraria em cogitação se o roadmap pedisse relevância textual livre — a
pesquisa acima não encontrou esse requisito no roadmap atual, então não é proposto.

## Decisão 2 — Responsável: estender o mecanismo já `APPROVED` de `ExpirationItem`, não criar um novo

Adicionar `assigneeUserId?: string` a `Requirement` (nível "coisa que precisa ser mantida válida",
o objeto acionável do roadmap) seguindo **literalmente** o mesmo padrão de campo opcional já
`APPROVED`/implementado em `ExpirationItem.assigneeUserId` — mesmo tipo, mesma semântica
(referência a um `userId` de Membership ativo na Organization, nunca um segundo modelo de
ownership). **Document não ganha `assigneeUserId` nesta fase** — um Document é evidência (D-143),
não uma obrigação; "responsável por manter válido" já é modelado no nível certo (`Requirement`),
duplicar o campo em `Document` seria um segundo lugar de verdade sem necessidade demonstrada
(nenhum achado da Fase 1 pediu isso — só o roadmap genérico "responsável por documento").

**Isto não é uma decisão de produto nova que precisa ir a Marcelo** — é a aplicação do mecanismo já
`APPROVED` em D-122 (que já passou pelo protocolo completo, incluindo pesquisa externa Jira/
GitHub/Linear) a uma segunda entidade. A analogia com D-109 (aplicação mecânica de um princípio já
aprovado a um call site que a rodada original não cobriu) se aplica em espírito, mas com uma
diferença material que este design assume como escopo, não decide silenciosamente:
**`AssignedActiveItemsLookup`/`ResponsibilityReassignmentRequiredError` (D-122/D-125) hoje só
verifica `ExpirationItem` via GSI1 `ITEMSTATUS`.** Estender a mesma proteção para
`Requirement.assigneeUserId` exige um segundo lookup contra `Requirement`'s GSI1 `REQSTATUS`
namespace (já existente, já tenant-facing — sem GSI novo) dentro da MESMA porta
`AssignedActiveItemsLookup`, ou uma porta irmã — detalhe de implementação, nível 4, não decisão de
protocolo nova, porque o MECANISMO (checagem best-effort pré-remoção, erro com lista+truncated) já
está aprovado; só o segundo tipo de entidade coberto é novo, e é aditivo, nunca uma mudança de
semântica do que já existe.

**Correção de comentário stale (fora desta decisão, nível 1-2)**: `tracked-subject.ts`'s docblock
deve ser atualizado para não implicar que "não existe segundo usuário real" — deve dizer, em vez
disso, que `TrackedSubject` especificamente nunca teve um achado pedindo responsável a esse nível,
distinto de `Requirement`/`ExpirationItem` que já têm.

## Decisão 3 — Vocabulário de validade unificado: função pura de derivação read-time, nunca um novo campo persistido

Novo módulo compartilhado **`src/shared/domain/validity-state.ts`** (não
`shared/observability/**` — não viola a regra `shared-must-not-reach-modules`, porque não importa
nada de `src/modules/**`; os call sites de cada módulo passam os valores já tipados, mesmo padrão
já usado por `security-audit.ts`). Um único enum:

```ts
export type UnifiedValidityState = "VALIDO" | "VENCENDO" | "VENCIDO" | "PERMANENTE" | "AGUARDANDO_REVISAO";
```

Nunca armazenado — cada módulo expõe um adaptador puro que mapeia SEU estado já existente para o
enum, no mesmo espírito de `deriveRequirementStatus`/`isRequirementExpiringSoon` (Requirement já
faz exatamente este tipo de derivação read-time, incluindo a subdivisão "vence em breve" com o
mesmo `SOON_THRESHOLD_DAYS`/`EXPIRING_SOON_THRESHOLD_DAYS = 7` já usado nos dois lugares hoje —
este design reaproveita essa constante, não inventa uma terceira):

- `Requirement`: `NOT_APPLICABLE` fica fora do vocabulário unificado (não é um estado de validade,
  é "não aplicável" — filtro separado, nunca forçado dentro de um dos 5 valores); `MISSING`/
  `PENDING` -> `AGUARDANDO_REVISAO`; `SATISFIED` sem `evidenceValidUntil` -> `PERMANENTE`;
  `SATISFIED` com `evidenceValidUntil` -> `VALIDO` ou `VENCENDO` (via `isRequirementExpiringSoon`
  já existente); `NOT_SATISFIED` -> `VENCIDO`.
- `DocumentVersion`: `DRAFT`/`RECEIVED`/`UNDER_REVIEW` -> `AGUARDANDO_REVISAO`; `REJECTED`/
  `WITHDRAWN`/`SUPERSEDED` fora do vocabulário (não são "documentos ativos" para fins de busca,
  mesmo raciocínio de "estado terminal não-corrente" já usado no resto do domínio); `ACCEPTED` sem
  `validUntil` -> `PERMANENTE`; `ACCEPTED` com `validUntil` -> `VALIDO`/`VENCENDO`/`VENCIDO` pela
  mesma janela de 7 dias.
- `ExpirationItem`: mesma lógica que `frontend/src/api/presentation.ts`'s `presentItemUrgency` já
  usa para ACTIVE (VALIDO/VENCENDO/VENCIDO conforme `dueDate`); sem conceito de "permanente"
  (`dueDate` é sempre obrigatório neste agregado); `ARCHIVED`/`RENEWED`/`DELETED` fora do
  vocabulário.
- `TrackedSubject`: **não participa** — não tem noção própria de validade (é o container de
  Documents/Requirements, não uma coisa que expira). Filtro de validade em busca sempre opera
  sobre Document/Requirement/ExpirationItem, nunca sobre Subject diretamente.

Esta função entra no filtro do endpoint de busca (Decisão 1) exatamente como um filtro em memória
a mais sobre o resultado paginado — na fatia futura de projeção materializada (Decisão 1), o mesmo
valor é pré-computado e gravado como atributo indexável no momento da escrita (`GSI10PK` na
Decisão 1), sem duplicar a lógica de derivação (o mesmo módulo puro é chamado dos dois lugares).

## Decisão 4 — Não é uma fatia, é um programa de fatias

```text
Fatia 1 — UnifiedValidityState (nível 3-4, sem protocolo novo — funções puras, mesmo padrão de
  teste de deriveRequirementStatus): src/shared/domain/validity-state.ts + testes unitários por
  entidade.

Fatia 2 — Requirement.assigneeUserId (nível 4-5 — aplicação de mecanismo já APPROVED a uma
  segunda entidade, ver Decisão 2): campo no schema/domain, updateRequirement ganha o campo,
  extensão de AssignedActiveItemsLookup/ResponsibilityReassignmentRequiredError para cobrir
  Requirement via GSI1 REQSTATUS. Corrigir docblock stale de tracked-subject.ts junto (nível 1-2).

Fatia 3 — Endpoint de busca/filtro MVP (nível 4-5, Decisão 1): GET /documents/search combinando
  GSI1 (Document/Requirement por status)/GSI2 (Document por Subject) já existentes, filtro em
  memória por nome/tag/responsável/UnifiedValidityState, paginação obrigatória, teto de páginas
  escaneadas documentado.

Fatia 4 (DEFERIDA, gatilho explícito na Decisão 1 — não construída nesta fase nem na próxima):
  projeção materializada SearchableDocument + GSI10, só quando o teto de TenantEntitlement subir
  ou uso real demonstrar custo — nomeada aqui para a fase de implementação não precisar
  redescobrir a estrutura, mesmo padrão de "escopo explicitamente fora" de D-193.
```

Cada fatia 1-3 é testável isoladamente e não exige uma segunda rodada de protocolo Claude↔Codox
salvo achado real durante implementação (mesmo padrão de "próxima fase" de D-193/D-192).

## Bloqueio genuíno de produto? Nenhum encontrado nesta rodada

A pergunta do brief ("a pergunta de responsável/ownership pode ser inevitável") **não se
concretizou** depois da leitura de código: D-122/D-125 já resolveram a pergunta de produto
genuína (o que acontece quando o responsável sai) para `ExpirationItem`, com pesquisa externa e
protocolo completo. Estender o mesmo campo+mecanismo para `Requirement` é aditivo, não uma
decisão de produto nova. Se o Codex, na crítica, encontrar uma diferença material entre
`ExpirationItem` e `Requirement` que invalide essa analogia (ex.: cardinalidade de Requirements
por Subject muito maior que Items por tenant, tornando o lookup de reatribuição caro de um jeito
que D-122 não previu), isso é endereçável dentro deste protocolo — não é, por si só, motivo para
escalar a Marcelo.

## Escopo explicitamente fora desta decisão

Busca full-text/relevância (nenhum achado do roadmap pede isso); `Document.assigneeUserId`;
qualquer índice novo além do `GSI10` nomeado-mas-não-construído da Fatia 4; migrar dado existente
(sem usuário real, não é requisito); UI/frontend do endpoint de busca (fora do escopo backend
deste protocolo); estender `TrackedSubject` com validade ou responsável.

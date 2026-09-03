# Busca e Filtros Documentais (Roadmap P0.5) — Round 2 Revision

> Responde à crítica da Rodada 1 (`round1-codex-critique.txt`, régua 5,4/10, design 4,8/10,
> NOT APPROVED, checklist contestado). Achado central da Rodada 1, aceito integralmente:
> **`Document` não tem `name` nem `tags`** (`document.ts` só tem `documentTypeId`/`subjectId`) e
> `GSI2` exige `subjectId` conhecido de antemão (não é um índice tenant-wide) — a Rodada 1 tratou
> "buscar documentos por nome/tag" como se essas propriedades existissem no nível certo. Este é o
> buraco que a Rodada 2 fecha, não um ajuste cosmético.

## Régua reconciliada (aceita a contestação da Rodada 1 quase integralmente)

Adoto o checklist de 6 critérios proposto pelo Codex na Rodada 1, com um ajuste: separo
"responsável" de "validade unificada" (a crítica os tratava como uma coisa só; são decisões
independentes com riscos diferentes — o Codex já notou isso na seção 6 da crítica, mas manteve os
dois no mesmo peso "15% — Validade unificada" por engano de transcrição do seu próprio ponto).

```text
1. (25%) Completude física e custo de composição — cada filtro aponta para o atributo/item que
   realmente o fornece, incluindo joins/BatchGet/fan-out e limites explícitos. NUNCA um campo
   citado que não existe na entidade consultada.
2. (20%) Paginação e ordenação corretas — cursor(es) explícitos, sem falso "sem mais resultados",
   teto de avaliação documentado, sem promessa de ordenação global que a composição não sustenta.
3. (15%) Semântica de produto — qual entidade é a unidade de busca, o que "nome"/"tag" significam
   em cada caso, universo exato retornado.
4. (15%) Estado de validade unificado — mapeamento total, currentness (qual versão conta),
   distinção entre derivado-materializado e autoritativo.
5. (15%) Responsável — mecanismo completo (não só schema): elegibilidade em create/update,
   comportamento em template/import, contrato de erro na reatribuição.
6. (10%) Governança de GSI — propósito de cada índice demonstrado, não afirmado; nenhuma IAM nova
   sobre índice restrito.
```

Isto é uma correção registrada da régua da Rodada 1 (não um capricho): o peso 25% original em
"tipo de busca certo" e 20% em "proporcionalidade" se sobrepunham exatamente como o Codex apontou;
o novo item 1 (completude física) absorve o achado mais grave (campos inexistentes) que nenhum dos
dois critérios antigos capturava diretamente.

## Correção central: unidade de busca é `TrackedSubject`, não "documento" solto

`TrackedSubject` é a ÚNICA entidade do cluster que tem hoje, nativamente, tudo que "busca por
nome"/"filtro por tag" precisa: `displayName`/`displayNameNormalized`, `tags: string[]`, e um
índice **tenant-wide** (`GSI7`, `GSI7PK=TENANT#t#SUBJECTSTATUS#<status>` — ao contrário de `GSI2`,
que exige `subjectId` conhecido). `Document` não tem nome nem tags (confirmado,
`document.ts:14-36`); `Requirement` tem `name` mas não `tags` nem um índice tenant-wide por nome
(seu `GSI1` é por status, ordenado por `updatedAt`, não por nome). Redesenho:

**Resultado de busca é uma união discriminada, nunca um item genérico fictício:**

```ts
type SearchHit =
  | { kind: "SUBJECT"; subject: TrackedSubject; matchedRequirements?: RequirementSummary[] }
  | { kind: "REQUIREMENT"; requirement: Requirement; subjectDisplayName: string }
  | { kind: "EXPIRATION_ITEM"; item: ExpirationItem };
```

### Matriz filtro × entidade × atributo físico × leitura necessária

| Filtro | `TrackedSubject` | `Requirement` | `ExpirationItem` |
|---|---|---|---|
| Nome (prefixo) | `GSI7SK` embute `NAME#<displayNameNormalized>` — prefixo nativo do índice, zero leitura extra | Sem índice por nome; nome só filtrável **depois** de já ter a página de `Requirement`s (por status via GSI1, ou por Subject via `REQUIREMENT_SK_PREFIX`) — filtro em memória sobre o campo já carregado | idem Requirement — `name` já está no item, filtro em memória sobre página já carregada via GSI1 |
| Nome (substring) | Em memória, sobre a página já paginada por prefixo/status (nunca um segundo índice) | idem | idem |
| Tag | `tags` já está no item — filtro em memória sobre a página GSI7 | **Requirement não tem `tags` hoje** — fora de escopo desta fase para Requirement/Item (ver "Escopo fora") | idem — `ExpirationItem.tags` já existe, filtro em memória |
| Responsável | N/A (Subject não tem responsável, Decisão 2) | `assigneeUserId` (Fatia 2, novo campo) — já está no item, zero leitura extra | `assigneeUserId` já existe — zero leitura extra |
| `UnifiedValidityState` | N/A (Subject não tem validade própria) | Computado de `status`/`evidenceValidUntil`, **já denormalizados no próprio item** (`requirement.ts:71-73`) — zero leitura extra, nunca precisa reler `DocumentVersion` | Computado de `status`/`dueDate`, já no item — zero leitura extra |
| Status (ACTIVE/ARCHIVED/etc.) | `GSI7PK` | `GSI1PK` (`REQSTATUS#`) | `GSI1PK` (`ITEMSTATUS#`) |

**Achado que fecha o problema de N+1 apontado na crítica**: `Requirement.evidenceState`/
`evidenceValidUntil` já são cache denormalizado no próprio item (comentário de
`requirement.ts:64-71`, escrito precisamente para o worker de reindex nunca precisar reler
`DocumentVersion`) — o mesmo cache resolve `UnifiedValidityState` no filtro de busca sem nenhuma
leitura adicional, nem "qual versão é a corrente" (a resposta já está fixada no momento do
`linkEvidence`, mesma janela de bounded-staleness que o resto do domínio já aceita para
`Requirement`). Isto substitui a alegação incorreta da Rodada 1 de que o endpoint precisaria ler
`DocumentVersion` para derivar validade de uma Requirement.

**Único fan-out real que sobrevive**: exibir `subjectDisplayName` num hit `REQUIREMENT`/
`EXPIRATION_ITEM` requer resolver `subjectId -> displayName`. Resolvido por **um único
`BatchGetItem`** por página de resultado (não por item), com a página já limitada a N (Decisão 1
abaixo) — `BatchGetItem` aceita até 100 chaves por chamada, nunca perto do teto nesta escala.

## Decisão 1 (revisada) — Três endpoints/modos de busca, nunca uma única Query fictícia

Em vez de um `GET /documents/search` genérico que finge combinar `GSI1`+`GSI2` (Rodada 1,
insustentável — `GSI2` não é tenant-wide), três modos explícitos, cada um com seu PRÓPRIO cursor
de paginação (nunca um cursor sintético cross-índice — a Rodada 1 não tinha resposta para isso, a
Rodada 2 explicitamente NÃO promete ordenação global entre os três modos, é escopo declarado, não
lacuna escondida):

1. **`searchSubjects`** — `Query` em `GSI7` (`SUBJECTSTATUS#<status>`), filtro em memória por
   nome (prefixo/substring)/tag/tipo. Cursor = `LastEvaluatedKey` nativo de `GSI7`.
2. **`searchRequirements`** — `Query` em `GSI1` (`REQSTATUS#<status>`), filtro em memória por
   nome/responsável/`UnifiedValidityState`. Cursor = `LastEvaluatedKey` nativo de `GSI1`
   namespace `REQSTATUS`. Enriquecido com `subjectDisplayName` via `BatchGetItem` por página.
3. **`searchExpirationItems`** — `Query` em `GSI1` (`ITEMSTATUS#<status>`), mesmo padrão,
   reaproveitando o índice que `responsibility-reassignment` (D-122/D-125) já usa para o mesmo
   propósito de "achar itens ACTIVE de um usuário".

**Teto explícito**: cada modo pagina no máximo **5 páginas nativas de 25 itens** (125 itens brutos
avaliados) por chamada antes de devolver `{ items, cursor, scanLimitReached: true }` — nunca um
scan sem fim escondido atrás de um filtro raro. `125` não é arbitrário: é 5x o teto do
`TenantEntitlement` free (25 Subjects) citado na Fase 1 — dá margem para um tenant no teto free ter
toda sua base varrida numa chamada, e ainda impõe um limite real quando o teto de entitlement
subir (gatilho da Fatia 4, inalterado da Rodada 1).

**Nível de risco desta parte**: 4 (`change-risk-scale.md` — três Queries sobre índices já
tenant-facing, heurística de filtro em memória, sem contrato externo novo nem GSI novo).

## Decisão 2 (revisada) — Responsável: mecanismo completo transportado, decisão de qual entidade é minha (engenharia), não do Marcelo

A crítica tem razão que eu tratei "Requirement, nunca Document" como óbvio quando é uma escolha.
Mantenho **Requirement como a entidade que ganha `assigneeUserId`** (é o único objeto do cluster
com uma noção real de "coisa que precisa continuar válida" — `Document` é evidência, não
obrigação, D-143), mas registro isso como **escopo de engenharia dentro da autoridade já delegada**
(D-122 já decidiu, com Marcelo, que este produto tem responsável-por-obrigação; qual aggregate
especificamente carrega o campo é a mesma classe de decisão que "onde fica um valor default" —
`research-protocol.md`'s linha divisória explícita: "como isso se encaixa no nosso próprio modelo
de dados já existente" não exige pesquisa nem escalonamento a Marcelo). Se uma fase futura de
UI/produto encontrar evidência real de que usuários esperam atribuir responsável no nível de
Document, isso é um achado novo tratável então — não um motivo para bloquear agora.

**Mecanismo completo (corrigindo a Rodada 1, que só citava schema+update+lookup)**, espelhando
ponto a ponto `expiration-service.ts`'s tratamento real de `assigneeUserId`:

1. **Elegibilidade no create** (`createRequirement`) — se `assigneeUserId` for informado, valida
   via a MESMA porta `MemberEligibilityChecker` já usada por `expiration-service.ts:118`
   (Membership ACTIVE na Organization) antes de persistir — nunca aceita um id não verificado.
2. **Elegibilidade no update** (`updateRequirement`) — mesma checagem quando o campo muda,
   espelhando `expiration-service.ts:266`.
3. **`applyTemplate` (materialização em massa de Requirements a partir de `RequirementTemplate`)
   nunca define `assigneeUserId`** — toda Requirement nasce sem responsável quando criada por
   template, consistente com o próprio comentário de `requirement.ts:74-82` ("apply é SNAPSHOT,
   nunca link vivo") — um responsável default herdado do template abriria um segundo lugar de
   verdade que a Fase 1 não encontrou nenhum achado pedindo. Atribuição pós-criação usa
   `updateRequirement` normalmente.
4. **Import** (`import-parse-service.ts`) — fora de escopo desta fase: o CSV de import hoje cria
   `TrackedSubject`, não `Requirement` diretamente; se uma fase futura de import de Requirements
   existir, herda esta mesma regra de elegibilidade no ponto de commit.
5. **Reatribuição na remoção/saída de Membership** — estende `AssignedActiveItemsLookup`
   (`organization/ports/assigned-active-items-lookup.ts:31`) com um SEGUNDO método (não sobrecarga
   do existente — a Rodada 1 chamava isso de "um segundo lookup", impreciso: é a mesma porta
   ganhando uma segunda capacidade tipada) que faz `Query` em `Requirement`'s `GSI1`
   `REQSTATUS#APPLICABLE`-equivalente (na prática, todo status exceto `NOT_APPLICABLE`, já que uma
   Requirement `NOT_APPLICABLE` não é uma obrigação ativa de ninguém) filtrando `assigneeUserId`.
   **Contrato de erro `ResponsibilityReassignmentRequiredError` (`app-error.ts:447`) ganha um
   campo discriminador `entityType: "EXPIRATION_ITEM" | "REQUIREMENT"`** dentro de cada item de
   `itemIds` (ou dois arrays separados `expirationItemIds`/`requirementIds`, mesma disciplina de
   `totalKnown`/`truncated` já existente, decisão de formato exato fica para a implementação —
   nunca uma taxonomia neutra genérica que esconde qual entidade está travando a remoção, era essa
   a crítica real do Codex e ela procede).

Nível de risco: 4-5 (extensão aditiva de um mecanismo já `APPROVED`, mas toca um contrato de erro
já em uso em produção — `RemoveMembershipService`/`LeaveOrganizationService` — logo tratado como
5 por precaução, não 3-4, seguindo a regra prática de "em dúvida, nível mais alto" de
`change-risk-scale.md`).

## Decisão 3 (revisada) — `UnifiedValidityState`: currentness resolvida, DRAFT corrigido, invariante reformulada

**Correção 1 (currentness)**: como a Decisão 1 revisada nunca busca `Document`/`DocumentVersion`
diretamente (só `Requirement`, que já cacheia `evidenceState`/`evidenceValidUntil` no momento do
link), o problema de "qual versão conta" não se aplica ao endpoint de busca. O adaptador
`DocumentVersion -> UnifiedValidityState` continua existindo no módulo compartilhado (útil para uma
tela de detalhe de Document que já tem a `DocumentVersion` corrente em mãos via
`Document.currentVersionId` — GetItem direto, um único item, sem ambiguidade de currentness
porque o CALLER já resolveu qual versão é a corrente antes de chamar o adaptador), mas não
participa do filtro de busca desta fase.

**Correção 2 (`DRAFT`)**: `DRAFT` não entra no vocabulário unificado (nem como
`AGUARDANDO_REVISAO`) — é pré-existência de evidência, não revisão pendente. Só `RECEIVED`/
`UNDER_REVIEW` mapeiam para `AGUARDANDO_REVISAO`. `REJECTED`/`WITHDRAWN`/`SUPERSEDED` continuam
fora do vocabulário (estados terminais não-correntes).

**Correção 3 (invariante)**: a linha "nunca armazenado" vira **"nunca fonte autoritativa"** — a
Fatia 4 (projeção materializada, deferida) PODE gravar o valor computado como atributo indexável,
desde que sempre recomputado a partir do agregado de origem (mesma disciplina de
`requirement-evidence-refresh`, D-193: o worker relê fresco, nunca aplica payload de evento). O
enum em si nunca vira um campo que um caller escreve diretamente — só os adaptadores puros
escrevem nele.

**Assinaturas dos adaptadores** (nomeados explicitamente, resposta ao achado #6 da crítica):

```ts
// src/shared/domain/validity-state.ts — puro, sem import de src/modules/**
export type UnifiedValidityState = "VALIDO" | "VENCENDO" | "VENCIDO" | "PERMANENTE" | "AGUARDANDO_REVISAO";
export const VALIDITY_SOON_THRESHOLD_DAYS = 7; // mesmo valor de EXPIRING_SOON_THRESHOLD_DAYS/SOON_THRESHOLD_DAYS

// cada módulo chama o utilitário genérico abaixo com SEUS próprios campos já tipados:
export function deriveValidityFromExpiry(hasExpiry: boolean, expiryIso: string | undefined, isCurrentlyValid: boolean, now: Date): UnifiedValidityState | undefined;
```

`deriveRequirementUnifiedValidity(requirement: Pick<Requirement, "status" | "evidenceValidUntil">, now: Date)`,
`deriveExpirationItemUnifiedValidity(item: Pick<ExpirationItem, "status" | "dueDate">, now: Date)`,
`deriveDocumentVersionUnifiedValidity(version: Pick<DocumentVersion, "state" | "validUntil">, now: Date)`
vivem cada um no módulo dono (`document-archive/domain/requirement.ts` etc.), chamando o utilitário
genérico compartilhado — mesma separação já usada para `EXPIRING_SOON_THRESHOLD_DAYS` (constante
compartilhada, lógica local a cada módulo).

## Decisão 4 (revisada) — Fatias

```text
Fatia 1 — src/shared/domain/validity-state.ts (utilitário genérico) + adaptador por entidade no
  módulo dono (document-archive/requirement.ts, document-archive/document-version.ts,
  expiration/expiration-item.ts) + testes unitários. Nível 3-4, sem protocolo novo.

Fatia 2 — Requirement.assigneeUserId: campo + elegibilidade create/update (MemberEligibilityChecker
  reuso) + applyTemplate explicitamente NUNCA herda + extensão tipada de
  AssignedActiveItemsLookup/ResponsibilityReassignmentRequiredError para cobrir Requirement via
  GSI1 REQSTATUS (discriminador de entidade no erro). Corrigir docblock stale de
  tracked-subject.ts junto (nível 1-2). Nível 5 (contrato de erro em produção tocado).

Fatia 3 — Três modos de busca (searchSubjects/searchRequirements/searchExpirationItems), cada um
  Query num índice já tenant-facing + filtro em memória + BatchGetItem de enriquecimento (só
  Requirement/Item) + teto de 5 páginas/125 itens documentado + cursor nativo por modo (sem
  cursor sintético cross-modo). Nível 4.

Fatia 4 (DEFERIDA, gatilho quantitativo inalterado da Rodada 1: teto de TenantEntitlement subir ou
  uso real mostrar custo): projeção materializada + GSI10 — a essa altura já teria um contrato
  físico completo herdado da Fatia 3 (a matriz filtro×entidade×atributo já existe), reduzindo o
  trabalho de design daquela fase a "onde persistir o que já sabemos calcular", não a redescobrir
  o que buscar.
```

## Pesquisa externa — sem mudança de fontes, escopo da conclusão reduzido

Mantida `SIM PARCIAL` da Rodada 1. A crítica está correta que a dicotomia "full-text→OpenSearch,
facetas→projeção" não é universal na literatura consultada — registro isso explicitamente como
correção: a pesquisa mostra que **ambas as abordagens servem filtro estruturado**, e a escolha
real entre elas neste projeto é de proporcionalidade/custo operacional (rodar um cluster
OpenSearch para um produto sem usuário real), não uma dicotomia técnica rígida — a fonte não
sustenta mais do que isso. A decisão de usar Queries já existentes em vez de qualquer infra nova
continua de pé, mas apoiada primariamente em `principles.md` #1 (proporcionalidade/evidência antes
de mecanismo) e no precedente interno de `import-parse-service.ts`, não numa alegação de consenso
de mercado que a pesquisa não sustenta.

## Escopo explicitamente fora desta decisão (inalterado + adições)

Busca full-text/relevância; `Document.assigneeUserId`; `GSI10`/projeção materializada (Fatia 4);
migrar dado existente; UI/frontend; validade/responsável em `TrackedSubject`; **tags em
`Requirement`** (não existe hoje, fora de escopo adicionar nesta fase — filtro de tag só cobre
`TrackedSubject`/`ExpirationItem`); busca por nome em `Document` (não tem campo de nome — buscável
só via seu `Requirement`/`Subject` pai); ordenação global unificada entre os três modos de busca.

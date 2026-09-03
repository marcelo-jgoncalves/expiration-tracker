# Busca e Filtros Documentais (Roadmap P0.5) — Round 3

> Régua **ESTÁVEL** desde a Rodada 2 (Codex 9,6/10, "sem necessidade de nova reconciliação").
> Design da Rodada 2: 6,2/10, NOT APPROVED, 8 achados bloqueantes. Esta rodada fecha os 8 pontos
> um a um, sem tocar a régua.

## 1. Prefixo de nome no GSI7 — reivindicação corrigida, não mais "nativo"

Confirmado (`tracked-subject.ts:52-62`): `GSI7SK = TYPE#<type>#NAME#<name>#SUBJECT#<id>` —
`type` precede `NAME#`, então um prefixo de nome só é um `begins_with` nativo quando `type` já é
conhecido. **Correção**: `searchSubjects` **exige `type` como parâmetro obrigatório quando o filtro
de nome é usado** (7 valores possíveis de `TrackedSubjectType` — a UI oferece um seletor, não texto
livre "buscar em todos os tipos ao mesmo tempo"). Quando o caller não fornece `type` (quer todos os
tipos), a Query usa só `GSI7PK` (`SUBJECTSTATUS#<status>`) e o nome vira filtro em memória sobre a
partição inteira de status — mais caro, mas dentro do mesmo teto de 5 páginas/125 itens já
declarado, nunca uma otimização de prefixo inexistente. Documentado como os DOIS caminhos
explícitos, não um único caminho genérico:

```text
searchSubjects(status, type?, namePrefix?, tag?, cursor?)
  se type presente:  Query(GSI7PK=SUBJECTSTATUS#status, begins_with(GSI7SK, "TYPE#{type}#NAME#{namePrefix ?? ''}"))
  se type ausente:   Query(GSI7PK=SUBJECTSTATUS#status) + filtro em memória por namePrefix/tag/type
```

## 2. `ExpirationItem` não tem `subjectId` — enriquecimento removido, união revisada

Confirmado (`expiration-item.ts:13-38`): nenhum campo de `subjectId`/relação com `TrackedSubject`.
**Correção**: hits `EXPIRATION_ITEM` nunca carregam `subjectDisplayName` — são um agregado
independente neste modelo de dados (achado da Fase 1 mantido: `ExpirationItem` e o cluster
`TrackedSubject`/`Document`/`Requirement` são hoje dois mundos sem FK entre si; unificá-los está
fora do escopo desta decisão, é uma mudança de modelo de dados própria). União revisada:

```ts
type SearchHit =
  | { kind: "SUBJECT"; subject: TrackedSubject }
  | { kind: "REQUIREMENT"; requirement: Requirement; subjectDisplayName: string }
  | { kind: "EXPIRATION_ITEM"; item: ExpirationItem }; // nunca enriquecido — sem chave física para isso
```

`matchedRequirements` **removido** de `SearchHit["SUBJECT"]` inteiramente (achado 5 da Rodada 2,
aceito sem ressalva — nenhum contrato físico foi fechado para esse campo e nenhum achado da Fase 1
pediu essa composição; se um caller quiser "Requirements deste Subject", já existe o endpoint de
listagem por Subject via `REQUIREMENT_SK_PREFIX`, fora desta decisão).

## 3. `status` é obrigatório e singular em todo modo de busca

Todos os três índices particionam por status (`REQSTATUS#`/`ITEMSTATUS#`/`SUBJECTSTATUS#`) — nunca
existe uma Query sem uma partição escolhida. **Contrato**: `status` é um parâmetro **obrigatório,
um único valor por chamada**, em todos os três modos. Um caller que queira "todos os status
ativos-relevantes" (ex. UI que oferece uma visão combinada ACTIVE+ARCHIVED) faz múltiplas chamadas
client-side, cada uma com seu próprio cursor — nunca o servidor combina partições numa única
resposta paginada (fecha o achado 3 da Rodada 2: sem isso, cursores múltiplos exigiriam um
protocolo de composição que este design deliberadamente não propõe). Default por modo quando
omitido: **não há default — `status` ausente é `ValidationError`, 400**, mesma disciplina de
"never a hidden default that changes meaning silently" já usada no resto da API.

## 4. Contrato de paginação completo

```ts
interface SearchPage<T> {
  items: T[];              // 0 a N — quantidade de hits DENTRO do lote avaliado, nunca um alvo fixo
  cursor?: string;         // presente sempre que o DynamoDB devolveu LastEvaluatedKey nessa página
                            // física, MESMO se o teto de 5 páginas foi atingido antes de esgotar
  scanLimitReached: boolean; // true se o teto de 125 itens avaliados foi atingido nesta chamada
                            // (distinto de "sem mais resultados": cursor presente + scanLimitReached
                            // true = "pode haver mais, chame de novo com o cursor"; cursor ausente =
                            // fim real da partição de status, mesmo com scanLimitReached false)
}
```

Regra de parada por chamada: avalia até 5 páginas físicas de 25 itens (`Limit: 25` por `Query`,
mesmo padrão já usado no resto do módulo) OU até a partição de status se esgotar (`LastEvaluatedKey`
ausente) — o que vier primeiro. **125 itens avaliados podendo produzir 0 hits é um resultado válido
e explícito** (`items: [], cursor: <presente>, scanLimitReached: true`) — a UI mostra "nenhum
resultado nesta leva, continuar buscando?" nunca confunde com "não existe". Cursor carrega
`{mode, status, type?, lastEvaluatedKey}` serializado — **rejeitado com 400 se reapresentado contra
um `mode`/`status` diferente do que o gerou** (fecha "validação de namespace do cursor", achado 4).

**`BatchGetItem` corrigido**: até 125 hits de `REQUIREMENT` por chamada podem ter até 125
`subjectId`s distintos — excede o teto de 100 chaves por `BatchGetItem`. Correção: reaproveita o
helper de chunking JÁ existente e testado (`dynamodb-subject-store.ts:128`, citado pela própria
crítica do Codex) — o enriquecimento de `subjectDisplayName` faz `ceil(125/100) = no máximo 2`
chamadas `BatchGetItem` por página de busca, nunca "uma única chamada" como a Rodada 2 alegou
incorretamente.

## 5. Reatribuição de responsável — dois lookups irmãos, contrato aninhado, nunca merged

**Correção à alegação `REQSTATUS#APPLICABLE`-equivalente (achado 6, procede integralmente)**: não
existe esse namespace. O lookup correto para "Requirements ativas atribuídas a este usuário" é
**4 Queries exaustivas**, uma por status em `{MISSING, PENDING, SATISFIED, NOT_SATISFIED}`
(excluindo só `NOT_APPLICABLE`, que nunca é uma obrigação ativa de ninguém por definição —
`deriveRequirementStatus`), cada uma paginada até esgotar (`LastEvaluatedKey` até `undefined`,
mesma disciplina de paginação real já usada por `AssignedActiveItemsLookup` original), filtrando
`assigneeUserId = :userId` em cada uma. Custo aceito explicitamente: proporcional ao volume de
Requirements do tenant, aceitável na escala atual (mesmo argumento de proporcionalidade já usado
para `AssignedActiveItemsLookup` original sobre `GSI1` `ITEMSTATUS`).

**Correção estrutural (achado 7)**: **duas portas irmãs, nunca uma porta estendida com um segundo
método misturado, nunca um import cross-módulo direto**:

- `AssignedActiveItemsLookup` (existente, `organization/ports/`) — inalterado, continua só
  `ExpirationItem`.
- `AssignedActiveRequirementsLookup` (**nova porta**, `organization/ports/`, mesmo padrão
  estrutural — a "consuming module" declara a porta, o composition root implementa lendo
  `document-archive`'s store, exatamente como `AssignedActiveItemsLookup` já faz para `expiration`
  hoje). `organization` nunca importa nada de `document-archive` diretamente — só o composition
  root (`runtime/aws/composition/organization.ts`) importa os dois módulos, mesmo padrão já
  estabelecido.

`RemoveMembershipService.remove()`/`LeaveOrganizationService.leave()` chamam **AMBOS os lookups
sempre** (nunca condicional — um usuário pode ter tanto `ExpirationItem`s quanto `Requirement`s
atribuídos simultaneamente). Contrato de erro **aninhado, nunca uma lista/contagem única
misturando as duas entidades** (fecha "taxonomia neutra" da Rodada 1 E "como os dois resultados são
combinados" da Rodada 2):

```ts
class ResponsibilityReassignmentRequiredError extends AppError {
  details: {
    targetUserId: string;
    expirationItems: { itemIds: string[]; totalKnown: number; truncated: boolean }; // teto 20, como hoje
    requirements: { requirementIds: string[]; totalKnown: number; truncated: boolean }; // teto 20, independente
  };
}
```

Lançado quando `expirationItems.totalKnown > 0 OR requirements.totalKnown > 0` — cada bloco
carrega seu próprio `totalKnown`/`truncated` real (nunca um total combinado que esconde qual
entidade trava a remoção — a UI mostra as duas listas separadas ao usuário). Isto é
retrocompatível por construção: qualquer client hoje já lê `details.itemIds` diretamente — quebra
o contrato de resposta existente. **Registrado explicitamente como mudança de contrato observável**
(nível 5, não uma extensão aditiva pura) — aceitável neste projeto porque não há usuário real
(`AGENTS.md` §1, "nunca tratar quebraria contas/sessões/dados existentes em dev como risco
bloqueador"), mas citado aqui para não fingir que é aditivo quando não é.

## 6. Tabela exaustiva de `UnifiedValidityState` (fecha achado 8)

| Entidade | Estado de origem | `evidenceValidUntil`/`dueDate`/`validUntil` | `UnifiedValidityState` |
|---|---|---|---|
| Requirement | `NOT_APPLICABLE` | qualquer | **excluído do vocabulário** (não é validade, é inaplicabilidade — filtro `applicability` separado) |
| Requirement | `MISSING` | N/A (sem evidência) | `AGUARDANDO_REVISAO` |
| Requirement | `PENDING` | N/A | `AGUARDANDO_REVISAO` |
| Requirement | `SATISFIED` | ausente | `PERMANENTE` |
| Requirement | `SATISFIED` | presente, `>= now + 7d` | `VALIDO` |
| Requirement | `SATISFIED` | presente, `< now + 7d` e `>= now` | `VENCENDO` |
| Requirement | `NOT_SATISFIED` | presente, `< now` (sempre, por `deriveRequirementStatus`) | `VENCIDO` |
| ExpirationItem | `ARCHIVED` \| `RENEWED` \| `DELETED` | qualquer | **excluído do vocabulário** (não-corrente) |
| ExpirationItem | `ACTIVE` | `dueDate >= now + 7d` | `VALIDO` |
| ExpirationItem | `ACTIVE` | `dueDate < now + 7d` e `>= now` | `VENCENDO` |
| ExpirationItem | `ACTIVE` | `dueDate < now` | `VENCIDO` |
| ExpirationItem | (nenhum) | — | **nunca `PERMANENTE`** — `dueDate` é sempre obrigatório neste agregado (`expiration-item.ts:22`, sem `?`) |
| DocumentVersion | `DRAFT` \| `RECEIVED` \| `UNDER_REVIEW` (exceto os dois abaixo) | — | ver linha seguinte |
| DocumentVersion | `DRAFT` | — | **excluído do vocabulário** (pré-existência, não revisão) |
| DocumentVersion | `RECEIVED` \| `UNDER_REVIEW` | — | `AGUARDANDO_REVISAO` |
| DocumentVersion | `REJECTED` \| `WITHDRAWN` \| `SUPERSEDED` | qualquer | **excluído do vocabulário** (terminal não-corrente) |
| DocumentVersion | `ACCEPTED` | `validUntil` ausente | `PERMANENTE` |
| DocumentVersion | `ACCEPTED` | `validUntil >= now + 7d` | `VALIDO` |
| DocumentVersion | `ACCEPTED` | `validUntil < now + 7d` e `>= now` | `VENCENDO` |
| DocumentVersion | `ACCEPTED` | `validUntil < now` | `VENCIDO` |

`"excluído do vocabulário"` significa a função adaptadora retorna `undefined` — um filtro de busca
por `UnifiedValidityState` nunca casa um item cujo adaptador retornou `undefined` (fail-closed,
mesmo estilo de `isRequirementExpiringSoon`). Cada linha desta tabela vira um caso de teste unitário
da Fatia 1 — nenhuma branch coberta só "por analogia".

## Checklist final (régua já estável desde a Rodada 2, 9,6/10, sem mudança)

1. (25%) Completude física e custo de composição.
2. (20%) Paginação e ordenação.
3. (15%) Semântica de produto.
4. (15%) Estado de validade unificado.
5. (15%) Responsável.
6. (10%) Governança de GSI.

## Fatias (atualizadas com os contratos fechados acima — inalteradas em número/ordem)

Fatia 1 (validity-state.ts + tabela exaustiva acima como casos de teste), Fatia 2
(`Requirement.assigneeUserId` + elegibilidade + `AssignedActiveRequirementsLookup` nova porta +
erro aninhado — nível 5, contrato observável quebrado deliberadamente), Fatia 3 (3 modos de busca,
`status` obrigatório singular, paginação com `scanLimitReached`, `BatchGetItem` chunked, sem
enriquecimento de `EXPIRATION_ITEM`, sem `matchedRequirements`), Fatia 4 (deferida, inalterada).

## Escopo fora (inalterado da Rodada 2, + explicitação)

Unificar `ExpirationItem` com `TrackedSubject`/`Document`/`Requirement` (dois modelos de dados
hoje sem FK entre si — fora de escopo, mudança de modelo de dados própria caso o produto decida
que precisa); combinar múltiplos `status` numa única chamada de busca; visão "todos os Subjects
não importando o tipo" com prefixo de nome nativo (cai para filtro em memória, documentado).

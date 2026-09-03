# Estado Final Consolidado — D-194: Busca e Filtros Documentais (Design, Roadmap P0.5)

**Status: `APPROVED` via protocolo Claude↔Codex (`AGENTS.md` §4), 5 rodadas, nota cega cada
rodada: Rodada 1 régua 5,4/Codex 4,8 (contestada) → Rodada 2 régua 9,6 ESTÁVEL/Codex 6,2 → Rodada 3
Codex 8,1 → Rodada 4 Codex 8,8 → Rodada 5 Claude 9,2/Codex 9,3 (fechamento, ambos ≥9,0, sem
arredondar).** Design-only — **nenhuma implementação foi feita nesta fase**. Evidência completa:
`docs/architecture/reviews/search-and-filters-scoping/` (round1-5, `-claude-`/`-codex-`
proposta/crítica cada).

## Origem

Fase 2 do plano de divide-and-conquer do item de roadmap P0.5 ("Busca e filtros documentais").
Fase 1 (escopo) encontrou: nenhum endpoint de listagem hoje suporta busca ou multi-filtro; GSI1-9
já claimados (GSI1/2/5/7/9 tenant-facing, GSI3/4/6/8 isolados por IAM); "responsável" ausente de
`Document`/`Requirement`; vocabulário de validade espalhado por 4-5 enums; recomendou nível 5-6.

## Correção ao enquadramento da Fase 1 (achado real, verificado por leitura direta)

**"Responsável" já existe** — `ExpirationItem.assigneeUserId`, com mecanismo completo de
reatribuição na remoção de Membership já `APPROVED`/implementado (D-122/D-125, com pesquisa
externa Jira/GitHub/Linear). O docblock de `tracked-subject.ts` ("modelar responsável antes de
existir um segundo usuário real") está desatualizado como justificativa geral desde D-086 (correção
de comentário registrada, nível 1-2, fora desta decisão). **`Document` não tem `name` nem `tags`**
— achado central da Rodada 1 do Codex que redirecionou todo o design: a unidade de busca por
nome/tag não pode ser "documento genérico".

## Pesquisa externa (E-014)

**SIM PARCIAL.** Busca full-text/multi-facet é um problema com solução de mercado conhecida
(OpenSearch/Algolia vs. projeção materializada/CQRS, fontes AWS Prescriptive Guidance/Database
Blog citadas com data em `round1-claude-proposal.md`). A Rodada 1 do Codex corrigiu uma
generalização exagerada da própria pesquisa (não existe uma dicotomia rígida "full-text→OpenSearch,
facetas→projeção" sustentada pelas fontes) — a Rodada 2 reduziu a conclusão ao que a pesquisa de
fato sustenta: a escolha real aqui é de proporcionalidade/custo operacional (sem usuário real, sem
justificativa para operar um cluster de busca), apoiada primariamente em `principles.md` #1 e no
precedente interno de `import-parse-service.ts`, não num "consenso de mercado" que a pesquisa não
provou. Layout de índice/chave/worker é decisão interna, resolvida pelo precedente `APPROVED` de
D-193 (`requirement-evidence-refresh`, outbox→worker→re-derive-fresh).

## Checklist final (reconciliado na Rodada 2, ESTÁVEL 9,6/10, usado nas Rodadas 3-5 sem mudança)

1. (25%) Completude física e custo de composição — cada filtro aponta para o atributo/leitura real
   que o fornece.
2. (20%) Paginação e ordenação corretas — cursor(es) explícitos, sem falso "sem mais resultados".
3. (15%) Semântica de produto — unidade de busca, significado exato de cada filtro.
4. (15%) Estado de validade unificado — mapeamento total, currentness, derivado vs. autoritativo.
5. (15%) Responsável — mecanismo completo (elegibilidade, template/import, contrato de erro), não
   só schema.
6. (10%) Governança de GSI — propósito de cada índice demonstrado, nenhuma IAM nova sobre índice
   restrito.

## Design final aprovado (resumo — histórico rodada-a-rodada tem o raciocínio completo)

### Unidade de busca — união discriminada, nunca "documento" genérico
`TrackedSubject` (via `GSI7`, tenant-wide) é a única fonte nativa de busca por nome/tag.
`Requirement` (via `GSI1` `REQSTATUS#`) e `ExpirationItem` (via `GSI1` `ITEMSTATUS#`) são as
unidades de filtro por validade/responsável. Resultado é uma união tipada
`{kind:"SUBJECT"|"REQUIREMENT"|"EXPIRATION_ITEM", ...}` — `ExpirationItem` nunca é enriquecido com
`subjectDisplayName` (não tem `subjectId`, os dois modelos de dados não têm FK entre si hoje,
unificá-los é fora de escopo).

### Três modos de busca, status obrigatório e singular, sem GSI novo
`searchSubjects`/`searchRequirements`/`searchExpirationItems`, cada um uma `Query` num índice já
tenant-facing (`GSI7`/`GSI1`/`GSI1`) + filtro em memória (nome prefixo-com-`type`-ou-substring-sem,
tag, responsável, `UnifiedValidityState`) sobre a página já lida — nunca uma segunda leitura por
item exceto `BatchGetItem` chunked (até 2 chunks de 100 chaves) para resolver
`subjectDisplayName` em hits de `REQUIREMENT`. `status` é obrigatório e singular por chamada (sem
composição de múltiplos status pelo servidor, sem cursor sintético cross-modo). Teto de 5 páginas
nativas de 25 itens (125 avaliados) por chamada, `{items, cursor, scanLimitReached}` como contrato
de página — cursor carrega fingerprint de toda a assinatura de busca (mode/status/type/
namePrefix/tag/assigneeUserId/validityState), rejeitado com 400 se reapresentado com filtros
diferentes. Nível 4 (`change-risk-scale.md`).

### Responsável — `Requirement.assigneeUserId`, mecanismo completo transportado de D-122/D-125
Campo novo em `Requirement` (não em `Document` — Document é evidência, Requirement é a obrigação
acionável, decisão de engenharia dentro da autoridade já delegada por D-122, não uma reabertura de
produto). Elegibilidade em create/update via `MemberEligibilityChecker` (mesma porta de
`expiration-service.ts`); `applyTemplate` nunca herda responsável (Requirements de template nascem
sem, consistente com "apply é snapshot" já documentado). Reatribuição na remoção de Membership via
**porta irmã nova** `AssignedActiveRequirementsLookup` (nunca estende a porta existente, nunca
importa `document-archive` diretamente de `organization` — só o composition root) — 4 Queries
exaustivas (`MISSING`/`PENDING`/`SATISFIED`/`NOT_SATISFIED`, excluindo `NOT_APPLICABLE`) rodando em
paralelo com a Query existente de `ExpirationItem` (5 no total), timeout de 5s com fail-closed
(`ServiceUnavailableError`, retryable). Contrato de erro **aditivo**: `itemIds`/`totalKnown`/
`truncated` de `ExpirationItem` inalterados, campo novo opcional `requirements?` — zero quebra de
contrato observável. Observabilidade via log operacional estruturado próprio (`SecureLogger` no
composition root, nunca `security-audit.ts` — taxonomia fechada de autorização/GSI restrito, não
serve para performance), cobrindo `ALLOWED`/`BLOCKED`/`TIMEOUT`/`ERROR`, com
`durationMs`/`pagesEvaluated`/`itemsEvaluated`/`consumedCapacityUnits`; gatilho quantitativo para a
fatia de índice dedicado por `assigneeUserId`: **>1% dos lookups excedendo 2,5s numa janela móvel
de 7 dias**. Nível 5 (contrato de erro em produção tocado, ainda que aditivamente).

### `UnifiedValidityState` — vocabulário fixo de 5 valores do roadmap, estados sem correspondência real ficam de fora
`src/shared/domain/validity-state.ts` (utilitário genérico, sem import de `src/modules/**`) +
adaptador puro por entidade no módulo dono. Tabela final de `Requirement` (8 linhas, cobrindo toda
combinação real de `status`×`evidenceState` alcançável por `deriveRequirementStatus`):
`NOT_APPLICABLE`/`MISSING`/`PENDING`-com-evidência-terminal-inválida excluídos do vocabulário
(retornam `undefined` — nunca forçados a um valor que mudaria o significado apresentado ao
usuário); `PENDING`-com-evidência-em-fluxo → `AGUARDANDO_REVISAO`; `SATISFIED` →
`PERMANENTE`/`VALIDO`/`VENCENDO` conforme `evidenceValidUntil` (já denormalizado no item, zero
leitura extra); `NOT_SATISFIED` → `VENCIDO`. `ExpirationItem`: `ACTIVE` →
`VALIDO`/`VENCENDO`/`VENCIDO` conforme `dueDate` (nunca `PERMANENTE`, `dueDate` é sempre
obrigatório neste agregado); demais status excluídos. `DocumentVersion`: `DRAFT` excluído (não é
revisão pendente); `RECEIVED`/`UNDER_REVIEW` → `AGUARDANDO_REVISAO`; `REJECTED`/`WITHDRAWN`/
`SUPERSEDED` excluídos (terminal não-corrente); `ACCEPTED` → `PERMANENTE`/`VALIDO`/`VENCENDO`
conforme `validUntil` — não participa do filtro de busca desta fase (nenhum modo busca `Document`
diretamente), mas o adaptador existe para uso futuro em tela de detalhe.

## Escopo explicitamente fora desta decisão

Busca full-text/relevância; `Document.assigneeUserId`; índice novo (`GSI10`)/projeção
materializada (fatia deferida, gatilho: teto de `TenantEntitlement` subir ou uso real mostrar
custo); migrar dado existente; UI/frontend; validade/responsável em `TrackedSubject`; tags em
`Requirement`; busca por nome em `Document` (sem campo de nome); unificar `ExpirationItem` com o
cluster `TrackedSubject`/`Document`/`Requirement` (dois modelos de dados sem FK entre si —
mudança de modelo de dados própria); ordenação global unificada entre os três modos de busca;
índice dedicado por `assigneeUserId` (nomeado, gatilho quantitativo definido, não construído).

## Bloqueio genuíno de produto? Nenhum encontrado

A escolha de `Requirement` (não `Document`) como entidade que carrega `assigneeUserId` foi tratada
como decisão de engenharia dentro da autoridade já delegada por D-122 (mesma classe de "onde um
valor já aprovado pelo produto fica no modelo de dados"), não escalada a Marcelo — o Codex validou
esse enquadramento sem contestar na Rodada 2. A mudança de contrato de erro foi resolvida por uma
alternativa aditiva (sugerida pelo próprio Codex) que evita precisar de aprovação de produto
separada. Nenhum outro ponto das 5 rodadas exigiu decisão exclusiva de Marcelo.

## Próxima fase (implementação) — escopo preciso, fatias executáveis independentemente

```text
Fatia 1 — src/shared/domain/validity-state.ts (utilitário genérico) + adaptador por entidade
  (document-archive/requirement.ts, document-archive/document-version.ts,
  expiration/expiration-item.ts) + testes unitários cobrindo as 8 linhas da tabela de Requirement
  e as linhas de ExpirationItem/DocumentVersion. Nível 3-4, sem protocolo novo.

Fatia 2 — Requirement.assigneeUserId: campo + elegibilidade create/update (reuso de
  MemberEligibilityChecker) + applyTemplate explicitamente nunca herda + porta nova
  AssignedActiveRequirementsLookup (organization/ports/, implementada no composition root lendo
  document-archive) + extensão aditiva de ResponsibilityReassignmentRequiredError (campo
  `requirements?` novo, campos existentes inalterados) + 4 Queries exaustivas em paralelo com
  timeout 5s fail-closed + log operacional próprio via SecureLogger (nunca security-audit.ts) +
  correção do docblock stale de tracked-subject.ts. Nível 5.

Fatia 3 — searchSubjects/searchRequirements/searchExpirationItems: Query em índice já tenant-facing
  (GSI7/GSI1/GSI1) + filtro em memória + BatchGetItem chunked (só enriquecimento de Requirement) +
  status obrigatório/singular + contrato de paginação completo (items/cursor/scanLimitReached,
  cursor com fingerprint de toda a assinatura de busca, 400 se divergir) + teto de 5 páginas/125
  itens. Nível 4.

Fatia 4 (DEFERIDA, gatilho quantitativo nomeado, não construída): projeção materializada
  SearchableDocument + GSI10, só quando TenantEntitlement subir ou uso real mostrar custo — a
  matriz filtro×entidade×atributo físico já fechada nas Fatias 1-3 reduz o trabalho de design
  daquela fase a "onde persistir o que já sabemos calcular".

Fatia 5 (DEFERIDA, gatilho quantitativo nomeado na Fatia 2, não construída): índice dedicado por
  assigneeUserId, só se >1% dos lookups de reatribuição excederem 2,5s numa janela móvel de 7 dias.
```

Cada fatia 1-3 é testável isoladamente e não exige uma segunda rodada de protocolo Claude↔Codex
salvo achado real durante implementação (mesmo padrão de "próxima fase" de D-192/D-193).

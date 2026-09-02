# MaintenanceDueIndex — Estado Final Consolidado (D-179)

**Status: `APPROVED (design)` via protocolo Claude↔Codex, 4 rodadas (5,8 → 6,4 → 8,3 → 9,3), Claude
9,2/Codex 9,3 na Rodada 4, sem arredondar. DESIGN-ONLY — implementação real fica para sessão(ões) futuras,
primeira fatia nomeada em `NEXT_SESSION_PROMPT.md`.**

Origem: D-170 (`docs/architecture/reviews/performance-audit-2026-09-02-reconciliation/estado-final-consolidado.md`,
achado #5) confirmou starvation estrutural permanente em 9 dos 10 workers de manutenção — `Scan`+`Limit`+
páginas bounded sem cursor persistido entre invocações agendadas, reiniciando pela mesma ordem física de hash
a cada run. Só `document-purge` (D-061) escapa, via `Query` sobre GSI6 ordenado por data de elegibilidade.

## Declaração E-014 (pesquisa externa) — `SIM PARCIAL`

Paginação/`LastEvaluatedKey` do DynamoDB, sparse index como padrão para filtrar itens elegíveis para
manutenção, e `dynamodb:LeadingKeys` para isolamento por partition key em `Query` de GSI são padrão externo
bem estabelecido, verificado contra 3 fontes primárias da AWS (Developer Guide de Query/Scan pagination,
best practices de sparse indexes, IAM fine-grained access control/Service Authorization Reference) — todas
verificadas diretamente contra o comportamento alegado, não citadas às cegas (2 citações da Rodada 1 —
AWS Database Blog raiz e "The DynamoDB Book" sem edição/capítulo — foram descartadas na Rodada 2 por não
serem reprodutíveis, achado real do Codex). A alocação real de GSI desta tabela (GSI1-GSI7 já ocupados, novo
índice precisa de GSI8) e o escopo exato de quais workers migram são internos, resolvidos por leitura direta
do código, não por pesquisa externa.

## Decisão aprovada

**GSI8 global, esparso, `KEYS_ONLY`, `PK = "WORK#<workerType>"` / `SK = "<dueAtIso>#TENANT#<tenantId>#
<entityId>"`**, substituindo `Scan`+`Limit`+páginas nos 9 workers (`membership-purge`, `invitation-purge`,
`document-file-reconciliation`, `requirement-reindex`, `quota-telemetry-purge`, `security-audit-purge`,
`transient-purge`, `delivery-record-purge`, `core-user-data-purge`) por `Query GSI8SK < now`, ordenado por
vencimento — mesma garantia estrutural que `document-purge`/GSI6 já implementa desde D-061.

### Componentes do design (fechados nas 4 rodadas, ver arquivos `round*.md` para o histórico completo)

1. **Namespace por PK, sem shard no lançamento** — `WORK#<workerType>` como partição; sharding fica como
   runbook condicionado a alarme real (`oldestCandidateAgeSeconds`), nunca pré-otimizado.
2. **Isolamento IAM real por worker** — `dynamodb:LeadingKeys` condicionado a `["WORK#<type>", "DLQ#<type>"]`
   por política de role, nunca uma política genérica "leia GSI8"; `dynamodb:TransactWriteItems` é ação NOVA
   (não coberta pela política geral `tenant_facing_read_write` hoje) adicionada explicitamente, escopada à
   tabela base, por role de worker.
3. **Projeção `KEYS_ONLY`** — sem duplicar atributos de negócio (crítico para `security-audit-purge`); todo
   worker já revalida o item base antes de agir (invariante #4 abaixo), então a leitura adicional que
   `KEYS_ONLY` implica é a mesma leitura que a correção já exigia, não custo puramente novo — quantificação
   real (RCU/WCU exatos) fica para medição em implementação.
4. **Revalidação atômica obrigatória** — GSI8 é somente mecanismo de descoberta, nunca fonte de elegibilidade
   (mesma invariante que `document-file-reconciliation/candidate-source.ts` já documenta hoje). Workers com
   fence de `TenantLifecycleRecord` passam a usar `TransactWriteItems` com `ConditionCheck(status=ACTIVE)` +
   mutação do candidato na MESMA transação — fecha o TOCTOU que existia no padrão antigo (`Get` separado +
   cache).
5. **`deriveMaintenanceDue(candidate): { dueAtIso } | undefined`** — função pura nova por worker (6 dos 9 já
   têm o equivalente exportado como `isPurgeEligibleBy*`; `requirement-reindex`, `document-file-reconciliation`
   e `transient-purge` precisam de extração/exportação, refactor mecânico nível 2-3), reusada por 3
   consumidores: o writer da entidade (grava o ponteiro na transição real), o script de backfill, e teste de
   consistência do candidate-source.
6. **Backfill cobre todo item com `dueAt` determinável, não só os já vencidos** — erro real da Rodada 3
   corrigido na Rodada 4: um item `REMOVED` há 2 dias (longe dos 30 exigidos) recebe o ponteiro no backfill
   com `GSI8SK` no futuro, evitando que registros pré-existentes com vencimento futuro desapareçam
   permanentemente do índice quando a data chegar.
7. **Coexistência temporária com critério objetivo de encerramento** — candidate-source migrado consulta GSI8
   primeiro; `Scan` de fallback só é removido no deploy seguinte, quando o backfill reporta 0 itens elegíveis-
   ao-índice sem ponteiro. Nunca dois mecanismos "para sempre".
8. **Poison records / quarentena** — backoff exponencial capado (`GSI8SK` recalculado a partir do
   `maintenanceAttemptCount` observado na revalidação, não recomputado a cada retry — idempotente via
   `ConditionalCheckFailedException` tratado como no-op, mesmo padrão que `membership-purge/purge.ts` já usa
   para o delete em si); acima de `MAX_ATTEMPTS`, move para `GSI8PK = "DLQ#<type>"`, mesma política IAM
   (lista de 2 valores em `LeadingKeys`). Redrive é operação manual futura, especificada (script separado,
   condição OCC, `GSI8SK` recalculado do estado atual via `deriveMaintenanceDue()`).
9. **Observabilidade sobe pelo handler, nunca pelo worker** — workers continuam observability-agnostic
   (`AGENTS.md` §7, D-007); retornam `quarantinedCount`/`oldestCandidateAgeSeconds` no objeto de resultado
   (mesmo padrão de todo `*PurgeResult` já existente); o handler real (`src/runtime/aws/handlers/`) emite as
   métricas. Gatilho de shard usa `oldestCandidateAgeSeconds` (backlog real, mensurável) como sinal primário,
   `ThrottledRequests` nativo da tabela+GSI8 como corroborante secundário (sem granularidade por namespace,
   nunca gatilho principal).
10. **`requirement-reindex` permanece no escopo GSI8** — achado real: a Rodada 1 excluiu incorretamente,
    alegando ausência de `dueAt`; `reindex.ts:46-47` confirma que `evidenceValidUntil` comparado contra `now`
    é exatamente esse `dueAt`. Erro corrigido na Rodada 3, confirmado pelo Codex.

### Alternativas avaliadas e rejeitadas (comparação real, não descartadas por presunção)

Cursor persistido por worker (resolve só posição, não o custo estrutural do `Scan`+filtro); Parallel Scan com
checkpoint (mesma limitação — **escolhida para nenhum destes 9**, mas seria a opção certa se algum worker não
tivesse noção real de `dueAt`, o que não é o caso de nenhum dos 9 depois da correção do item 10 acima);
sobrecarregar o GSI6 existente (empilha blast radius de isolamento IAM e reabre a decisão de projeção `ALL`
já fechada por D-061 para um caso que não precisa dela); TTL nativo (não resolve os workers com condição de
tenant-ativo extra); Stream/outbox materializando itens de trabalho (infraestrutura nova sem ganho líquido
sobre um GSI namespaced); fila/tabela de manutenção dedicada (SQS não ordena por `dueAt` nativamente; a
quarentena do item 8 já cobre a necessidade real de isolar poison records sem fila nova).

## Achados genuínos por rodada (não teatro de revisão — cada nota subiu porque um problema real foi corrigido)

- **Rodada 1 → 2 (5,8/10)**: 12 achados bloqueantes reais — garantia de progresso falsa diante de poison
  records, IAM "por índice" não é "por worker", projeção indecisa, matriz de 9 contratos ausente, backfill sem
  fundamento, revalidação não formalizada, observabilidade ausente, shard com métrica errada, 2 imprecisões
  factuais sobre GSI6, checklist substituindo pesos normativos, alternativas não comparadas, citações E-014
  não reprodutíveis.
- **Rodada 2 → 3 (6,4/10)**: a correção da Rodada 2 introduziu **3 erros factuais novos** (excluiu
  `requirement-reindex` por leitura invertida do código; alegou que `reset-dev-data.ts` faz reseed quando na
  verdade só apaga; matriz com fórmulas de `dueAt` erradas para 3 workers) — cada um corrigido por leitura
  direta do código na Rodada 3, com `arquivo:linha` citado.
- **Rodada 3 → 4 (8,3/10)**: os 5 achados restantes eram de design genuíno, não erro factual — backfill
  cobria o conjunto errado (só itens já vencidos), reuso de função "já exportada" não valia para 3 dos 9
  workers, IAM omitia `TransactWriteItems` (ação real não coberta pela política geral), idempotência do
  backoff ambíguo não demonstrada, observabilidade dentro do worker violava a arquitetura vigente.
- **Rodada 4 (9,3/10, aprovado)**: todos os 5 fechados com mecanismo concreto reaproveitando padrões já
  convergidos no projeto (claim condicional idempotente = mesmo formato do OCC delete já usado;
  observabilidade subindo ao handler = regra já existente; IAM completo). Única ressalva não-bloqueante do
  Codex: a redação "observado na Query" para o contador de tentativas é imprecisa com `KEYS_ONLY` — o valor
  correto é observado na revalidação/`GetItem` do item base, que o fluxo já exige de qualquer forma; corrigido
  nesta consolidação (item 8 acima já reflete "observado na revalidação", não "na Query").

## O que esta decisão NÃO faz

Não implementa código (fora de escopo explícito — design-only). Não migra `document-purge`/GSI6 (não sofre do
bug, mudá-lo seria custo sem correção). Não decide os números reais de RCU/WCU por worker (medição de
implementação). Não escreve os 9 scripts de backfill/redrive nem os testes Terraform novos (nomeados como
próxima fatia, `NEXT_SESSION_PROMPT.md`).

## Referências

`round1-claude-proposal.md`, `round1-codex-critique.md` (5,8/10), `round2-claude-revision.md`,
`round2-codex-critique.md` (6,4/10), `round3-claude-revision.md`, `round3-codex-critique.md` (8,3/10),
`round4-claude-revision.md`, `round4-codex-critique.md` (9,3/10, `APPROVED`) — todos nesta mesma pasta.

# D-319 — Rodada 3 (endereçando os achados da Rodada 2, nota Codex 7,8/10)

## Achado 1 (residual) — fase de PARSE ainda mascarava a claim órfã — CORRIGIDO

Achado real e certeiro do Codex: minha correção da Rodada 2 só protegia a fase de COMMIT — a fase
de PARSE (`import-parse-service.ts`) tratava QUALQUER `ImportDedupRecord` existente como "já
importado" (`SKIP_DUPLICATE`/`EXTERNAL_ID_ALREADY_EXISTS`), inclusive um com `subjectId: ""`
(claim órfã). Isso significa que um job NOVO reimportando o mesmo CSV pularia a linha
silenciosamente para sempre — nunca chegando à proteção de commit que a Rodada 2 implementou.

Corrigido em AMBOS os branches (`SUBJECT` em `import-parse-service.ts:168` e `ITEM` na mesma
lógica para Item): a checagem agora só trata como duplicata genuína quando
`existingDedup?.subjectId` tem um valor real — uma claim órfã passa como `CREATE_SUBJECT`/
`CREATE_ITEM` normal, deixando a proteção de commit (`resolveExistingClaim()`, já corrigida na
Rodada 2) capturar e reportar `FAILED_INDETERMINATE_ROW_STATE` de forma visível, em vez de um
silêncio permanente na fase de parse. 2 testes novos (um por branch) provam que a claim órfã agora
passa como `CREATE_*`, não mais `SKIP_DUPLICATE`.

## Achado 2 (residual) — cobertura de teste ainda incompleta — PARCIALMENTE endereçado, resto registrado

Os 2 novos testes de parse (acima) fecham o cenário mais crítico ("novo job encontrando
placeholder", citado explicitamente pelo Codex). Os outros 3 cenários que o Codex pediu (falha
exatamente entre claim e criação; criação concluída mas confirmação falha; execução concorrente)
são estados de baixo nível difíceis de simular sem instrumentar o próprio `ImportStore` fake para
falhar no meio de uma sequência — decisão: não instrumentado nesta rodada (ver achado 6 abaixo,
que cobre a causa raiz de "execução concorrente" como uma questão maior de OCC, não só de teste).
Corrigido o erro de contagem apontado ("4 testes" vs. 3 reais) — a Rodada 2 realmente tinha 3.

## Achado 3, 4, 5 — confirmados resolvidos pelo Codex, nenhuma ação necessária

## Achado 6 (residual) — validação de horário (hora=24) — CORRIGIDO

`DATE_TIME_PATTERN` agora captura hora/minuto/segundo e `isValidClockTime()` (nova, mesma forma de
`isValidCalendarDate()`) rejeita `"2026-12-31T24:00:00Z"` — RFC3339 nunca trata "24:00:00" como
sentinela de "mesmo dia", e o `Date.parse` silenciosamente rolava para o dia seguinte. Teste novo.

## Achado da Rodada 2 sobre corrigir TrackedSubject também — o Codex apontou um problema estrutural maior (OCC)

O Codex confirmou que corrigir `commitTrackedSubjectRows()` foi apropriado, mas identificou que a
nova transição `FAILED_INDETERMINATE_ROW_STATE` (como TODA transição de FAILED neste arquivo,
inclusive as PRÉ-EXISTENTES — `MISSING_PLAN_REFERENCE`, `PLAN_INTEGRITY_MISMATCH`,
`ENTITLEMENT_EXCEEDED`) grava via `deps.store.update<ImportJob>()` **sem condição de versão**
(`failJob()`, já existia antes de D-319) — duas execuções concorrentes do mesmo worker (SQS
at-least-once, o cenário que este arquivo inteiro foi desenhado para tolerar) podem se sobrescrever
mutuamente, uma potencialmente perdendo o registro `FAILED` da outra.

**Decisão, não corrigido nesta rodada**: confirmado por grep que os branches `TrackedSubject` e
`Item` (`commitTrackedSubjectRows`/`commitItemRows`) escrevem cursor/status via `update()`
incondicional (`failJob()`, linha 104, já usada por `MISSING_PLAN_REFERENCE` antes de qualquer
código de D-319 existir). **Correção de precisão (Rodada 3, achado do Codex)**: ao contrário do que
esta nota dizia antes, isso NÃO vale para "toda escrita neste arquivo" — o branch
`Document`/`Requirement` (`commitReferencingRows`) já usa `buildVersionedUpdate()`/
`executeTenantBusinessMutation` com `expectedVersion`, com fencing real. A lacuna é real e
pré-existente a D-319 (confirmado no commit-pai de D-319, `failJob()` já incondicional), mas D-319
**replicou** essa lacuna no branch Item novo, em vez de trazê-lo ao padrão mais rigoroso que
Document/Requirement já tinham — não é só "herdado", é uma escolha real desta mudança que merece
nome. Consertar exigiria adicionar fencing de versão a `commitTrackedSubjectRows`/`commitItemRows`
inteiros — mudança estrutural maior que o escopo desta revisão (detecção de claim órfã). Registrado
em `decisions-log.md` D-330/`NEXT_SESSION_PROMPT.md` para uma rodada de escopo dedicada.

## Testes/evidência desta rodada

Backend: 274 arquivos/3261 testes verdes (+3: 2 parse-phase orphaned-claim + 1 clock-time).
`npm run typecheck`/lint limpos.

## Auto-nota cega (Claude), Rodada 3

Ver `round-3-claude-selfgrade.md` (arquivo separado).

# Rodadas 1-2 — Bulk Actions (Roadmap P1, item 17)

## Rodada 1 — Proposta Claude (resumo)

Roadmap (`roadmap-competitivo-2026-09-01.md:109`): "Bulk actions — importante para operação em
escala", sem lista de ações. `docs/frontend/interface-context-and-critical-tasks.md` §30: bulk
archive foi cogitado e removido do horizonte por "product creep — nenhuma base em código nem em
roadmap aprovado" — condição que não vale mais (roadmap agora nomeia o item formalmente), mas
histórico usado para manter a lista v1 estreita.

Candidatos de ação única: `ExpirationItem.updateItem()` (reassign) e `archiveItem()`
(`expiration-service.ts:284,384`). Precedente de fan-out: `import-commit-service.ts` (D-192) —
uma `TransactWriteItems` PEQUENA por linha, nunca uma transação gigante, falha nunca aborta o
lote.

Proposta inicial: v1 = reassign+archive; fan-out por transação pequena independente; resposta
síncrona com outcome por item; RBAC `WRITE_ROLES` (não elevado); teto 100 itens; síncrono (sem
worker).

**Nota cega Codex Rodada 1: 8,0/10.** Achados: (1) bulk archive é mais destrutivo (emite
`ItemDeactivated`, cancela/rematerializa reminders via outbox, `expiration-service.ts:795`) —
precisa confirmação UX explícita; (2) falta contrato `{itemId, expectedVersion}` por item — sem
isso perde a garantia OCC; (3) terminologia errada ("mesmo ledger de D-192" — aqui é síncrono,
sem ledger) + falta taxonomia de falha; (4) RBAC `WRITE_ROLES` confirmado correto; (5) teto 100
síncrono é arriscado — `items_handler` usa timeout default de 10s (`lambda-function/
variables.tf:43`), não os 25s dedicados de `export-handler`; (6) pesquisa externa usada de forma
frouxa — Jira na verdade usa job assíncrono com `taskId`/polling para até 1000 itens.

## Rodada 2 — Revisão Claude + crítica Codex

Aceitos os 6 pontos: (1) confirmação UX explícita (`confirm: true`) exigida para bulk archive;
(2) contrato `{itemId, expectedVersion, ...campos}` por item adotado; (3) terminologia corrigida
para "outcome por item na resposta síncrona" + taxonomia completa adotada; (4) RBAC mantido; (5)
Lambda DEDICADA (mesmo precedente de `export-handler`, D-123/D-126) com `timeout_seconds=25`, teto
100 mantido; (6) pesquisa corrigida — Jira usa job/polling pela escala/complexidade maior (1000
itens, múltiplos tipos de issue), este design continua síncrono por proporcionalidade (teto 100,
1 entidade, 1 tenant, mesmo argumento de D-194/D-198).

**Nota cega Codex Rodada 2: 8,4/10.** Achados restantes: (1) ambiguidade de retry pós-timeout —
se o cliente perde a resposta após N itens aplicados e faz retry, os já aplicados voltariam como
`VERSION_CONFLICT` mesmo tendo "sucedido" — precisa regra de reconciliação; (2) justificativa
"export processa 2000 itens em 25s" é fraca — export usa `queryGsi1Page` (leitura), bulk archive é
`GetItem` forte+`TransactWriteItems` (update+outbox+audit+fence) por item, custo não comparável —
tratar teto 100/25s como hipótese a validar, não fato provado; (3) correção de infra: API é HTTP
API v2 (`aws_apigatewayv2_api`), cota de integração 30s, não "REST 29s".

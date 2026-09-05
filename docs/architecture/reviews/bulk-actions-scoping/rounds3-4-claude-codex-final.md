# Rodadas 3-4 — Bulk Actions (fechamento)

## Rodada 3 — Revisão Claude + crítica Codex

Aceitos os 3 pontos: (1) regra de reconciliação restrita — se `current.version !== expectedVersion`,
só reconhece replay quando `current.version === expectedVersion+1` E o estado atual já é EXATAMENTE
o alvo desta ação (nunca "algo mudou" genérico); qualquer outra combinação é `VERSION_CONFLICT`
fail-closed; (2) teto 100/25s reclassificado como melhor estimativa de engenharia, condicionado a
smoke test de integração medindo o tempo real ANTES de expor a rota, ajustável para baixo se
necessário; (3) corrigido para "HTTP API v2 (`aws_apigatewayv2_api`), cota de integração 30s".

**Nota cega Codex Rodada 3: 8,9/10.** Ajuste semântico restante: a regra de reconciliação prova
que o ESTADO-ALVO já foi observado após avanço de 1 versão, mas NÃO prova que foi a própria
tentativa/retry que causou isso (poderia ser outro ator aplicando a mesma mudança) — nomear
corretamente (`TARGET_ALREADY_APPLIED`, não `SUCCEEDED_RECONCILED`) e declarar isso explicitamente.
Também: registrar precondição explícita de bulk archive operar só em itens `ACTIVE` — `archiveItem()`
atual não bloqueia rearquivar item já `ARCHIVED` quando a versão bate, o que emitiria um
`ItemDeactivated` duplicado sem transição real se replicado no bulk.

## Rodada 4 — Revisão final Claude + fechamento Codex

Aceitos os 2 ajustes: outcome renomeado para `TARGET_ALREADY_APPLIED`, definido com precisão
honesta ("estado-alvo já observado após avanço de uma versão — não implica que esta tentativa
específica escreveu"); sem `bulkOperationId`/ledger no v1 (autoria de qual tentativa causou o
estado não é requisito declarado). Bulk archive ganha precondição `status === "ACTIVE"` — item
já `ARCHIVED`/`DELETED` no lote retorna `INELIGIBLE_STATE` (novo, distinto de `VERSION_CONFLICT`),
nunca emite `ItemDeactivated` duplicado. Comportamento do `archiveItem()` single-item existente
permanece intocado.

**Nota cega final Codex: 9,2/10.**
**Nota cega final Claude: 9,1/10** — 4 rodadas reais, cada achado do Codex verificado por leitura
direta de código (`expiration-service.ts:284,384,795`, `lambda-function/variables.tf:43`,
`api-gateway/main.tf:6`), design final reusa o precedente exato de `export-handler` (Lambda
dedicada) e a disciplina de proporcionalidade já estabelecida (D-194/D-198) em vez de inventar
mecanismo novo.

**Ambos ≥9,0, sem arredondar. FECHADO — DESIGN APROVADO.**

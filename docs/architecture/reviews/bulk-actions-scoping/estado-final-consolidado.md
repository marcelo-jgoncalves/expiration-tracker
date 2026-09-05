# Estado Final Consolidado — Roadmap P1 item 17 ("Bulk actions")

**Status: `APPROVED` — design técnico, protocolo Claude↔Codex (`AGENTS.md` §4) completo, 4
rodadas, nota cega final Claude 9,1/Codex 9,2 (ambos ≥9,0, sem arredondar). Evidência completa:
`rounds1-2-claude-codex.md`, `rounds3-4-claude-codex-final.md` (neste diretório). DESIGN-ONLY —
nenhum código/schema/infra alterado.**

## Origem

Roadmap nomeia "Bulk actions" como item P1 formal — condição que faltava quando um achado
anterior do Codex classificou bulk-archive como "product creep" (`docs/frontend/
interface-context-and-critical-tasks.md` §30). D-198 confirmou nenhuma rota bulk existe hoje.

## Pesquisa externa (E-014): SIM PARCIAL

Atlassian Jira bulk operations (job assíncrono, `taskId`/polling, até 1000 itens, permissões
próprias) e Asana multi-select (síncrono para seleções pequenas) — ambas fontes primárias,
2026-09-05. Padrão de mercado: split síncrono-para-pequeno/assíncrono-para-grande — este design
fica no lado síncrono por proporcionalidade de escala (teto 100, não 1000).

## Achados reais que fecharam as 4 rodadas (todos do Codex, verificados por leitura de código)

1. Bulk archive é mais destrutivo que reassign (`ItemDeactivated`+cancelamento de reminders,
   `expiration-service.ts:795`) — fechado com confirmação UX explícita obrigatória no request.
2. Contrato `{itemId, expectedVersion}` por item ausente na Rodada 1 — sem ele a bulk action
   perderia a garantia OCC das rotas single-item — fechado, obrigatório.
3. Teto 100 síncrono sobre o timeout real de 10s de `items_handler` (`lambda-function/
   variables.tf:43`) — fechado com Lambda DEDICADA (mesmo precedente de `export-handler`,
   D-123/D-126), `timeout_seconds=25`, dentro da cota real de 30s do HTTP API v2 (`api-gateway/
   main.tf:6` usa `aws_apigatewayv2_api`, correção de "REST 29s" para "HTTP API v2, 30s").
4. Teto 100/25s inicialmente "provado" por analogia fraca com `export` (leitura, não
   transação) — fechado reclassificando como hipótese de engenharia, condicionada a smoke test de
   integração medindo o custo real antes de expor a rota, ajustável para baixo.
5. Ambiguidade de retry pós-timeout (itens já aplicados voltariam como `VERSION_CONFLICT`) —
   fechado com regra de reconciliação restrita: só reconhece `TARGET_ALREADY_APPLIED` quando
   `current.version === expectedVersion+1` E o estado bate EXATAMENTE com o alvo desta ação;
   qualquer outra combinação é `VERSION_CONFLICT` fail-closed. Nomenclatura corrigida para não
   afirmar autoria da tentativa (não implica que "esta" tentativa escreveu, só que o alvo já
   existe).
6. `archiveItem()` atual não bloqueia rearquivar item já `ARCHIVED` com versão válida — fechado
   com precondição explícita `status === "ACTIVE"` no bulk archive (item inelegível retorna
   `INELIGIBLE_STATE`, nunca emite `ItemDeactivated` duplicado); comportamento single-item
   existente permanece intocado.

## Design final (9 decisões)

1. **Lista v1**: `bulk reassign` (`assigneeUserId`) e `bulk archive` sobre `ExpirationItem`.
   Nenhuma outra ação (delete, renew, Requirement/Document) no v1.
2. **Confirmação UX**: bulk archive exige `confirm: true` explícito no corpo da requisição.
3. **Precondição de status**: bulk archive só processa itens `ACTIVE`; inelegível → `INELIGIBLE_STATE`.
4. **Contrato por item**: `items: [{itemId, expectedVersion, ...campos da ação}]`.
5. **Fan-out**: uma `TransactWriteItems` PEQUENA por item, cada uma OCC-fenced independentemente
   (padrão de `import-commit-service.ts`, D-192) — nunca uma transação gigante para o lote.
6. **Reconciliação de retry**: `TARGET_ALREADY_APPLIED` só quando version avançou exatamente 1 E
   o estado bate com o alvo; caso contrário `VERSION_CONFLICT` fail-closed.
7. **Resposta síncrona**: outcome por item, taxonomia completa (`SUCCEEDED`/
   `TARGET_ALREADY_APPLIED`/`INELIGIBLE_STATE`/`NOT_FOUND`/`VERSION_CONFLICT`/
   `INELIGIBLE_ASSIGNEE`/`AUTHORIZATION_DENIED`/`TENANT_NOT_ACTIVE`/`VALIDATION_FAILED`/`UNKNOWN`).
8. **Infra**: Lambda dedicada (`timeout_seconds=25`, mesmo padrão de `export-handler`), teto 100
   itens condicionado a validação empírica (smoke/integração) antes de produção.
9. **RBAC**: `WRITE_ROLES`, mesmo tier das rotas single-item equivalentes — nunca elevado só por
   ser bulk (distinto do precedente de disclosure-de-leitura de D-195/D-204/D-205, que não se
   aplica aqui: bulk write só toca itens que o ator já poderia tocar individualmente).

## Escopo explicitamente fora desta decisão

Bulk delete, bulk renew, bulk sobre `Requirement`/`Document` — candidatos futuros, não decididos;
job assíncrono/`bulkOperationId`/ledger persistido (só necessário se autoria de tentativa virar
requisito de auditoria); teto acima de 100 (decisão futura se o smoke test permitir).

## Próxima ação

Implementação real fica para sessão dedicada futura, mesmo padrão de D-121/D-127/D-179/D-191/
D-194/D-197/D-204/D-205. Fatias sugeridas (não decididas): (1) Lambda dedicada + rotas HTTP + RBAC;
(2) mecanismo de fan-out+reconciliação+taxonomia de outcome; (3) smoke test de integração medindo
o custo real de 100 itens antes de expor em produção.

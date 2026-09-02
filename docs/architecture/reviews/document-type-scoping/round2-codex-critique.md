# DocumentType — Rodada 2 (crítica Codex sobre a revisão, via `codex exec`)

**RUBRIC SCORE: 7,8/10 · DESIGN SCORE: 8,4/10** — ainda há achados bloqueantes, não fecha nesta rodada.

## Verificação dos 8 achados anteriores

1. **Segundo writer — parcialmente resolvido.** Tornar `documentTypeId` obrigatório e remover o fallback é correto, mas a revisão não migra o schema HTTP fonte de verdade `schemas/api/docarchive-guest-submit-evidence-request.v1.json` (hoje aceita `documentType` opcional), nem nomeia o produtor real do campo na UI de guest upload — só handlers/backend existem hoje.

2. **TOCTOU — mecanismo correto, integração incompleta.** `ConditionCheck(status=ACTIVE)` na mesma transação fecha a corrida corretamente, sem precisar de `expectedVersion`. **Novo bloqueante:** `createDocument()` hoje usa `putIfAbsent` solto, mas toda mutação tenant-scoped de negócio deve passar por `executeTenantBusinessMutation` (`shared/tenant-lifecycle/tenant-business-mutation.ts`) — a revisão não especifica essa integração (a transação real terá o `ConditionCheck` do tipo + `Put` do Document + a fence de lifecycle anexada pela lane, 3 entradas, não 2).

3. **Rename para mesmo nome normalizado — resolvido.** O ramo condicional evita corretamente duas operações no mesmo item.

4. **Normalizer — resolvido.** Promoção para `src/shared/text/` é coerente com o boundary (`shared-must-not-reach-modules` só proíbe a direção inversa); `subject`/`document-archive` importando de `shared` não viola nada.

5. **Pointer/CancellationReasons — quase resolvido.** Mecanismo correto e precedente real confirmado (`accept-invitation.ts`, `change-membership-role.ts` já distinguem por índice). **Bloqueante remanescente:** falta definir o mapeamento de posição para o `ConditionCheck` do `DocumentType` na criação de `Document` (índice 0 do erro de tipo ausente/deprecated deve virar erro de aplicação nomeado, nunca escapar como `TransactionCanceledException` cru); com a lane de tenant business mutation, a fence de lifecycle fica no último índice.

6. **GSI1SK normalizado — resolvido.**

7. **E-014 — resolvido.** `SIM PARCIAL` corrige a alegação insustentável sobre GitHub labels.

8. **Checklist reponderado — pesos melhores, mas ainda não reconciliado.** `research-protocol.md` exige que, em `SIM PARCIAL`, o checklist derivado de pesquisa cubra só a parte externamente informada — a régua da Rodada 2 mistura isso com decisões explicitamente internas (mecanismo de concorrência DynamoDB, GSI2, cobertura de todos os writers, setup de templates) e não tem âncoras "atende/não atende" por critério.

## Pontuação ponderada do design (régua da Rodada 2)

- Identidade/rename, 25%: 10,0
- Integridade concorrente, 25%: 6,5
- Soft-state, 20%: 10,0
- GSI2/todos os writers, 15%: 7,0
- Normalização/dedupe, 10%: 9,5
- Setup para templates, 5%: 8,0

Para a próxima revisão: integrar a criação de `Document` (interna e guest) à `TenantBusinessMutation` lane, definir o mapeamento posicional completo de `CancellationReasons` (incluindo a fence de lifecycle), migrar o schema HTTP do guest flow, e restringir/ancorar a sub-rubrica E-014 conforme `SIM PARCIAL` (só identidade/rename/soft-state/normalização, não mecanismo interno de concorrência/GSI/lane).

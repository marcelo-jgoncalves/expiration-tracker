# D-328 — Rodada 7 (correção ao achado R6-1, nota Codex 8,8/10 na Rodada 6)

A Rodada 6 confirmou R5-1 corrigido nas 3 comparações, mas achou um achado novo de severidade
Média (R6-1): comparar `challengeId` só DEPOIS de um conflito de `version` (dentro do `catch`) não
bastava, porque a exclusão física do TTL do DynamoDB é assíncrona e pode deixar um `version`
coincidir entre gerações genuinamente diferentes. Corrigido nesta rodada.

## R6-1 (Média) — `version` sozinho, condicionado fora de uma checagem atômica, permite reuso entre gerações

Confirmado, exatamente como o Codex descreveu: um escritor pausado (ex. um reenvio B que leu o
desafio A antes de A ser fisicamente apagado pelo TTL) tem seu `expectedVersion` calculado sobre A.
Se A é apagado de verdade enquanto B está pausado, e uma chamada `requestConfirmation()` totalmente
nova (não um reenvio - a primeira desta chave desde a exclusão) cria um desafio C do zero, C também
recebe `version=1` (`nextVersion = (current?.version ?? 0) + 1` com `current` nulo). A escrita
condicionada de B (`expectedVersion=1`) então SUCEDE contra C só por coincidência de numeração -
nunca chega ao `catch` que checa `challengeId`, porque a condição de versão sozinha já foi
satisfeita.

**Corrigido**: `challengeId` entra na própria `ConditionExpression` atômica da escrita, via
`extraConditions` (`occ.ts`, mecanismo já existente, usado por outros módulos - ex. o worker de
purga W3-06 - para exatamente este tipo de fence adicional), não só na checagem pós-conflito do
`catch`. Um `challengeIdFenceCondition()` novo (`#challengeIdFence = :challengeIdFence`, attribute
`challengeId`) é anexado às 3 escritas condicionadas do serviço (o retry loop de
`requestConfirmation()`, `incrementAttemptCountWithRetry()`, `setConfirmedAtWithRetry()`) - agora a
escrita só pode suceder contra a geração EXATA de onde foi calculada, coincidência de `version` ou
não.

## Achado colateral da própria verificação: o dublê de teste do módulo não avaliava `extraConditions`

Ao escrever o teste de regressão para R6-1, descobri que `test/unit/notification/in-memory-store.ts`
(o dublê in-memory usado por todo teste unitário deste módulo) só avaliava `#tenantId`/`#accountId`
como fences extras em uma escrita condicionada - qualquer outro `extraConditions` (como o
`challengeId` novo) era silenciosamente ignorado pelo dublê, mesmo que o DynamoDB real o aplicasse
corretamente. Isso significava que um teste de regressão para R6-1 passaria mesmo SEM a correção
real (falso positivo). Generalizei a checagem (mesmo arquivo) para avaliar qualquer par
nome/valor de igualdade presente em `ExpressionAttributeNames`/`Values`, exceto os placeholders
reservados (`#version`/`#updatedAt`) e os gerados para SET/REMOVE (`#set*`/`#rem*`) - mesma postura
que `test/unit/reminder/in-memory-store.ts` já tem com seu avaliador de expressão mais completo,
só que sem precisar portar o parser inteiro (nenhum outro `extraConditions` deste módulo hoje usa
`attribute_exists`/comparação de ordem, só igualdade). Confirmado por mutação (ver evidência
abaixo) que o teste de regressão realmente falha sem a correção E que a suíte completa do módulo
(484 testes antes desta rodada) continua verde com a generalização.

Também precisei alinhar a convenção de nomes de placeholder do próprio `challengeIdFenceCondition()`
(`#challengeIdFence`/`:challengeIdFence`, mesmo sufixo compartilhado) à convenção que
`buildScopedVersionedUpdate()` já usa para `#tenantId`/`:tenantId` e `#accountId`/`:accountId` - a
primeira tentativa (`#challengeIdFence`/`:expectedChallengeIdFence`, sufixos diferentes) fazia o
dublê generalizado calcular a chave de valor errada e silenciosamente pular a checagem. Também
verificado por mutação nesta rodada.

## Teste novo

`test/unit/notification/whatsapp-phone-confirmation-service.test.ts`, "a resend paused across a
physical TTL deletion never overwrites a from-scratch challenge that coincidentally reuses
version=1 (R6-1)": A é criado, B (reenvio) lê A e pausa antes de escrever, A é fisicamente removido
via `store._simulateTtlDeletion()` (helper novo, test-only, não faz parte de `NotificationStore` -
TTL real é uma exclusão assíncrona do lado do servidor, nenhum código de aplicação a invoca), C cria
um desafio do zero (não reenvio) na mesma chave, genuinamente mais tarde. B retoma e deve reconhecer
que perdeu (via `challengeId`, não `version`), adotando o `expiresAt` de C. **Verificado por
mutação duas vezes**: (1) removida a `extraConditions` da escrita do reenvio - teste falha; (2)
antes disso, a convenção de nome de placeholder incompatível já tinha causado um falso-positivo
silencioso (o teste passava mesmo com a correção mutada) - descoberto e corrigido ANTES de submeter,
não depois.

## Evidência

- `npm run typecheck` / `npm run lint` / `npm run check-boundaries` / `npm run check-docs`: limpos.
- `npx vitest run test/unit test/contract`: 2872/2872 (suíte completa, não só o módulo notification).
- 2 mutações aplicadas e revertidas nesta rodada (ver acima), ambas comprovaram que o teste
  depende de verdade da correção, não de um artefato do dublê.

DoD: item=D-328 Rodada 7 (fix R6-1 + fortalecimento do dublê de teste do módulo); risco=nível 4-5
(concorrência/integridade de estado num fluxo de segurança); evidência=2872/2872 vitest +
typecheck/lint/boundaries/docs limpos + teste novo verificado por mutação (2x); lacunas=nenhuma
conhecida; D-328 permanece em protocolo até 2 rodadas consecutivas ≥9,0 genuinamente cegas.

# D-328 — Rodada 8 (correções aos achados R7-1/R7-2, nota Codex 8,8/10 na Rodada 7)

A Rodada 7 confirmou R6-1 corrigido nas 3 escritas condicionadas, mas achou 2 problemas novos:
R7-1 (Média, no dublê de teste, não na produção) e R7-2 (Baixa, produção real). Ambos corrigidos
nesta rodada.

## R7-1 (Média) — o dublê de teste ainda aceitava condições não avaliadas em silêncio

Confirmado, e o Codex tinha razão ao não aceitar a correção por convenção de nome da Rodada 7 como
suficiente: minha generalização anterior (`if (!(valueKey in values)) continue`) ainda dependia de
adivinhar o nome do placeholder de valor a partir do nome do placeholder de nome - qualquer
`extraConditions` futuro que não seguisse essa convenção seria silenciosamente ignorado pelo dublê,
deixando uma escrita suceder em teste quando o DynamoDB real a teria rejeitado. Exatamente a
fragilidade que a própria Rodada 7 expôs por acidente antes de ser mascarada pela convenção de
nome.

**Corrigido**: `test/unit/notification/in-memory-store.ts` agora porta o avaliador genérico de
`ConditionExpression` que `test/unit/reminder/in-memory-store.ts` já tem e já é testado em batalha
(D-300) - `attribute_exists`/`attribute_not_exists`, igualdade, `AND`/`OR` de nível superior
respeitando parênteses (`extraConditions` do `occ.ts` sempre embrulha sua própria expressão em
parênteses, então um split ingênuo por `" AND "` quebraria um grupo assim). A expressão em si é a
única fonte de verdade agora - nenhuma suposição de convenção de nome - e sintaxe não reconhecida
lança erro (`InMemoryNotificationStore: unsupported condition clause: ...`) em vez de aprovar
silenciosamente. `transactWrite()` usa esse avaliador uniformemente para `Put`/`Update`/
`ConditionCheck`, substituindo os 3 blocos especiais que existiam antes.

Confirmei que toda `ConditionExpression` real deste módulo (`grep` em `src/modules/notification`)
usa só os 2 formatos que o avaliador cobre - `attribute_not_exists(PK) AND attribute_not_exists(SK)`
(criação) e o formato gerado por `buildScopedVersionedUpdate()`/`extraConditions` (igualdade) - então
nada quebra por sintaxe não suportada nesta migração.

## R7-2 (Baixa) — vencedor podia desaparecer entre o `putIfAbsent()` perdido e a releitura

Confirmado: `const won = await this.store.get(...); return { expiresAt: won!.expiresAt };` presumia
que a linha vencedora ainda existia no momento da releitura - se ela for fisicamente removida pelo
TTL (exclusão assíncrona, mesma janela de tempo do R6-1) entre o `putIfAbsent()` retornar `false` e
esta releitura específica, `won` é `undefined` e o acesso estoura em runtime (a asserção `!` do
TypeScript não protege nada além de compilação).

**Corrigido**: sem vencedor para adotar, a vaga está livre de novo - o código tenta criar mais uma
vez (`continue`, próxima iteração do mesmo laço já existente, que gera um `challengeId` novo via
`this.newId()`), nunca assume que `won` existe. Não é mais um "bypass de identidade de geração"
(Codex já descartou isso) - é só o quarto caminho de persistência não tratando ausência como um
estado real e alcançável.

## Testes novos

- R7-1 não introduz teste próprio isolado - é validado pela suíte INTEIRA do módulo continuar verde
  com o avaliador genérico no lugar do especial-caso anterior (485 testes de notification, 2873 no
  repositório inteiro), já que qualquer regressão de interpretação de condição quebraria algum
  teste existente que dependia do comportamento condicional correto.
- R7-2: `test/unit/notification/whatsapp-phone-confirmation-service.test.ts`, "a from-scratch
  create that loses to a putIfAbsent conflict, then finds the winner already gone (TTL), retries
  instead of throwing (R7-2)" - intercepta `putIfAbsent()` para simular uma perda de corrida real
  (insere um vencedor de mentira, reporta `false`) e `get()` para simular esse vencedor já apagado
  na releitura seguinte. **Verificado por mutação**: revertida temporariamente para
  `return { expiresAt: won!.expiresAt }`, o teste falha com o `TypeError` exato que o Codex previu
  (`Cannot read properties of undefined (reading 'expiresAt')`) - restaurada em seguida.

## Evidência

- `npm run typecheck` / `npm run lint` / `npm run check-boundaries` / `npm run check-docs`: limpos.
- `npx vitest run test/unit test/contract`: 2873/2873 (suíte completa do repositório).
- 1 mutação aplicada e revertida nesta rodada (R7-2, ver acima) - R7-1 não tem uma mutação pontual
  própria (é uma reescrita do próprio mecanismo de avaliação, validada pela suíte inteira
  permanecer verde, não por reverter uma linha).

DoD: item=D-328 Rodada 8 (fix R7-1 dublê de teste + R7-2 produção real); risco=nível 4-5
(concorrência/integridade de estado num fluxo de segurança + robustez de infraestrutura de teste
compartilhada); evidência=2873/2873 vitest + typecheck/lint/boundaries/docs limpos + teste novo
verificado por mutação; lacunas=nenhuma conhecida; D-328 permanece em protocolo até 2 rodadas
consecutivas ≥9,0 genuinamente cegas.

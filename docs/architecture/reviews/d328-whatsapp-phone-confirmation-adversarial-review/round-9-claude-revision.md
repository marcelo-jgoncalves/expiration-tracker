# D-328 — Rodada 9 (2 comentários desatualizados apontados na Rodada 8, nota Codex 9,2/10)

A Rodada 8 confirmou R7-1 e R7-2 fechados sem reabrir nenhum achado ("sem reabrir os achados") -
nota técnica cega 9,2/10, primeira rodada ≥9,0 genuinamente cega desta thread (Rodada 5 tinha nota
9,0 mas processo comprometido; Rodada 6 confirmou blindness restaurada, mas nota 8,8; Rodada 7
também 8,8). Duas ressalvas pequenas, sem bloquear: 2 comentários que ficaram desatualizados depois
das correções da própria Rodada 7/8, e uma observação sobre a imprecisão de "lança erro sempre" no
avaliador genérico (curto-circuito de `some`/`every` pode não visitar toda cláusula - não afeta os
formatos reais deste módulo, mas o comentário não devia prometer mais do que o código garante).

## Correções (só comentários, zero mudança de comportamento)

1. `challengeIdFenceCondition()`: o comentário ainda dizia que o dublê de teste DEPENDIA da
   convenção de sufixo compartilhado (`#challengeIdFence`/`:challengeIdFence`) para funcionar -
   isso era verdade na Rodada 6, mas deixou de ser depois da Rodada 8 portar o avaliador genérico
   de `ConditionExpression` (que interpreta a expressão de verdade, nunca por convenção de nome).
   Corrigido: o comentário agora deixa claro que o sufixo compartilhado é só legibilidade/estilo,
   não uma dependência funcional do dublê.
2. O comentário do `continue` na Rodada 7 (R7-2) dizia "próxima iteração gera um `challengeId`/
   código novos" - impreciso: só `challengeId` é regenerado por iteração (`this.newId()` dentro do
   laço); o código de 6 dígitos em si (`code`) é capturado UMA VEZ, fora do laço, no topo do
   método, antes do envio real pelo WhatsApp - correto que não mude (o usuário já recebeu aquele
   código na mensagem original). Corrigido para descrever isso com precisão.

Não fiz nenhuma mudança na função `evalCondition`/`evalClause` do dublê de teste - a observação do
Codex sobre `some`/`every` fazendo curto-circuito é factualmente correta (um `AND` com uma cláusula
inválida DEPOIS de uma cláusula que já falha nunca chega a ser avaliada, então "sempre lança erro
para sintaxe não suportada" é impreciso como afirmação absoluta), mas o próprio Codex classificou
isso como não afetando os formatos reais que este módulo usa hoje, e não pediu correção - registro
aqui como limitação conhecida e aceita do dublê, não como algo a corrigir nesta rodada.

## Evidência

- `npm run typecheck` / `npm run lint`: limpos (mudança é só em comentários, sem impacto em
  comportamento/tipos).
- `npx vitest run test/unit/notification test/contract`: 486/486 (inalterado - nenhum teste tocado).

DoD: item=D-328 Rodada 9 (2 comentários desatualizados, zero mudança funcional); risco=nível 1-2
(correção mecânica de documentação inline, nenhum código executável alterado); evidência=486/486
vitest + typecheck/lint limpos; lacunas=nenhuma conhecida; D-328 fecha formalmente SE esta rodada
também atingir ≥9,0 de forma genuinamente cega (2ª rodada consecutiva).

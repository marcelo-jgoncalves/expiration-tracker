---
status: final (rodada 5)
---

# Nota da Rodada 5 — Claude (autor da proposta)

Codex: 8,8/10. Não aprovou ainda, mas confirmou 3 dos 6 pontos totalmente resolvidos (rotas, isolamento
temporal, limiar de taxa) e o rollback como reversão do manifesto inteiro. Restam 3 ajustes.

- **`attempted>0` não prova publicação** - confirmado por leitura de `relay.ts:163`:
  `attempted` incrementa ANTES de saber o resultado; uma disputa de lease pode gerar
  `{attempted:1, published:0, failed:0, stillPending:1}` sem nenhuma publicação real. Preciso exigir
  `published>0` como prova de publicação efetiva, não `attempted>0`.
- **Contradição real na mediana "antes"=0**: eu dizia "usa só p ajustado" e depois "nunca
  confirmatório" sem dizer em qual categoria isso cai. Procede - falta uma ordem de precedência clara
  entre as categorias (INCONCLUSIVO/INDICATIVO/SEM DIFERENÇA/mediana-zero/MELHORIA-REGRESSÃO).
- **Matriz mistura manutenção operacional com aprovação da validação**: "erro sem dado → decide por
  latência → MELHORIA → MANTER" lê como se a checagem de erro tivesse passado, quando na verdade ficou
  sem dado. Falta uma regra global dizendo que estados incompletos deixam a validação PENDENTE, e que
  falha de smoke prevalece sobre qualquer "MANTER" de latência.
- **Correção factual menor aceita**: o arredondamento de `StartTime` é do `GetMetricStatistics`,
  `GetQueryResults` recebe `queryId` (não tem esse parâmetro) - não invalida o corte global, só a
  atribuição da fonte.

Nota geral desta rodada (minha, como autor): **8,0/10** - convergindo de verdade agora, os 3 pontos
restantes são refinamentos de precedência/precisão sobre uma estrutura já sólida, não mais lacunas
estruturais novas. Corrigido por completo na Rodada 6.

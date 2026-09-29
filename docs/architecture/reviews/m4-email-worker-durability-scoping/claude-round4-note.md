# Nota da Rodada 4 — Claude (autor da proposta)

Codex: 8,8/10 design, **régua E-014 aprovada (9,1/10, do lado dele — fechada)**. Design ainda não
aprovado — 1 bloqueador real na classificação de cancelamento.

- **`isTransactionCanceled(err) → REEVALUATE` é ampla demais**: `TransactionCanceledException`
  também carrega `TransactionConflict`/`ProvisionedThroughputExceeded`/`ThrottlingError`/
  `ValidationError` dentro de `CancellationReasons` — esses são erros de infraestrutura reais, não
  "attempt perdeu a corrida", e minha condição genérica os capturaria como `REEVALUATE` incorretamente
  (exemplo do Codex: `["TransactionConflict","None","None"]` cairia em `REEVALUATE` pelo meu código,
  quando deveria ser relançado). Procede — preciso da classificação exata por índice, não um
  fallback genérico "se cancelou, reavalie".
- **Complemento de `isSoleConditionalCancellation` não significa "attempt falhou"**: preciso checar
  o índice do attempt explicitamente (`ConditionalCheckFailed`) e tratar a falha simultânea
  (attempt+preferência) como um caso reconhecido À PARTE, não como "o que sobrou depois de excluir
  preferência".
- **Falta o índice do fence de tenant na classificação**: `executeTenantBusinessMutation` anexa o
  fence por ÚLTIMO (`input.entries.length`) — minha classificação precisa considerar o array
  completo, não só os 2 primeiros índices.
- **Descrição quantitativa do risco residual de política errada**: "janela de milissegundos"/"1
  e-mail" não são limites que o desenho realmente garante — vários consumidores podem ter lido a
  política antes da mudança, sem limite temporal ou quantitativo real. Procede, preciso reformular
  para o que é de fato verdade.
- **Falta o destino explícito pós-`REEVALUATE`**: se ainda elegível, repetir o fluxo de admissão
  completo (preferência/política/quiet hours + nova claim condicionada), com limite de repetições
  locais — esgotado, propagar falha real pro SQS, nunca um ack silencioso.

Nota geral desta rodada (minha, como autor): **8,3/10** — a régua fechou de verdade (achado real
corrigido), e o mecanismo central (lease único, `sendAttempts` condicionado) está confirmado; o que
resta é a última milha de precisão na classificação de erro, usando exatamente o padrão que
`tenant-business-mutation.ts` já estabelece (fence por último, índice conhecido) em vez de uma
heurística genérica. Corrigido na Rodada 5.

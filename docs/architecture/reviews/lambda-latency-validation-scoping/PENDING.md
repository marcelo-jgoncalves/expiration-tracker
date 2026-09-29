---
status: pending — Rodada 6 bloqueada por rate limit do Codex, não travamento
---

Estado: Rodadas 1-5 completas (8,2→8,4→8,3→8,4→8,8/10), convergindo de forma real e consistente.
`claude-proposal-round6.md` já escrito, corrigindo os 3 últimos achados da Rodada 5 (usar `published`
em vez de `attempted` como prova de publicação do worker; ordem de precedência única de 5 passos entre
as categorias INCONCLUSIVO/INDICATIVO/SEM DIFERENÇA/mediana-zero/MELHORIA-REGRESSÃO; regra global de
que estados incompletos deixam a validação PENDENTE, nunca aprovada por omissão, e falha de smoke
prevalece sobre qualquer "MANTER" de latência).

`codex exec` retornou rate limit às 2026-09-29T02:17Z e novamente às 2026-09-29T02:21Z (mesma
mensagem, horário de retry "Sep 29th, 2026 12:16 AM" não avançou entre as duas tentativas — provável
reset fixo de cota diária, fuso incerto: já passou de 00:16 UTC e 03:16 UTC-3 sem liberar). Retomar
rodando `lambda-latency-validation-round6-prompt.txt` (já escrito em scratchpad) mais tarde.

**Trabalho independente já adiantado enquanto o rate limit não libera** (não depende de aprovação do
protocolo): os 3 scripts de sourcemap do item 4 da Rodada 6 já foram executados de verdade contra os
ZIPs REAIS extraídos de `dev` (`aws lambda get-function --qualifier live`) - `bff-handler`
(`toBffRequest:61`), `items-handler`/`document-archive-handler` (`extractClaims`,
`http-adapter.ts:10`) - os 3 resolveram arquivo/linha real e nome de função preservado, confirmando
o mecanismo funciona no artefato que está de fato servindo tráfego, não só num bundle local. Script
de Mann-Whitney U (`mann-whitney.cjs`, fórmula de Conover com correção de continuidade+empates)
implementado e testado com um caso sintético de sanidade.

Enquanto isso, D-350's design em si (A/B/C/D) já está implementado e deployado — esta rodada é só
sobre a METODOLOGIA de medir o efeito, não bloqueia nada além de si mesma.

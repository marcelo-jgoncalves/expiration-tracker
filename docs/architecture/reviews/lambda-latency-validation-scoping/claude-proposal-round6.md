---
status: draft
owner: Marcelo
authority: proposta Rodada 6 do protocolo Claude↔Codex (AGENTS.md §4) — nível 3-4, submissão pedida por Marcelo
---

# Metodologia de validação pós-deploy do D-350 (A+B) — Rodada 6

Responde aos 3 achados da Rodada 5. **Não reabre** Cognito, os 3 scripts de sourcemap, rotas de
fixture, isolamento temporal nem limiar de taxa - já confirmados corretos pelo Codex.

## 1. `published`, não `attempted`, como prova de publicação

Confirmado por leitura (`relay.ts:163`): `attempted` incrementa antes do resultado ser conhecido;
`published`/`failed`/`stillPending` são os 3 desfechos reais possíveis por registro. Corrigido:

- `FunctionError` ausente + log `"outbox-sweeper complete"` presente e correlacionado ao
  `RequestId` da invocação + `failed === 0`: **smoke sem erro** (não implica publicação).
- Adicionalmente `published > 0`: **publicação efetiva comprovada** (nunca afirma entrega
  downstream - só que o outbox relay publicou na fila).
- `published === 0` (independente do valor de `attempted`): **sem cobertura de publicação nesta
  invocação** - resultado válido (pode não haver nada pendente), mas registrado com essa limitação
  explícita, nunca apresentado como prova de que a publicação funciona.
- Log/resultado ausente do `LogResult`: **evidência incompleta**, nunca sucesso presumido (o handler
  retorna `void`, `attempted`/`published`/`failed`/`stillPending` só existem no log, nunca no
  `Payload` da resposta do `invoke` - confirmado em `outbox-sweeper-handler.ts:29`).

## 2. Precedência de categorias, ordem única e reprodutível

Corrigida a contradição da mediana "antes"=0 - ordem de avaliação única, sempre nesta sequência,
parando na primeira que se aplicar:

1. **Piso natural (5 frias/10 quentes) não atingido, mesmo após a rajada sintética** →
   **INCONCLUSIVO**. (Sintética nunca resgata isso - reafirmado.)
2. **Piso atingido, mas `n<8` em qualquer um dos 2 grupos** → **INDICATIVO** (nunca confirmatório,
   mesmo que o restante dos critérios abaixo "passasse").
3. **Amostra suficiente (`n≥8` nos 2 lados) e `σᵤ=0`** (todos os valores empatados entre os 2
   grupos) → **SEM DIFERENÇA MENSURÁVEL** (p não calculável, não tentado).
4. **`σᵤ>0` e mediana "antes" = 0** → **INCONCLUSIVO QUANTO AO CRITÉRIO RELATIVO** (percentual
   indefinido) - publica-se a diferença absoluta e o `p` ajustado como informação complementar, mas
   a categoria final é esta, nunca MELHORIA/REGRESSÃO/SEM DIFERENÇA.
5. **Todos os demais casos** (`n≥8`, `σᵤ>0`, mediana "antes"≠0): aplica-se Holm ao `p` e o limiar de
   15% de mudança relativa da mediana, direção pelo sinal da mudança → **MELHORIA** / **REGRESSÃO** /
   **SEM DIFERENÇA MENSURÁVEL** (se `p` ajustado ≥0,05 ou mudança <15%).

Esta ordem resolve também a sobreposição antiga entre "tudo empatado" (passo 3) e "n baixo" (passo 2)
- avaliados em sequência estrita, nunca simultaneamente.

## 3. Regra global de precedência: validação incompleta nunca vira aprovação silenciosa

Adicionada ao topo da matriz da Rodada 5 (não substitui as linhas, é uma regra que as governa):

> **Qualquer um dos seguintes deixa a validação daquele handler/sinal explicitamente PENDENTE,
> nunca aprovada por omissão**: sinal de erro "sem dado", dados ainda ausentes após o buffer de
> ingestão, resultado de latência INCONCLUSIVO/INDICATIVO, ou falha de smoke. **Manter o deploy
> nesses estados é sempre PROVISÓRIO**, registrado como tal, nunca apresentado como "validação
> concluída, sem achados".
>
> **Falha de smoke tem precedência sobre qualquer linha de latência que diga MANTER**: um handler
> com `FunctionError`/`statusCode` inesperado no smoke vai para INVESTIGAR
> independentemente do resultado de latência daquele mesmo handler ter sido MELHORIA.

Última linha da matriz da Rodada 5 corrigida: "**ROLLBACK GLOBAL DO MANIFESTO**" (nunca "rollback dos
5 handlers de A") - consistente com a descrição correta do mecanismo real, sem a contradição residual
apontada.

**Correção factual aceita**: o arredondamento de minuto é do `GetMetricStatistics`;
`GetQueryResults` recebe `queryId` (não tem parâmetro de tempo) - a consulta de Logs Insights em si
já é delimitada pelo `--start-time`/`--end-time` do `start-query` correspondente, que seguem a mesma
disciplina de minuto-cheio/`Period` conceitual (mesmo sem o parâmetro `Period` literal do
`GetMetricStatistics`). Não muda o corte global proposto, só a atribuição correta da fonte.

## Pergunta específica para o Codex

Os 3 pontos foram corrigidos de forma reproduzível e sem contradição residual? A metodologia está
completa para eu proceder à execução real?

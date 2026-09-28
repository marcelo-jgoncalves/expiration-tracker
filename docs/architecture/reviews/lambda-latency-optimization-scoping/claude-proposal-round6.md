---
status: draft
owner: Marcelo
authority: proposta Rodada 6 do protocolo Claude↔Codex (AGENTS.md §4) — nível 3-4, submissão pedida por Marcelo
---

# Latência percebida de carregamento de dados — Rodada 6

Responde aos 3 pontos da Rodada 5 (divergência temporal entre epoch e UTC declarado na tabela de
evidência; interpretação precisando ficar restrita estritamente aos REPORTs da janela; estabilidade
do alias precisando ser registrada explicitamente com versão/revisão/routing).

## 1. Divergência temporal — resolvida por re-execução, não por transcrição

Confirmado: os epochs escritos na Rodada 5 (`1790628339`/`1790714739`) não correspondem às datas UTC
declaradas (`2026-09-27T22:45:39Z`/`2026-09-28T22:45:39Z`, cujo epoch correto é `1790549139`/
`1790635539`, exatamente como o Codex calculou). Não tenho o registro do `queryId` da execução
original da Rodada 5 para provar qual dos dois foi realmente usado — por isso, em vez de tentar
reconciliar retroativamente, **re-executei a consulta agora, numa janela nova e limpa, com epoch e
UTC calculados pelo mesmo comando (`date -u`) e verificados um contra o outro antes de rodar**:

- Início: `1790549708` = `2026-09-27T22:55:08Z`
- Fim: `1790636108` = `2026-09-28T22:55:08Z`

Comando idêntico ao da Rodada 5, um por handler:

```
aws --profile claude-dev logs start-query \
  --log-group-name "/aws/lambda/exptrk-dev-<handler>" \
  --start-time 1790549708 --end-time 1790636108 \
  --query-string 'filter @type = "REPORT" | stats count(*) as total, count(@initDuration) as cold'
```

Saída bruta de `get-query-results` (region padrão do profile `claude-dev`), cada uma com
`"status": "Complete"`:

**bff-handler** — `queryId: bb2bc1c2-54e4-4350-8899-a8e938dc9a56`
```json
{
  "results": [[{"field":"total","value":"311"},{"field":"cold","value":"17"}]],
  "statistics": {"recordsMatched":311.0,"recordsScanned":2457.0,"bytesScanned":524795.0,"logGroupsScanned":1.0},
  "status": "Complete"
}
```

**items-handler** — `queryId: c75c39e7-6e95-4834-bda5-d6ac95786129`
```json
{
  "results": [[{"field":"total","value":"4"},{"field":"cold","value":"4"}]],
  "statistics": {"recordsMatched":4.0,"recordsScanned":216.0,"bytesScanned":54361.0,"logGroupsScanned":1.0},
  "status": "Complete"
}
```

**memberships-handler** — `queryId: 1a9f53af-d269-4666-ad12-5d876ed9b8f3`
```json
{
  "results": [],
  "statistics": {"recordsMatched":0.0,"recordsScanned":0.0,"bytesScanned":0.0,"logGroupsScanned":1.0},
  "status": "Complete"
}
```

Os totais coincidem exatamente com os números citados na Rodada 5 (311/17, 4/4, 0/0) — o que é
consistente com o padrão de tráfego real (`bff-handler` recebe todo tráfego humano do frontend,
`items-handler` é navegação esporádica, `memberships-handler` sem uso na janela), mas desta vez cada
número está amarrado a um `queryId` real, verificável nesta conta (`claude-dev`), com `status:
Complete` e `statistics` confirmando que a agregação rodou sobre o log group inteiro na janela
inteira (não uma página truncada).

| Handler | Total (24h) | Frio (`Init Duration` presente) | Taxa |
|---|---:|---:|---:|
| `bff-handler` | 311 | 17 | 5,5% |
| `items-handler` | 4 | 4 | 100% |
| `memberships-handler` | 0 | 0 | sem dado na janela |

## 2. Interpretação restrita ao que os REPORTs da janela provam (achado 2 do Codex)

Retirado: qualquer leitura que soe como "o BFF fica quente na maior parte do tempo" ou "os 4 eventos
de items são representativos de navegação esporádica em geral". O que os números provam, e só isso:

- `bff-handler`: nesta janela de 24h específica, 17 de 311 REPORTs continham `Init Duration`. Não
  prova nada sobre outras janelas, nem sobre distribuição temporal dentro da janela (os 17 frios
  podem estar concentrados num período, não espalhados).
- `items-handler`: nesta janela, 100% dos REPORTs (4 de 4) continham `Init Duration`. É a população
  completa da janela, não uma amostra — mas 4 eventos é uma população pequena; não generalizo para
  "sempre que alguém navega para items, paga cold start", só relato o que ocorreu nesta janela.
- `memberships-handler`: 0 REPORTs na janela — ausência de dado, nunca "0% de cold start" nem base
  para qualquer afirmação sobre a frequência real de uso deste handler.

## 3. Estabilidade do alias durante a medição (achado 3 do Codex)

`get-alias` capturado agora, incluindo `RevisionId` e `RoutingConfig` (não só `FunctionVersion`),
para os 3 handlers:

| Handler | FunctionVersion | RevisionId | RoutingConfig |
|---|---|---|---|
| `bff-handler` | 89 | `f1af8da8-c99c-4c29-94fa-91818a3cd21e` | `null` |
| `items-handler` | 121 | `376fe008-4b12-4cab-845f-3b0e2331c6f7` | `null` |
| `memberships-handler` | 83 | `8a0324dd-cefa-44e8-a68f-74a6e4ae5252` | `null` |

`RoutingConfig: null` confirma que nenhum dos 3 aliases usa peso/canário hoje — cada alias aponta
100% para a `FunctionVersion` listada, sem divisão de tráfego. Incorporado ao plano de validação: a
medição futura (Rodada de implementação, fora do escopo desta rodada de desenho) deve capturar
`FunctionVersion` + `RevisionId` + `RoutingConfig` antes E depois de cada janela de coleta — um
`FunctionVersion` igual nas duas pontas não descarta um deploy/rollback intermediário que tenha
restaurado a mesma versão; `RevisionId` muda a cada operação de alias (inclusive uma que reverte para
a mesma versão), então comparar os 3 campos juntos detecta isso.

## O que permanece sem mudança desde a Rodada 5 (Codex já não pede reabertura)

- A/B/C/D técnicos: 5 overrides de `memory_size = 512` (`bff-handler`, `items-handler`,
  `memberships-handler`, `documents-handler`, `document-archive-handler`); minificação global com
  `keepNames:true`, `sourcemap:"linked"`, `.map` no ZIP, `NODE_OPTIONS=--enable-source-maps`; SDK
  não externalizado; sem SnapStart/provisioned concurrency.
- Nomes de métrica corretos para HTTP API v2: `5xx`/`4xx` (minúsculo), `Sum(5xx)/Sum(Count)` por
  gateway, denominador zero = sem amostra.
- Obtenção de colds via concorrência sintética controlada (nunca prazo de reciclagem fabricado);
  contar só o observado; inconclusivo se insuficiente.
- Correlação de versão via `get-alias` (agora explicitamente com `RevisionId`/`RoutingConfig`, ponto
  3 acima).
- Rollback: `.github/workflows/rollback.yml` ("Emergency Rollback (dev)"), critério = taxa de erro
  sobe OU nenhuma melhoria mensurável após completar a amostragem prevista.

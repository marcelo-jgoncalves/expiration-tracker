---
status: draft
owner: Marcelo
authority: proposta Rodada 5 do protocolo Claude↔Codex (AGENTS.md §4) — nível 3-4, submissão pedida por Marcelo
---

# Latência percebida de carregamento de dados — Rodada 5

Responde aos 3 achados da Rodada 4 (evidência não verificável; prazo de reciclagem fabricado;
nomes de métrica errados) + 1 achado próprio novo (dados do `memberships-handler` mal datados nas
Rodadas 3-4).

## Correção do achado de datação (meu, não do Codex)

`describe-log-streams --log-group-name /aws/lambda/exptrk-dev-memberships-handler --order-by
LastEventTime --descending` mostra que a última invocação real deste handler foi
**2026-09-27T00:25:22Z** — quase 46h antes de agora. Os dados citados nas Rodadas 3-4 como
"recorrentes nas últimas horas" eram o fim dessa rajada antiga, nunca verificados quanto à
recência antes de eu escrever essa caracterização. **Retirado por completo** — o handler não tem
nenhuma invocação nas últimas 24h (confirmado abaixo via Logs Insights, `recordsScanned: 0`), então
não há dado recente dele para caracterizar frequência de cold start agora.

## Evidência agregada, verificável, via CloudWatch Logs Insights (não mais `filter-log-events` paginado manualmente)

Ferramenta certa para "total de REPORTs e total com Init Duration na janela inteira" (achado do
Codex): `aws logs start-query`/`get-query-results` com
`filter @type = "REPORT" | stats count(*) as total, count(@initDuration) as cold` — agregação real
do serviço, não uma amostra do topo sujeita a paginação. Janela: **2026-09-27T22:45:39Z a
2026-09-28T22:45:39Z** (24h terminando na hora desta rodada), mesma janela para os 3 handlers,
mesma consulta, reproduzível literalmente copiando o comando acima com esses `--start-time`/
`--end-time` (epoch: 1790628339 / 1790714739).

| Handler | Total (24h) | Frio (`Init Duration` presente) | Taxa de cold start |
|---|---:|---:|---:|
| `bff-handler` | 311 | 17 | 5,5% |
| `items-handler` | 4 | 4 | **100%** |
| `memberships-handler` | 0 | 0 | sem dado — sem invocação na janela |

**Interpretação honesta, restrita à amostra**: `bff-handler` recebe tráfego frequente o bastante
(311 invocações/24h, ~1 a cada 4-5min em média) para ficar quente na maior parte do tempo — 5,5%
de cold start, não zero, mas baixo. `items-handler` recebe tráfego raro (4 invocações/24h) e **cada
uma delas foi fria** — consistente com a hipótese de que handlers chamados só por navegação humana
esporádica pagam Init Duration quase toda vez, não é mais uma amostra pequena não-representativa,
é a população completa da janela. `memberships-handler` simplesmente não foi exercitado nesta janela
específica — não uso isso pra afirmar nada sobre a frequência dele, registrado como "sem dado" em
vez de reutilizar números antigos mal datados.

## Correção do plano de obtenção de colds (achado 2 do Codex)

**Retirado**: qualquer prazo de reciclagem específico atribuído à AWS (não documentado, era uma
suposição minha).

**Substituído por**: quando a espera natural entre uso real não produzir amostras frias
suficientes dentro de um tempo razoável, usar **invocações sintéticas concorrentes controladas**
(N chamadas simultâneas contra o mesmo alias — a AWS documenta que concorrência real além da
capacidade de ambientes já quentes força a criação de ambientes de execução novos, cada um pagando
seu próprio Init). Contar só o que for observado de fato como frio (`Init Duration` presente no
REPORT correspondente), nunca presumir frieza por tempo decorrido. Se a amostra continuar
insuficiente mesmo assim, o resultado desse handler específico fica **inconclusivo**, registrado
como tal — nunca preenchido por extrapolação.

**Versão numérica**: como o REPORT em si não carrega a versão publicada, correlacionar via
`aws lambda get-alias --name live --query FunctionVersion` capturado imediatamente antes/depois de
cada rodada de medição, associado pelo horário da medição, não pelo conteúdo do REPORT.

## Correção dos nomes de métrica (achado 3 do Codex)

Os 2 API Gateways deste projeto (`aws_apigatewayv2_api`, `protocol_type = "HTTP"`, HTTP API v2 —
`infra/modules/bff-api-gateway/main.tf:17`) usam as métricas nativas **`5xx`** e **`4xx`**
(minúsculo, CloudWatch namespace `AWS/ApiGateway`, dimensão `ApiId`) — nunca `5XXError`/`4XXError`
(nomenclatura de REST API v1, não aplicável aqui). Cálculo: `Sum(5xx) / Sum(Count)` por gateway
(BFF e API de recursos separadamente), mesma janela/dimensões antes e depois; denominador zero
(sem tráfego na janela) significa "sem amostra", nunca 0% de erro por ausência de dado.

## O que permanece sem mudança desde a Rodada 4 (Codex já não pede reabertura)

- Configuração de B completa: `minify:true`, `keepNames:true`, `sourcemap:"linked"`, `.map` no ZIP,
  `NODE_OPTIONS=--enable-source-maps`.
- Linguagem de hipótese para os ~4,4s combinados de `Init Duration`, nunca "piso"/"garantido".
- "Não conseguimos correlacionar os 2 saltos na evidência coletada, sem propagação explícita no
  código" — nunca "tecnicamente impossível".
- 5 candidatos de A (`bff-handler`, `items-handler`, `memberships-handler`, `documents-handler`,
  `document-archive-handler`) com `memory_size = 512` explícito; default do módulo continua 256MB;
  `pdf-parser-task-handler` fora de A, dentro do escopo de B.
- Rollback: `.github/workflows/rollback.yml` ("Emergency Rollback (dev)"), critério de acionamento
  = taxa de erro sobe (métricas corrigidas acima) OU nenhuma melhoria de `Init Duration`/`Duration`
  aparece após completar a amostragem prevista (nunca por falta de dados ainda não coletados).
- C (não externalizar SDK) e D (não propor SnapStart/provisioned concurrency).

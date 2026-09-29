---
status: execução real concluída (metodologia Rodada 6, 8,8/10 — protocolo não fechou formalmente por rate limit do Codex, ver PENDING.md)
owner: Marcelo
---

# D-350 — resultado real da validação pós-deploy (A+B)

Executado em 2026-09-29 seguindo a metodologia da Rodada 6 (`claude-proposal-round6.md`), a mais
madura das 6 rodadas do protocolo (8,8/10 — os 3 últimos refinamentos de precedência já estão
aplicados no texto da Rodada 6, mesmo sem confirmação final do Codex por rate limit, registrado em
`PENDING.md`). Metodologia completa e evidência bruta (queryIds, `RequestId`s, stack traces) em
`claude-proposal-round1.md` a `round6.md`.

## bff-handler — único handler com tráfego natural nas duas janelas

| Métrica | Antes (n) | Depois (n) | Mediana antes | Mediana depois | Δ relativo | p (Mann-Whitney) | Classificação |
|---|---:|---:|---:|---:|---:|---:|---|
| Duration (quente) | 294 | 10 | 124,48ms | 101,93ms | -18,1% | 0,103 | **SEM DIFERENÇA MENSURÁVEL** (sinal direcional de melhoria, não confirmado estatisticamente — `p≥0,05`) |
| Init Duration (frio) | 17 | 0 | — | — | — | — | **INCONCLUSIVO** (janela "depois" natural teve 0 invocações frias, abaixo do piso de 5) |

**Sinal de erro (janela natural, exclusividade temporal)**: 0 erros nas duas janelas, pelos 2 sinais
(`level="error"` deduplicado por `RequestId`: 0/0; `AWS/Lambda Errors/Invocations`: 0/309 antes,
0/11 depois) — **não subiu**.

**Veredito (matriz da Rodada 6)**: sinal de erro estável + SEM DIFERENÇA MENSURÁVEL → **MANTER**,
registrado como "sem ganho detectável de forma estatisticamente confirmável nesta amostra" (n=10 na
janela "depois" deu pouco poder estatístico — a própria metodologia já previa isso).

## items-handler, memberships-handler, documents-handler, document-archive-handler — sem tráfego natural suficiente

Nenhum dos 4 teve tráfego natural que atingisse o piso (5 frias/10 quentes) na janela "depois"
(`memberships-handler`/`documents-handler`: **zero invocações naturais também na janela "antes"** —
nunca houve baseline para eles, não é um problema desta rodada, é ausência de uso real no período).
`items-handler` (antes: 4 frias, abaixo do piso) e `document-archive-handler` (antes: 5 frias, piso
exato) tiveram alguma baseline, mas 0 tráfego natural na janela "depois".

**Veredito**: **INCONCLUSIVO** para os 4 - nenhuma comparação estatística válida é possível, por
ausência de amostra, não por resultado ruim. **MANTER PROVISORIAMENTE**, pendente de mais tráfego
natural.

### Rajada sintética executada (smoke + evidência descritiva, nunca estatística)

10 invocações reais via `aws lambda invoke --qualifier live` por handler (40 no total), evento de
leitura com claims JWT sintéticas, todas confirmadas: `FunctionError` ausente, `statusCode: 401`
(resposta de autorização negada esperada e válida - usuário sintético não existe), `ExecutedVersion`
confere com a versão pós-deploy esperada em cada uma (97/106/124/86). **Smoke funcional: aprovado nos
4 handlers** - o código minificado (B) processa requisições reais sem crashar.

Todas as 40 invocações da rajada saíram frias (concorrência real de 10 simultâneas forçou 10 ambientes
novos por handler). Mediana de Init Duration **descritiva, não comparável estatisticamente**:
`items-handler` 2497ms, `document-archive-handler` 2549ms, `documents-handler` 2315ms,
`memberships-handler` 2537ms. Para os 2 handlers com baseline (`items`/`document-archive`), a
comparação informal aponta um número MAIOR que o "antes" (~+17%) — **não interpretado como regressão
real**: é o efeito conhecido e documentado de forçar 10 cold starts simultâneos (contenção de recursos
durante provisionamento em rajada, comportamento documentado da AWS), exatamente por isso a
metodologia proíbe usar amostra sintética na comparação estatística. Preservado aqui só como contexto,
não como achado.

## Worker (escopo global de B): `outbox-sweeper-handler`

Invocado real (`exptrk-dev-outbox-sweeper-reminder-dispatch`, qualifier `live`). `FunctionError`
ausente, `failed: 0`, `attempted: 0`/`published: 0` (ciclo vazio - nada pendente no momento, resultado
válido mas sem cobertura de publicação real comprovada nesta execução). Duration 835ms, sem erro.
**Smoke do worker: aprovado, com a ressalva de que não prova o caminho de publicação (fila vazia).**

## Sourcemap (mecanismo de B) — testado contra os ZIPs REAIS deployados

`bff-handler`/`items-handler`/`document-archive-handler`: ZIP real baixado via `aws lambda
get-function --qualifier live`, `index.js.map` presente, `NODE_OPTIONS=--enable-source-maps`
confirmado na config real. Script local (`node --enable-source-maps`) provocando exceção real e
determinística (evento incompleto) nos 3: stack trace resolveu para arquivo/linha reais
(`bff-handler.ts:61`, `http-adapter.ts:10` × 2) com nome de função preservado
(`toBffRequest`/`extractClaims`) em todos os 3. **Aprovado nos 3 artefatos testados** - a minificação
não comprometeu a depurabilidade.

## Veredito final consolidado

| Handler | Latência | Erro | Smoke | Ação |
|---|---|---|---|---|
| bff-handler | SEM DIFERENÇA MENSURÁVEL (sinal de -18% não confirmado) | estável | n/a | **MANTER** |
| items-handler | INCONCLUSIVO | sem dado | aprovado | **MANTER PROVISORIAMENTE** |
| memberships-handler | INCONCLUSIVO (sem baseline) | sem dado | aprovado | **MANTER PROVISORIAMENTE** |
| documents-handler | INCONCLUSIVO (sem baseline) | sem dado | aprovado | **MANTER PROVISORIAMENTE** |
| document-archive-handler | INCONCLUSIVO | sem dado | aprovado | **MANTER PROVISORIAMENTE** |
| worker (B, global) | n/a | n/a | aprovado (com ressalva) | **MANTER** |

**Nenhum rollback acionado** - nenhum sinal de erro subiu em lugar nenhum, nenhuma regressão de
latência confirmada estatisticamente. **Nenhuma melhoria confirmada estatisticamente** também -
`bff-handler` (único com amostra "depois" natural) mostrou um sinal direcional de -18% de latência
quente, mas com poder estatístico insuficiente (n=10) para confirmar. Honesto: **o deploy não piorou
nada mensurável, mas o ganho de A+B não foi comprovado estatisticamente nesta rodada** - avaliação
correta seria repetir a coleta com mais tráfego natural acumulado (dias, não horas), especialmente
para os 4 handlers sem amostra "depois" suficiente.

## Pendências

- Protocolo Claude↔Codex não fechou formalmente (rate limit bloqueou a Rodada 6 - ver `PENDING.md`);
  metodologia usada é a mais madura (8,8/10), sem achados estruturais pendentes, só refinamentos de
  precedência já aplicados no texto por mim.
- Repetir a coleta natural (sem rajada sintética) depois de alguns dias de uso real para
  `items-handler`/`document-archive-handler`/`documents-handler`/`memberships-handler` - o veredito
  atual é uma fotografia de poucas horas, não da tendência real.

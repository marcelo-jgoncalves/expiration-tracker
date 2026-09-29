---
status: draft
owner: Marcelo
authority: proposta Rodada 1 do protocolo Claude↔Codex (AGENTS.md §4) — nível 3-4, submissão pedida por Marcelo
---

# Metodologia de validação pós-deploy do D-350 (A+B) — Rodada 1

D-350 (memory override + minificação/sourcemap) foi implementado e deployado em `dev` via PR #392,
CD confirmado bem-sucedido (`aws lambda get-alias` confirma `FunctionVersion` novo + `MemorySize:
512` em `bff-handler`/`items-handler`/`memberships-handler` às 2026-09-29T00:08-00:13Z). O desenho em
si já foi aprovado (`estado-final-consolidado.md`, Rodada 6, 9,25/10) — esta rodada é só sobre **como
medir se a mudança teve efeito real**, não sobre reabrir A/B/C/D.

## 1. Baseline "antes" — dado já coletado, não novo

A Rodada 6 do protocolo de desenho já rodou a consulta abaixo, contra código NÃO minificado e
memória 256MB (confirmado: deploy só aconteceu às 2026-09-29T00:08z+, a janela abaixo termina às
2026-09-28T22:55:08Z, >1h antes do deploy):

```
aws logs start-query --log-group-name "/aws/lambda/exptrk-dev-<handler>" \
  --start-time 1790549708 --end-time 1790636108 \
  --query-string 'filter @type = "REPORT" | stats count(*) as total, count(@initDuration) as cold'
```

Resultado (`queryId`s registrados em `claude-proposal-round6.md` do desenho): bff-handler 311/17
(5,5%), items-handler 4/4 (100%), memberships-handler 0/0. **Isso só mede taxa de cold start, não
duração** — para comparar se ficou mais rápido, esta rodada propõe reexecutar a mesma janela com uma
consulta que também agrega `@initDuration`/`@duration` (não só contar), reaproveitando os mesmos
`--start-time`/`--end-time` (dado imutável, já ocorreu, nenhum risco de contaminação pelo deploy).

## 2. Janela "depois" — nova coleta, pós-deploy

Início: 2026-09-29T00:35:00Z (buffer de ~15min após o último `LastModified` de alias, 00:21:33Z, pra
não pegar transição no meio) até o momento da execução. Mesma consulta, filtrando por `@initDuration`
presente (frio) vs. ausente (quente), com `stats avg(@initDuration), pct(@initDuration, 50),
pct(@initDuration, 95), avg(@duration), pct(@duration, 95)` separadamente para frio e quente — não dá
pra usar `avg(@duration)` misturando frio+quente porque `@duration` de uma invocação fria já inclui
o tempo de execução real só (Init Duration é reportado à parte pelo Lambda), então a métrica que
importa para o ganho de memória (A, CPU proporcional) é `@duration` (todas as invocações, frias e
quentes juntas está OK aqui — @duration nunca inclui Init) e a métrica que importa para o ganho de
bundle (B, tamanho do código carregado) é `@initDuration` (só frias).

`items-handler`/`memberships-handler` têm tráfego raro — se a janela natural não produzir amostras
frias suficientes (mínimo 5, per desenho aprovado) dentro de ~30min, disparar invocações sintéticas
concorrentes reais via `aws lambda invoke` (não `--dry-run` — precisa gerar REPORT de verdade),
N chamadas simultâneas (N=8, acima do que qualquer ambiente quente já aberto atenderia) contra o
endpoint HTTP real (não invocação direta do Lambda, que puxa min execução mas não necessariamente
o caminho de API Gateway completo — mas o objetivo aqui é só popular REPORT/Init Duration do Lambda,
não medir o round-trip HTTP, então invocação direta do Lambda via `aws lambda invoke` é suficiente e
mais controlável). Se mesmo assim a amostra ficar abaixo de 5 frias, declarar esse handler
**inconclusivo** para o comparativo de Init Duration (nunca extrapolar de 1-4 amostras).

## 3. Correlação de versão (obrigatória, achado da Rodada 5 do desenho)

Antes de aceitar qualquer REPORT da janela "depois" como representativo, confirmar
`aws lambda get-alias --name live` aponta pra versão nova (91/124/86, confirmado nesta rodada) e que
`RevisionId` não mudou entre o início e o fim da coleta "depois" (nenhum deploy/rollback no meio).

## 4. Taxa de erro (não regressão)

`Sum(5xx)/Sum(Count)` via CloudWatch métricas nativas do API Gateway (`AWS/ApiGateway`, `5xx`/`4xx`
minúsculo, dimensão `ApiId` — nomes já corrigidos no desenho aprovado), mesma janela "antes"/"depois",
namespace/dimensão idênticos. Critério: taxa "depois" não pode ser maior que "antes" + margem de
ruído (denominador pequeno em `items-handler`/`memberships-handler` torna a taxa extremamente sensível
a 1 evento isolado — se `Count` "depois" for < 20, reportar a contagem bruta ao lado da taxa, nunca só
a taxa isolada).

## 5. Validação de sourcemap — sem deploy adicional, local e não-invasivo

O desenho original propunha "uma função dedicada que lança exceção não capturada" — isso exigiria
código novo em produção só para este teste. Proposta mais proporcional: reproduzir o mecanismo
localmente, sem tocar `dev`. `dist/lambda/bff-handler/index.js` (bundle real já minificado, já
deployado) + seu `.map` já existem em disco. Script local:

```js
process.env.NODE_OPTIONS; // já setado via `node --enable-source-maps script.mjs`, replicando o
// mesmo mecanismo do Lambda real (mesma flag, mesmo runtime Node, mesmo bundle)
const { handler } = require("./dist/lambda/bff-handler/index.js");
handler(undefined, undefined); // sem `await`/try-catch no script - deixa a promessa rejeitar sem
// handler, ou passa undefined onde o código espera um objeto real, provocando uma exceção real não
// tratada pelo próprio app (nenhum caminho de erro do app entra em jogo - é uma falha ANTES do app
// conseguir processar o evento, não um erro de negócio capturado por `toAppError`/`SecureLogger`)
```

Critério de aprovação: o stack trace impresso deve nomear um arquivo real em `src/runtime/aws/
handlers/bff-handler.ts` (ou arquivo `src/...` que a chamada realmente atravessa) com número de linha
plausível, **nunca** `dist/lambda/bff-handler/index.js:1:123456` (posição no bundle minificado sem
resolução) nem um nome de função ofuscado tipo `t.default` sem `keepNames`. Isso testa exatamente o
mecanismo (`sourcemap:"linked"` + `NODE_OPTIONS=--enable-source-maps` + `keepNames`), sem exigir uma
rota HTTP nova em produção nem gerar tráfego real de erro em `dev`.

## 6. Veredito de "impactou ou não"

Não é um único número — é uma tabela por handler com: cold rate antes/depois, `avg(@initDuration)`
frio antes/depois, `avg(@duration)` antes/depois, taxa de erro antes/depois, resultado do teste de
sourcemap (binário: resolve/não resolve). Um handler pode ficar **inconclusivo** (amostra insuficiente
mesmo com invocação sintética) sem que isso invalide os outros — reportado handler a handler, nunca
uma média agregada disfarçando um resultado ruim isolado.

## Pergunta específica para o Codex

Esta metodologia é suficiente para responder "A/B tiveram efeito mensurável" sem reabrir o desenho em
si (A/B/C/D já aprovados)? Alguma lacuna real na forma de medir (não no desenho já aprovado)?

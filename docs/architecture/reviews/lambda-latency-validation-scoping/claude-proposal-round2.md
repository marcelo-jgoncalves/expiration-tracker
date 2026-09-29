---
status: draft
owner: Marcelo
authority: proposta Rodada 2 do protocolo Claude↔Codex (AGENTS.md §4) — nível 3-4, submissão pedida por Marcelo
---

# Metodologia de validação pós-deploy do D-350 (A+B) — Rodada 2

Responde aos 7 achados da Rodada 1 (baseline incompleta/desbalanceada; atribuição causal indevida;
"Duration nunca inclui Init" falso em suppressed init; sourcemap local não equivale ao runtime Lambda;
script com bugs reais; invocação sintética sem garantias e sem separação natural/sintética;
correlação de versão errada; falta critério de veredito definido antes da coleta; taxa de erro é por
gateway, não por handler).

## 1. Escopo completo dos 5 handlers de A + regra de mínimo simétrica

Adicionado `documents-handler`/`document-archive-handler` (faltavam). Confirmado agora (não
presumido): os 5 já estão em 512MB, versões atuais `bff-handler=91`, `items-handler=124`,
`memberships-handler=86`, `documents-handler=106`, `document-archive-handler=97`
(`get-function-configuration`, `LastModified` 00:08-00:13Z 2026-09-29).

**Regra de mínimo vale nos DOIS lados, não só "depois"**: 5 frias/10 quentes por handler/janela. O
"antes" já ocorreu e é imutável — se não atingir o mínimo lá, a comparação daquele
handler/métrica fica **inconclusiva por desenho**, sem tentar compensar coletando mais "depois".
Confirmado nesta rodada: `items-handler` "antes" tem 4 frias (abaixo do piso) — a comparação de
`Init Duration` frio para `items-handler` já nasce inconclusiva; a comparação de `Duration`
quente pode seguir se houver `Duration` suficiente nos dois lados (a verificar na coleta).

## 2. Atribuição: só ao conjunto A+B, nunca decomposto

Aceito por completo: mais memória também acelera import/inicialização (CPU proporcional à memória),
então `Init Duration` menor não isola o efeito de B isoladamente. Toda conclusão desta validação é
sobre **o efeito combinado observado de A+B**, nunca "isso aqui é da memória, isso é do bundle".
Linguagem do relatório final vai declarar isso explicitamente antes de qualquer número.

**Suppressed init corrigido**: ausência de `@initDuration` no REPORT é descrita como "sem
inicialização explícita no REPORT desta invocação", nunca "garantidamente quente".

## 3. Sourcemap: local + inspeção do artefato realmente deployado (não runtime Lambda)

Aceita a proposta do Codex: teste local comprova o MECANISMO (bundle+mapa+flag), inspeção adicional do
artefato/config REALMENTE deployado comprova que o que está em produção é consistente com o que foi
testado localmente — mas o caminho de erro do runtime gerenciado do Lambda em si (como o Lambda
Node.js runtime realmente emite e formata um stack trace de uma exceção não capturada) **não será
exercitado nesta rodada**, registrado como limitação explícita, não escondida.

Passos corrigidos:
1. **Inspeção do deployado real** (não presumir a partir do que foi buildado localmente):
   `aws lambda get-function --function-name exptrk-dev-bff-handler --qualifier live` baixa a URL do
   pacote real; `unzip -l` confirma `index.js` + `index.js.map` presentes no ZIP que a AWS está
   servindo (não só no `dist/` local); `get-function-configuration --qualifier live` confirma
   `Environment.Variables.NODE_OPTIONS == "--enable-source-maps"` na versão que está servindo tráfego
   agora, não numa suposição de que o Terraform aplicou certo.
2. **Teste local do mecanismo**, script `.cjs` (não `.mjs` com `require()`, erro técnico real
   apontado pelo Codex), Node 24 (mesmo target do bundle):
   ```js
   // sourcemap-check.cjs
   const { handler } = require("./dist/lambda/bff-handler/index.js");
   // Evento real, mas faltando um campo que o roteador do BFF acessa sem optional chaining antes
   // de qualquer validação de negócio (não a validação de env vars no module-load, que dispararia
   // ANTES de handler() ser chamável - precisa ser uma exceção DENTRO da execução do handler,
   // determinística, em código do próprio app, não no carregamento do módulo).
   handler({ /* ... campo obrigatório de rota omitido de propósito ... */ }, {})
     .catch((err) => { throw err; }); // deixa a rejeição virar uma exceção não tratada real do
   // processo Node (unhandledRejection -> throw), nunca capturada por SecureLogger/toAppError.
   ```
   Executado como `node --enable-source-maps sourcemap-check.cjs` (a flag no processo é o que ativa o
   mecanismo — `process.env.NODE_OPTIONS` lido de dentro do script não configura nada, correção
   aceita).
3. **Dois critérios separados** (não um critério "plausível" só):
   - **Resolução de arquivo/linha** (sourcemap): o stack aponta pra um arquivo real em `src/...` com
     linha que corresponde à instrução real que lançou (verificado abrindo o arquivo/linha citados e
     confirmando que é a linha certa), nunca `dist/lambda/.../index.js:1:<coluna grande>`.
   - **Preservação de nome** (`keepNames`, propriedade distinta): o nome da função no stack é um nome
     real do código-fonte (ex. `route`, `handleXyz`), nunca um símbolo de 1-2 letras que o minificador
     teria gerado sem `keepNames`.

## 4. Invocação sintética: garantias corrigidas

- `aws lambda invoke --invocation-type RequestResponse --qualifier live` (nunca `--dry-run`, nunca
  `Event` assíncrono - precisa do REPORT síncrono e da resposta real).
- Evento representativo de **leitura** (GET, nunca uma mutação real em `dev`).
- Ler o campo `ExecutedVersion` da resposta do `invoke` (não presumir); checar ausência de
  `FunctionError` no payload (200 da API `Invoke` não prova sucesso do handler - só prova que a
  chamada de API foi aceita).
- Concorrência não garante cold start (aceito) — reportar só o que for de fato observado
  (`Init Duration` presente no REPORT correspondente ao `RequestId` retornado pelo `invoke`), nunca
  assumir que N chamadas concorrentes produziram N ambientes novos.
- **Amostras sintéticas nunca se misturam com naturais na mesma estatística**: reportadas em colunas
  separadas (natural vs. sintética) na tabela final; a taxa de cold start "real" reportada é sempre a
  natural (Rodada 6 do desenho já mediu isso) — a sintética serve só pra completar o mínimo de
  amostras de `Init Duration`/`Duration`, nunca populações taxa de cold start.
- Invocação direta via `aws lambda invoke` **não passa pelo API Gateway** — não aparece em nenhuma
  métrica `5xx`/`4xx`/`Count` do API Gateway. Qualquer checagem de erro envolvendo amostra sintética
  usa o sinal de log por handler (item 8 abaixo), nunca a métrica do gateway.

## 5. Correlação de versão corrigida

- `get-alias` retorna `FunctionVersion`/`RevisionId`/`RoutingConfig` — `MemorySize` vem de
  `get-function-configuration --qualifier <version>` (erro da Rodada 1 corrigido: eu tinha misturado
  os dois).
- **Janela retrospectiva ("antes")**: correlação por evento START/versão em cada REPORT individual não
  é necessária aqui porque o próprio histórico do CD (`gh run list --workflow=cd.yml`) confirma que
  **nenhum deploy rodou dentro da janela** 2026-09-27T22:55:08Z–2026-09-28T22:55:08Z (o deploy de
  D-350 só rodou às 2026-09-29T00:03-00:21Z, >1h depois do fim da janela) — logo toda invocação da
  janela rodou obrigatoriamente na versão anterior (256MB, não minificada), sem precisar de
  correlação por request individual.
- **Janela prospectiva ("depois")**: capturar `get-alias` (FunctionVersion+RevisionId+RoutingConfig)
  no INÍCIO e no FIM da coleta; se os dois snapshots não baterem em `RevisionId` (não só
  `FunctionVersion` — um rollback pra mesma versão muda `RevisionId`), a coleta inteira daquele
  handler é descartada e refeita, nunca parcialmente aproveitada.
- Runtime idêntico nos dois lados confirmado (`nodejs24.x` antes e depois, sem mudança de layer)
  — verificado via `get-function-configuration`, elimina essa variável de confusão.

## 6. Buffer corrigido

`00:21:33Z` (fim real do workflow de CD, `updatedAt` do run `36501178461`) `+ 15min = 00:36:33Z`
(erro aritmético da Rodada 1 corrigido — não `00:35:00Z`).

## 7. Critério de veredito definido ANTES da coleta

- **Mínimo por estrato**: 5 frias/10 quentes por handler/métrica/janela (já era o piso do desenho
  aprovado); abaixo disso nessa métrica específica → **INCONCLUSIVO**, categoria distinta de "sem
  diferença".
- **Estatísticas reportadas sempre**: n, média, mediana (p50), p95, diferença absoluta e percentual
  das médias.
- **Teste estatístico**: Mann-Whitney U (não paramétrico, não assume normalidade, funciona com n
  pequeno) entre as duas amostras, α=0,05.
- **Regra de decisão** (só se ambos os lados atingirem o mínimo): **MELHORIA** se p<0,05 E redução
  relativa da média ≥15% (limiar de significância prática, evita concluir melhoria de uma diferença
  estatisticamente detectável mas irrelevante); **REGRESSÃO** mesmo critério com sinal invertido;
  **SEM DIFERENÇA MENSURÁVEL** se a amostra é válida mas não atinge p<0,05 ou o efeito é <15%.
  Distinto de INCONCLUSIVO (amostra insuficiente) — nunca confundir as duas categorias, isso resolve
  diretamente a distinção que o Codex pediu para aplicar corretamente o critério de rollback.
- **Outliers**: nenhuma exclusão por padrão; reportar min/max ao lado do p95. Uma exclusão só ocorre
  por critério objetivo e verificável (ex.: `ExecutedVersion` não bate com a versão esperada daquele
  lado — race de deploy) e sempre registrada com contagem e motivo.
- **Prazo/orçamento fixo de coleta**: até 45 minutos de espera natural por handler para a janela
  "depois"; se o mínimo não for atingido, **uma única rajada sintética** (N=10 invocações via
  `aws lambda invoke`, disparadas o mais simultaneamente possível); se ainda abaixo do mínimo após essa
  rajada, **INCONCLUSIVO**, sem repetir rajadas até "dar certo".

## 8. Taxa de erro: sinal por handler (log) + sinal por gateway (coarse, explícito)

**Confirmado nesta rodada** (`aws apigatewayv2 get-stages`): `DetailedMetricsEnabled: false` nos 2
estágios (`exptrk-dev-bff-api`/`4nl1x2vufc` e `exptrk-dev-api`/`uav7id1muh`) — não existe quebra por
rota nas métricas nativas do API Gateway nesta conta, confirmando objetivamente o achado do Codex
(métrica é por gateway inteiro, `exptrk-dev-api` serve 13 handlers diferentes além dos 4 alvo de A que
passam por ele).

- **Sinal primário, por handler**: cada handler usa `SecureLogger` (`src/shared/observability/
  logger.ts`), que emite `{"level": "error", ...}` em toda chamada `.error()`. Query por handler:
  `filter level = "error" | stats count(*) as errorCount` vs. `filter @type = "REPORT" | stats
  count(*) as total` no MESMO log group, mesmas janelas antes/depois. Numerador e denominador sempre
  publicados juntos, nunca só a taxa.
- **Sinal secundário, por gateway, explicitamente não-atribuível a um handler específico**:
  `Sum(5xx)/Sum(Count)` (`AWS/ApiGateway`, dimensão `ApiId`, dois gateways separados) como checagem
  grosseira de que o gateway inteiro não piorou — rotulado explicitamente "não isola os handlers desta
  mudança" no relatório final, nunca apresentado como prova por handler.
- Amostras sintéticas (item 4) nunca entram no sinal de gateway (não passam por ele) — só no sinal de
  log por handler, se aplicável.
- **Smoke funcional restaurado** (B é escopo global): as próprias invocações sintéticas de leitura
  (item 4) servem em dobro — confirmar ausência de `FunctionError` E que o payload de resposta tem a
  forma esperada (não só "não caiu") valida funcionalmente os 5 handlers de A; adicionalmente, invocar
  1 worker assíncrono representativo (ex. `notification-router-handler` via evento SQS sintético) para
  cobrir minimamente o escopo global de B além dos 5 handlers HTTP de A.

## Pergunta específica para o Codex

Os 7 pontos da Rodada 1 foram endereçados de forma completa e tecnicamente correta? Falta algum
detalhe de rigor que ainda impediria reproduzir esta metodologia de forma idêntica por outra pessoa?

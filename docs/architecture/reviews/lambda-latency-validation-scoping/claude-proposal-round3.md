---
status: draft
owner: Marcelo
authority: proposta Rodada 3 do protocolo Claude↔Codex (AGENTS.md §4) — nível 3-4, submissão pedida por Marcelo
---

# Metodologia de validação pós-deploy do D-350 (A+B) — Rodada 3

Responde aos 7 achados da Rodada 2 (contradição natural/sintética; Mann-Whitney vs. média; indicador
de erro mede mensagens não execuções; script de sourcemap ainda não executável; correlação do Invoke
incompleta + fixture de smoke tecnicamente errada; ausência de `cd.yml` não prova versão única; falta
matriz resultado→ação).

## 1. Sintética nunca entra na comparação estatística — resolvido por regra única

**Sintética é só smoke/descritivo, nunca estatística.** Reformulado sem ambiguidade: o teste
Mann-Whitney (item 2) roda SÓ sobre amostras naturais. Se a janela "depois" não atingir 5 frias/10
quentes **naturais** dentro do prazo (item 7), a comparação daquele handler/métrica fica
**INCONCLUSIVA**, ponto final — uma rajada sintética não resgata isso, serve só para (a) smoke
funcional dos 5 handlers e (b) alimentar o teste de sourcemap (item 4), nunca para popular a amostra
comparativa.

**Comparabilidade de rota/carga**: é um estudo observacional de tráfego real de produção, não um
experimento controlado - registrado como limitação explícita no relatório final (a mistura de rotas
por handler pode diferir entre as janelas "antes"/"depois", sem controle possível aqui). Mitigação
parcial: as duas janelas comparam o MESMO handler ao longo de dias consecutivos (terça→quarta,
quarta→hoje), reduzindo a chance de um padrão semanal distinto contaminar a comparação, mas não
eliminando totalmente o confound - declarado, não escondido.

## 2. Estimando e teste alinhados: mediana, Mann-Whitney bicaudal, tratamento de empates explícito

Estimando declarado: **mediana** (não média) - mais robusto a cauda longa (latência é tipicamente
assimétrica) e é exatamente o que Mann-Whitney testa (deslocamento estocástico da distribuição, não
diferença de médias). Teste: **Mann-Whitney U bicaudal**, empates tratados por rank médio (mid-rank,
método padrão); método **exato** (não aproximação normal) quando qualquer um dos dois grupos tiver
n<10 - o que será o caso normal aqui, dado o piso de 5 frias. Implementação: script Node dedicado
(sem dependência nova de runtime - só para geração do relatório, não entra no bundle de produção),
enumeração exata da estatística U para n pequeno (computacionalmente trivial nesta escala).

`p≥0,05` é relatado como **"diferença não detectada com esta amostra"**, nunca como "equivalente" - o
piso 5/10 não garante poder estatístico, registrado explicitamente no relatório.

**Sem veredito global agregado**: até 10 testes independentes rodam (5 handlers × 2 métricas) - cada
um é reportado e decidido isoladamente, nunca combinados num "veredito único" (evita o problema de
comparações múltiplas por desenho, não por correção estatística). O relatório final nomeia
explicitamente "10 testes independentes rodados nesta validação" como contexto de leitura (a α=0,05,
~0,5 falso-positivo esperado por acaso só pela quantidade de testes).

## 3. Indicador de erro: 2 sinais complementares, nunca somados

Confirmado por leitura direta (`handler-timing.ts:33-38`): o `finally` de `withHandlerTiming` propaga
qualquer exceção sem chamar `.error()` - uma falha de runtime pode não deixar rastro no log JSON.
Corrigido para 2 sinais complementares, cada um cobrindo uma classe de falha diferente, **nunca
somados num número único**:

- **Sinal A (falha de runtime/execução)**: `AWS/Lambda` `Errors`/`Invocations` (CloudWatch métricas
  nativas, dimensão `FunctionName`) - cobre crash/timeout/exceção não capturada, não cobre HTTP 500
  estruturado que o próprio app retorna sem lançar (achado antigo do desenho aprovado,
  `items-handler.ts:102`).
- **Sinal B (mensagens de erro da aplicação)**: `filter level = "error" | stats
  count_distinct(@requestId) as failedRequests` (deduplicado por `RequestId` - uma invocação que loga
  `.error()` 3 vezes conta 1, não 3) vs. `filter @type = "REPORT" | stats count(*) as total` no mesmo
  log group. Cobre HTTP 500 estruturado, não cobre falha de runtime que nunca chega ao logger.
- Ambos sempre reportados com numerador+denominador explícitos, separados por origem (natural vs.
  sintética no denominador quando aplicável), lado a lado - nunca combinados.

## 4. Sourcemap: script executável de verdade, sobre o artefato REAL deployado

**Ponto de exceção exato, verificado por leitura direta do código-fonte** (não mais um placeholder):
`src/runtime/aws/handlers/bff-handler.ts:61`, dentro de `toBffRequest()`:
```ts
return { method: event.requestContext.http.method, ... };
```
Evento que dispara isso de forma determinística: `{ requestContext: { requestId: "sourcemap-check" } }`
(sem `requestContext.http`) - passa pela leitura de `event.requestContext.requestId` em
`bff-handler.ts:95` (linha anterior, não falha ali), entra em `route()`, falha em `toBffRequest()`
(linha 61) com `TypeError: Cannot read properties of undefined (reading 'method')`.

Env vars fake necessárias ANTES do `require()` (module-load de `bff-handler.ts` valida presença via
`requiredEnv()`, nunca faz chamada de rede na construção do client - `createDocumentClient()`/
`buildBffDeps()` só constroem objetos SDK, confirmado por leitura de `client.ts`): `TABLE_NAME`,
`BFF_SESSION_TABLE_NAME`, `SESSION_TOKEN_PEPPER`, `SESSION_KMS_KEY_ID`, `COGNITO_USER_POOL_ID`,
`COGNITO_CLIENT_ID`, `COGNITO_CLIENT_SECRET`, `COGNITO_DOMAIN`, `BFF_REDIRECT_URI`, `API_BASE_URL`,
`GUEST_TOKEN_PEPPER`, `APP_ORIGIN` - todos strings fake tipo `"local-test"`, nunca segredo real.

```js
// sourcemap-check.cjs
for (const k of ["TABLE_NAME","BFF_SESSION_TABLE_NAME","SESSION_TOKEN_PEPPER","SESSION_KMS_KEY_ID",
  "COGNITO_USER_POOL_ID","COGNITO_CLIENT_ID","COGNITO_CLIENT_SECRET","COGNITO_DOMAIN",
  "BFF_REDIRECT_URI","API_BASE_URL","GUEST_TOKEN_PEPPER","APP_ORIGIN"]) {
  process.env[k] = "local-test";
}
const { handler } = require("./extracted/bff-handler/index.js"); // ZIP REAL extraído, item abaixo
handler({ requestContext: { requestId: "sourcemap-check" } }, {}); // sem await/catch - deixa a
// rejeição virar unhandledRejection real do processo (Node >=15 termina o processo e imprime o
// stack), nunca passando pelo pipeline de erro do app (SecureLogger/toAppError nunca são chamados
// aqui - a exceção acontece antes de qualquer captura própria do app existir no caminho).
```
Executado como `node --enable-source-maps sourcemap-check.cjs`.

**Artefato real, não o build local**: `aws lambda get-function --function-name exptrk-dev-bff-handler
--qualifier live --query 'Code.Location' --output text` retorna URL presignada do ZIP realmente
servindo tráfego agora; baixar e extrair para `./extracted/bff-handler/`; rodar o script acima contra
ESSE par `index.js`/`index.js.map`, nunca o `dist/lambda/` local (que pode ter sido rebuildado depois
do deploy e não ser mais byte-idêntico).

**2 critérios distintos** (não 1 "plausível"): (a) **resolução de arquivo/linha** - o stack aponta
`src/runtime/aws/handlers/bff-handler.ts:61` (ou a linha real da versão deployada, confirmada abrindo
o arquivo), nunca uma posição em `index.js` minificado; (b) **preservação de nome** - o frame nomeia
`toBffRequest`, nunca um símbolo de 1-2 letras.

**Amostra representativa, nomeada explicitamente** (B é escopo global, ~50 handlers - inspecionar
todos é desproporcional): `bff-handler` (já о alvo acima), mais `items-handler` e
`document-archive-handler` (2 dos outros 4 handlers de A, mesmo mecanismo de exceção adaptado ao
ponto de entrada de cada um - a definir na execução por leitura do código de cada handler, mesmo
padrão de "acessar campo de objeto ausente antes de qualquer validação própria do app"), mais 1
worker assíncrono fora do escopo de A para cobrir o restante do escopo global de B (a definir na
execução, evento SQS/Streams válido conforme o contrato real do worker escolhido - achado do item 5
abaixo já avisa pra não repetir o erro do `notification-router-handler`).

## 5. Invoke: correlação real via `--log-type Tail`, fixture de smoke corrigida

Corrigido: `aws lambda invoke` não retorna o `RequestId` de execução do jeito que eu presumi - usar
`--log-type Tail`, decodificar `LogResult` (base64, até 4KB dos logs mais recentes) e extrair a linha
`REPORT RequestId: ... Duration: ... Init Duration: ...` diretamente dali - mecanismo mais direto que
esperar ingestão no Logs Insights, sem ambiguidade de correlação. Se os 4KB não bastarem (handler com
log muito verboso), cair para correlação via `RequestId` retornado no `LogResult`'s primeira linha
(`START RequestId: <id>`) contra Logs Insights, registrando esse fallback se usado.

`FunctionError` é campo de metadado da RESPOSTA do `invoke` (`aws lambda invoke ... --query
FunctionError`), separado do `Payload` (corpo retornado pelo handler) - os dois são checados
separadamente: ausência de `FunctionError` (Lambda não crashou) E `Payload.statusCode` na faixa
2xx/3xx esperada para o evento de leitura escolhido (app não retornou erro estruturado).

**Fixtures nomeadas explicitamente, por handler** (nenhum placeholder):
- `bff-handler`: `GET /bff/organizations` com sessão válida NÃO é viável sem cookie real - usar
  `GET /bff/session` sem cookie, que é um caminho de leitura legítimo e determinístico (deve responder
  401/200 conforme ausência de sessão, nunca 500) - suficiente pra gerar REPORT real sem mutar nada.
- `items-handler`/`documents-handler`/`document-archive-handler`/`memberships-handler`: rota GET de
  listagem/dashboard de cada um, com claims JWT sintéticas mínimas válidas (mesmo padrão que os testes
  de contrato já existentes usam para simular o autorizer - a localizar em `test/contract/` na
  execução, reaproveitando fixture real de teste, não inventando uma nova).
- **Worker assíncrono do smoke**: achado concreto do Codex confirmado por leitura -
  `notification-router-handler` recebe **DynamoDB Streams**, não SQS (`notification-router-
  handler.ts:61`) - um registro SQS seria ignorado silenciosamente. Corrigido: usar um worker que
  realmente consome SQS (ex. `whatsapp-digest-delivery-handler`, consumidor de
  `SQS_NOTIFICATION_WHATSAPP_DIGEST_V1`, confirmado no código) com um evento SQS de formato válido
  para ESSE contrato específico, e uma asserção de processamento efetivo (não só ausência de erro) -
  a definir a asserção exata na execução, por leitura do handler.

## 6. Identificação de versão: `cd.yml` E `rollback.yml`, mais spot-check do log START

`gh run list --workflow=cd.yml` E `gh run list --workflow=rollback.yml` confirmados **os dois** sem
nenhuma execução dentro da janela "antes" (`rollback.yml`: única execução histórica em
2026-08-22T03:17:56Z, muito antes da janela; `cd.yml`: já confirmado na Rodada 2). Complementado com
spot-check real: extrair 5 linhas `START RequestId: ... Version: $N` de log streams da janela "antes"
via `filter @type = "START" | fields @timestamp, @message | limit 5`, confirmar `Version` bate com a
versão pré-deploy esperada (89/121/83/106/97) - evidência direta, não só inferência pela ausência de
workflow.

Janela "depois": mantém `get-alias` no início E fim (`RevisionId` idêntico nos dois, já proposto),
mais confirmação de `RoutingConfig: null` nos dois snapshots (sem canário/peso) - se qualquer um dos
dois mudar, a coleta inteira é descartada e refeita (já proposto na Rodada 2, mantido).

## 7. Matriz explícita resultado → ação + regra de parada da coleta

**Regra de parada da janela "depois"**: coletar até **45 minutos corridos de tráfego natural OU até
atingir o piso (5 frias/10 quentes), o que vier primeiro** - nunca esperar o prazo cheio se o piso já
foi atingido antes. Se não atingido aos 45min: 1 rajada sintética de N=10 (`aws lambda invoke`
concorrente), aguardar **2 minutos de buffer de ingestão** antes da consulta final agregada (Logs
Insights não é instantâneo). Se ainda abaixo do piso após isso: **INCONCLUSIVO**, sem repetir.

**Matriz resultado → ação** (por handler, nunca agregada):

| Sinal de erro (A ou B) | Latência (Init Duration cold / Duration) | Ação |
|---|---|---|
| Subiu (qualquer um dos 2 sinais) | Qualquer resultado | **ROLLBACK** desse handler via `.github/workflows/rollback.yml` (mecanismo já existente, dev-only, reversível - executável de forma autônoma per `AGENTS.md` §1/§3, reportado depois) |
| Estável/melhorou | REGRESSÃO (Mann-Whitney significativo, sinal de piora) | **INVESTIGAR** esse handler especificamente antes de decidir - não reflete automaticamente rollback de todo o deploy por 1 handler divergente |
| Estável/melhorou | MELHORIA | **MANTER**, registrar número final |
| Estável/melhorou | SEM DIFERENÇA MENSURÁVEL | **MANTER**, registrar como "sem ganho detectável nesta amostra" (nunca "sem ganho", distinção do achado 2 da Rodada 1) |
| Estável/melhorou | INCONCLUSIVO (amostra insuficiente) | **MANTER**, registrar como pendência de mais tráfego natural antes de reavaliar |

Teste de sourcemap (item 4) é uma trilha própria, independente desta matriz - uma falha ali não
aciona rollback de latência (não é uma regressão de performance), é registrada como item de
debuggability a corrigir separadamente se ocorrer.

## Pergunta específica para o Codex

Os 7 pontos da Rodada 2 foram endereçados com detalhe suficiente para reproduzir exatamente (mesmo
evento, mesma linha, mesmo comando) por outra pessoa? Falta algo?

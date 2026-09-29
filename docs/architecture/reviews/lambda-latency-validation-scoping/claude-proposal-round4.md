---
status: draft
owner: Marcelo
authority: proposta Rodada 4 do protocolo Claude↔Codex (AGENTS.md §4) — nível 3-4, submissão pedida por Marcelo
---

# Metodologia de validação pós-deploy do D-350 (A+B) — Rodada 4

Responde aos 7 achados da Rodada 3, incluindo o bloqueio real que o Codex reproduziu ao vivo
(`COGNITO_USER_POOL_ID="local-test"` inválido para o verificador JWT do Cognito).

## 1. Exclusividade temporal natural/sintética, operacionalizada

- Janela "depois" natural: início fixo `2026-09-29T00:36:33Z`; fim = o que vier primeiro entre (a)
  atingir 5 frias/10 quentes por handler, ou (b) 45 minutos corridos (`2026-09-29T01:21:33Z`).
  **Ambos os limites são registrados por escrito ANTES da coleta começar** (não decididos depois de
  ver os dados).
  Fica registrado nesta linha: **antes**=`2026-09-27T22:55:08Z`–`2026-09-28T22:55:08Z`,
  **depois**=`2026-09-29T00:36:33Z`–`2026-09-29T01:21:33Z` (ou o momento em que o piso for atingido,
  o que for anterior).
- **Rajada sintética (se necessária) só começa DEPOIS do fim da janela natural registrada acima**,
  nunca sobreposta a ela.
- **Buffer de ingestão não amplia a janela amostrada**: espera-se 2 minutos de relógio ANTES de rodar
  a consulta final, mas o parâmetro `--end-time` da consulta permanece o fim real da janela (natural
  ou, se houve rajada, o fim da rajada) - nunca o momento em que a consulta foi de fato executada.
- Correção de linguagem: **"tráfego real em `dev`, sem usuário real"** (nunca mais "produção").

## 2. Estatística: Mann-Whitney como teste de distribuição, mediana como descritivo, Holm nos testes válidos

- **Mann-Whitney U não prova igualdade de medianas** sem assumir formas de distribuição iguais entre
  os grupos (só sob essa hipótese adicional a rejeição implica diferença de localização/mediana) -
  aceito a correção. Reformulado: Mann-Whitney testa **se há evidência de que a distribuição geral de
  latência mudou** (dominância estocástica); a mediana de cada lado é reportada **como resumo
  descritivo ao lado**, nunca como "o que o p-valor prova formalmente".
- **Fórmula exata** (Conover, 1999 - aproximação normal com correção de continuidade e correção por
  empates, aplicada uniformemente, nunca dependente de escolha ad-hoc por tamanho de amostra):
  ```
  U₁ = R₁ - n₁(n₁+1)/2         (R₁ = soma dos postos do grupo 1, empates por posto médio)
  μᵤ = n₁n₂/2
  σᵤ² = (n₁n₂/12) × [(n₁+n₂+1) - Σ(tᵢ³-tᵢ)/((n₁+n₂)(n₁+n₂-1))]   (tᵢ = tamanho de cada grupo de empate)
  z = (U₁ - μᵤ ± 0,5) / σᵤ      (correção de continuidade, sinal conforme direção)
  p = 2×(1-Φ(|z|))              (bicaudal)
  ```
  Registrado explicitamente: esta é uma aproximação; para grupos com n<8, o poder estatístico é baixo
  e o p-valor é tratado como **indicativo, não confirmatório** - declarado no relatório, nunca
  escondido atrás de um número seco.
- **Limiar de significância prática**: mantido da Rodada 2 - ≥15% de mudança relativa **na mediana**
  (explicitamente reafirmado aqui, não mais implícito).
- **Correção de comparações múltiplas**: Holm-Bonferroni aplicado **só aos testes que atingiram o
  piso amostral** (não aos handlers/métricas já INCONCLUSIVOS, que não geram p-valor nenhum);
  reportado p bruto E p ajustado lado a lado; a classificação MELHORIA/REGRESSÃO usa o **p ajustado**.

## 3. Sinais de erro: exclusividade temporal resolve a limitação de dimensão

**Confirmado, achado do Codex procede**: `AWS/Lambda` `Errors`/`Invocations` com dimensão
`FunctionName` agrega TODAS as invocações daquele nome de função, sem distinguir origem. **Resolvido
pela mesma exclusividade temporal do item 1**: como a rajada sintética só ocorre depois do fim da
janela natural registrada, uma consulta `GetMetricStatistics` com `--start-time`/`--end-time`
delimitados exatamente pela janela natural exclui a sintética por construção - nunca depende da
métrica "saber" a origem, depende só do recorte temporal.

- **"Subiu" definido numericamente**: taxa "depois" (janela natural) > taxa "antes" **E** a diferença
  absoluta de contagem de erros é ≥1 (evita reagir a arredondamento de taxa quando o denominador é
  pequeno). Se `Invocations`/`total` = 0 em qualquer janela → **"sem dado"**, nunca 0% nem "estável".
- Sinal B (log `level="error"`, `count_distinct(@requestId)`) segue os mesmos dois pontos: recorte
  temporal exclusivo da janela natural; denominador zero → "sem dado".
- Os 2 sinais continuam reportados lado a lado, nunca somados.

## 4. Sourcemap: script corrigido (bloqueio real do Codex resolvido) + 2 handlers + 1 worker concretos

**Bloqueio corrigido**: `COGNITO_USER_POOL_ID` precisa de um valor sintaticamente válido -
`"us-east-1_LocalTest123"` (testado e confirmado pelo próprio Codex na Rodada 3, reaproveitado aqui
literalmente).

### `bff-handler` (mantido da Rodada 3, env var corrigida)
Ponto de exceção: `src/runtime/aws/handlers/bff-handler.ts:61` (`toBffRequest`,
`event.requestContext.http.method` quando `requestContext.http` está ausente).
```js
// sourcemap-check-bff.cjs
const FAKE = {
  TABLE_NAME: "local-test", BFF_SESSION_TABLE_NAME: "local-test",
  SESSION_TOKEN_PEPPER: "local-test", SESSION_KMS_KEY_ID: "local-test",
  COGNITO_USER_POOL_ID: "us-east-1_LocalTest123",   // <- corrigido, formato válido
  COGNITO_CLIENT_ID: "local-test", COGNITO_CLIENT_SECRET: "local-test",
  COGNITO_DOMAIN: "https://local-test.auth.us-east-1.amazoncognito.com",
  BFF_REDIRECT_URI: "https://local-test/callback", API_BASE_URL: "https://local-test/api",
  GUEST_TOKEN_PEPPER: "local-test", APP_ORIGIN: "https://local-test",
};
for (const [k, v] of Object.entries(FAKE)) process.env[k] = v;
const { handler } = require("./extracted/bff-handler/index.js");
handler({ requestContext: { requestId: "sourcemap-check" } }, {});
```

### `items-handler` (novo, concreto - substitui "a definir")
Verificado por leitura direta: `event.requestContext.authorizer.jwt.claims` é acessado em
`extractClaims()` (`src/runtime/aws/http-adapter.ts:10`), chamado em `items-handler.ts:54` **antes**
do `try`/`catch` do dispatch de rotas (que só começa dentro do `timeSpan` na linha 62) - um evento sem
`authorizer` estoura ali, sem passar pelo pipeline de erro do app. Só precisa de `TABLE_NAME`
(`items-handler.ts:31-32`, sem validação de formato Cognito - handler mais simples que o BFF).
```js
// sourcemap-check-items.cjs
process.env.TABLE_NAME = "local-test";
const { handler } = require("./extracted/items-handler/index.js");
handler({ requestContext: { requestId: "sourcemap-check" } }, {});
```
Critério de arquivo/linha esperado: `src/runtime/aws/http-adapter.ts:10` (função `extractClaims`).

### `document-archive-handler` (novo, concreto - substitui "a definir")
Mesmo ponto de exceção (`extractClaims`, `http-adapter.ts:10`, chamado em
`document-archive-handler.ts:124`, também antes de qualquer try/catch próprio) - **mesmo bug-fonte,
2 bundles independentes** (cada handler é buildado separadamente por `build-lambdas.ts`), então isso
prova a correção do sourcemap em 2 ARTEFATOS distintos, não só 2 vezes o mesmo. Precisa de 4 env vars
(`document-archive-handler.ts:86-100`): `TABLE_NAME`, `QUARANTINE_BUCKET_NAME`,
`REPORT_EXPORTS_BUCKET_NAME`, `DOCARCHIVE_SHARE_LINK_PEPPER`.
```js
// sourcemap-check-docarchive.cjs
for (const k of ["TABLE_NAME","QUARANTINE_BUCKET_NAME","REPORT_EXPORTS_BUCKET_NAME","DOCARCHIVE_SHARE_LINK_PEPPER"])
  process.env[k] = "local-test";
const { handler } = require("./extracted/document-archive-handler/index.js");
handler({ requestContext: { requestId: "sourcemap-check" } }, {});
```

### Worker do smoke: `outbox-sweeper-handler` (trocado - `whatsapp-digest-delivery-handler` descartado)
**Achado do Codex sobre `notification-router-handler` levou a reавaliar o worker inteiro, não só
trocar de handler**: `whatsapp-digest-delivery-handler` dependeria de Secrets Manager real (credencial
de vendor externo) e um kill switch de feature flag - inadequado pra um smoke de rotina, risco
desproporcional (poderia disparar uma chamada real à API do WhatsApp se o kill switch estivesse
ligado). Trocado por `outbox-sweeper-handler` (`src/runtime/aws/handlers/outbox-sweeper-handler.ts`):
disparado por EventBridge Scheduler a cada 5 minutos em produção normal (invocar uma vez a mais é
equivalente a um ciclo natural, idempotente por design, `leaseOwner` único por invocação), sem
vendor externo, sem payload de evento (assinatura `handler(): Promise<void>`), só DynamoDB via GSI6.
**Não é o alvo do teste de sourcemap** (função `sweepPendingDispatch`, não compartilha o mesmo ponto
de exceção de `extractClaims` - decisão consciente de separar as 2 preocupações: sourcemap testado
nos 3 handlers HTTP acima, este worker só prova ausência de `FunctionError` pós-minificação).
Invocação real (função já deployada, sem simulação local): `aws lambda invoke --qualifier live
--invocation-type RequestResponse --log-type Tail exptrk-dev-outbox-sweeper-handler output.json`.
**Asserção de processamento real** (não só ausência de erro, achado do Codex sobre kill switches):
o REPORT/log deve conter a linha `"outbox-sweeper complete"` (emitida por
`outbox-sweeper-handler.ts`'s `logger.info` só depois de `sweepPendingDispatch` retornar com
sucesso) - presença dessa linha no `LogResult` decodificado é a prova de execução completa.

### 2 critérios de aprovação, por artefato (3 handlers HTTP acima)
1. **Resolução de arquivo/linha**: stack aponta pro arquivo/linha reais de `src/...` (a conferir
   contra o CÓDIGO-FONTE DA VERSÃO EXTRAÍDA do ZIP real, não presumido pelo `git HEAD` atual -
   `unzip`/inspeção do `.map` do artefato baixado, não do `dist/` local).
2. **Preservação de nome**: o frame nomeia a função real (`toBffRequest` ou `extractClaims`), nunca
   um símbolo minificado de 1-2 letras.

## 5. Correlação do Invoke: RequestId direto da linha REPORT, nunca de START

**Corrigido**: `--log-type Tail` só traz os ÚLTIMOS 4KB - não presumir que `START` sobreviva nesse
recorte. A própria linha `REPORT` já carrega `RequestId:` (formato padrão do runtime Lambda:
`REPORT RequestId: <id> Duration: ... Init Duration: ... Memory Size: ... Max Memory Used: ...`) -
extrair `RequestId`/`Duration`/`Init Duration` diretamente dessa linha, nunca de `START`. Se a linha
`REPORT` não aparecer nos 4KB retornados (só ocorreria com um handler extremamente verboso em log,
não é o caso dos handlers HTTP simples aqui), **essa amostra específica fica inconclusiva** -
descartada, não substituída por suposição.

`FunctionError` (campo de METADADO da resposta do `invoke`, `aws lambda invoke --query
FunctionError`) e `Payload.statusCode` (corpo retornado pelo handler) continuam checados
separadamente, como já corrigido na Rodada 3.

## 6. Fixtures concretas dos 4 handlers autenticados + tabela handler→versão

### Fixtures de invocação (rotas de leitura, claims sintéticas plausíveis, sem membership real)
Claims sintéticas comuns (formato exigido por `extractClaims`, sem precisar existir no banco -
achado aceito: resposta de AUTORIZAÇÃO NEGADA/vazia é resultado esperado válido, não erro):
```json
{ "sub": "01JSMOKE0000000000000001", "jti": "smoke-jti-01",
  "iat": "<epoch agora>", "exp": "<epoch agora + 3600>" }
```
- `items-handler`: `GET /items/dashboard`, evento com `routeKey: "GET /items/dashboard"`,
  `requestContext.authorizer.jwt.claims` = acima. Resposta esperada: `FunctionError` ausente E
  `Payload.statusCode` ∈ {200, 401, 403} (qualquer resposta estruturada válida, nunca 500).
- `documents-handler`: `GET /documents/{documentId}` com `pathParameters: {documentId: "doc_smoke"}`
  (ID sintético, não precisa existir) - mesma claims, mesmo critério de statusCode (200/401/403/404).
- `document-archive-handler`: `GET /document-archive/requirements` (rota de listagem tenant-wide),
  mesma claims, mesmo critério.
- `memberships-handler`: `GET /organizations` (listagem), mesma claims, mesmo critério.
- **`bff-handler`**: `GET /bff/session`, SEM cookie. **Correção aceita do Codex**: resposta esperada é
  `200` com corpo `{"authenticated": false}` (não 401 - confirmado lendo o código real), critério
  ajustado para `Payload.statusCode === 200` E corpo contém `"authenticated":false`.

### Tabela handler→versão→intervalo→consulta (spot-check da Rodada 3, refinado)
Por handler (não uma tabela genérica única), executado na hora da coleta:

| Handler | Versão esperada "antes" | Consulta (Logs Insights) |
|---|---|---|
| bff-handler | 89 | `filter @type="START" \| fields @timestamp,@message \| filter @message like /Version: 89/ \| limit 5`, janela = janela "antes" |
| items-handler | 121 | idem, `Version: 121` |
| memberships-handler | 83 | idem, `Version: 83` |
| documents-handler | (a confirmar - versão pré-deploy não capturada nesta rodada, buscar via histórico se disponível, senão registrar como não verificado para este handler especificamente) | idem |
| document-archive-handler | (idem) | idem |

**Limitação explícita**: 5 registros confirmam amostralmente que a versão esperada aparece na janela,
não certificam exclusividade em toda a janela - aceito como evidência amostral, não prova total,
conforme a correção da Rodada 3.

## 7. Rollback compatível com o mecanismo real + parada por handler + smoke incondicional

**Achado do Codex confirmado por leitura de `rollback.yml:205`**: o workflow reverte TODAS as funções
do manifesto de uma vez, não oferece reversão seletiva por handler. Matriz corrigida:

| Sinal de erro (A ou B, janela natural) | Latência (handler com piso atingido) | Ação |
|---|---|---|
| Subiu em QUALQUER um dos 5 handlers | Qualquer resultado | **ROLLBACK DO DEPLOY INTEIRO** via `.github/workflows/rollback.yml` (reverte os 5 handlers juntos, único modo que o mecanismo real oferece - executável de forma autônoma per `AGENTS.md` §1/§3, reportado depois) |
| Estável em todos os 5 | REGRESSÃO em 1+ handler (Mann-Whitney ajustado significativo, direção de piora) | **INVESTIGAR** esse(s) handler(s) antes de decidir - não aciona automaticamente rollback do deploy inteiro por 1 handler divergente entre os 5 |
| Estável em todos os 5 | MELHORIA | **MANTER**, registrar número final |
| Estável em todos os 5 | SEM DIFERENÇA MENSURÁVEL | **MANTER**, registrado como "sem ganho detectável nesta amostra" |
| Estável em todos os 5 | INCONCLUSIVO (piso não atingido mesmo após rajada) | **MANTER**, registrado como pendência de mais tráfego natural |

**Parada explícita por handler** (não um corte único para os 5): cada handler tem seu próprio relógio
de 45min/piso, independente dos outros - um handler pode fechar em 10min (tráfego alto) enquanto outro
ainda está coletando aos 40min.

**Smoke incondicional**: as invocações de fixture (item 6) e o teste de sourcemap (item 4) rodam
**sempre**, independente de o tráfego natural já ter atingido o piso ou não - não ficam condicionadas
à insuficiência de amostra (correção do achado do Codex: "o smoke também precisa ocorrer quando o
tráfego natural já atingiu o mínimo").

**Buffer de 2 minutos gera resultado explícito**: se após os 2 minutos de espera de ingestão os dados
ainda não aparecerem na consulta, o resultado é **"dados ainda ausentes/incompletos"** (um estado
próprio, nunca presumido como sucesso silencioso nem confundido com INCONCLUSIVO por amostra
insuficiente - são causas diferentes, um é atraso de ingestão, outro é volume real de tráfego).

## Pergunta específica para o Codex

Os 7 pontos, incluindo o bloqueio real que você reproduziu ao vivo, foram corrigidos com detalhe
suficiente para reproduzir exatamente por outra pessoa? Falta algo?

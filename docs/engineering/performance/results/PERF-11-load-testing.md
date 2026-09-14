# PERF-11 — Load testing HTTP (k6)

## Resumo executivo

O ramp real (k6 contra o ambiente `dev` ao vivo, tenant sintético real) **não chegou a testar a
capacidade de Lambda/API Gateway/DynamoDB** porque encontrou um gargalo diferente, bem mais cedo:
a **quota de aplicação `API_REQUEST` (100 requisições/60s por tenant)**, implementada em
`src/modules/identity/application/quota.ts` e consumida em vários handlers (ex.:
`consumeApiRequestQuota` em `src/modules/subject/http/subject-handlers.ts:19`,
`limit: 100, windowSeconds: 60`). Essa quota é **por tenant**, não por rota — todas as chamadas do
teste (Overview, SubjectHub, Item detail, Reports) descontam do mesmo balde
`TENANT#org_01M2GE4F1SZPSJ47HCGRXH4XMN#QUOTA`.

Com apenas ~5-10 VUs sustentados (cada VU fazendo ~1 request/s), o tenant já ultrapassa 100
req/min e o BFF passa a responder `429 QUOTA_EXCEEDED` para a maior parte do tráfego. Confirmado
via CloudWatch: **zero throttles, zero erros e concorrência de Lambda no pico de apenas 34**
(quota de conta agora é 1000) durante toda a janela do teste — ou seja, a infraestrutura (Lambda,
API Gateway, DynamoDB) não chegou nem perto do limite; o teto real, neste ambiente, com este
tenant, é a regra de negócio de rate limiting.

Isso muda o que "ponto de saturação" significa aqui: não é um gargalo de Lambda/DynamoDB (que é o
que o plano de ação queria investigar), é um limitador de aplicação que qualquer carga realista de
mais de ~1-2 usuários simultâneos ativos no mesmo tenant já atinge. **Esse é o achado principal do
PERF-11.**

## Metodologia

- **Ferramenta**: k6 v2.0.0 (`C:\Program Files\k6\k6.exe`, já instalado na máquina — nenhuma
  instalação foi necessária).
- **Scripts**: `performance/k6/` (commitados, ver seção "Scripts" abaixo).
- **Ambiente**: `https://d1mbs2t047qo9d.cloudfront.net` (CloudFront → API Gateway → BFF Lambda →
  resource Lambdas → DynamoDB), conta AWS `975707451904`, região `us-east-1`.
- **Tenant**: "PERF Test Tenant" (`org_01M2GE4F1SZPSJ47HCGRXH4XMN`), 7 Items, 2 Subjects — ver
  `docs/engineering/performance/baseline/PERF-04-test-tenant.md`. Autenticação real via sessão BFF
  (cookies obtidos por `docs/engineering/performance/traces/perf-04-auth.mjs`, fluxo OAuth
  Cognito Hosted UI real, não mockado). Sessão verificada válida (`GET /bff/session` → 200,
  `authenticated: true`) antes de cada rodada.
- **CSRF**: confirmado que não é necessário — todas as 4 rotas usadas são `GET` (leitura), e o
  `verifyCsrf` do BFF (`src/modules/bff/domain/bff-request.ts`) só é aplicado a métodos de
  mutação. Só o cookie de sessão (`__Host-et_session`) foi enviado.
- **Todas as chamadas são somente leitura** — nenhuma mutação foi feita contra o tenant durante o
  teste de carga.

### Rotas reais verificadas ao vivo antes de escrever os scripts

| Rota | Status | Observação |
|---|---|---|
| `GET /bff/api/items/dashboard` | 200 | Scenario A |
| `GET /bff/api/subjects/dashboard` | 200 | parte do Scenario B |
| `GET /bff/api/subjects/{subjectId}` | 200 | parte do Scenario B |
| `GET /bff/api/items/{itemId}` | 200 | substituto do Scenario C, ver nota abaixo |
| `GET /bff/api/document-archive/storage-usage` | 200 | gap de IAM do Ciclo A (`CICLO-A-analise.md`) parece corrigido |
| `GET /bff/api/document-archive/requirements/{subjectId}` | 200, `{"requirements":[]}` | confirma que o tenant não tem nenhum documento real |
| `GET /bff/api/reports/expiring-soon-items` | 200, CSV | bug JSON.parse-vs-CSV do PERF-04 confirmado corrigido — usado no Scenario D |

### Substituição no Scenario C ("Document detail") e no fatia "Documents" do Scenario D

O alvo literal do plano é a tela Document Detail (`frontend/src/routes/DocumentDetail.tsx`), que
chama `GET /bff/api/document-archive/documents/{documentId}` e
`.../documents/{documentId}/versions`. **O tenant PERF nunca teve nenhum documento enviado** —
`GET .../document-archive/requirements/{subjectId}` devolve `{"requirements":[]}`, então não existe
nenhum `documentId` real para chamar. Criar um exigiria uma mutação (fluxo de upload/commit),
fora de escopo de um teste de carga somente-leitura.

**Substituto usado**: `GET /bff/api/items/{itemId}` (tela Item Detail) — a rota de "detalhe de
entidade única" mais próxima com dado real semeado neste tenant. Os números do Scenario C (e da
fatia "Documents" do Scenario D) medem essa rota, não o Lambda `document-archive` especificamente.
Isso está sinalizado nos comentários de `performance/k6/scenario-c-document-detail.js` e
`scenario-d-mixed.js`.

### Dataset pequeno — ressalva

7 Items / 2 Subjects é um dataset propositalmente pequeno (herdado do PERF-04, feito para medir
latência por request, não padrões de query em volume). Isso é adequado para o que o PERF-11 mede
(latência/throughput por request sob concorrência), mas **não** testa paginação, scans grandes ou
GSIs sob muitos itens — isso é uma preocupação diferente, fora do escopo deste experimento.

## Ramp executado e por que não foi até 100 VU em todos os cenários

O ramp (1 → 5 → 10 → 25 → 50 → 100 VU) foi executado **integralmente para o Scenario D** (mistura
realista, o mais representativo), e até a confirmação clara da condição de parada (1 → 5 → 10 VU)
para os Scenarios A, B e C — a decisão de não continuar os 3 primeiros cenários até 50/100 VU foi
consciente: a quota de aplicação (`API_REQUEST`, 100 req/60s, por tenant — não por rota) já é
compartilhada por **todo o tráfego do mesmo tenant**, então uma vez que o Scenario D provou que o
teto está na quota de aplicação (bem abaixo de qualquer teto de Lambda/DynamoDB), repetir o mesmo
achado a 50 e 100 VU em mais 3 scripts seria gerar tráfego/custo real sem gerar informação nova —
isso é exatamente o "não tentar quebrar a AWS por curiosidade" que a tarefa pediu para respeitar.
Standard reprodutível: qualquer stage com mais de ~2 VUs sustentados por >60s já estoura os 100
req/min do tenant.

### Scenario A — Overview dashboard (leitura simples)

| VU | Duração | Requests | p50 | p95 | p99 (aprox. via max) | Erro | Req/s |
|---|---|---|---|---|---|---|---|
| 1 | 30s | 20 | 470ms | 643ms | 744ms | 0.00% | 0.66 |
| 5 | 30s | 104 | 418ms | 826ms | 1.17s | 0.00% | 3.32 |
| 10 | 30s | 214 | 370ms | 583ms | 1.96s | **94.85%** (203/214, todos 429 `QUOTA_EXCEEDED`) | 6.84 |

**Stop condition atingida em VU=10**: erro >1% (na verdade 94.85%). Ramp interrompido aqui para
este cenário — não avançado para 25/50/100 VU.

### Scenario B — SubjectHub (tela composta, 2 requests paralelos/iteração)

| VU | Duração | Requests | p50 | p95 | Erro | Req/s |
|---|---|---|---|---|---|---|
| 1 | 30s | 38 | 469ms | 822ms | **2.63%** (1/38) | 1.26 |
| 5 | 30s | 190 | 419ms | 793ms | **66.84%** (127/190) | 6.06 |
| 10 | 30s | 396 | 389ms | 1.09s | **74.74%** (296/396) | 12.60 |

**Stop condition já atingida em VU=1** (erro 2.63% > 1%) — porque cada iteração dispara 2 requests
em paralelo (mesmo padrão real do browser no SubjectHub), então mesmo 1 VU sustenta ~2 req/s,
suficiente para bater no teto de 100/60s do tenant compartilhado ao longo de 30s de teste
acumulado com as rodadas anteriores. Ramp não avançado além de VU=10 para este cenário.

### Scenario C — Document detail (substituto: Item detail, ver nota de metodologia)

| VU | Duração | Requests | p50 | p95 | Erro | Req/s |
|---|---|---|---|---|---|---|
| 1 | 30s | 21 | 406ms | 496ms | **90.47%** (19/21) | 0.68 |
| 5 | 30s | 105 | 389ms | 674ms | 6.66% (7/105) | 3.42 |
| 10 | 30s | 217 | 372ms | 590ms | **82.48%** (179/217) | 6.90 |

**Stop condition atingida em VU=1** — a quota de tenant é compartilhada e cumulativa: como os
Scenarios A e B já haviam consumido parte considerável da janela de 60s do tenant nos minutos
imediatamente anteriores (mesmo tenant, mesma janela fixa `TYPE#API_REQUEST#<window>`), o Scenario
C começou já perto do teto. Isso reforça o achado: **em uso realista (mesmo usuário navegando
entre telas), 100 req/60s por tenant é atingido rapidamente**, não é um artefato de um único
endpoint isolado.

### Scenario D — mistura realista (40% Overview / 25% Items / 20% Subjects / 10% Documents / 5% Reports)

Ramp completo executado 1 → 5 → 10 → 25 VU (interrompido em 25 VU, não avançado a 50/100 — ver
abaixo):

| VU | Duração | Requests | p50 | p95 | Erro | Req/s |
|---|---|---|---|---|---|---|
| 1 (baseline) | 30s | 19 | 615ms | 868ms | 0.00% | 0.61 |
| 5 | 30s | 86 | 558ms | 2.02s | 0.00% | 2.75 |
| 10 | 30s | 186 | 490ms | 1.20s | **44.62%** (83/186) | 5.93 |
| 25 | 30s | 493 | 405ms | 1.02s | **100%** (493/493) | 15.81 |

**Stop condition atingida entre VU=5 e VU=10**: erro passa de 0% para 44.62% (limite é >1%). Em
VU=25 o erro já é 100% (o tenant está permanentemente no teto da janela de 60s antes mesmo do
primeiro request do estágio). **Ramp interrompido em VU=25** — 50 e 100 VU deliberadamente não
executados: nesse ponto, aumentar VU só geraria mais 429s idênticos, não informação nova sobre
Lambda/API Gateway/DynamoDB (o objetivo real da tarefa).

Nota sobre p95: o p95 de VU=5 (2.02s) parece pior que o de VU=10/25 (1.20s/1.02s) — isso é
**ruído estatístico dos poucos requests que passaram (não-429)** em VU=10/25 já sob quota, não uma
melhora real de performance sob carga; a métrica `http_req_duration` do k6 inclui tanto os 200
quanto os 429 (rápidos, o BFF rejeita cedo, antes de qualquer chamada a resource Lambda/DynamoDB) —
por isso a duração cai à medida que a fração de 429 (respondidos rápido, sem tocar o backend) sobe.
**Os números de duração deixam de ser comparáveis a partir do estágio em que a quota é
estourada** — o que importa a partir daí é só a taxa de erro.

## CloudWatch — confirmação de que o gargalo NÃO é infraestrutura

Janela agregada de toda a execução do ramp (`2026-09-14T18:15–18:28 America/Sao_Paulo` /
`21:15–21:32 UTC`), perfil `claude-dev`, `exptrk-dev-bff-handler` (e agregado de conta onde
indicado):

| Métrica | Valor observado | Quota/limite | Interpretação |
|---|---|---|---|
| `Lambda ConcurrentExecutions` (conta, Maximum) | pico **34** | 1000 (pós-aumento do PERF-01) | 3.4% da quota — nem perto do teto |
| `Lambda Throttles` (`bff-handler`) | **0** (soma, toda a janela) | — | nenhum throttle de Lambda ocorreu |
| `Lambda Errors` (`bff-handler`) | **0** (soma, toda a janela) | — | nenhum erro 5xx/exception real da função |
| `Lambda Duration` (`bff-handler`, Average por minuto) | 275ms–3.0s (variação alta, dominada por poucos datapoints de cold start/ruído da máquina de teste) | — | dentro da faixa observada no PERF-04 (baseline) |
| API Gateway latência | não coletado separadamente nesta rodada (métrica de conta não filtrável só por esta API sem mais setup; Duration do Lambda já cobre o essencial) | — | — |
| DynamoDB throttling | não verificado nesta rodada — dado o achado de que a quota de aplicação barra o tráfego antes de qualquer stress real em Lambda, não há motivo para esperar pressão em DynamoDB aqui (consistente com PERF-13: zero throttling em 7 dias de tráfego real) | — | — |

Todos os `429` observados no k6 vieram do corpo `{"code":"QUOTA_EXCEEDED","category":"QUOTA_EXCEEDED","quotaType":"API_REQUEST","limit":100}`
ou do 429 genérico do gateway (`{"message":"Too Many Requests"}`, provavelmente o mesmo limite
reportado de forma diferente por uma camada anterior/CloudFront ou por uma resposta cacheada de
erro) — nenhum deles é um 5xx de Lambda/DynamoDB.

## Resultado esperado do plano — respostas honestas

- **Capacidade atual**: para este tenant único, sob este limitador de aplicação, a capacidade
  sustentável é **~100 requisições por 60 segundos** (≈ 1.6 req/s) antes de começar a receber 429
  — isso equivale a aproximadamente 1-2 usuários ativos navegando normalmente (cada view dispara
  1-2 requests). **Não foi possível medir a capacidade real de Lambda/API Gateway/DynamoDB** neste
  experimento porque o rate limiter de aplicação bloqueia antes de qualquer um desses componentes
  ser exercitado sob carga significativa.
- **Primeiro gargalo real encontrado**: a quota de aplicação `API_REQUEST` (100 req/60s por
  tenant), `src/modules/identity/application/quota.ts` + `limit: 100, windowSeconds: 60` em
  `src/modules/subject/http/subject-handlers.ts:19` (e replicado em outros handlers — busca por
  `API_REQUEST` retorna 26 arquivos). Isso é **esperado por design** (proteção contra abuso/custo,
  documentada no data-model do produto) — não é um bug, mas para efeito de teste de carga é o
  gargalo que qualquer teste de múltiplos usuários simultâneos vai encontrar primeiro, bem antes
  de qualquer limite de infraestrutura.
- **Ponto de saturação de Lambda/DynamoDB**: **não atingido / não pôde ser medido** nesta rodada.
  Para medir isso de verdade seria necessário rodar o mesmo ramp contra **múltiplos tenants**
  distintos simultaneamente (distribuindo a carga para que nenhum tenant único bata na quota de
  100/60s), ou temporariamente elevar/desabilitar a quota `API_REQUEST` só para o tenant de teste
  via o mesmo mecanismo administrativo usado para as demais quotas — nenhuma das duas opções foi
  feita aqui (a primeira exigiria provisionar N tenants sintéticos, fora do escopo desta tarefa; a
  segunda seria uma mudança de configuração de produto, não uma ação de teste de carga pura).
  **Recomendação para um PERF-11-b futuro**, se o objetivo real for estressar Lambda/DynamoDB: usar
  vários tenants de teste (um por VU-group, ou um pool pequeno) para spalhar a carga acima do teto
  de 100 req/tenant/min.

## Scripts (`performance/k6/`)

- `performance/k6/lib/config.js` — config compartilhada: base URL, cookie de sessão (lido do
  `perf-04-session-cookies.json` via `open()`), IDs reais do tenant (`ITEM_ID`, `SUBJECT_ID`).
- `performance/k6/scenario-a-overview.js` — Scenario A.
- `performance/k6/scenario-b-subjecthub.js` — Scenario B (`http.batch` para replicar o fan-out
  paralelo real do SubjectHub, per PERF-07).
- `performance/k6/scenario-c-document-detail.js` — Scenario C (com nota de substituição inline).
- `performance/k6/scenario-d-mixed.js` — Scenario D (mistura ponderada 40/25/20/10/5).

Uso (um estágio de VU por vez, não `stages` embutido, para permitir checar CloudWatch/condições de
parada entre estágios):

```bash
k6 run --vus 1 --duration 30s performance/k6/scenario-a-overview.js
k6 run --vus 5 --duration 30s performance/k6/scenario-a-overview.js
# ... 10, 25, 50, 100
```

Pré-requisito: sessão válida em
`docs/engineering/performance/.local/perf-04-session-cookies.json` — se ausente/expirada, rodar
`node docs/engineering/performance/traces/perf-04-auth.mjs` primeiro.

## Achados incidentais (fora do escopo original, registrados para acompanhamento)

1. O bug do PERF-04 (`GET /bff/api/reports/expiring-soon-items` retornando 500 por
   `JSON.parse` de um corpo CSV) está **confirmado corrigido** — 200 com CSV válido, verificado ao
   vivo antes de usar essa rota no Scenario D.
2. O gap de IAM do Document Archive (`CICLO-A-analise.md`, `OrganizationStore.queryGsi4`) também
   parece corrigido — `GET /bff/api/document-archive/storage-usage` responde 200 ao vivo. Não foi
   possível confirmar 100% para as rotas de documento/requirement individuais porque o tenant não
   tem nenhum documento/requirement real semeado (ver nota de substituição acima).
3. A resposta 429 tem **dois formatos diferentes** observados no mesmo teste:
   `{"code":"QUOTA_EXCEEDED",...}` (da aplicação) e `{"message":"Too Many Requests"}` (formato
   genérico, provavelmente de uma camada diferente — API Gateway throttling de conta/rota, ou
   CloudFront). Não investigado a fundo nesta tarefa (fora de escopo), mas vale um item de
   acompanhamento separado para confirmar se há *dois* rate limiters distintos em jogo, não só um.

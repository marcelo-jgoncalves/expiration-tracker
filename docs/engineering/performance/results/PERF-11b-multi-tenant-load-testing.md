# PERF-11-b — Load testing multi-tenant (follow-up do PERF-11)

## Resumo executivo

Este é um follow-up explicitamente pedido pelo Marcelo depois do PERF-11 (`results/PERF-11-load-testing.md`):
o ramp original nunca chegou a exercitar a capacidade real de Lambda/API Gateway/DynamoDB porque
bateu quase de imediato na quota de aplicação por tenant (`API_REQUEST`, 100 req/60s,
`src/modules/identity/application/quota.ts`). A ideia aqui era distribuir a carga entre **múltiplos
tenants sintéticos** para que o teto agregado subisse o suficiente para, finalmente, encostar em um
limite de infraestrutura de verdade.

**Resultado**: com **10 tenants**, o teto agregado subiu de ~1,67 req/s (1 tenant) para
~16,67 req/s teórico (10× 100 req/60s) — e o ramp realmente foi mais longe antes de estourar
(VU=25 em vez de VU=10 do PERF-11 original, ~15,6 req/s medidos vs ~5,9 req/s do PERF-11). **Mas o
teto encontrado continua sendo a mesma quota de aplicação, agora agregada em 10 baldes em vez de
1** — não foi encontrado nenhum gargalo real de infraestrutura. CloudWatch confirma, de novo: zero
throttles, zero erros de Lambda, DynamoDB sem throttling, concorrência de Lambda no pico de apenas
**39** (3,9% da quota de conta de 1000). Isso é honesto e esperado dado o tamanho da conta/quota:
para realmente estressar Lambda/DynamoDB neste ambiente seria necessário ir muito além de 10
tenants (ver seção "Por que não fomos além" abaixo).

## Por que 10 tenants

A quota `API_REQUEST` é **por tenant**, fixa em `limit: 100, windowSeconds: 60`
(`src/modules/identity/application/quota.ts`, lane `EphemeralTelemetryMutation`, janela fixa por
`floor(epochSeconds / windowSeconds)`, sem nuance adicional por tipo de rota — todas as chamadas
GET usadas nos cenários descontam do mesmo balde por tenant). Com N tenants espalhando o tráfego,
o teto agregado sobe para N × 100/60s. 10 foi escolhido como o menor N que claramente ultrapassa a
faixa "poucos usuários simultâneos" que travou o PERF-11 (1-2 VUs já bastavam lá), mantendo o
número de tenants/dados sintéticos pequeno e descartável — não é um valor mágico, só o ponto
"dá para ver o ramp ir mais longe sem provisionar uma frota grande de usuários Cognito".

## Metodologia

### Provisionamento dos tenants

Tentativa inicial: reaproveitar o **mesmo usuário Cognito** e criar N organizações, trocando a
organização ativa da sessão via `POST /bff/organization/select` (Wave B2B-6/D-101,
`src/modules/bff/http/bff-handlers.ts`) — mais barato que criar N usuários. **Não funcionou**:
`POST /bff/organizations` retorna `409 CONFLICT` ("You have already created an organization.") na
segunda chamada do mesmo usuário — o produto limita **1 organização por usuário**
(`CreateOrganizationService`). Confirmado ao vivo antes de mudar de abordagem.

Abordagem usada: **10 usuários Cognito sintéticos**, criados via
`aws cognito-idp admin-create-user` + `admin-set-user-password --permanent` (user pool
`us-east-1_NZlvr5IIn`, mesmo pool do PERF-04), um por tenant:
`marcelo.mjgoncalves+perf-loadtest-2026-09-14-01@gmail.com` .. `-10@gmail.com`. Credenciais em
`docs/engineering/performance/.local/perf-11b-loadtest-users-credentials.txt` (gitignored).

Para cada usuário: login real via Cognito Hosted UI (Playwright headless, mesmo padrão de
`traces/perf-04-auth.mjs`) → `POST /bff/organizations` (`displayName: "PERF LoadTest Tenant 01"`
.. `"10"`) → seed via API normal (nunca escrita direta no DynamoDB): 3 Items
(`POST /bff/api/items`, categoria "Licenca", `dueDate` 2026-12-01) + 1 Subject
(`POST /bff/api/subjects`, tipo VENDOR) por tenant — mesma escala pequena do tenant original do
PERF-04/PERF-11 (este teste mede throughput de requisições, não volume de dados). Script:
`docs/engineering/performance/traces/perf-11b-multi-tenant-setup.mjs` (committed).

Sessão de cada tenant salva em `docs/engineering/performance/.local/perf-11b-session-{1..10}.json`
(gitignored) + manifesto `docs/engineering/performance/.local/perf-11b-tenants.json` (gitignored)
com `organizationId`/`itemId`/`subjectId`/`cookieFile` de cada um.

| # | Organização | Item semeado (1º) | Subject semeado |
|---|---|---|---|
| 01 | `org_01M2H00W3C1JKN4R98DR6T8AJJ` | `item_01M2H00XAF2PMKT3K8G9T1VZ8P` | `subject_01M2H012N8SM689RBANQ3WJD82` |
| 02 | `org_01M2H017FTA3DVZZAQQAHAQB52` | `item_01M2H018VT4PVCNR19G98Z96S2` | `subject_01M2H01AS8ZQS9A6PN83PGY464` |
| 03 | `org_01M2H01FFC69VCV92Q30HFVG9Y` | `item_01M2H01G8PRJXTESGN0JPKJMZ3` | `subject_01M2H01HY0Q02MN7R3W9W5WMYJ` |
| 04 | `org_01M2H01NXQYQWRPWXJHKD6ZAFJ` | `item_01M2H01PKTA254V828CD5G7R61` | `subject_01M2H01R8FV2VMPZ19HJS4FYMW` |
| 05 | `org_01M2H01WECYMWJMP2FB5XJ0W7S` | `item_01M2H01X1EJAT7JR3KHDYA05MJ` | `subject_01M2H01YY8XD74KT295KZ09VHC` |
| 06 | `org_01M2H0231K6JRJ6S3T1YDEDP4K` | `item_01M2H023JTQYR5VC7K2WX8MXTK` | `subject_01M2H02533QZ54FH3T823QE8BE` |
| 07 | `org_01M2H0298YDQBXRF9GBV4CBQ9X` | `item_01M2H029T6NTEJ3H36B8Z3FRTD` | `subject_01M2H02BBQJ1WRVBBF7T2QJV3G` |
| 08 | `org_01M2H02FJ7CFMWXQ4D1MHW4YDB` | `item_01M2H02G42FGMJNVVVK0GKP4SX` | `subject_01M2H02HJG20N14CHNNZ6DJKCT` |
| 09 | `org_01M2H02NXYWTAXAT168ABBF5D9` | `item_01M2H02PF64XYARQDP0BK8WHHZ` | `subject_01M2H02T5ETYEFBMJ6859DZ2MG` |
| 10 | `org_01M2H02ZRNDJ0XDX2D02ZPYMAX` | `item_01M2H030F6BBJ2X1Z26GT4CDX3` | `subject_01M2H03236DH4WBRAKQWZ15DD8` |

### Harness k6 (reuso do PERF-11)

Reaproveitado `performance/k6/` do PERF-11, sem reescrever nada — adicionados apenas:

- `performance/k6/lib/config-multi-tenant.js` — carrega o manifesto + as 10 sessões, expõe
  `tenantForVu(vuId)` (round-robin `(__VU - 1) % 10`) e `commonParamsForVu(name, vuId)`.
- `performance/k6/scenario-d-mixed-multi-tenant.js` — mesma mistura ponderada do Scenario D do
  PERF-11 (40% Overview / 25% Items / 20% Subjects / 10% Documents-substituto / 5% Reports), mas
  cada VU usa a sessão/`itemId` do seu próprio tenant em vez do tenant único do PERF-11.

**Só o Scenario D foi rodado** neste follow-up (decisão consciente por orçamento de tempo, igual
justificativa do PERF-11: D já é a mistura mais representativa e o objetivo aqui era escala de
throughput/infra, não repetir a mesma conclusão em 4 scripts). Scenarios A/B/C não foram
adaptados para multi-tenant.

## Ramp executado

Mesma estrutura do PERF-11 (1 → 5 → 10 → 25 → 50 → 100 VU, um estágio por vez, 30s cada, checando
condição de parada entre estágios):

| VU | Duração | Requests | p50 | p95 | Erro | Req/s agregado | Req/s/tenant (aprox.) |
|---|---|---|---|---|---|---|---|
| 1 (baseline) | 30s | 20 | 461ms | 608ms | 0,00% | 0,66 | 0,66 (1 tenant ativo) |
| 5 | 30s | 91 | 479ms | 1,40s | 0,00% | 2,89 | ~0,58 (5 tenants ativos) |
| 10 | 30s | 190 | 435ms | 1,09s | 0,00% | 6,09 | ~0,61 (10 tenants ativos) |
| 25 | 30s | 488 | 413ms | 1,14s (2,19s p/ 200s) | **28,48%** (139/488) | 15,58 | ~1,56 (25 VUs / 10 tenants = 2,5 VU/tenant) |

**Stop condition atingida em VU=25**: taxa de erro 28,48% > 1% (limite do plano). Ramp interrompido
aqui — 50 e 100 VU deliberadamente não executados, pela mesma lógica do PERF-11: o teto já estava
identificado como a mesma quota de aplicação, e continuar geraria mais 429 sem informação nova
sobre Lambda/API Gateway/DynamoDB.

Nota sobre p95 em VU=25: o valor de `http_req_duration` "geral" (1,14s) mistura 200s e 429s
(rápidos); o p95 isolado das respostas `expected_response:true` (só 200s) foi 2,19s — mesmo efeito
de "duração deixa de ser comparável" já documentado no PERF-11, porque uma fração crescente das
respostas é rejeição rápida de quota, não trabalho real de backend.

Comparação direta com o PERF-11 original (Scenario D, tenant único): o ramp multi-tenant foi **2,5×
mais longe em VU** antes de estourar (VU=25 vs VU=10) e sustentou **~2,6× mais throughput agregado
limpo** antes do erro (6,09 req/s em VU=10 limpo aqui vs. o PERF-11 já mostrando 44,62% de erro em
VU=10 com um único tenant).

## CloudWatch — confirmação de que o gargalo CONTINUA não sendo infraestrutura

Janela agregada da execução (`2026-09-14T19:15–19:23 America/Sao_Paulo` / `22:15–22:23 UTC`),
perfil `claude-dev`, conta `975707451904`, `us-east-1`:

| Métrica | Valor observado | Quota/limite | Interpretação |
|---|---|---|---|
| `Lambda ConcurrentExecutions` (conta, Maximum) | pico **39** (às 19:22, durante o estágio VU=25) | 1000 | 3,9% da quota — praticamente igual ao PERF-11 (34), mesmo com mais tenants/throughput |
| `Lambda Throttles` (`bff-handler`, Sum) | **0** em toda a janela | — | nenhum throttle |
| `Lambda Errors` (`bff-handler`, Sum) | **0** em toda a janela | — | nenhum erro 5xx real |
| `Lambda Duration` (`bff-handler`, Average por minuto) | 288ms–2,22s (picos de Maximum até ~5,2s, poucos datapoints, consistente com cold start/ruído) | — | dentro da faixa observada no PERF-04/PERF-11 |
| `DynamoDB ThrottledRequests` (`exptrk-dev-table`, Sum) | **0** (nenhum datapoint na janela, ou seja, nem chegou a registrar) | — | zero pressão em DynamoDB |

Todos os `429` observados (verificados via checks do k6 e amostras `curl` manuais durante o
estágio) são o mesmo padrão do PERF-11: rejeição rápida da aplicação antes de qualquer chamada real
a resource Lambda/DynamoDB, não uma falha de infraestrutura.

## Resposta à pergunta central: encontramos um gargalo REAL de infraestrutura desta vez?

**Não.** Mesmo distribuindo a carga por 10 tenants (teto agregado ~16,67 req/s em vez de ~1,67
req/s), o primeiro limite que o ramp encontra continua sendo a quota de aplicação `API_REQUEST`
— só que agora agregada em 10 baldes de 100/60s em vez de 1. Lambda, API Gateway e DynamoDB não
mostraram nenhum sinal de pressão real: concorrência de Lambda no pico foi de apenas 39 (3,9% de
1000), zero throttles, zero erros, zero throttling de DynamoDB.

Isso é **honesto e esperado** para o tamanho desta aplicação: mesmo levando a quota de aplicação
para 1000 req/60s agregados (16,67 req/s) hipoteticamente com N=100 tenants em vez de 10, ainda
estaríamos muito longe de qualquer teto plausível de Lambda/DynamoDB nesta conta — a concorrência
de Lambda cresce aproximadamente proporcional ao throughput e à latência (`~throughput × p95`), e
com p95 na casa de ~0,5-1s isso significaria algo como `16,67 × 1 ≈ 17` de concorrência sustentada
por essa taxa — para chegar perto dos 1000 de conta seria necessário um throughput agregado ~60×
maior que o testado aqui, ou seja, **centenas de tenants sintéticos**, não dezenas. Isso está fora
do escopo razoável deste follow-up (e do "não tentar quebrar a AWS por curiosidade" pedido na
tarefa original).

### Capacidade agregada limpa alcançada

O maior estágio **sem** violar nenhuma stop condition foi **VU=10 (10 tenants, ~1 VU/tenant)**:
6,09 req/s agregados, 0% de erro, p95=1,09s. VU=25 (2,5 VU/tenant em média) já rompe a quota
agregada — **~15,6 req/s agregados é aproximadamente o teto de throughput desta aplicação com 10
tenants**, quase batendo no teto teórico de 16,67 req/s (10×100/60s), o que confirma que a quota
de aplicação, não qualquer característica dinâmica de Lambda/DynamoDB, é o que define esse número.

## Recomendação sobre os tenants sintéticos

Os 10 tenants (`org_01M2H00W3C1JKN4R98DR6T8AJJ` .. `org_01M2H02ZRNDJ0XDX2D02ZPYMAX`) e os 10
usuários Cognito associados (`marcelo.mjgoncalves+perf-loadtest-2026-09-14-01@gmail.com` ..
`-10@gmail.com`) são artefatos de teste, não permanentes — **recomendação: apagar depois que este
resultado for revisado**, mesmo destino do "PERF Test Tenant" original do PERF-04 quando aquele
programa for encerrado. Nenhuma exclusão foi feita nesta tarefa (decisão separada, fora de escopo
aqui, conforme instrução).

## Achado incidental

O throughput agregado que este teste conseguiu sustentar sem erro (~6-15,6 req/s com 10 tenants
ativos) já dá uma boa aproximação de "quantos tenants realmente ativos ao mesmo tempo este produto
aguenta antes da quota de aplicação (não da infra) virar o teto real" — para qualquer cenário de
lançamento com múltiplos clientes simultâneos navegando ativamente, a quota de 100 req/60s por
tenant provavelmente nunca será o gargalo prático (cada tenant usa a própria janela), mas a
constatação central do PERF-11 permanece: **para medir Lambda/DynamoDB de verdade seria necessário
elevar/desabilitar temporariamente a quota `API_REQUEST` só para tenants de teste**, o que é uma
mudança de configuração de produto (fora do escopo de um teste de carga puro), não simplesmente
adicionar mais tenants sintéticos — 10x mais tenants ainda não seria suficiente, como mostrado
acima.

## Scripts e arquivos

- `docs/engineering/performance/traces/perf-11b-multi-tenant-setup.mjs` — provisiona os N tenants
  (committed).
- `performance/k6/lib/config-multi-tenant.js` — config compartilhada multi-tenant (committed).
- `performance/k6/scenario-d-mixed-multi-tenant.js` — Scenario D multi-tenant (committed).
- `docs/engineering/performance/.local/perf-11b-loadtest-users-credentials.txt` — credenciais dos
  10 usuários Cognito (gitignored).
- `docs/engineering/performance/.local/perf-11b-session-{1..10}.json` — sessões BFF por tenant
  (gitignored).
- `docs/engineering/performance/.local/perf-11b-tenants.json` — manifesto (gitignored).

Uso (reprodução):

```bash
node docs/engineering/performance/traces/perf-11b-multi-tenant-setup.mjs 10
k6 run --vus 1 --duration 30s performance/k6/scenario-d-mixed-multi-tenant.js
k6 run --vus 5 --duration 30s performance/k6/scenario-d-mixed-multi-tenant.js
# ... 10, 25 (parar em 25 pela mesma stop condition encontrada aqui)
```

# PERF-06 — Edge/CloudFront/latência Brasil

Ciclo B do programa de performance (`docs/engineering/performance/TODO.md`). Objetivo: medir o
`PriceClass` atual da distribuição CloudFront, entender o comportamento real de cache HIT/MISS dado
a arquitetura Full BFF, e avaliar se `sa-east-1` seria mais rápido que `us-east-1` para um usuário no
Brasil — sem confundir isso com uma decisão de mover a região do backend.

Distribuição real: `E2XPYCT6NSP8R1` (domínio `d1mbs2t047qo9d.cloudfront.net`), confirmada via
`aws cloudfront get-distribution-config --id E2XPYCT6NSP8R1 --profile claude-dev --region us-east-1`.

## 1. PriceClass atual

`DistributionConfig.PriceClass = "PriceClass_100"` (confirmado ao vivo, não é suposição do Terraform).

O que cada classe significa:

- **PriceClass_100**: só edge locations na América do Norte e Europa. Um usuário no Brasil **não**
  bate em um POP brasileiro — a requisição sai do Brasil, atravessa a rede até o POP mais próximo
  dentro do conjunto habilitado (tipicamente Miami/EUA para tráfego saindo do Brasil) e só ali o
  TLS é terminado.
- **PriceClass_All**: inclui todas as edge locations do mundo, incluindo as do Brasil (São Paulo,
  Rio de Janeiro, outras). Um usuário brasileiro termina o TLS localmente, e a partir daí o tráfego
  segue pela rede backbone da AWS (mais previsível/rápida que a internet pública) até o origin em
  `us-east-1`.
- **Custo**: CloudFront cobra por classe de preço — `PriceClass_100` é a opção mais barata (menos
  edge locations = tarifas de saída mais baixas); `PriceClass_All` custa mais por GB transferido,
  principalmente porque adiciona regiões historicamente mais caras (América do Sul, Índia, etc.).
  Não é uma diferença gigante em termos absolutos num ambiente de baixíssimo tráfego como este
  (~437 requests/7 dias, ver §2), mas é uma linha de custo que sobe com o preço por GB da região,
  não com uma taxa fixa.

## 2. Cache HIT/MISS — por que pouco é cacheável aqui

Comportamentos de cache reais da distribuição (`DefaultCacheBehavior` + `CacheBehaviors`, 7 no total):

| Path pattern | Origin | Cache Policy ID | O que é |
|---|---|---|---|
| `*` (default) | `spa-s3` | `658327ea-f89d-4fab-a63d-7e88639e58f6` | Managed policy **CachingOptimized** — assets estáticos do SPA (JS/CSS/HTML buildado) |
| `/bff`, `/bff/*` | `bff-api` | `4135ea2d-6df8-44a3-9df3-4b5a84be39ad` | Managed policy **CachingDisabled** |
| `/document-archive/guest/document-requests/*/session` | `resource-api` | `4135ea2d-6df8-44a3-9df3-4b5a84be39ad` | **CachingDisabled** |
| `/document-archive/guest/document-requests/*/document-types` | `resource-api` | `4135ea2d-6df8-44a3-9df3-4b5a84be39ad` | **CachingDisabled** |
| `/document-archive/guest/document-requests/*/uploads` | `resource-api` | `4135ea2d-6df8-44a3-9df3-4b5a84be39ad` | **CachingDisabled** |
| `/guest/document-requests/*/info` | `resource-api` | `4135ea2d-6df8-44a3-9df3-4b5a84be39ad` | **CachingDisabled** |
| `/guest/document-requests/*/uploads` | `resource-api` | `4135ea2d-6df8-44a3-9df3-4b5a84be39ad` | **CachingDisabled** |

Confirma exatamente a hipótese do plano: **todos os 6 path patterns que apontam para as APIs
(`bff-api`/`resource-api`) usam a managed policy AWS `CachingDisabled`** (min/default/max TTL = 0,
forward de todos os headers/cookies/query strings relevantes para autenticação de sessão) — CloudFront
nunca guarda essas respostas, sempre encaminha para o origin. Isso é o comportamento correto e
esperado para uma arquitetura Full BFF (ADR-0011): a sessão/autenticação vive no BFF, a esmagadora
maioria das chamadas é autenticada por usuário, e cachear no edge uma resposta ligada a sessão seria
um bug de vazamento de dados entre usuários, não uma otimização. Só o **default behavior** (`spa-s3`,
os arquivos estáticos do bundle do SPA) usa `CachingOptimized` — isso é o único tráfego que de fato
se beneficia de cache no edge hoje, e já é aproveitado.

Métrica `AWS/CloudFront CacheHitRate` (namespace `AWS/CloudFront`, dimensão `Region=Global`,
`--region us-east-1` obrigatório por ser um quirk de conta global) retornou **0 datapoints** nos
últimos 7 dias — essa métrica adicional não está habilitada nesta distribuição (é opt-in, tem custo
por métrica). Como proxy, `Requests` (Sum diário) mostra volume real muito baixo: 117, 75, 1, 5, 3,
236 requests nos 6 dias com dados (~437 no total, consistente com um ambiente `dev` de baixíssimo
uso, mencionado em achados anteriores desta sessão sobre zero linhas de Organization/Membership).
Dado o volume e a configuração `CachingDisabled` nas rotas de API, o HIT rate real de conteúdo
dinâmico é essencialmente **N/A por design** — não há nada ali para dar HIT; o único HIT possível é
nos assets estáticos do SPA, que a métrica agregada não separa por path pattern sem uma configuração
adicional (real-time logs ou métricas por cache-behavior) fora do escopo desta medição.

## 3. Benchmark Brasil: edge hop vs. origin round-trip

**Confirmação de localização desta máquina**: `curl https://ipinfo.io/json` retornou IP geolocalizado
em Belo Horizonte, MG, Brasil (ASN Claro NXT/Virtua) — a máquina usada para medir **está de fato no
Brasil**, então a medição abaixo é representativa de um usuário brasileiro real, não uma ressalva a
fazer no exit criterion.

5 requisições consecutivas de cada lado:

| | CloudFront (`d1mbs2t047qo9d.cloudfront.net`) | Origin direto (`4nl1x2vufc.execute-api.us-east-1.amazonaws.com`, API Gateway) |
|---|---|---|
| `time_total` (s) | 0.734 / 0.532 / 0.537 / 0.540 / 0.450 | 0.543 / 0.467 / 0.438 / 0.493 / 0.472 |
| Média | ~0.559s | ~0.483s |

**Achado**: a diferença é pequena e dentro do ruído normal de rede (a amostra via CloudFront foi, na
média, ligeiramente **mais lenta**, não mais rápida, que o acesso direto ao origin). Isso é exatamente
o esperado dado §2 — como nenhuma resposta de API é cacheada, CloudFront não está evitando nenhuma
viagem até `us-east-1`; ele está apenas adicionando um hop de proxy (TLS termination no edge +
reconexão ao origin) sem eliminar a latência Brasil↔Virgínia que domina o tempo total. Com
`PriceClass_100`, esse hop de edge nem sequer é um POP brasileiro — é um POP na América do
Norte/Europa mais próximo, então o "edge" efetivo já está quase tão longe do usuário quanto o próprio
origin.

**O valor real do CloudFront aqui hoje não é cache — é TLS termination + reuso de conexão na borda**
(keep-alive HTTP/2 para os assets estáticos do SPA, e alguma reutilização de conexão TCP/TLS entre
CloudFront e o origin para chamadas de API). Isso ainda tem valor (evita handshake TLS completo do
zero em cada request do browser), mas não é o tipo de ganho que "trocar a região do origin" resolveria
de forma diferente — são mecanismos distintos.

## 4. Duas decisões diferentes — não confundir

**Decisão A — `PriceClass_100` vs `PriceClass_All`** (config CloudFront, mudança pequena e reversível,
dentro do escopo deste item):
- Custo: sobe (mais caro por GB nas regiões adicionadas, incluindo Brasil).
- Ganho esperado: um POP brasileiro real termina TLS mais perto do usuário — reduz o RTT do primeiro
  handshake e dos assets estáticos (`spa-s3`, que É cacheado). Para as chamadas de API
  (`CachingDisabled`), o ganho é menor porque a resposta ainda precisa viajar até `us-east-1` de
  qualquer forma — só a perna Brasil→POP fica mais curta, não a perna POP→origin.
- **Recomendação**: dado o volume de tráfego atual (~437 requests/7 dias em `dev`), o custo extra de
  `PriceClass_All` é desprezível em termos absolutos, e o ganho (TLS mais perto do usuário + os assets
  estáticos do SPA cacheados num POP brasileiro) é real, ainda que modesto para o tráfego de API. Para
  um ambiente `dev`/baixo tráfego, **não há urgência** — o ganho não seria perceptível dado o volume
  atual. Mas é uma mudança barata o suficiente (uma linha de Terraform, sem migração de dados, sem
  mudança de arquitetura) que vale considerar antes de qualquer lançamento com usuários reais no
  Brasil, especialmente porque melhora diretamente o carregamento do SPA (asset estático, já
  cacheável) que é a primeira experiência de qualquer usuário.

**Decisão B — origin em `us-east-1` vs `sa-east-1`** (migração de backend, fora do escopo deste item):
- Isso não é uma configuração de CloudFront — é mover Lambdas, API Gateway, DynamoDB e toda a stack
  Terraform (`infra/`) para outra região. Envolve replicação/migração de dados, possível downtime,
  revisão de todos os ARNs/recursos region-bound (KMS, SES, layers ADOT pinados em `us-east-1` per
  `dev.tfvars`), e um esforço de ordens de grandeza maior que ajustar um `price_class`.
  Este item (PERF-06) mede a arquitetura de edge, não decide sobre migração de backend.
- §3 mostra que, mesmo hoje, o gargalo dominante na latência de API para o Brasil é o RTT até
  `us-east-1`, não o hop de CloudFront — então tecnicamente uma migração para `sa-east-1` *reduziria*
  essa parcela. Mas essa é uma decisão de arquitetura/infra com trade-offs próprios (custo, esforço,
  disponibilidade de serviços AWS equivalentes em `sa-east-1`, dependências já fixadas em
  `us-east-1` como o layer ADOT) que precisa de sua própria análise dedicada — **não está sendo
  recomendada nem decidida aqui**.

## Conclusão / exit criterion

- PriceClass atual confirmado: `PriceClass_100`.
- Cache: confirmado via config real que toda rota de API usa `CachingDisabled` (nenhum HIT possível
  por design, consistente com Full BFF/sessão por usuário); único cache real é o SPA estático via
  `CachingOptimized`. Métrica `CacheHitRate` não está habilitada na distribuição (0 datapoints);
  `Requests` usado como proxy de volume (~437/7 dias, tráfego de dev muito baixo).
- Benchmark Brasil: medido com a máquina real confirmada no Brasil (Belo Horizonte, via IP
  geolocation) — CloudFront (`PriceClass_100`, sem POP brasileiro) não mostrou vantagem de latência
  sobre acesso direto ao origin (~0.56s vs ~0.48s de média, diferença dentro do ruído); consistente
  com a análise de cache (nada é cacheado, então o hop de edge não elimina o RTT até `us-east-1`).
- Recomendação entregue: considerar `PriceClass_All` antes de lançamento com usuários reais no
  Brasil (custo baixo dado o volume atual, ganho real para os assets estáticos do SPA); migração de
  origin para `sa-east-1` explicitamente **fora de escopo** e não avaliada como decisão a tomar aqui.
- Nenhuma mudança de infraestrutura foi aplicada — este item foi só medição/análise, conforme
  escopo.

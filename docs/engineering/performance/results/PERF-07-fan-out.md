# PERF-07 — Fan-out de requests por tela

Ciclo B do programa de performance (`docs/engineering/performance/TODO.md`). Objetivo: inventariar,
por tela principal, quantos requests HTTP distintos disparam no mount, classificar o padrão
(paralelo vs. sequencial/waterfall) e definir o critério para quando um endpoint composto/BFF-agregado
se justificaria — **sem construir esse endpoint agora** (instrução explícita do plano: "não criar
GraphQL improvisado"). Esta fatia é só inventário + critério.

## Método

Fonte primária: leitura direta dos componentes de rota em `frontend/src/routes/**/*.tsx`, cruzando
cada `useXxx()` chamado no corpo do componente (não em callback/dialog) com o inventário de 37 hooks
do PERF-10 (`results/PERF-10-query-cache.md`) para saber a classe de freshness e confirmar que é de
fato um `useQuery`. "Dispara no mount" = chamado incondicionalmente (ou com `enabled` derivado só de
parâmetros de rota/estado inicial, nunca de uma ação do usuário) no corpo da função do componente de
tela. Hooks chamados dentro de diálogos/expansores que só montam sob interação (ex.:
`SubscriptionHistoryDialog`, formulário de criação) **não contam** como fan-out do mount da tela —
são on-demand por natureza, não um problema de "tela carrega N coisas de uma vez".

Contagem de requests HTTP cruza com os números já medidos em PERF-03 (nº de requests por jornada,
mock local) e latências reais por endpoint do PERF-04 (BFF real, `dev`). PERF-03 inclui outros
requests que não são `useQuery` de dados de negócio (documento HTML, bundle JS/CSS, `/bff/session`
compartilhado entre `AuthContext`/`ActiveOrganizationContext` com `staleTime: 30s` — 1 request
reaproveitado, não N) — por isso o número de "hooks que disputam dados" abaixo é menor que o "nº
requests" total do PERF-03 por jornada.

## Inventário por tela

| Tela (jornada PERF-03) | Hooks/requests disparados no mount | Padrão | Fonte |
|---|---|---|---|
| Overview (J01) | `useItemsDashboardBounded("ACTIVE")` + `useStorageQuota()` (card condicional, só renderiza se `warningLevel != OK`, mas a query roda sempre) | **Paralelo** — 2 hooks, nenhum depende do outro (nenhum usa `data` de outro como input) | `routes/Overview.tsx:34,60` |
| Items Collection (J02) | `useItemsDashboardPage(status)` | 1 hook — não há fan-out | `routes/items/ItemsCollection.tsx:116` |
| Subjects Collection (J03) | `useSubjectsDashboard(status)` | 1 hook — não há fan-out | `routes/subjects/SubjectsCollection.tsx:52` |
| Subject Hub (J04) | `useSubject(subjectId)` + `useSubjectCompliance(subjectId)` + `useRequirementsForSubject(subjectId)` + `useRequirementAssignments(subjectId)` + `useDocumentRequestSeries(subjectId)` | **Paralelo** — 5 hooks, todos usam `subjectId` vindo direto do param de rota (`useParams`), nenhum espera o resultado de outro | `routes/subjects/SubjectHub.tsx:38-49` |
| Requirements Collection (J05) | Filtro "todos": `useRequirementsForSubject(filterSubjectId)` (só se filtrado por subject) + `useRequirementsSearch` × até 4 buckets de status (`MISSING`/`PENDING`/`SATISFIED`/`NOT_SATISFIED`) via flags `enabled` mutuamente exclusivas | **Paralelo** — até 4-5 hooks simultâneos, `enabled` deriva só de `filterSubjectId`/`isAll` (estado inicial da URL), nenhuma dependência de resultado de outro | `routes/RequirementsCollection.tsx:74-86` |
| Document Detail (J06) | `useDocument(documentId)` + `useDocumentVersions(documentId)` | **Paralelo** — 2 hooks, ambos usam `documentId` do param de rota | `routes/DocumentDetail.tsx:76-77` |
| Reports (J07) | `useReportSubscriptions(enabled)` — `useMembers()` e `useReportSubscriptionRuns(...)` só disparam dentro do diálogo de criação/histórico (on-demand, não no mount da tela) | 1 hook no mount — não há fan-out | `routes/Reports.tsx:174,262,321` |
| Notification Preferences (J08) | `useNotificationPreferences()` | 1 hook — não há fan-out | `routes/NotificationPreferences.tsx:143` |

**Todas as telas que disparam mais de 1 hook no mount usam o mesmo padrão: N queries paralelas, cada
uma alimentada por um parâmetro já disponível no momento do mount (route param ou estado inicial da
URL) — nunca o resultado de uma query anterior.** Não foi encontrado nenhum caso real de waterfall
sequencial (ex.: "buscar X, esperar resposta, usar `X.id` para buscar Y") em nenhuma das 8 jornadas
nem nas telas correlatas revisadas (`ItemDetail`, `ItemDocuments`, `ActivityLog`, `Members`,
`DocumentTypesCollection`, `RequirementTemplatesScreen` — mesma checagem rápida de imports/hooks
top-level, mesmo padrão: ou 1 query, ou N queries paralelas por param de rota).

### Por que isso não é surpresa

TanStack Query não impõe sequenciamento por padrão — cada `useQuery` dispara seu `fetch` assim que
`enabled` é true, independentemente dos outros hooks no mesmo componente. Um waterfall só apareceria
se o código explicitamente usasse `enabled: query1.data != null` para encadear (padrão comum quando
uma tela precisa do ID retornado por uma busca antes de poder buscar o detalhe). Essa busca
(`grep enabled.*\.data` nos hooks/rotas) não encontrou nenhuma ocorrência desse padrão nas telas
listadas — todo `subjectId`/`documentId`/`itemId` usado como input de query já vem do param de rota
(`useParams`), nunca de outra query.

## Custo real do fan-out paralelo (Subject Hub, pior caso — 5 hooks)

Usando os p50/p95 reais do PERF-04 (`GET /bff/api/subjects/{subjectId}` = 437ms/628ms — único
endpoint medido que corresponde a um dos 5 hooks; os outros 4 endpoints do Subject Hub
— `subjectCompliance`, `requirementsForSubject`, `requirementAssignments`, `documentRequestSeries`
— não foram incluídos no PERF-04 warm-test, então a estimativa abaixo assume latência semelhante,
não medida diretamente):

- **Se fossem sequenciais** (5 × ~450ms de latência real de BFF): ~2.250ms até a tela ficar completa.
- **Como são paralelos de fato**: tempo total até a tela ficar completa ≈ o mais lento dos 5, não a
  soma — ordem de grandeza de ~450-650ms (o mesmo p50/p95 de uma única chamada), não 5×.

Isso é consistente com o próprio J04 do PERF-03 (backend mockado, latência ~0ms): mesmo com 12
requests HTTP na jornada completa (bundle+sessão+5 hooks+afins), o tempo até conteúdo útil ficou em
180ms — porque o mock, como o BFF real por trás de Promise.all implícito do React Query, não soma
latências entre requests paralelos.

**Conclusão do custo**: o fan-out paralelo do Subject Hub (5 hooks) já se comporta, em termos de
tempo percebido, como 1 request lento — não como 5 somados. Não há economia de latência a ganhar
juntando os 5 em 1 endpoint composto; a economia possível seria só de overhead de conexão/protocolo
(≤1 round-trip TCP/TLS a menos, desprezível sobre HTTP/2 com conexão já quente ao mesmo host
CloudFront) e de 4 invocações Lambda a menos por carregamento de tela (custo de infraestrutura, não
de latência percebida pelo usuário).

## Critério de decisão para endpoint composto (para revisitar no futuro, não aplicado agora)

Uma tela só é candidata real a um endpoint composto/BFF-agregado quando **todas** as condições abaixo
são verdadeiras:

1. **Waterfall sequencial comprovado**: existe pelo menos uma query cujo `enabled`/parâmetro depende
   do `data` de outra query da mesma tela (não de um param de rota já disponível no mount) — ou seja,
   o encadeamento é inerente ao dado, não uma escolha de implementação evitável.
2. **Profundidade ≥ 2 saltos sequenciais** com pelo menos 1 deles custando ≥ ~300ms de latência real
   de BFF (ordem de grandeza do p50 medido no PERF-04: 263-477ms por endpoint) — 1 salto sequencial de
   latência baixa não justifica a complexidade operacional de um endpoint novo.
3. **Latência somada visível ao usuário**: soma dos saltos sequenciais ≥ ~800ms-1s no p50 (limiar
   onde a espera deixa de ser "instantânea" e começa a pedir um spinner dedicado/skeleton — heurística
   de percepção padrão, não um SLA formal deste programa) — abaixo disso, o ganho de UX de agregar não
   compensa o custo de manter mais um contrato de API.
4. **Sem solução mais barata disponível primeiro**: não existe uma forma de eliminar ou paralelizar o
   waterfall sem endpoint novo — ex.: (a) o segundo dado pode ser buscado por um param que já existe
   na URL/estado local (torna as 2 queries paralelas, elimina o waterfall sem nenhum endpoint novo);
   ou (b) o backend pode devolver o campo que faltava dentro da resposta já existente do primeiro
   endpoint (mudança de shape barata, não um agregador novo); só depois de descartar (a) e (b) um
   endpoint composto vira a opção mais barata restante.
5. **Dado logicamente coeso**: os dados agregados fazem sentido como "uma leitura" do ponto de vista
   do domínio (não é forçar 2 bounded contexts não relacionados numa resposta só por conveniência de
   rede) — evita reintroduzir o problema que o plano já nomeia como risco ("não criar GraphQL
   improvisado": um agregador genérico vira um segundo modelo de domínio paralelo ao BFF real).

Quando as 5 condições batem, a via preferida é endpoint composto **específico da tela** (um
BFF handler dedicado que já sabe exatamente quais 2-3 leituras agregar, com contrato fixo) — nunca
um endpoint GraphQL-like genérico de composição arbitrária, que é exatamente o anti-padrão que o
plano pede para evitar.

## Aplicação do critério às telas inventariadas

| Tela | Condição 1 (waterfall real)? | Candidata a endpoint composto? | Motivo |
|---|---|---|---|
| Overview | Não (2 hooks paralelos, nenhuma dependência) | **Não** | Nenhum waterfall — condição 1 falha de saída |
| Items Collection | Não (1 hook) | **Não** | Não há fan-out |
| Subjects Collection | Não (1 hook) | **Não** | Não há fan-out |
| Subject Hub | Não (5 hooks paralelos, todos por `subjectId` de rota) | **Não** | Condição 1 falha; mesmo sendo a tela com mais fan-out (5), é paralelo — tempo percebido ≈ 1 request, não 5 somados (ver seção de custo acima) |
| Requirements Collection | Não (até 5 hooks paralelos, `enabled` por estado de URL) | **Não** | Condição 1 falha |
| Document Detail | Não (2 hooks paralelos) | **Não** | Condição 1 falha |
| Reports | Não (1 hook no mount) | **Não** | Não há fan-out |
| Notification Preferences | Não (1 hook) | **Não** | Não há fan-out |

## Conclusão

**Nenhuma tela do app hoje justifica um endpoint composto.** Não existe nenhum waterfall sequencial
real em nenhuma das 8 jornadas nem nas telas correlatas revisadas — todo fan-out encontrado (o
máximo é Subject Hub, 5 hooks) é paralelo, alimentado por um parâmetro já disponível no mount (route
param), e o tempo percebido pelo usuário nesse caso já é dominado pela query mais lenta do grupo, não
pela soma — exatamente o comportamento que tornaria um endpoint composto desnecessário mesmo se a
condição 1 do critério fosse relaxada.

Isso confirma, do lado do fan-out de requests, a mesma leitura já registrada em PERF-03/PERF-09: a
alavanca de performance real deste app está no **bundle JS sem code-splitting histórico** (já resolvido
no PERF-09, ~46% de redução) e na **latência intrínseca por request do BFF** (~350-500ms p50, ver
PERF-04) — não em número excessivo de requests por tela. O critério acima fica documentado para
revisitar caso uma tela futura introduza de fato uma dependência sequencial entre queries (ex.: uma
nova tela que precise resolver um ID via busca antes de buscar o detalhe).

## Arquivos

- `docs/engineering/performance/results/PERF-07-fan-out.md` — este arquivo.
- Nenhum código alterado — fatia é só inventário/critério, sem endpoint novo (per instrução do plano).

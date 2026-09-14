# PERF-03 — Baseline frontend/browser (jornadas J01–J08)

## Contexto e escopo

Fatia final de PERF-03: medir TTFB/DCL/Load/LCP/CLS/JS transferred/nº requests/time-to-useful-data para as
8 jornadas J01–J08 do plano, com waterfalls de J01/J04/J06, e repetir J01/J04 sob Fast 4G + CPU throttling.
O bundle baseline (JS/CSS raw+gzip) já estava fechado em `results/PERF-03-bundle-baseline.md` e não foi
refeito aqui.

Medido contra o commit em `perf/performance-program-v1` (frontend com `dist/` já buildado, `npm run build`
prévio), Chromium via Playwright 1.62.1, viewport padrão, locale `pt-BR`/timezone `UTC` (mesma convenção do
`playwright.config.ts` do projeto).

## Ambiente e abordagem (item 1)

O `frontend/e2e/*.spec.ts` existente **não sobe nenhum backend real** — toda a suíte mocka o BFF via
`page.route()` (confirmado lendo `smoke.spec.ts`, `block3-subjects-requirements.spec.ts`,
`block5-document-detail.spec.ts`, `block8-notification-preferences.spec.ts`, `block10-reports-dossier-audit.spec.ts`),
servindo o frontend contra o `vite preview` local (`playwright.config.ts`, `baseURL: http://127.0.0.1:4173`).
Não há LocalStack, AWS nem qualquer chamada de rede real no fluxo de teste — nem mesmo em CI.

Reaproveitei exatamente esse padrão: subi `npm run preview -- --port 4173 --strictPort --host 127.0.0.1`
contra o `dist/` já existente e escrevi um harness Playwright standalone
(`docs/engineering/performance/traces/perf-03-journeys.mjs`, script Node ad-hoc, **não** um teste de
`frontend/e2e/`, não roda em CI) que mocka as mesmas rotas `**/bff/...` com os mesmos formatos de payload
vistos nos specs reais, navega por cada jornada e coleta os números via `performance.getEntriesByType`,
`PerformanceObserver` (`largest-contentful-paint`, `layout-shift`) e os eventos `response` do Playwright
(contagem de requests e bytes de JS transferido).

**Implicação importante para a leitura dos números**: como o "backend" é um mock local que responde em
~0–2ms, esta medição **não captura latência real de rede/API** — isso é objeto de PERF-04 (baseline
BFF/HTTP/Lambda). O que esta fatia mede com fidelidade é o **custo puro do frontend**: download do bundle,
parse/exec de JS, render React e re-render após a resposta (mesmo que instantânea) do React Query. Isso é
tratado explicitamente na seção de conclusão abaixo.

## Metodologia

- 3 execuções por jornada, sem throttling — valor reportado é a **mediana** das 3 (dados brutos das 3
  execuções estão em `traces/perf-03-results.json`).
- J01 e J04, adicionalmente, 1 execução sob **Fast 4G + CPU 4x** (`Network.emulateNetworkConditions`
  download ≈1.6 Mbps / upload ≈0.75 Mbps / latency 150ms via CDP, `Emulation.setCPUThrottlingRate rate: 4`)
  — single-run, não mediana (nota abaixo).
- `time-to-useful-data`: tempo desde `page.goto()` até o locator julgado "conteúdo principal visível" da
  tela ficar visível (ex.: `tbody tr` no Overview, "Conformidade" no Subject Hub) — julgamento por tela,
  documentado por jornada na tabela.
- `INP`: **não medido**. INP real exige interação humana cronometrada em produção (RUM); não há
  aproximação confiável via automação síncrona do Playwright que não seja fabricada. Marcado explicitamente
  como não medido em cada jornada, em vez de forjar um número.
- `JS parse/exec`: aproximado por `DCL - TTFB` (tempo entre a resposta do documento e
  `DOMContentLoaded`, no qual cai o parse do HTML + download/parse/exec do bundle síncrono, já que a app não
  tem code-splitting — ver PERF-03-bundle-baseline.md). Não há Chrome DevTools Protocol `Profiler` script
  coverage aqui; é uma aproximação por temporização, não um profile de CPU.

## Resultados por jornada (sem throttling, mediana de 3 execuções)

| Jornada | Rota final | TTFB (ms) | DCL (ms) | Load (ms) | LCP (ms) | CLS | JS transferido | nº requests | Time-to-useful-data (ms) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| J01 Login→Overview | `/overview` | 1,7 | 48,1 | 48,6 | 132 | 0,017 | 489.013 B (477,6 KB) | 7 | 164 |
| J02 Overview→Items | `/items` | 1,4 | 42,7 | 42,8 | 108 | 0,017 | 489.013 B | 8 | 201 |
| J03 Overview→Subjects | `/subjects` | 1,4 | 35,5 | 35,5 | 120 | 0,001 | 489.013 B | 9 | 162 |
| J04 Subjects→SubjectHub | `/subjects/subj-1` | 1,4 | 43,6 | 43,6 | 108 | 0,001 | 489.013 B | 12 | 180 |
| J05 SubjectHub→Requirements | `/requirements?subjectId=subj-1` | 1,2 | 40,5 | 40,5 | 124 | 0,001 | 489.013 B | 13 | 152 |
| J06 Requirements→DocumentDetail | `/documents/doc-1` (via `/requirements`) | 1,4 | 42,8 | 42,9 | 112 | 0,001 | 489.013 B | 10 | 109 |
| J07 Reports | `/reports` | 1,2 | 42,0 | 42,5 | 132 | 0,0005 | 489.013 B | 6 | 120 |
| J08 Settings (notificações) | `/settings/notifications` | 1,6 | 46,4 | 46,4 | 120 | 0 | 489.013 B | 6 | 120 |

`INP`: não medido em nenhuma jornada (ver Metodologia). `JS parse/exec` (aprox. DCL − TTFB): ~34–45ms em
todas as jornadas — consistente com bundle único sem code-splitting sendo parseado/executado a cada
navegação completa de página (cada jornada aqui é um `page.goto()` fresh, não uma navegação client-side
subsequente).

Todas as jornadas transferem o **mesmo total de JS** (489.013 B) porque não há code-splitting por rota —
confirma a conclusão de `PERF-03-bundle-baseline.md`: o bundle inteiro é baixado independente de qual
jornada o usuário está navegando.

## J01 e J04 sob Fast 4G + CPU throttling (execução única)

| Jornada | TTFB (ms) | DCL (ms) | Load (ms) | LCP (ms) | Time-to-useful-data (ms) |
|---|---:|---:|---:|---:|---:|
| J01 (unthrottled, mediana) | 1,7 | 48,1 | 48,6 | 132 | 164 |
| J01 (Fast 4G + CPU 4x) | 1,8 | 1.155 | 1.155,1 | 1.492 | 1.615 |
| J04 (unthrottled, mediana) | 1,4 | 43,6 | 43,6 | 108 | 180 |
| J04 (Fast 4G + CPU 4x) | 1,8 | 1.150,9 | 1.151,2 | 1.596 | 1.832 |

Sob throttling, DCL/Load sobem **~24x**, LCP **~11–15x**, time-to-useful-data **~10x**. TTFB fica
praticamente igual (a resposta HTML inicial é pequena e o mock não adiciona latência de rede real além da
simulada) — o custo inteiro do throttling recai sobre o **download do bundle JS de 477,6 KB** em ~1,6 Mbps
simulado e o **parse/exec sob CPU 4x mais lento**, não sobre chamadas de API (que continuam mockadas e
respondendo quase instantaneamente mesmo sob throttling de rede, pois passam por `page.route()` e nunca
saem do processo do Playwright).

**Nota de honestidade metodológica**: J01/J04 throttled são execução única (não mediana de 3), por corte de
tempo — os números têm mais ruído potencial que as medições unthrottled. Suficiente para a ordem de
grandeza do problema (bundle-bound sob rede lenta), mas não para comparação estatística fina.

## Waterfalls (item 3)

Playwright `page.screenshot()` não captura waterfall de rede. Optei por **HAR** (`context.recordHar`,
`content: "embed"`, inclui corpo das respostas) como substituto — abrível em qualquer HAR viewer ou na aba
Network do DevTools ("Import HAR"). Também salvei um screenshot da tela final de cada jornada para contexto
visual.

Artefatos em `docs/engineering/performance/screenshots/`:
- `J01-waterfall.har` + `J01-screenshot.png`
- `J04-waterfall.har` + `J04-screenshot.png`
- `J06-waterfall.har` + `J06-screenshot.png`

## Conclusão: frontend vs. espera de API (critério de saída)

Com o backend mockado (latência ~0–2ms, sem chamada de rede real saindo do processo), **toda a duração
observada acima é, por construção, tempo de frontend** — download+parse+exec de JS, render React inicial e
re-render após a resposta (instantânea) do React Query. Isso não é uma limitação escondida: é o ponto —
com o backend real fora do escopo desta fatia, qualquer "espera de API" que sobrar nestes números é
artefato de mock, não sinal real.

A decomposição possível a partir do que foi medido:

- **Sem throttling**: ~35–48ms até DCL (download HTML + parse/exec do bundle síncrono já em cache do
  navegador/preview local) e mais ~70–160ms até o conteúdo útil aparecer (render React + roundtrip ao mock,
  este último desprezível). **Praticamente 100% frontend** neste cenário — não há uma "espera de API" real
  para separar porque a API não existe de verdade aqui.
- **Sob Fast 4G + CPU throttling**: o salto de ~48ms→1.155ms em DCL e ~164ms→1.615ms em time-to-useful-data
  é quase inteiramente explicado por **download do bundle de 477,6 KB em rede lenta simulada** + **parse/exec
  sob CPU 4x throttled** — de novo, não é espera de API (o mock responde igual de rápido sob throttling de
  rede, já que nunca atravessa a rede real).

**A separação real "frontend vs. espera de API real"** só pode ser fechada combinando esta fatia com
PERF-04 (latência p50/p75/p90/p95/p99 do BFF/Resource Lambda contra a AWS real) — aí sim have-se o número
de rede+backend real para subtrair do tempo total de uma jornada ponta-a-ponta. O achado concreto e honesto
desta fatia isolada é: **o principal alavanca de performance percebida hoje está no frontend
(bundle sem code-splitting, ~478 KB JS único, baixado inteiro em toda jornada)** — sob rede real de
usuário (não localhost), esse bundle sozinho já é responsável por >1s de atraso antes de qualquer resposta
de API entrar em jogo, como mostra o throttled run. Isso reforça a recomendação já registrada em
`PERF-03-bundle-baseline.md`: route-based code-splitting via `React.lazy` é o candidato mais direto para
reduzir o tempo de frontend nas 8 jornadas, antes mesmo de otimizar o backend.

## O que ficou de fora / follow-up

- **INP real**: não medido (nem aproximado) em nenhuma jornada — requer telemetria de interação real de
  usuário (RUM), fora do alcance de automação síncrona sem fabricar dado. Follow-up natural: ativar o
  scaffolding de CloudWatch RUM já preparado em PERF-02 (`frontend/src/observability/rum.ts`) quando a
  infra de RUM existir.
- **Throttled apenas para J01/J04** (conforme escopo do item), execução única (não mediana) por corte de
  tempo — as demais 6 jornadas (J02, J03, J05–J08) só têm números unthrottled. Follow-up: repetir com
  throttling se o programa julgar necessário antes de otimizar.
- **JS parse/exec** é aproximado por `DCL − TTFB`, não por um profile de CPU real (`Performance.getEntries`
  não separa parse de execução de forma limpa em runtime; um profile via CDP `Profiler.start/stop` daria um
  número mais preciso, não feito aqui por escopo/tempo).
- Nenhuma chamada de rede real contra o BFF/AWS foi feita nesta fatia (ver seção "Ambiente e abordagem")
  — isso é esperado e intencional, não uma lacuna a fechar aqui; é o objeto de PERF-04.

## Como reproduzir

```bash
cd frontend
npm run build
npx vite preview --port 4173 --strictPort --host 127.0.0.1 &
node ../docs/engineering/performance/traces/perf-03-journeys.mjs
# resultados brutos: docs/engineering/performance/traces/perf-03-results.json
# HARs/screenshots: docs/engineering/performance/screenshots/J0{1,4,6}-*
```

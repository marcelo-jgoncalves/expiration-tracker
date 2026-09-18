# PERF-14 — Regression gates (fatia 1: bundle budget CI + Lighthouse CI)

## Contexto e escopo

Fatia isolada de PERF-14 (item de fechamento — `docs/engineering/performance/TODO.md`, "###
PERF-14": "bundle budget CI, Lighthouse CI, k6 smoke em PR, synthetic canaries, alarms de
latência/throttle/backlog, dashboard consolidado — só depois de baseline confiável existir").
Só os 2 sub-itens abaixo têm baseline confiável já fechado (PERF-03/09 para bundle, PERF-03
para frontend/browser) e nenhuma dependência de infra ainda não provisionada:

1. **Bundle budget CI gate** — feito.
2. **Lighthouse CI gate** — feito.

Os outros 4 sub-itens de PERF-14 seguem **bloqueados/pendentes** (ver seção final) — bloqueados
pela quota de Lambda Concurrent Executions ainda em 10 na conta `dev` (PERF-01, pendente de ação
manual do Marcelo) ou por infra ainda não provisionada. Não foram tentados nesta fatia.

Medido contra o commit `7eff2f8` (branch `perf/performance-program-v1`, já mesclado em `develop`
via PR #319).

## 1. Bundle budget CI gate

### O que foi feito

Script Node standalone `frontend/scripts/check-bundle-budget.mjs` (~90 linhas, sem nova
dependência de produção — usa só `node:fs`/`node:zlib` da stdlib), rodado depois do `npm run
build` no job `frontend` do `.github/workflows/ci.yml`. Falha (`exit 1`) se o **chunk de
entrada** (`dist/assets/index-*.js` + `dist/assets/index-*.css` — o par shell/router/auth/
providers que todo visitante baixa antes de qualquer rota renderizar, ver PERF-09) exceder o
orçamento.

**Decisão de escopo**: o gate mede só o chunk de entrada, não o agregado de todos os chunks lazy
de rota. Depois do code splitting do PERF-09 (~30 rotas em `React.lazy`), o agregado de todos os
chunks **deve** crescer conforme a app ganha funcionalidade — isso é o ponto do code splitting, e
orçar o agregado penalizaria adicionar telas em vez de pegar regressão real (ex.: um import
pesado acidentalmente aterrissando no shell em vez de numa rota lazy).

**Por que script custom em vez de `bundlesize`/`size-limit`**: um gate de ~90 linhas cobrindo
exatamente 1 verificação (2 arquivos, 2 limites) é menos overhead que uma nova devDependency com
sua própria superfície de configuração/API para manter atualizada — mesmo raciocínio já usado
para `scripts/check-spa-build-artifacts.mjs` (ADR-0011) nesse mesmo job.

### Orçamento definido e por quê

Baseline pós-PERF-09 (`PERF-03-bundle-baseline.md`, seção "depois do code splitting"): chunk de
entrada **~280,8 KB raw / ~86,7 KB gzip**.

| | Baseline | Orçamento | Headroom |
|---|---:|---:|---:|
| Raw | 280,8 KB | **330 KB** | +17,5% |
| Gzip | 86,7 KB | **100 KB** | +15,3% |

Headroom de ~15–18% (dentro da faixa 10–20% sugerida) dá espaço para crescimento incremental
normal do shell (novo provider de contexto, nova lib pequena no App.tsx) sem mascarar uma
regressão real. Números redondos (330 KB / 100 KB) em vez de percentuais exatos, para o limite
ser legível de cabeça na saída do CI sem fazer conta.

### Verificação local

```
$ cd frontend && npm run build && node scripts/check-bundle-budget.mjs
[bundle-budget] Entry chunk files:
  index-BhwVWl8o.js: raw=254.3KB gzip=80.6KB
  index-Bu3B8eUA.css: raw=20.0KB gzip=4.2KB
[bundle-budget] Total: raw=274.4KB (budget 330KB), gzip=84.8KB (budget 100KB)
[bundle-budget] OK — entry chunk within budget.
```

**PASSA** hoje, com margem confortável (274,4 KB / 330 KB raw = 83% do orçamento; 84,8 KB /
100 KB gzip = 85% do orçamento) — números levemente abaixo do baseline do PERF-09 (280,8/86,7 KB)
porque o build medido aqui é de um commit ligeiramente diferente (pós-merge PR #319), variação
esperada e dentro do ruído normal, não uma regressão.

## 2. Lighthouse CI gate

### O que foi feito

`@lhci/cli@0.15.1` adicionado como devDependency de `frontend/`. Configurado via
`frontend/lighthouserc.json`:

- `collect.staticDistDir: "./dist"` — Lighthouse CI sobe seu próprio servidor estático local
  contra o `dist/` já buildado, sem precisar de `vite preview` nem de qualquer backend real
  (opção mais simples que reusar o harness `vite preview` do PERF-03, já que aqui não há
  necessidade de mockar rotas `/bff/*` — ver ressalva abaixo sobre a rota medida).
- `url: ["http://localhost/index.html"]`, `numberOfRuns: 3` (mediana das 3, reduz ruído de uma
  única execução).
- `preset: "desktop"` (perfil de máquina de referência do PERF-00, não mobile).
- Categorias avaliadas: `performance`, `accessibility`, `best-practices` (SEO fora de escopo,
  app é atrás de login, não indexável por design).

Wired no job `frontend` de `.github/workflows/ci.yml`, step "Lighthouse CI (PERF-14)", logo após
o step de bundle budget (que já roda após `npm run build`) e antes do dependency audit.

### Ressalva importante: qual rota é medida

A app é inteiramente gated por autenticação (`ProtectedRoute` → Cognito via full-page redirect,
`frontend/src/auth/ProtectedRoute.tsx`). Sem um BFF real (e este gate deliberadamente não sobe
nenhum backend, real ou mockado), não é possível chegar à tela "Overview" autenticada e
renderizada com dados. O Lighthouse CI aqui mede a **navegação inicial em `/`** — carregamento do
mesmo chunk de entrada, mesmo shell/router/AppShell/providers, até o estado estrutural de
loading/redirect do `ProtectedRoute` (`InitialLoading`, ver `ProtectedRoute.tsx`) — que é
exatamente a mesma carga de bundle/parse/render que a tela Overview real teria antes de
seus próprios dados chegarem. Isso ainda serve como rede de regressão honesta para o custo de
carregamento do frontend (o que este gate existe para proteger), mas **não é** uma medição da
tela Overview com conteúdo real renderizado — diferente do harness Playwright do PERF-03, que
mockava o BFF para chegar lá. Documentado aqui para não confundir um leitor futuro.

### Limiares definidos e por quê

**Distinção crítica**: os números do PERF-03 (`PERF-03-frontend-baseline.md`) — LCP ~132ms/CLS
~0,017 para J01 — vêm de medição real via Playwright/`performance.getEntriesByType` contra um
BFF **mockado respondendo em ~0–2ms**, sem qualquer throttling de rede/CPU (exceto a repetição
isolada sob Fast 4G+CPU4x). Lighthouse usa sua **própria simulação de throttling lab** (mesmo com
`preset: "desktop"`, aplica alguma limitação de CPU/rede simulada por padrão) e sua própria
metodologia de scoring — os números absolutos de LCP/CLS que o Lighthouse produz **não são
comparáveis diretamente** aos números do PERF-03. Por isso os limiares abaixo são deliberadamente
frouxos — servem como rede de regressão grosseira (detectar uma queda grande, não validar um
número específico), não como réplica dos números do PERF-03.

| Categoria | Limiar | Por quê |
|---|---:|---|
| `performance` | `>= 0.80` | Frouxo de propósito — score Lighthouse é sensível a fatores que não são regressão de código (variação de CPU do runner do CI, versão do Chrome). 0.8 ainda pega uma queda real grande sem gerar falso positivo por ruído. |
| `accessibility` | `>= 0.80` | Rede de regressão básica — não valida a11y a fundo (fora de escopo desta fatia), só evita que uma mudança quebre algo estrutural (contraste, labels). |
| `best-practices` | `>= 0.80` | Idem — rede básica (HTTPS, console errors, etc.), não auditoria completa. |

### Verificação local

```
$ cd frontend && npx lhci autorun
...
Running Lighthouse 3 time(s) on http://localhost:PORT/index.html
Run #1...done.
Run #2...done.
Run #3...done.
Checking assertions against 1 URL(s), 3 total run(s)
All results processed!
Done running autorun.
[exited with code 0]
```

Scores reais das 3 execuções (lidos dos relatórios JSON em `.lighthouseci/`, não commitados —
adicionado a `frontend/.gitignore`):

| Run | performance | accessibility | best-practices | LCP (ms) | CLS |
|---|---:|---:|---:|---:|---:|
| 1 | 1.00 | 1.00 | 0.96 | 384,5 | 0 |
| 2 | 1.00 | 1.00 | 0.96 | 398,3 | 0 |
| 3 | 1.00 | 1.00 | 0.96 | 397,3 | 0 |

**PASSA** hoje, com folga larga em relação aos limiares de 0,80 — esperado, já que a página
medida (shell + redirect estrutural) é leve e os limiares foram fixados frouxos de propósito
(ver seção acima). O LCP de ~385–398ms medido pelo Lighthouse não deve ser comparado ao LCP de
~132ms do PERF-03 (J01) — metodologias diferentes, ver ressalva acima.

## Confirmação: nada quebrou

- `npm run typecheck` (frontend) — OK, sem erros.
- `npm run lint` (frontend) — OK, sem erros/warnings.
- `npm test` (frontend, vitest) — **407/407 testes passando** (50 arquivos), sem alteração.
- `npm audit --omit=dev --audit-level=high` (frontend) — 0 vulnerabilidades (produção).
- YAML do `.github/workflows/ci.yml` validado via parse (`js-yaml`, `actionlint` não disponível
  no ambiente) — carrega sem erro, ordem dos steps no job `frontend` confirmada (bundle budget e
  Lighthouse CI rodam depois de "Build (production bundle)" e antes dos audits de dependência).

## Arquivos alterados

- `frontend/scripts/check-bundle-budget.mjs` (novo)
- `frontend/lighthouserc.json` (novo)
- `frontend/package.json` / `frontend/package-lock.json` (`@lhci/cli` como devDependency)
- `frontend/.gitignore` (`.lighthouseci/` ignorado)
- `.github/workflows/ci.yml` (2 steps novos no job `frontend`)
- `docs/engineering/performance/TODO.md` (2 sub-itens de PERF-14 marcados `[x]`)

## Os 4 itens restantes de PERF-14 — bloqueados/pendentes

Nenhum destes foi tentado nesta fatia (fora de escopo explícito):

1. **k6 smoke em PR** — bloqueado pela mesma quota de Lambda Concurrent Executions ainda em 10
   na conta `dev` (PERF-01: "Pendente de ação manual do Marcelo"). Rodar k6 em PR real contra
   `dev`, mesmo em baixo volume, arrisca throttling na conta compartilhada por 62+10 funções —
   já houve 1 throttle real registrado no PERF-01. Não deve ser feito antes do aumento de quota.
2. **Synthetic canaries** — requer infra de execução periódica (CloudWatch Synthetics ou
   equivalente) ainda não provisionada; também depende da mesma quota de concorrência para não
   competir com tráfego real.
3. **Alarms de latência/throttle/backlog** — depende de as métricas EMF customizadas do PERF-02
   (`bff.session_resolve_ms`, `lambda.request_context_ms`, etc.) estarem de fato chegando ao
   CloudWatch nesta conta — achado do PERF-04/PERF-08: **não estão** (nenhum namespace
   `ExpirationTracker/BFF`/`RequestContext`/`Items`/`Subjects` existe hoje). Alarmar sobre
   métricas que não existem não é possível; requer investigar e resolver esse gap primeiro
   (possível interferência do ADOT na extração EMF, já anotado como pendente no PERF-04).
4. **Dashboard consolidado** — depende dos itens 2 e 3 acima (canaries + métricas reais) para ter
   dado real a consolidar; um dashboard vazio/parcial não cumpriria o objetivo do item.

Estes 4 continuam listados como pendentes em `docs/engineering/performance/TODO.md`, não
marcados como concluídos.

## Revalidacao de observabilidade - 2026-09-18

A premissa de bloqueio registrada acima ficou obsoleta apos deploys posteriores. A conta `dev`
agora publica metricas nos namespaces `ExpirationTracker/BFF`, `ExpirationTracker/RequestContext`,
`ExpirationTracker/Items` e `ExpirationTracker/Subjects`, e o dashboard `exptrk-dev-operations`
esta implantado. A medicao real de sete dias mostrou, fora das janelas de carga intencional, p95
horario de aproximadamente 300-820 ms no proxy BFF, 180-424 ms em RequestContext, 258-592 ms
em Items e 432-742 ms em Subjects.

O modulo `observability-dashboard` passou a incluir graficos p95 dessa decomposicao e quatro
alarmes de regressao sustentada. Os limiares sao 1.500 ms (BFF proxy), 750 ms (RequestContext),
1.000 ms (Items) e 1.500 ms (Subjects), exigindo tres janelas consecutivas de cinco minutos.
Dados ausentes nao disparam alarme, pois o trafego de `dev` e intermitente. Latencia e backlog
ficam cobertos; o fechamento de throttling e synthetic canaries permanece independente.

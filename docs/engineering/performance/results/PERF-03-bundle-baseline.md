# PERF-03 — Bundle baseline (JS/CSS raw + gzip)

## Contexto

Fatia isolada de PERF-03: só medir o bundle atual de produção (`npm run build` do `frontend/`), sem
navegador/Lighthouse/Playwright (isso é coberto em outras fatias do mesmo item do TODO).

Medido contra o commit `00e3da004d9aae5f49a9fa0e206c4f58896f3a9c` (branch `perf/performance-program-v1`),
com `npm run build` (`tsc --noEmit && vite build`, Vite 5.4.21). Build concluído sem erros.

## Resultado por arquivo

| Arquivo | Raw (bytes) | Raw (KB) | Gzip (bytes) | Gzip (KB) |
|---|---:|---:|---:|---:|
| `assets/index-82j51kQO.js` | 489.013 | 477,6 KB | 136.530 | 133,3 KB |
| `assets/index-C4LVtUZ1.css` | 40.801 | 39,8 KB | 6.963 | 6,8 KB |
| `index.html` | 1.169 | 1,1 KB | 681 | 0,7 KB |

(KB acima em KiB, 1024 bytes — consistente com o número reportado pelo próprio Vite no build.)

## Totais

| Categoria | Raw | Gzip |
|---|---:|---:|
| JS total | 477,6 KB | 133,3 KB |
| CSS total | 39,8 KB | 6,8 KB |
| **Grand total (JS+CSS)** | **517,4 KB** | **140,1 KB** |
| Grand total incl. `index.html` | 518,5 KB | 140,8 KB |

## Code-splitting

**Não há code-splitting** — o build emite um único chunk JS (`index-82j51kQO.js`, 489 KB raw) e um único
CSS (`index-C4LVtUZ1.css`). Não há `manualChunks`, `React.lazy`/`import()` dinâmico detectado no build, nem
plugin de bundle visualizer (`rollup-plugin-visualizer` ou similar) configurado em `frontend/vite.config.ts`
— o `vite.config.ts` atual só tem `@vitejs/plugin-react` e o proxy de dev do BFF, nada relacionado a
bundling/análise. Isso significa que os números acima já são o "worst case" de payload inicial: toda a app
(todas as rotas J01–J08) é baixada em uma única request JS, não há benefício de lazy-loading por rota ainda.

## Comparação com a referência do plano

Referência do plano: **~480 KB raw / ~135 KB gzip** (presumivelmente JS+CSS combinados, dado que é o valor
citado junto do item "bundle baseline").

- **Raw**: 517,4 KB medido vs. ~480 KB de referência → **~8% acima** da referência.
- **Gzip**: 140,1 KB medido vs. ~135 KB de referência → **~4% acima** da referência.

Está **em linha, ligeiramente acima** da referência do plano — não é um desvio grande, mas não está abaixo
dela. Como não há code-splitting, todo esse peso é carregado na primeira visita (nenhuma rota adia
JS/CSS). Se o objetivo do programa de performance incluir reduzir abaixo da referência, o candidato mais
óbvio de otimização (fora do escopo desta fatia de medição) é introduzir `React.lazy`/route-based splitting
para as jornadas J01–J08, já que hoje 100% do JS é bundle único.

## PERF-09 — depois do code splitting

Medido no mesmo branch (`perf/performance-program-v1`), após implementar PERF-09 (route-level
`React.lazy`/`Suspense`, `rollup-plugin-visualizer`, prefetch seletivo em idle). Mesma metodologia
(raw + gzip por arquivo via `npm run build` + leitura direta de `dist/assets/`).

### Antes vs. depois

| Métrica | Antes (PERF-03) | Depois (PERF-09) |
|---|---:|---:|
| Nº de chunks JS | 1 | 63 |
| Nº de chunks CSS | 1 | 17 |
| JS total (raw / gzip) | 477,6 KB / 133,3 KB | 501,5 KB / 173,3 KB |
| CSS total (raw / gzip) | 39,8 KB / 6,8 KB | 40,3 KB / 11,6 KB |
| **Grand total JS+CSS (raw / gzip)** | **517,4 KB / 140,1 KB** | **541,8 KB / 184,8 KB** |
| **Carga inicial (chunk de entrada, raw / gzip)** | 517,4 KB / 140,1 KB (bundle único = tudo) | **~277,3 KB / ~83,7 KB** (`index` JS + `index` CSS) |

(Totais "depois" recalculados via leitura direta de `dist/assets/`, mesma unidade KiB do
baseline. O aumento no total agregado — ~25 KB raw, ~45 KB gzip — é overhead esperado do
code-splitting: por-chunk module wrappers/preamble do Rollup e pior taxa de compressão gzip por
arquivo pequeno isoladamente; o que importa para a métrica de performance real é a carga
**inicial**, não a soma de tudo que só é baixado sob demanda.)

### Carga inicial: detalhe

O chunk de entrada (`index-*.js` + `index-*.css`, tudo que carrega antes de qualquer rota
renderizar) caiu de **517,4 KB → ~277,3 KB raw** (~46% menor) e **140,1 KB → ~83,7 KB gzip**
(~40% menor):

| Arquivo | Raw (KB) | Gzip (KB) |
|---|---:|---:|
| `assets/index-DH877bgr.js` (shell/router/auth/AppShell/providers) | 260,3 | 82,5 |
| `assets/index-Bu3B8eUA.css` | 20,5 | 4,2 |
| **Total carga inicial** | **~280,8** | **~86,7** |

(A rota `/overview`, primeiro destino real após o redirect de `/`, adiciona seu próprio chunk
pequeno — `Overview-*.js`, 2,6 KB raw / 1,2 KB gzip — levando a "primeira tela útil" a ~283,4 KB
raw / ~87,9 KB gzip, ainda assim bem abaixo do bundle único anterior.)

O restante do JS (as ~35 rotas/telas + seus sub-chunks de dependência compartilhada, ex.
`Tracking`, `ImportWizard`, `SubjectRequests`) só é baixado quando o usuário efetivamente navega
até essa rota — ou, para `items`/`subjects`, um pouco antes, via o prefetch em idle (ver abaixo).

### O que foi feito

1. **Code splitting por rota** (`frontend/src/App.tsx`): toda tela de rota top-level (Overview,
   Items* , Subjects*, Requirements, Reviews, DocumentDetail, DocumentTypes*, RequirementTemplates,
   Members, Settings, ActivityLog, NotificationPreferences, AcceptInvitation, NotFound, Reports,
   Guest*, ImportWizard) virou `React.lazy(() => import(...))`, uma árvore `<Routes>` envolta em
   um único `<Suspense fallback={<InitialLoading />}>` (reusando o componente de loading já
   existente em `components/AsyncStates.tsx`, nenhum spinner novo foi criado). Shell/gating
   (`AppShell`, `ProtectedRoute`, `OrgRouteGuard`, `AuthProvider`, `ActiveOrganizationProvider`,
   `ToastProvider`, o próprio router) permanece no bundle principal, como esperado.
2. **Bundle analyzer**: `rollup-plugin-visualizer` adicionado como devDependency e configurado em
   `frontend/vite.config.ts`, emitindo `dist/stats.html` (treemap, com gzip/brotli) a cada build.
3. **Prefetch seletivo em idle** (`frontend/src/routing/prefetch.ts`): ao montar a rota Overview,
   agenda via `requestIdleCallback` (fallback `setTimeout`) o `import()` dos chunks de
   `ItemsCollection` e `SubjectsCollection` — os dois destinos de navegação mais prováveis a
   partir da Overview (CTAs "Ver todos os vencimentos"/links de item, e "Fornecedores" é o outro
   item de topo da navegação junto de "Vencimentos"). Escopo deliberadamente restrito a esses 2
   alvos, não a todas as rotas.

### Testes

`npm run typecheck`, `npm run lint` e `npm run test` (407 testes, 50 arquivos) passam sem
alteração. Um subconjunto do e2e (`smoke`, `expiration-vertical-slice`,
`block3-subjects-requirements`, `block10-reports-dossier-audit` — 48 testes) passa sem nenhuma
flakiness nova causada pelo `Suspense` boundary; o suite completo de e2e não foi rodado nesta
fatia (ver task notes do PERF-09).

## Como reproduzir

```bash
cd frontend
npm run build
ls -la dist/assets/
for f in dist/assets/*; do
  raw=$(stat -c%s "$f")
  gz=$(gzip -c "$f" | wc -c)
  echo "$f raw=$raw gzip=$gz"
done
```

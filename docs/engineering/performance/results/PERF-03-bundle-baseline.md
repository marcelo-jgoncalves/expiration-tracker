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

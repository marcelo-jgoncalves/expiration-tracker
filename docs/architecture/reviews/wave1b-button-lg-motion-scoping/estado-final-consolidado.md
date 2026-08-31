# Wave 1b — Button `lg` / motion `slow`: Estado Final Consolidado

**Status: `APPROVED` via protocolo Claude↔Codex, 3 rodadas, Claude 9,2/Codex 9,7 (sem
arredondamento).** Resíduos nomeados explicitamente em D-130 ("Wave 1b — Design System
Implementation Gap"). Histórico: `round1-claude-proposal.md` (Codex 8,7 — achou inconsistência
real entre "significado reutilizável exige segundo consumidor" e "slow nasce no primeiro
consumidor", mais gatilho puramente numérico para motion) → `round2-claude-revision.md` (critério
único corrigido, Codex 9,7) → `round3-claude-close.md` (tréplica de fechamento, sem achado novo).

## Decisão 1 — Button `lg`

**Não implementar agora.** `--control-height-lg` (44px) permanece um token de escala geral em
`tokens.css`, sem virar variante do `Button` (`ButtonSize` continua `"sm" | "md"`). Critério:
implementar só quando existir um caso de uso real e concreto (nunca por antecipação especulativa).
Nenhuma tela hoje nomeia um CTA mobile full-width/touch-primary; `sm`(32px)/`md`(36px) já
satisfazem WCAG 2.5.8 com folga — isso é confirmação auxiliar, não a razão suficiente. Resíduo
permanece nomeado para quando um fluxo mobile-first concreto precisar do tamanho maior.

## Decisão 2 — motion `--duration-slow`

**Não adicionar agora.** Critério corrigido na Rodada 2 (não é mais "qualquer transição >160ms" —
achado real do Codex de que um número isolado não estabelece semântica): o token nasce no mesmo
commit da primeira implementação de uma categoria de movimento genuinamente distinta das
existentes — entrada/saída de uma superfície sobreposta (Modal/Dialog/Drawer/Popover), que o
próprio catálogo (`design-system.md` §21/§76-77) já trata como merecendo tratamento de duração
mais deliberado que hover/foco inline. Nenhum desses componentes existe ainda no código real, logo
a categoria semântica (não só o número) ainda não existe. Valor a validar contra
`prefers-reduced-motion` quando implementado.

## z-index e breakpoints (mecânico, sem rodada nova)

Verificação de estado real feita nesta sessão (Wave 1b, ver `decisions-log.md` D-133):
`--z-base`/`--z-sticky`/`--z-overlay`/`--z-skip-link` já estão totalmente implementados em
`tokens.css` — não é gap, apenas confirmação de que `design-system.md` §76-77 já tem equivalente
real. Breakpoints nomeados (§25: 640/768/1024/1280/1440) **não** têm tokens dedicados em
`tokens.css` hoje — a única media query real do frontend (`base.css`, 900px, sidebar→drawer) usa um
valor ad-hoc. Aplicando o MESMO critério desta rodada (token nasce com o primeiro consumidor real
de uma categoria semântica, nunca especulativamente): não criar tokens de breakpoint agora — seriam
tokens sem consumidor real, e o valor `900px` já em produção não corresponde a nenhum dos 5 valores
do catálogo, então "reconciliar" agora seria escolher um número sem evidência de qual granularidade
o frontend realmente vai precisar. Decisão mecânica (nível 1-2, direta do critério já aprovado
nesta mesma rodada), não exigiu nova rodada Claude↔Codex.

## Nota

Nenhuma mudança de código de frontend resulta desta rodada de decisão em si (as duas decisões são
"não implementar agora"); a única mudança de código desta sessão é a implementação de `Divider`/
`IconButton` (gap real do catálogo, não coberto por este scoping), registrada separadamente em
D-133.

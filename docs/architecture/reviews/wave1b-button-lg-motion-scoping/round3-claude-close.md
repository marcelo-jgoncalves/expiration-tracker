# Wave 1b — Button `lg` / motion `slow` — Rodada 3 (tréplica de fechamento)

Gate atingido na Rodada 2 (Claude 9,2 self / Codex 9,7, ambos >=9.0 sem arredondar). Mínimo de 3
rodadas do protocolo (AGENTS.md §4) satisfeito por esta tréplica de fechamento, sem achado novo:
Codex confirmou que a correção da Rodada 2 resolveu integralmente o único achado real da Rodada 1
(inconsistência de critério + gatilho numérico). Nenhuma disposição nova. Decisão final:

- Button `lg`: **não implementar agora** — resíduo nomeado, revisitar só com um caso de uso real.
- `--duration-slow`: **não adicionar agora** — nasce no mesmo commit do primeiro componente de
  superfície sobreposta (Modal/Dialog/Drawer/Popover) implementado, nunca antes, nunca por gatilho
  numérico isolado.

Encerrado. Registrar como D-132 em `decisions-log.md`.

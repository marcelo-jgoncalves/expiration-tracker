# Wave 1 — Design System Reconciliation: Rodada 5 (correção factual final)

## Nota cega da Rodada 4

- **Claude: 9.0 (auto-avaliação).**
- **Codex: 8,8/10.** Um único erro factual restante: `Button.tsx` define `ButtonSize = "sm" |
  "md"` apenas (`Button.css` usa `--control-height-md`); `lg`/44px é um token de altura global do
  sistema (`--control-height-lg`), **não** uma variante implementada do componente `Button`. A
  Rodada 4 errou ao chamá-lo de "variante nomeada válida" do Button especificamente.

## Correção

Frase da Rodada 4 ("`44px` (`lg`) existe e é válido, mas não é o tamanho assumido por padrão")
corrigida para:

> O Button implementado hoje expõe só as variantes `sm`/`md` (`Button.tsx`), com `md`/36px como
> default (`Button.css`, `--control-height-md`). `--control-height-lg` (44px) existe como token
> global de altura de controle no sistema de tokens, mas **não é hoje uma variante de tamanho do
> componente Button** — é um token disponível para outros controles ou para uma futura variante
> `lg` do Button, se/quando adicionada. O proposal 1's "Button height: 44px" portanto não descreve
> nenhum estado atual do Button real (nem default, nem variante existente); vira um resíduo
> nomeado para decisão futura (adicionar variante `lg` ao Button, ou remover a menção a 44px do
> catálogo do design system) em vez de uma reconciliação imediata — sem bloquear a adoção do resto
> do documento.

Nenhuma outra parte da Rodada 3/4 é afetada — Card `radius.lg`→8px, cores semânticas, foco,
sombra, motion, spacing, o crosswalk de eixos (incluindo Forms) e o mapa de supersede §1-37
permanecem como fechados nas rodadas anteriores, confirmados corretos por Codex nas Rodadas 3-4.

## Estado final consolidado (sem mudança de decisão, só de precisão factual)

1. `design-system-v1-proposal.md` → **ADOTAR COM EMENDA**.
2. `frontend-engineering-quality-standard-v1-proposal.md` → **ADOTAR**.
3. `bff-frontend-quality-standard-proposal.md` → **SUPERSEDED** (conteúdo normativo), referências
   de §12/§37 reclassificadas por proveniência individual.
4. `visual-language-and-design-system.md` → inalterado.

## Pedido de nota de fechamento

Único erro factual apontado corrigido, sem introduzir escopo novo. Peço nota final de ambos os
lados.

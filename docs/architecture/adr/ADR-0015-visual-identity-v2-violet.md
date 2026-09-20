# ADR-0015 — Identidade visual v2 (violeta, Plus Jakarta Sans, ícones Lucide) como base oficial do design system

**Status**: Aceito — decisão direta de Marcelo, protocolo dispensado (`ai-governance.md` §2) | **Data**: 2026-09-20 | **Type**: Type 1 (nível 6, `change-risk-scale.md` — reverte decisões de identidade visual já `APPROVED` via protocolo completo) | **Decisor**: Marcelo (`AGENTS.md` §1)

## Contexto

`docs/frontend/visual-language-and-design-system.md` (16 rodadas, `VL-G1..VL-G17`, Claude 9,2/Codex 9,04, 2026-08-26) e `docs/frontend/design-system.md` (5 rodadas, Claude 9,2/Codex 9,5, D-130, 2026-08-31) formalizaram uma direção visual — acento azul-indigo (`#2f4fd0`), stack tipográfica de sistema sem webfont, **nenhum sistema de ícones** (só marcadores de forma CSS e glifos de texto). O primeiro documento permanece, até hoje, marcado `PROVISIONAL PENDING USER VALIDATION` — a validação nunca tinha acontecido.

Marcelo explorou uma direção v2 em sessão separada (Claude Design/Artifacts, fora deste repositório), produzindo um design system completo (tokens, 21 componentes, camada de refinamento, config de lint de aderência) com acento violeta (`#7c3aed`), tipografia Plus Jakarta Sans (Google Fonts) e ícones reais (Lucide, SVG embutido). Entregue como `Untitled.zip` em `prototype/`, auditado nesta sessão (contraste recalculado, `forced-colors`, `WCAG 2.2` SC 2.5.8/2.4.11, achados reais corrigidos) contra os critérios já `APPROVED` de `docs/frontend/frontend-engineering-quality-standard.md` (Eixo 3 — Acessibilidade 12%, Eixo 11 — Design System 3%) e `docs/frontend/interface-quality-standard.md`.

Marcelo decidiu diretamente, 2026-09-20: **este v2 (já corrigido) é a base do design system oficial**, substituindo a direção v1 nos três pontos onde divergem.

## Options Considered

1. **v2 — acento violeta, Plus Jakarta Sans, ícones Lucide** (escolhida) — decisão direta do responsável final por identidade visual/arquitetura (`AGENTS.md` §1). Já auditado contra os eixos de acessibilidade/design system já aprovados neste projeto, com 4 achados reais corrigidos antes desta ADR (ver §"Correções aplicadas").
2. **v1 — acento azul-indigo, stack de sistema, sem ícones** (`visual-language-and-design-system.md`/`design-system.md`, hoje vigente no `frontend/src/components/ui/**` real) — rejeitada por decisão direta de Marcelo, não por mérito técnico comparativo. Nunca chegou a passar por User Validation real (ficou `PROVISIONAL` desde 26/08).
3. **Manter as duas coexistindo (feature flag/tema)** — não considerada; não há indicação de que multi-tema seja necessário, e introduziria complexidade sem evidência de necessidade real (`principles.md` #1).

## Por que o protocolo Claude↔Codex foi dispensado (`ai-governance.md` §2)

1. A escolha já foi feita diretamente por Marcelo, não por um agente propondo e outro validando — ele revisou o resultado desta sessão (auditoria completa do v2) e decidiu explicitamente adotá-lo.
2. Esta ADR documenta a dispensa e o porquê (este parágrafo).
3. Alternativas tecnicamente viáveis continuam registradas acima (Options Considered) — v1 nunca foi tecnicamente invalidado, só substituído por decisão de produto.

## Evidence

Auditoria completa desta sessão (2026-09-20): recontagem de contraste WCAG 2.1 (`accent-600` 5,70:1, `accent-700` 7,19:1, `red-700` 6,57:1 em branco — todos ≥ AA), verificação de `forced-colors`/`SelectedItem`/`Highlight`/`ButtonBorder`/`CanvasText`, `WCAG 2.2` SC 2.5.8 (target ≥24px, controles reais ≥32px) e SC 2.4.11 (nada `sticky`/`fixed` exceto skip link), pesquisa externa datada (W3C WCAG22 Techniques F87 — obsoleto desde 12/01/2026 —, algoritmo de font-matching CSS Fonts Module Level 4 via MDN, W3C Design Tokens Community Group 2025.10). `docs/frontend/frontend-engineering-quality-standard.md` Eixo 3/Eixo 11 e `docs/frontend/interface-quality-standard.md` usados como régua — nenhum critério novo inventado.

## Correções aplicadas antes de aceitar o v2 como base oficial

Todas em `docs/frontend/design-system-v2/` (destino permanente do design system, copiado de `prototype/Untitled.zip`):

1. **Bug real de peso de fonte**: `tokens/fonts.css` carregava só os pesos estáticos 500/600/700/800 do Google Fonts, mas `tokens/typography.css` declara 400/550/650 — nenhum dos três batia, então todo texto "regular" renderizava como peso 500, "medium" como 600, "semibold" como 700 (confirmado pelo algoritmo real de font-matching, CSS Fonts Module Level 4). Corrigido para servir a fonte variável real (Plus Jakarta Sans suporta eixo `wght` 200-800) com o range exato `wght@400..650`, eliminando o descasamento por completo.
2. **`forced-colors` incompleto**: o indicador de página atual na navegação usava só `box-shadow` (que não renderiza em modo de alto contraste forçado) como uma de suas 3 pistas — diferente do resto do sistema, que já tratava `forced-colors` corretamente em todo outro componente. Adicionado `border` com a cor de sistema `SelectedItem` como fallback, nos dois layouts (rail vertical e nav horizontal em viewport estreito).
3. **Drift de documentação**: `README.md` descrevia raios (4/6/8px) e sombras da direção v1, desatualizados depois da migração v2 (raios 8/12/18px, Panel com `shadow-raised`, sombra com tom violeta) — corrigido para refletir os valores reais de `tokens/shape.css`.
4. **Metadado errado**: `adherence.oxlintrc.json` classificava `--layout-gutter` (espaçamento) como `"color"` em `tokenKinds` — corrigido.

**Achado da pesquisa externa retirado da lista de correções**: o padrão `content: attr(data-label)` em `DataTable.css` (rótulo do layout mobile empilhado) foi inicialmente sinalizado como uma falha WCAG (técnica F87) — pesquisa direta na página oficial do W3C confirmou que **F87 foi marcada obsoleta em 12/01/2026** (suporte de leitor de tela para conteúdo gerado por CSS melhorou o suficiente); mantido como está, sem correção, com nota de que o texto do rótulo não é selecionável (limitação cosmética, não falha de acessibilidade).

**Não corrigido nesta rodada, registrado como candidato futuro**: alinhamento ao formato W3C Design Tokens (DTCG, versão estável 2025.10, ~84% de adoção em 2026 por pesquisa da zeroheight) — o sistema usa CSS custom properties puro, não o JSON DTCG. Não é lacuna do Eixo 11 atual (peso 3%, não menciona formato de token), mas é uma emenda candidata a esse eixo quando o protocolo Claude↔Codex voltar — não bloqueia a adoção do v2 como base oficial.

## Impacto/próximos passos (fora do escopo desta ADR)

Esta ADR só formaliza a ADOÇÃO da direção v2 e as correções ao artefato entregue. Reconciliar `docs/frontend/design-system.md`/`visual-language-and-design-system.md` (que ainda descrevem v1 como vigente) e portar os tokens/componentes para `frontend/src/components/ui/**`/`frontend/src/styles/tokens.css` (o código real, hoje ainda v1) são passos de implementação separados, não decididos aqui.

## References

`docs/frontend/design-system-v2/` (artefato corrigido), `docs/frontend/visual-language-and-design-system.md`, `docs/frontend/design-system.md`, `docs/frontend/frontend-engineering-quality-standard.md` (Eixo 3/Eixo 11), `docs/engineering/ai-governance.md` §2, `docs/engineering/change-risk-scale.md` (nível 6).

# Wave 1 — Design System Reconciliation: Estado Final Consolidado

**Status: `APPROVED` via protocolo Claude↔Codex, 5 rodadas, Claude 9,2/Codex 9,5 (sem
arredondamento).** Item 4 da fila de `NEXT_SESSION_PROMPT.md`, Wave 1 de
`docs/engineering/pilot-readiness-program.md`, decidido sob a autoridade ampliada de
`docs/engineering/ai-governance.md` §1 (2026-08-31).

Histórico completo das 5 rodadas: `round1-claude-proposal.md` → `round2-claude-revision.md` →
`round3-claude-final.md` → `round4-claude-close.md` → `round5-claude-close.md`. Achado real mais
significativo do protocolo: a Rodada 1 declarou "nenhum gate `VL-G` é reaberto" sem verificar os
valores primitivos reais em `frontend/src/components/ui/tokens.css` — a Rodada 1's próprio erro
foi a mesma classe de defeito (documentação afirmando prova mais ampla que a evidência) que
`VL-G16 Documentation Truth` foi desenhado para pegar em `visual-language-and-design-system.md`.
Codex achou isso na Rodada 1 e o protocolo levou 4 rodadas adicionais para reconciliar
exaustivamente (paleta, tipografia, radius, foco, cores semânticas, sombra, motion, altura de
botão/papel semântico de variante, spacing) em vez de descartar a divergência como resíduo futuro.

## Decisão 1 — `docs/frontend/design-system-v1-proposal.md`

**ADOTAR COM EMENDA.** Arquitetura de tokens (primitive→semantic→component tokens quando
justificado), regras de processo (proibição de valor arbitrário, nomeação semântica de token),
catálogo de ~30 componentes (roadmap, não afirmação de que já existem), patterns nomeados,
motion/z-index/breakpoints/i18n-readiness/dark-mode-readiness — adotados integralmente, porque não
existiam como documento normativo formal e não conflitam com nada `APPROVED`.

Valores primitivos concretos que conflitavam com `tokens.css` real (accent `#7C3AED`→`#2F4FD0`;
Plus Jakarta Sans→System UI; H1 32/40→22px; H2 24/32→18px; radius sm/md/lg/xl 8/12/16/20→4/6/8px;
foco `#6D28D9`→`#2F4FD0`; cores semânticas próprias→as de `tokens.css`; shadow.md alpha
.08→.12 com RGB diferente; motion 120/180/240ms→120/160ms sem token `slow`) foram **substituídos**
pelos valores já implementados e testados em `visual-language-and-design-system.md` — não
migrados, a decisão visual de 16 rodadas permanece intacta. Spacing é compatível em valor, mapeado
por nome. Button `height: 44px` do proposal não corresponde a nenhuma variante implementada hoje
(`Button.tsx` só tem `sm`/`md`, default `md`/36px) — fica como resíduo nomeado para decisão futura
(adicionar variante `lg` ou remover a menção), não bloqueante.

Ação de implementação (documentação, feita nesta sessão): seção `## 0. Reconciliação de valores`
inserida no topo do arquivo com a tabela completa e a regra "valor concreto vs. referência
simbólica, papel semântico de default vence coincidência numérica"; arquivo renomeado para
`docs/frontend/design-system.md`, frontmatter `status: APPROVED`.

## Decisão 2 — `docs/frontend/frontend-engineering-quality-standard-v1-proposal.md`

**ADOTAR.** 12 eixos de engenharia de frontend (segurança/BFF, confiabilidade técnica,
performance, arquitetura, testes, privacidade, observabilidade, DS-conformidade-de-implementação,
responsividade-técnica) cobrem espaço genuinamente diferente dos 12 eixos de
`interface-quality-standard.md` (UX/IA) — confirmado por crosswalk exaustivo eixo-a-eixo com regra
"um achado, um dono de pontuação" (inclui a correção de Rodada 4 que adicionou Forms como overlap
real, dividido entre UX-de-formulário e mecanismo-técnico-de-formulário). Nenhum eixo de
`interface-quality-standard.md` é reaberto ou duplicado.

Ação de implementação: crosswalk completo inserido como seção formal; arquivo renomeado para
`docs/frontend/frontend-engineering-quality-standard.md`, frontmatter `status: APPROVED`.

## Decisão 3 — `docs/frontend/bff-frontend-quality-standard-proposal.md`

**SUPERSEDED** para todo conteúdo normativo (arquitetura de Full BFF — já fato consumado em
`frontend-production-foundation.md`/D-053/D-054; rubrica `FG1-FG4` — superseded pelos 12 eixos/
`FE-G1..FE-G5` do documento novo; fluxos E2E, gates, processo, DS, responsividade — todos com
equivalente mais completo no documento novo). Mapa seção-a-seção §1-37 completo, sem lacuna.
Referências externas de §12/§37 **não** declaradas superseded em bloco — reclassificadas por
proveniência individual (OWASP/WCAG/Core-Web-Vitals cobertos pelo doc novo §106; IETF OAuth
Browser-Based Applications preservado como proveniência de decisões já em
`frontend-production-foundation.md`; heurísticas de Nielsen apontadas para seu lar formal real,
`interface-heuristic-accessibility-evaluation.md`; CloudFront/Next.js BFF histórico puro, pergunta
já resolvida pela implementação real).

Ação de implementação: frontmatter atualizado para `status: SUPERSEDED` com a ressalva de
proveniência de referências; arquivo mantido no lugar (evidência histórica, mesmo tratamento de
`docs/architecture/history/`).

## Decisão 4 — `docs/frontend/visual-language-and-design-system.md`

**Inalterado.** Continua `APPROVED — PROVISIONAL PENDING USER VALIDATION`, fonte de verdade dos
valores primitivos reais e do registro de protocolo/evidência (16 rounds, `VL-G1..VL-G17`). Nota
adicionada apontando para `design-system.md` como fonte prospectiva de arquitetura/catálogo.

## Trabalho futuro nomeado (fora de escopo desta rodada, não implementado)

**Wave 1b — Design System Implementation Gap** (nome novo, a priorizar em sessão futura):
implementar o catálogo de ~30 componentes ainda faltantes, adicionar camada de component-tokens a
componentes novos, decidir se/quando adicionar variante `lg` ao Button, avaliar motion `slow`/
z-index/breakpoints nomeados no CSS real. Nenhum código de frontend foi alterado nesta sessão —
reconciliação foi puramente documental, como esperado para uma rodada de reconciliação de
documentos (não uma proposta de mecanismo do zero).

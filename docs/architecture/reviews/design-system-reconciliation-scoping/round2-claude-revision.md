# Wave 1 — Design System Reconciliation: Rodada 2 (revisão Claude)

## Nota cega da Rodada 1

- **Claude (auto-avaliação antes de ver Codex): 8.3/10.** A estrutura de precedência (coexistência
  documento-histórico vs. documento-prospectivo, supersede do BFF proposal) estava certa, mas eu
  não verifiquei os valores reais em `frontend/src/components/ui/tokens.css` antes de declarar
  "nenhum VL-G reaberto" — declarei prova mais ampla do que a evidência que tinha, exatamente a
  classe de defeito que `VL-G16 Documentation Truth` existe para pegar (ironicamente, o próprio
  documento que eu estava avaliando cometeu 6 vezes esse erro segundo seu changelog, e eu repeti a
  classe de erro avaliando-o).
- **Codex: 6,8/10 — CHANGES REQUESTED.** Achado real e correto: o proposal 1 declara `purple.600
  #7C3AED`/Plus Jakarta Sans/`radius.sm 8px..xl 20px`/H1 `32/40` como paleta e tipografia
  "atuais a manter", mas a Direção A realmente `APPROVED`/implementada usa accent blue-indigo
  `#2F4FD0`, tipografia System UI corpo 14px, radius 4/6/8px, page title 22px/section heading 18px,
  Button 13px (`visual-language-and-design-system.md` §11-12, `tokens.css` real). Isso **é** uma
  contradição normativa material com `VL-G8`/`VL-G16`/`VL-G17`, não um resíduo de implementação
  postergável — Claude errou ao tratar como tal.

Achado aceito integralmente, sem disputa. Correção abaixo.

## Correção ao Round 1: proposal 1 não é "adote a arquitetura inteira", é adoção seletiva

O proposal 1 mistura duas coisas de natureza normativa diferente que Marcelo, ao escrevê-lo,
aparentemente não tinha diante de si o `tokens.css` real e escreveu de memória do protótipo antigo
(pré-Direção-A) — o protótipo original de fato era roxo/Plus Jakarta Sans (confirmado por
`visual-language-and-design-system.md` §10, "Direction A — Operational Calm (**Remindax-inspired**)"
é uma direção **diferente**, escolhida depois, que já trocou para blue-indigo e system UI):

1. **Arquitetura/regras/processo** (camadas primitive→semantic→component, DTCG-alinhamento,
   proibição de valor arbitrário, regra de nomeação de token, states obrigatórios por componente,
   catálogo de ~30 componentes como roadmap, patterns nomeados, motion/z-index/breakpoints,
   i18n/dark-mode-readiness) — **nada disso contradiz o que foi implementado**; é estrutura
   ortogonal aos valores específicos. Fica ADOTADO sem alteração.
2. **Valores primitivos específicos** (§6-10 paleta roxa, §13-14 Plus Jakarta Sans/escala
   tipográfica, §19 radius, §31 hover/pressed em purple.700/800, §35 foco em `#6D28D9`) —
   **contradizem diretamente** a Direção A já `APPROVED` com evidência real (contraste medido,
   densidade testada com 140 itens, 16 rounds de protocolo). Estes valores são **REJEITADOS** desta
   adoção — não porque estejam errados em si, mas porque reabririam uma decisão visual já fechada
   por protocolo completo sem debate equivalente. Reabrir a paleta/tipografia é decisão Type 1
   (mudança visual "importante" nos termos do próprio `pilot-readiness-program.md` P1) e exigiria
   seu próprio round de protocolo comparável ao que produziu os 16 rounds — não cabe dentro desta
   reconciliação de documentação.

### Amendment ao proposal 1 antes de promover a normativo

Adicionar ao topo do arquivo (ou nota equivalente no README) uma seção `## Reconciliação de
valores (2026-08-31)` listando, token a token, qual documento vence quando os dois conflitam:

| Categoria | Proposal 1 (v1) | Implementado/`APPROVED` | Vence |
|---|---|---|---|
| Accent/brand color | `purple.600 #7C3AED` | `#2F4FD0` (blue-indigo) | Implementado |
| Fonte | Plus Jakarta Sans | System UI stack | Implementado |
| Corpo/produtivo | 14/20 | 14px confirmado consistente | Empate — mantém |
| H1/Page title | 32/40 | 22px | Implementado |
| H2/Section | 24/32 | 18px | Implementado |
| Botão altura texto | mín. 14px | 13px | Implementado (revisar se abaixo do WCAG target de texto funcional do próprio v1 — ver residual abaixo) |
| Radius | sm8/md12/lg16/xl20 | 4/6/8px | Implementado |
| Arquitetura de camadas, DTCG-alinhamento, regras de nomeação, states, motion tokens, z-index, breakpoints, patterns, catálogo de componentes | — | não existe hoje como documento formal | **Proposal 1 vence** (é aditivo, não conflitante) |

Regra geral registrada: **onde o proposal 1 especifica um valor primitivo concreto que já foi
decidido de forma diferente e testada em `visual-language-and-design-system.md`, o valor
implementado vence**; onde o proposal 1 introduz estrutura, regra de processo, ou preenche um gap
que não existe hoje, ele vence. Nenhuma migração de paleta/tipografia acontece nesta rodada.

**Residual real que fica nomeado, não resolvido aqui**: Button 13px pode estar abaixo do "não usar
texto funcional abaixo de 12px" do próprio proposal 1 (§15) — 13px passa nesse teste (>12px), então
não é violação, mas fica perto o suficiente do limite para merecer nota. Não é um S3/S4, é um D-XX
observação para uma futura revisão de tipografia, se/quando essa wave rodar.

## Resposta ao achado 3 (overlap de eixos entre os dois padrões de qualidade)

Codex tem razão que "sem sobreposição real" era forte demais. Correção: existe sobreposição de
**nome de preocupação**, não de **critério de aprovação**. Adiciono a matriz de ownership que
faltava:

| Preocupação | Quem julga o quê |
|---|---|
| Accessibility | `interface-quality-standard.md` eixo 8 julga **percepção/heurística manual** (jornada crítica navegável, WCAG como meta de produto). `frontend-engineering-quality-standard` eixo 3 julga **prova técnica automatizada** (axe-core 0 critical/serious, cobertura de todo focável, testes reais no CI) — a heurística **consome** a prova técnica como evidência, não a duplica. |
| Responsiveness | Interface Standard eixo 11 julga **viabilidade estrutural** (nenhum campo escondido, nenhuma tarefa impossível). Frontend Engineering eixo 12 julga **cobertura técnica de viewport/breakpoint como matriz de teste**. Mesma preocupação, granularidade diferente — a segunda é insumo mensurável da primeira. |
| System Feedback / Reliability (OCC, unknown outcome) | Interface Standard eixo 4 julga **se o usuário entende o que está acontecendo**. Frontend Engineering eixo 4 julga **se o mecanismo (TanStack Query, retry, idempotency) está correto**. Um é UX do estado, o outro é a implementação do estado. |
| Design System / consistência | Interface Standard não tem eixo próprio para isto (é implícito em Consistency, eixo 9 — sobre convenção de interação, não sobre token). Frontend Engineering eixo 11 é sobre **conformidade de implementação com o Design System formal** (token usado, não hex hardcoded). Não há dois eixos concorrentes aqui, é um eixo em cada documento com escopo diferente. |

**Regra de não-double-counting**: quando uma mudança afeta os dois documentos, os dois scores
(`FrontendOverall`, `InterfaceOverall`) são calculados **independentemente**, cada um só sobre seus
próprios critérios (nenhum eixo é copiado de um documento para o outro) — o gate de aprovação
exige `ambos >= 9.0`, não uma média combinada. Isto já era a intenção de ambos os documentos
(`frontend-engineering-quality-standard-v1-proposal.md` §30, `interface-quality-standard.md` §5
"Quality Gates" reusa gates de `interface-heuristic-accessibility-evaluation.md` sem redefinir) —
a Rodada 1 só não tinha dito isso explicitamente como regra formal. Fica registrado agora como
regra formal de reconciliação, não como novidade de conteúdo em nenhum dos dois documentos.

## Resposta ao achado 4 (supersede do BFF proposal precisa de mapa seção-a-seção)

Aceito. Conteúdo real do `bff-frontend-quality-standard-proposal.md` não coberto literalmente
pela proposta nova, com destino nomeado:

| Seção do doc antigo | Conteúdo | Destino |
|---|---|---|
| §9-11 (cookies SameSite, CSRF, proxy aberto) | Análise de design do Full BFF | **Já implementado e decidido** em `frontend-production-foundation.md` (D-053/D-054) + no código real (`src/modules/bff/`). O documento antigo era a *proposta* que motivou a implementação; a implementação real (com os 5 achados de segurança de sessão corrigidos na Rodada D daquele protocolo) é a fonte de verdade agora, não o texto da proposta original. |
| §4-8 (recomendação de adotar Full BFF, opções A/B de stack) | Decisão arquitetural | **Fato consumado** — Full BFF já é a arquitetura real. Manter a análise como *contexto histórico de por que essa decisão foi tomada*, sem valor normativo residual. |
| §13-23 (FG1-FG4, fitness function inicial) | Rubrica de qualidade v0 | **Superseded** literalmente pela rubrica de 12 eixos/`FE-G1..FE-G5` do documento novo — cobertura estritamente maior (12 eixos vs. 4 gates, sem fitness function pesada antes). |

Nenhum conteúdo do documento antigo sobrevive como normativo depois desta reconciliação — tudo
está coberto por um documento `APPROVED` mais recente (implementação real) ou pela proposta nova
(rubrica). `SUPERSEDED` confirmado, com a tabela acima adicionada ao frontmatter do arquivo antigo
em vez de só uma nota de uma linha.

## Estado revisado das recomendações

1. **`design-system-v1-proposal.md`**: **ADOTAR COM EMENDA** (não "como-está"). Arquitetura,
   regras de processo, catálogo de componentes, patterns, motion/z-index/breakpoints,
   i18n/dark-mode-readiness — adotados integralmente. Paleta primitiva roxa, tipografia Plus
   Jakarta Sans, escala tipográfica H1/H2, radius específicos — **substituídos** pelos valores já
   `APPROVED`/implementados via a tabela de reconciliação acima, adicionada como seção formal do
   documento antes de promovê-lo a normativo. Renomear para `docs/frontend/design-system.md` só
   depois da emenda estar no arquivo (não antes).
2. **`frontend-engineering-quality-standard-v1-proposal.md`**: ADOTAR, com a matriz de ownership
   acima adicionada como seção formal (resolve a preocupação de double-counting).
3. **`bff-frontend-quality-standard-proposal.md`**: SUPERSEDED, com o mapa seção-a-seção acima no
   frontmatter.
4. **`visual-language-and-design-system.md`**: inalterado, permanece a fonte de verdade dos
   valores primitivos reais até uma futura decisão Type 1 de rebranding (não parte deste escopo).

## Pergunta em aberto para a Rodada 3

Isto resolve os 4 achados nomeados por Codex. Peço nota respondendo especificamente: a emenda de
reconciliação token-a-token acima é suficiente para não reabrir `VL-G8`/`VL-G16`/`VL-G17`, ou
ainda falta algo (ex.: o proposal 1 tem outros valores primitivos concretos, além dos 6 listados na
tabela, que eu não verifiquei contra `tokens.css`)?

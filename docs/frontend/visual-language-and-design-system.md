# Visual Language + Design System Foundation

> **Status:** `APPROVED AS VISUAL LANGUAGE + DESIGN SYSTEM FOUNDATION — PROVISIONAL PENDING USER VALIDATION`
> **Data:** 2026-08-26 · **Branch:** `feat/visual-language-design-system` · **Base:** `develop`
> **Escopo de código:** `frontend/` (Core Expiration slice apenas)

---

## 1. Executive Summary

O frontend saiu de uma fundação **deliberadamente provisória** (`foundation.css`: 71 linhas, 4
tokens, escala de cinza, sem identidade visual, sem primitives) para uma **linguagem visual de
produto operacional** com arquitetura de tokens em duas camadas, um conjunto pequeno de
componentes acessíveis, e QA visual determinístico.

O que mudou, concretamente:

- `frontend/src/styles/foundation.css` foi substituído por `tokens.css` (primitivos →
  aliases semânticos) + `base.css` (elementos, shell, foco, motion).
- Nove primitives novos em `frontend/src/components/ui/`, mais os já existentes
  (`AsyncStates`, `TextField`, `FormErrorSummary`) reescritos sobre os tokens.
- As cinco superfícies do Core Expiration slice aplicadas: Overview, Collection, Detail,
  Create, Renew.
- A Expiration Collection deixou de ser um `<ul>/<li>` e passou a ser uma `<table>` semântica
  real, com urgência e situação em colunas separadas, empilhando em blocos rotulados abaixo de
  820px sem esconder nenhum campo.
- 3 testes E2E de densidade (140 itens, 375px, reflow a 200%) + 10 baselines de regressão
  visual determinísticas.

Três achados reais foram encontrados **medindo a página renderizada**, não lendo a paleta:

| # | Achado | Severidade | Correção |
|---|---|---|---|
| 1 | `.ui-table__group-count` a 4,48:1 sobre a superfície do cabeçalho de grupo | S2 (WCAG 1.4.3) | passou de `text-tertiary` para `text-secondary` |
| 2 | No layout empilhado, a célula identificadora perdia para `.ui-table td` por especificidade — o emissor era jogado para a direita da linha | S2 | seletores qualificados com `td` |
| 3 | Urgência ecoava o rótulo de ciclo de vida ("Urgência: Ativo" ao lado de "Situação: Ativo") | S2 | `presentItemUrgency` passou a dizer "Sem urgência" / "Não se aplica" |

**Nada aqui foi validado com usuários.** Toda hipótese de hierarquia, densidade, rótulo e
posicionamento é raciocínio de design + avaliação especializada, registrada na §35.

## 2. Status

`APPROVED AS VISUAL LANGUAGE + DESIGN SYSTEM FOUNDATION — PROVISIONAL PENDING USER VALIDATION`

Este documento **não** declara, e nada neste milestone autoriza declarar: `FINAL DESIGN SYSTEM`,
`USER-VALIDATED`, `FINAL HIGH-FIDELITY UI`, `VISUAL DESIGN COMPLETE`, `FINAL INFORMATION
HIERARCHY`. User Validation continua não iniciada (suspensa por decisão do Marcelo).

## 3. Scope

Dentro: tokens semânticos, tipografia, espaçamento, grid, hierarquia de superfície, tratamento
de status/urgência, foco, semântica de cor, forms, botões, tabelas/listas, notices,
loading/empty/error, fundações responsivas, princípios de motion e de iconografia, regressão
visual, consistência de componentes — aplicados **somente** a Overview, Expiration Collection,
Expiration Detail, Create Expiration e Renew Expiration.

## 4. Non-Goals

Fora, explicitamente: as outras 12 das 17 Interaction Surfaces; qualquer mudança de IA, journey
ou fluxo; dark mode; i18n; um projeto de logo/marketing/ilustração; Storybook; uma biblioteca
de ícones; um framework de UI; densidade configurável pelo usuário; sorting/paginação/seleção
de linha na tabela; a seção de Documentos no Detail (fora do slice, não um blocker).

## 5. Product Context

Ferramenta operacional, data-dense, orientada a tarefa e a confiança: acompanhamento de
vencimentos, priorização, datas e urgência, documentos, requisitos, solicitações, terceiros,
lembretes, estados assíncronos, fluxos de revisão. Não é site de marketing nem app de
entretenimento. A pergunta central de toda superfície é **"o que precisa da minha atenção?"**.

Autoridade normativa preexistente que este milestone **não** altera:
`docs/frontend/interface-quality-standard.md` (12 eixos, threshold `Overall ≥ 9.0`),
`docs/frontend/core-expiration-vertical-slice.md` (comportamento aprovado do slice),
`docs/frontend/interface-conceptual-model-and-information-architecture.md` (IA dual-anchor).

## 6. Research Sources

Reconciliadas nesta sessão como **método e evidência**, nunca como mandato visual nem como
componentes a copiar (Apêndice B do prompt da missão):

| Fonte | O que foi extraído |
|---|---|
| WCAG 2.2 (`w3.org/TR/WCAG22/`) | Alvo normativo AA; 1.4.3 contraste, 1.4.1 uso de cor, 1.4.10 reflow, 2.4.11 foco não obscurecido, 2.5.8 target size |
| WAI-ARIA APG | Usado como referência de quando NÃO construir um widget: nenhum `grid`, nenhum `tablist` foi introduzido |
| Carbon | Ritmo de espaçamento em 8px com microincrementos; separação entre type set produtivo e expressivo; padrão de status indicator com múltiplas pistas |
| Atlassian | Tokens escolhidos por significado, não por valor; lozenge como atributo compacto |
| GOV.UK | Disciplina de forms operacionais (label visível, error summary com links, valores preservados); tag de status que não parece ação; remoção de caixa-alta por legibilidade |
| NN/g — data tables | Tabelas continuam adequadas para encontrar/comparar/escanear/agir quando os registros compartilham atributos |
| NN/g — minimalismo estético | Minimalismo = maximizar sinal, não remover informação útil |
| DTCG | Metodologia de tokens conceituais; formato preview 2025.10 **não** adotado (a própria spec pede que não seja tratada como autoritativa) |
| Playwright test-snapshots | `toHaveScreenshot` em ambiente determinístico |

## 7. Research Findings

1. **Tabela vence card para esta coleção.** Os registros compartilham atributos e a tarefa é
   comparar/escanear. Card seria escolha estética contra a evidência.
2. **Status precisa de mais de uma pista.** Texto + cor sempre; forma quando ajuda scanning.
3. **Data relativa nunca substitui a absoluta.** Ambas, sempre, lado a lado.
4. **Caixa-alta em status prejudica legibilidade.** Sentence case, exceto siglas reais.
5. **Tokens semânticos > tokens primitivos nas features.** Preserva significado e tematização.
6. **Automação de acessibilidade é necessária e insuficiente.** Verificação humana permanece.

## 8. Existing Visual Baseline

Auditado no início da missão (Workstream A, reaproveitado):

- `foundation.css`: 71 linhas, 4 custom properties (`--line`, `--line-strong`, `--bg`,
  `--text`), genuinamente estrutural — o comentário do arquivo declarava explicitamente
  "structural tokens only, never a design system".
- Nenhum primitive: `<button>` cru em todo lugar; status como texto entre colchetes (`[Ativo]`);
  `<ul>/<li>` para coleções comparáveis.
- Ação primária e link de navegação visualmente idênticos.
- `main { max-width: 760px }` fixo, desperdiçando o desktop em superfícies densas.
- Densidade sob volume real (100+ itens) **nunca verificada contra o código real do frontend** —
  só contra o protótipo.

Todos os cinco pontos são endereçados por este milestone.

## 9. Visual Principles

1. **Signal over decoration.** Todo elemento justifica-se por hierarquia, agrupamento, estado,
   affordance, feedback, atenção ou identidade. O resto é ruído.
2. **Operational, not marketing.** Coleções favorecem scanning; urgência é perceptível; ações
   são encontráveis; dados são comparáveis; estados são inequívocos.
3. **Epistemic Integrity acima da estética.** A interface nunca aparenta saber mais do que o
   sistema sabe. Nenhum badge verde de "sucesso" para uma verdade que o domínio não possui.
4. **Cor semântica, não decorativa.** Vermelho/âmbar/verde significam algo ou não são usados.
5. **Cor nunca sozinha.** Texto + cor, e forma quando contribui para scanning.
6. **Calma operacional.** Superfícies claras, bordas contidas, sombras quase ausentes,
   hierarquia por espaço e tipografia antes de por container.

## 10. Direction Candidates

A exploração foi **refeita** nesta sessão com o viés que a correção de rota do product owner
determina: Direction A é a hipótese preferida, e as alternativas existem para desafiá-la, não
para empatar com ela.

### Direction A — Operational Calm (Remindax-inspired) — **PRIMARY CANDIDATE**

| | |
|---|---|
| Princípios | Superfícies claras, separação sutil, bordas contidas, sombras quase inexistentes, hierarquia sem containers pesados |
| Paleta | Neutros levemente frios; accent blue-indigo único e moderado; status semânticos independentes do accent |
| Tipografia | System UI, sentence case, escala pequena, 14px como corpo produtivo |
| Densidade | Moderada — linha de duas linhas (identificador + metadado de apoio), respiro suficiente para parecer organizada |
| Status | Pill com marcador de forma + rótulo em sentence case, tinta clara, borda de 1px |
| Superfície | Nav lateral em superfície branca sobre página cinza-clara; coleção dentro de um painel único de raio 8px |
| Forças | Legibilidade alta; ruído baixo; parece um SaaS profissional agradável de usar diariamente; sobrevive bem a nomes longos |
| Riscos | Linhas de duas linhas custam altura vertical num dataset grande; um accent forte demais dominaria |

### Direction B — Neutral Precision — challenger

| | |
|---|---|
| Princípios | Densidade máxima, quase-monocromático, nav em barra superior, zebra, sem painel |
| Paleta | Cinzas neutros; accent teal escuro; status com barra lateral em vez de pill |
| Tipografia | 13px de corpo, cabeçalhos de coluna em caixa-alta com tracking |
| Densidade | Alta — uma linha por registro, metadado inline |
| Forças | Cabe mais registros por tela; muito rápido de escanear numericamente |
| Riscos | Lê como ferramenta técnica/industrial; caixa-alta contraria §18 e a evidência GOV.UK; abandona as qualidades que motivaram a escolha da referência |

Ambas foram implementadas como mockups estáticos comparáveis (mesmo shell, page header, linha
de tabela, status, urgência, botão, campo, notice) e verificadas por contraste real antes de
qualquer comparação estética.

Nenhuma terceira direção foi produzida. A correção de rota é explícita: no máximo 1–2
alternativas, e nunca escolher uma alternativa apenas para demonstrar independência da
referência.

## 11. Direction Decision

**Escolhida: Direction A — Operational Calm (Remindax-inspired).**

| Critério | A | B | Nota |
|---|---|---|---|
| Operational clarity | ✔ | ✔ | Empate |
| Scannability | ✔ | ✔ | B cabe mais linhas; A separa melhor os grupos |
| Trust | ✔ | ~ | B lê como ferramenta interna, não como produto que se paga |
| Contrast (real) | ✔ | ✔ | Ambas passam AA em todos os pares medidos |
| Density | ~ | ✔ | **Única vantagem objetiva de B** |
| Visual fatigue | ✔ | ~ | Zebra + caixa-alta cansam em uso diário |
| Brand distinctiveness | ✔ | ~ | |
| Implementation simplicity | ✔ | ✔ | Empate |
| Responsiveness | ✔ | ~ | A já stackeia; B depende de scroll horizontal |
| Semantic state clarity | ✔ | ~ | Caixa-alta em status contraria §18 |
| **VL-G17 Reference Alignment** | ✔ | ✘ | B abandona clareza/leveza/calma sem justificativa objetiva |

B tem exatamente uma vantagem objetiva (densidade) e nenhum dos gates que poderiam desqualificar
A (accessibility, contrast, data density, task hierarchy, responsiveness, state clarity,
maintainability) foi acionado contra A: o teste de densidade real com 140 itens (§26) mostra a
coleção continuando escaneável. A vantagem de densidade de B não compra o suficiente para
justificar abandonar a direção estética que o product owner escolheu.

**Registro de decisão** (formato §154 do prompt da missão):

- **Question**: qual direção visual adotar para a fundação?
- **Options**: A (Operational Calm, Remindax-inspired) · B (Neutral Precision).
- **Evidence**: contraste real medido em ambas; densidade real de 140 registros verificada em A;
  §18 e a evidência GOV.UK contra caixa-alta em status; a correção de rota do product owner.
- **Decision**: A.
- **Consequences**: linhas de duas linhas custam altura vertical; aceito, porque nenhum campo
  crítico é escondido para compensar.
- **Reversibility**: alta. A direção vive quase inteiramente na camada semântica de
  `tokens.css`; trocar accent, densidade de linha ou raio é editar tokens, não componentes.

**Sobre a referência.** Remindax é benchmark de **atmosfera** — clareza, leveza, aparência de
SaaS profissional, hierarquia calma, densidade moderada, ruído baixo. Nada foi copiado: paleta,
logotipo, ícones, ilustrações, textos, componentes proprietários e estrutura de tela são
próprios. O accent blue-indigo `#2F4FD0` foi escolhido **depois** de verificação de contraste,
não por semelhança; a taxonomia de status vem do domínio do Expiration Tracker (urgência
separada de ciclo de vida, `UNKNOWN_OUTCOME` distinto de falha), que a referência não tem.

## 12. Color

Duas camadas. **Nenhuma feature referencia um primitivo** (mission §57).

Primitivos: rampa neutra levemente fria de 12 passos (`--color-neutral-0..900`), accent
blue-indigo (`--color-accent-50/100/200/600/700/800`), e quatro famílias semânticas
(`red`/`amber`/`green`/`blue`) com 3 passos cada.

Semânticos e seus contrastes **medidos** (fórmula de luminância relativa WCAG, script próprio):

| Token | Valor | Sobre | Ratio | Exigido | |
|---|---|---|---|---|---|
| `--color-text-primary` | `#1B2333` | surface-default | **15,73:1** | 4,5 | ✔ |
| `--color-text-primary` | `#1B2333` | surface-page | **14,81:1** | 4,5 | ✔ |
| `--color-text-secondary` | `#5A6478` | surface-default | **5,95:1** | 4,5 | ✔ |
| `--color-text-secondary` | `#5A6478` | surface-subtle | **5,36:1** | 4,5 | ✔ |
| `--color-text-tertiary` | `#667085` | surface-default | **4,97:1** | 4,5 | ✔ |
| `--color-text-link` | `#2743B0` | surface-default | **8,35:1** | 4,5 | ✔ |
| `--color-text-on-accent` | `#FFFFFF` | action-primary | **6,67:1** | 4,5 | ✔ |
| `--color-action-primary` | `#2F4FD0` | surface-default | **6,67:1** | 3 (UI) | ✔ |
| `--color-focus-ring` | `#2F4FD0` | surface-page | **6,27:1** | 3 | ✔ |
| `--color-border-interactive` | `#858D9D` | surface-default | **3,34:1** | 3 (UI) | ✔ |
| `--color-border-interactive` | `#858D9D` | surface-page | **3,14:1** | 3 (UI) | ✔ |
| status critical fg/bg | `#B42318`/`#FEF3F2` | — | **6,05:1** | 4,5 | ✔ |
| status warning fg/bg | `#B54708`/`#FFFAEB` | — | **5,20:1** | 4,5 | ✔ |
| status success fg/bg | `#067647`/`#ECFDF3` | — | **5,40:1** | 4,5 | ✔ |
| status info fg/bg | `#175CD3`/`#EFF4FF` | — | **5,43:1** | 4,5 | ✔ |
| status neutral fg/bg | `#344054`/`#F1F3F7` | — | **9,49:1** | 4,5 | ✔ |

Além da tabela de paleta, o **contraste computado de cada elemento com texto realmente
renderizado** foi medido no navegador (não só os pares de token previstos). Foi assim que o
achado #1 apareceu: `--color-text-tertiary` sobre a superfície do cabeçalho de grupo dava
4,48:1 — abaixo do mínimo, e invisível numa revisão de paleta. Resultado após correção: **0
falhas**.

Cada status é um **trio** fg/bg/border, nunca um valor solto — é o que garante que a cor jamais
seja o único portador da informação.

## 13. Typography

Option A do §16 do prompt: **stack de fontes do sistema**, nenhuma fonte baixada. Option B
(fonte open source auto-hospedada) foi avaliada e recusada: o ganho visual sobre a system UI
stack num produto denso em pt-BR não é mensurável o suficiente para justificar peso de bundle,
uma requisição extra no caminho crítico e risco de FOUT numa ferramenta que se abre dezenas de
vezes por dia. Zero download, zero manutenção, integração nativa com a plataforma.

Escala em `rem` (nunca px no root — 200% de zoom e a configuração de tamanho de fonte do SO
dependem disso): 12 / 13 / 14 / 16 / 18 / 22 / 28. 14px é o corpo produtivo; 12px é restrito a
cabeçalho de coluna e texto de badge; nada menor existe. Três pesos (400/550/650). Sentence
case em todo lugar, sem `text-transform: uppercase` em nenhum status.

## 14. Spacing

Base 4px com ritmo de 8px acima de 8: `2 4 8 12 16 24 32 48 64`. Dez passos, nenhum a mais. A
escala foi derivada do conteúdo real (altura de controle, padding de célula, separação de
seção), não copiada.

## 15. Grid / Layout

O `max-width: 760px` global foi removido. Em vez de uma largura para tudo:

- coleções densas usam a viewport (`--layout-content-max: 1440px`);
- forms e prosa explicativa ficam estreitos (`--layout-reading-max: 42rem`);
- a lista de atributos do Detail é limitada a 56rem — a 1440px, um grid de duas colunas
  esticado deixa rótulo e valor a meia tela de distância;
- notices são limitados a 64rem: são lidos, não escaneados.

Nav lateral de 216px acima de 900px, virando uma linha que quebra abaixo disso.

## 16. Density

Dois regimes, expressos como padding, **não** como um toggle exposto ao usuário:

- **Produtivo/compacto**: coleções (`--density-row-padding-block: 12px`).
- **Confortável**: forms, seções de detalhe, confirmação.

## 17. Surfaces

Três superfícies e mais nada: `surface-page` (fundo), `surface-default` (branco, o painel e a
nav), `surface-subtle` (cabeçalho de grupo, fundo do controle de filtro). Hierarquia sai de
superfície + hairline + espaço, antes de sombra.

## 18. Borders / Radii / Elevation

Raios: 4 / 6 / 8px, e `pill` **exclusivamente** para badges. Nenhum container vira pill.

Bordas semânticas: `subtle` (separação), `default`, `interactive` (contorno de controle, 3,34:1),
`strong`, `danger`.

Elevação: exatamente dois passos além de `none` — `raised` (1px, quase imperceptível) e
`overlay` (reservado para algo que realmente flutua; hoje só o skip link o usa). Nenhuma sombra
dramática, nenhum glassmorphism, nenhum card empilhado sobre card.

## 19. Motion

`120ms` para microtransições, `160ms` como padrão, easing único. Motion só confirma estado ou
comunica transição — nunca decora. `prefers-reduced-motion: reduce` neutraliza tudo, verificado
no navegador: a animação do skeleton mede `1.4s` normalmente e `0.001s` sob reduced-motion; a
transição de botão, `0.12s` → `0.001s`.

## 20. Iconography

**Nenhuma biblioteca de ícones foi adicionada** (§50). O conjunto realmente necessário é
minúsculo — um marcador de forma no badge e um glifo de tom no notice — e ambos são desenhados
em CSS puro (border-radius / triângulo por borda) ou um caractere, sempre `aria-hidden`, sempre
acompanhados de texto. Nenhuma ação é apenas-ícone. Adicionar Lucide/Heroicons custaria
dependência, bundle e manutenção para substituir 5 linhas de CSS.

## 21. Status / Urgency

O sistema distingue os dois conceitos por construção (§32):

- **Situação** (ciclo de vida): Ativo / Arquivado / Renovado — de `presentItemStatus`.
- **Urgência** (relação com o relógio): Vencido / Vence hoje / Vence em N dias / Sem urgência /
  Não se aplica — de `presentItemUrgency`.

Na Collection são duas colunas; no Detail, dois badges lado a lado.

`StatusBadge` recebe a `StatusPresentation` já mapeada — **o call site não escolhe o tom**. Um
componente não consegue inventar um tom mais amigável do que o domínio suporta, porque não
escolhe tom nenhum. O tom `success` existe no sistema de tokens mas **nenhum mapeamento de
domínio o emite**: este domínio não possui um estado que prove "tudo certo" (`SATISFIED` é um
vínculo registrado; `CLEAN` é um scan de malware). Introduzir um mapeamento `success` é uma
mudança Type 1.

Três pistas por badge: rótulo textual, marcador de forma (círculo cheio / anel / triângulo /
quadrado), cor. Sob `forced-colors: active`, verificado no navegador: a borda vira `CanvasText`
e o rótulo sobrevive — o status continua identificável sem nenhuma cor autoral.

## 22. Dates / Numbers

Data absoluta **sempre** disponível (`DD/MM/YYYY`), com o contexto relativo ao lado ou na linha
de apoio — nunca "em breve" sozinho. `font-variant-numeric: tabular-nums` em toda a tabela, para
que datas alinhem coluna a coluna. `formatRelativeDueContext` foi extraída para que a tabela não
precisasse reconstruir a metade relativa fazendo `split(" · ")` sobre uma string de exibição.

## 23. Forms

Label visível sempre, `htmlFor`/`id` real, nunca placeholder no lugar de label. Obrigatoriedade
dita em palavras — `(obrigatório)` / `(opcional)` — não um asterisco cujo significado precisa ser
aprendido numa legenda em outro lugar da página.

O estado inválido usa três pistas simultâneas: borda do controle mais espessa, régua vermelha à
esquerda do campo inteiro, e a mensagem. Cor sozinha nunca.

`ErrorSummary` no topo com links (`href="#id-do-campo"`) que levam ao controle. A string exibida
no summary é **a mesma string** que o campo renderiza, passada pelo chamador — as duas não
conseguem divergir. Valores digitados sobrevivem a qualquer erro (já era verdade e continua
coberto por teste).

## 24. Feedback

Três níveis, e o nível é escolhido pela natureza da informação:

- **Inline**: erro de campo, aviso específico da tarefa.
- **Page/section notice** (`InlineNotice`): estado de sistema, recuperação significativa,
  conflito. É conteúdo de fluxo normal, **persistente por construção** — nunca um toast.
- **Toast**: não existe neste sistema. Nenhuma informação importante desaparece sozinha.

Semântica ARIA explícita e escolhida por caso: `alert` (interrompe) só quando algo acabou de dar
errado e bloqueia; `status` (educado) para confirmação; `none` para um notice já presente na
primeira pintura — anunciar seria ruído.

## 25. Loading / Empty / Error

Quatro padrões de loading distintos (§43), nunca um spinner global:

| Situação | Padrão |
|---|---|
| Primeira pintura, estrutura desconhecida | `InitialLoading` (texto, `role="status"`) |
| Primeira pintura, estrutura **conhecida** | `CollectionSkeleton` — linhas de altura reservada, sem salto de layout |
| Dados já na tela, atualizando | `BackgroundRefreshIndicator` — inline, nunca substitui o conteúdo |
| Mutação em voo | o próprio botão (`pending`), com o rótulo trocado |

Skeleton só onde representa estrutura real. As barras são `aria-hidden` com uma única live
region — um leitor de tela recebe "Carregando…" uma vez, não oito placeholders decorativos.

Cinco semânticas de empty preservadas e visualmente distintas: `true-empty` (o único com convite
a criar), `filtered-empty`, `not-ready`, `unavailable`, `permission-limited`. `unavailable` e
`permission-limited` deliberadamente **não** afirmam "não existem dados" — o sistema não tem
observabilidade para saber isso.

`UNKNOWN_OUTCOME` é renderizado `warning`, jamais `critical`: não é falha, é desfecho não
confirmado, e a cópia diz exatamente isso.

## 26. Data Tables / Collections

`DataTable` é uma `<table>` semântica genérica e tipada. **Não** é um ARIA `grid`: não há
modelo de teclado de planilha aqui, só leitura, comparação e navegação por link.

- Primeira coluna = identificador humano do registro, mais larga, quebra em vez de truncar (um
  nome de licença truncado não identifica nada).
- Grupos de urgência são `<tbody>` com `<th scope="colgroup">` — o agrupamento está na semântica
  da tabela, não só nos pixels.
- `<caption>` obrigatório (visualmente oculto) — a tabela precisa de nome programático.
- Container de scroll horizontal explícito, focável e nomeado (`role="region"`), porque Firefox
  e Safari não oferecem outra forma de rolá-lo sem mouse.
- Abaixo de 820px cada registro vira um bloco chave/valor rotulado via `data-label`. **Nada é
  escondido**: nome, data absoluta, urgência, situação e ação primária continuam presentes.

Deliberadamente ausentes: sorting, redimensionamento de coluna, seleção de linha, virtual
scrolling. Nenhum é exigido por journey aprovada; adicioná-los seria mudança de UX sem evidência.

**Densidade verificada de verdade** (o ponto que a auditoria de baseline registrou como nunca
verificado contra código real): `e2e/expiration-density.spec.ts` renderiza 140 itens com nomes
longos e quase-idênticos, três grupos de urgência, emissores presentes e ausentes, e afirma que
as 140 linhas existem, que a ordem dos grupos é a ordem de prioridade operacional, que cada
linha carrega os quatro campos que nunca podem cair, e que a página não rola horizontalmente a
375px nem a 640px (equivalente a 200% de zoom sobre 1280px).

## 27. Responsive

Alvos verificados: 375px, 640px (≡ 200% de zoom), 720px, 820px (breakpoint de stacking), 900px
(breakpoint da nav), 1440px.

- ≤900px: nav lateral vira linha que quebra; indicador de página atual passa de barra à esquerda
  para barra embaixo.
- ≤820px: tabela empilha (§26).
- ≤600px: a lista de atributos do Detail passa a uma coluna.
- Sem overflow horizontal de página em nenhum alvo (asserção automatizada, não inspeção visual).

## 28. Accessibility

Alvo: **WCAG 2.2 AA**. Verificado no navegador real, não só por leitura de código:

| Verificação | Resultado |
|---|---|
| Navegação só por teclado | 22 paradas percorridas na Collection; ordem DOM = ordem visual; sem armadilha |
| Foco visível | Anel de 2px `#2F4FD0` com offset em **todas** as 22 paradas |
| Foco não obscurecido (2.4.11) | Garantia estrutural: nada é `sticky`/`fixed` neste sistema exceto o skip link |
| Contraste (1.4.3) | 0 falhas medindo cor computada de todo elemento com texto renderizado |
| Target size (2.5.8) | Todos os controles ≥ 24px em ambas as dimensões após a correção do link identificador |
| Labels/erros de form | Label visível + `htmlFor`, `aria-invalid`, `aria-describedby`, summary com links |
| Headings/landmarks | `<nav aria-label>`, `<main id="surface-content" tabIndex={-1}>`, `<h1>` por página, `<section aria-labelledby>` |
| Estado sem depender de cor (1.4.1) | Badge = rótulo + forma + cor; campo inválido = borda + régua + mensagem; nav atual = tinta + peso + barra |
| Links vs botões | `Button` (`<button>`) para mutação, `ButtonLink` (`<Link>`) para navegação; nenhum `<div>` estilizado |
| Zoom 200% / reflow (1.4.10) | Sem scroll horizontal a 640px com 60 itens (asserção automatizada) |
| Reduced motion | `1.4s`→`0.001s` e `0.12s`→`0.001s`, medido |
| Forced colors | Bordas de badge viram `CanvasText`; anel de foco vira `Highlight`; rótulos sobrevivem |

**`axe` não foi adicionado.** O toolchain do `frontend/` não o tem (o `prototype/` tinha, mas é
outro artefato) e o prompt é explícito: obrigatório apenas se já fizer parte do projeto. Foi
mantido o que o repositório já usa e que é mais forte que axe nestes eixos: `eslint-plugin-jsx-a11y`
no lint bloqueante, mais as verificações no navegador acima.

**Nenhuma sessão com leitor de tela real foi executada.** NVDA/VoiceOver não estão disponíveis
neste ambiente. Semântica foi verificada estruturalmente (roles, nomes acessíveis, ordem de
foco), não por escuta. Registrado em §35 e §39, nunca declarado como conformidade completa.

## 29. Token Architecture

```text
primitivos  --color-neutral-900, --color-accent-600, --space-5, --font-size-300
     ↓
semânticos  --color-text-primary, --color-action-primary, --color-status-critical-fg
     ↓
componente  (só onde há necessidade real; hoje: --density-row-padding-block/inline)
```

Categorias: color, typography, spacing, size, radius, border, elevation, motion, layout,
z-index. `z-index` é um conjunto fechado e ordenado (`base`/`sticky`/`overlay`/`skip-link`) —
nenhum componente inventa um número.

Nomes descrevem **função**, nunca aparência: `--color-text-danger`, não `--red-button`.

Nenhuma camada de token de componente foi criada preventivamente. A troca de tema futura
acontece na camada semântica; os primitivos não são a costura.

## 30. Component Architecture

`frontend/src/components/ui/`:

| Componente | Papel | Notas |
|---|---|---|
| `Button` / `ButtonLink` | Ação vs. navegação | Dois componentes de propósito, porque a distinção semântica é o ponto. 4 variantes. `pending` é distinto de `disabled` |
| `StatusBadge` | Atributo compacto não interativo | Tom vem do mapeamento de domínio, não do call site |
| `UrgencyIndicator` | Urgência, distinta de situação | Reusa o primitive do badge; o que difere é a semântica |
| `DataTable` / `CellSecondary` | Coleção operacional | Genérico, tipado, com grupos e stacking |
| `InlineNotice` | Feedback persistente de página/seção | 5 tons; semântica live escolhida por caso |
| `PageHeader` / `Section` / `Toolbar` / `Panel` | Estrutura | `Panel` é o **único** container de agrupamento; não existe `Card` |

Existentes reescritos sobre os tokens sem mudar API pública: `AsyncStates` (+ `CollectionSkeleton`
novo), `TextField` (+ `id` opcional), `FormErrorSummary` (+ `fieldErrors` opcional).

Variantes descrevem intenção (`variant="danger"`, `tone="warning"`), nunca aparência
(`isBlue`). HTML nativo primeiro: nenhum widget customizado foi construído, nenhum `role` foi
adicionado onde o elemento nativo já o tinha.

**Nenhuma dev gallery / Storybook foi criada.** Ver §32.

## 31. Visual Regression

`frontend/e2e/visual-regression.spec.ts`, projeto Playwright `visual`, 10 baselines:

Overview desktop · Collection desktop densa (140) · Collection estreita densa · Collection
vazia · Detail desktop · Create estreito · Create com erros de validação · Renew em conflito OCC
· estado de erro compartilhado · anel de foco na ação primária.

Determinismo (§132): viewport fixo, locale/timezone fixos na config, **relógio congelado** via
`addInitScript` antes de qualquer código da aplicação avaliar, fixture com seed determinística,
animações desabilitadas pela própria chamada de screenshot, zero dependência de rede externa.
Uma suíte cujas baselines apodrecem à meia-noite é pior que nenhuma.

Tolerância: `maxDiffPixelRatio: 0.02` — absorve rasterização sub-pixel, ainda falha se uma
coluna se move, um badge some, o stacking quebra ou um cabeçalho de grupo colapsa. Sem guerra de
pixels (§136).

**Governança** (§69): um snapshot que muda é **item de revisão**, nunca algo a re-gravar até o
CI ficar verde. `--update-snapshots` só com explicação da mudança visual no PR que o faz.

**Limitação real e o caminho para resolvê-la.** Baselines de screenshot são por plataforma
(rasterização de fonte difere) e estas foram gravadas em `win32`, enquanto o CI roda em
`ubuntu-latest`. Por isso o projeto `visual` é **deliberadamente separado** e **não** faz parte
de `npm run test:e2e`: plugá-lo no job de CI hoje falharia por baseline ausente, não por
regressão real — um build vermelho que não ensina nada. Caminho de adoção, para quem retomar:
(1) rodar `npx playwright test --project=visual --update-snapshots` num runner Linux; (2)
commitar as baselines `-linux.png` resultantes; (3) adicionar `npm run test:visual` ao job
`frontend` de `.github/workflows/ci.yml`. Até lá, o CI cobre as mesmas superfícies
**funcionalmente** via `e2e/expiration-density.spec.ts`, que afirma as propriedades de
scannability de forma independente de rasterização.

## 32. Dependency Decisions

**Zero dependências novas.** `frontend/package.json` está byte-idêntico ao de `develop` exceto
por dois scripts npm.

| Candidato | Decisão | Razão |
|---|---|---|
| Tailwind / MUI / Chakra / Ant / Carbon React / Mantine / shadcn | **Não** | O frontend é deliberadamente enxuto. O sistema necessário são ~9 componentes pequenos e uma folha de tokens; um framework traria bundle, lock-in de identidade visual, custo de migração e uma aparência que não é do produto. A hipótese do prompt (§64) foi confirmada no código, não assumida |
| CSS-in-JS / CSS Modules | **Não** | Vite já faz bundle de CSS colocado ao lado do componente com escopo por convenção de nome. Runtime zero. Trocar a arquitetura de estilo seria decisão Type 1 sem benefício |
| Biblioteca de ícones | **Não** | Ver §20 |
| Storybook | **Não** | Custo de dependência + CI + configuração + manutenção para renderizar 9 componentes. As 10 baselines de Playwright já cobrem variantes, estados, conteúdo longo, densidade, status e erros nas superfícies reais — e o fazem no contexto real, que é onde os defeitos aparecem. Reavaliar quando o catálogo crescer a ponto de superfícies reais não cobrirem as variantes |
| Dev gallery interna | **Não** (por ora) | Mesma razão; e uma rota de galeria teria de ser garantidamente removida do bundle de produção (§43 do checklist), custo real por benefício hoje baixo |

Impacto de bundle: JS **inalterado**; CSS `22,7 kB` (4,4 kB gzip) — o único custo, e ele
substitui um arquivo anterior.

## 33. Visual Quality Addendum

Não substitui `docs/frontend/interface-quality-standard.md`. Nenhum eixo, peso ou threshold foi
alterado (isso seria Type 1). Este addendum mapeia os critérios visuais aos 12 eixos existentes:

| Critério visual | Eixo(s) |
|---|---|
| Visual hierarchy | 3 Information Presentation · 1 Task Suitability |
| Scannability | 3 · 7 Data Operations |
| Density | 3 · 7 |
| Typography | 3 · 8 Accessibility |
| Semantic color | 3 · 8 · 12 Trust/Risk |
| Component consistency | 9 Consistency |
| State completeness | 4 System Feedback · 5 Error Prevention/Recovery |
| Responsive behavior | 11 Responsiveness |
| Interaction affordance | 1 · 5 |
| Focus visibility | 8 |
| Contrast | 8 |
| Content / icon semantics | 10 Content · 8 |
| Motion restraint | 8 · 11 |
| Maintainability | 9 |

## 34. Quality Gates

| Gate | Resultado | Evidência |
|---|---|---|
| **VL-G1** Epistemic Integrity | **PASS** | Tom vem do mapeamento de domínio, não do call site; `success` sem emissor; `UNKNOWN_OUTCOME` = warning; aviso de lembretes copiados é warning, não success |
| **VL-G2** Contrast | **PASS** | 0 falhas medindo cor computada de todo elemento renderizado; 1 achado real corrigido (4,48:1) |
| **VL-G3** Color Independence | **PASS** | Badge: rótulo + forma + cor; campo inválido: borda + régua + mensagem; nav atual: tinta + peso + barra; verificado sob `forced-colors` |
| **VL-G4** Focus | **PASS** | Anel de 2px em 22/22 paradas; nada sticky, logo foco nunca obscurecido; baseline visual dedicada |
| **VL-G5** Core Task Hierarchy | **PASS** | Uma ação primária por superfície; identificador é a coluna mais larga; urgência tem coluna própria; nenhuma decoração acima de informação crítica |
| **VL-G6** Density | **PASS** | 140 itens, nomes longos e quase-idênticos, 3 grupos; asserção automatizada + baseline visual |
| **VL-G7** Responsive Integrity | **PASS** | Stacking mantém todos os campos; sem overflow a 375/640px; asserção automatizada |
| **VL-G8** Token Consistency | **PASS** | Nenhum hex fora de `tokens.css`; nenhuma feature referencia primitivo |
| **VL-G9** State Completeness | **PASS** | Button: default/hover/active/focus/disabled/pending. Field: default/hover/focus/invalid/disabled. Badge: não interativo (sem hover/focus, correto). Table row: default/hover |
| **VL-G10** Forms | **PASS** | Label visível, obrigatoriedade em palavras, erro em 3 pistas, foco, valores preservados (coberto por teste) |
| **VL-G11** Feedback | **PASS** | success/erro/pending/unknown têm tratamentos distintos; UNKNOWN nunca comprimido em FAILED |
| **VL-G12** Visual Regression | **PASS** | 10 baselines determinísticas reproduzíveis + governança e caminho de adoção em CI documentados (§31) |
| **VL-G13** Dependency Proportionality | **PASS** | Zero dependências novas |
| **VL-G14** Premature UX Redesign | **PASS** | Nenhuma journey/IA reaberta. As duas mudanças estruturais (§36) são correções de primitive e de rótulo ambíguo, ambas justificadas e registradas |
| **VL-G15** Accessibility Semantics | **PASS** | Nenhum widget customizado; `<table>` real em vez de `<ul>`; nenhum ARIA onde o nativo bastava |
| **VL-G16** Documentation Truth | **PASS** | Status provisório em todo lugar; ausência de teste com leitor de tela declarada; limitação de CI das baselines declarada |
| **VL-G17** Reference Alignment | **PASS** | Clareza, leveza, aparência de SaaS profissional, hierarquia calma, densidade moderada e ruído baixo preservados — e verificados contra dataset grande, não só contra 5 registros bonitos. Nada copiado da referência |

Nenhum gate em FAIL. Nenhum S4. Nenhum S3 não resolvido em fluxo crítico.

## 35. User Validation Deferrals

**PENDING USER VALIDATION** — hipóteses de design, nunca fatos. Nenhuma sessão com usuário
ocorreu; nada aqui deve ser lido como "usuários preferem/entendem/confiam".

| # | Item | Hipótese atual | O que perguntar |
|---|---|---|---|
| D-01 | Hierarquia visual exata da navegação | Nav lateral em desktop orienta sem competir com o conteúdo | Operadores procuram navegação à esquerda ou no topo? |
| D-02 | Rótulo "Visão geral" (era "Overview") | Interface pt-BR não deve vazar inglês | O termo é reconhecido? |
| D-03 | Rótulos "Sem urgência" / "Não se aplica" | Mais claros que ecoar o rótulo de situação | Fazem sentido, ou "Sem urgência" soa como "não importa"? |
| D-04 | Densidade final da coleção | Linha de duas linhas equilibra identificação e volume | Operadores com 300+ itens querem mais densa? |
| D-05 | Colocação de ações secundárias | "Renovar" por linha, à direita | É onde procuram, ou esperam entrar no detalhe? |
| D-06 | Agrupamento por urgência vs. lista plana ordenada | Agrupar ajuda a triagem | Os grupos ajudam ou fragmentam a leitura? |
| D-07 | Conjunto de colunas | Nome/Categoria/Data/Urgência/Situação é o mínimo comparável | Falta alguma? Sobra alguma? |
| D-08 | Ausência de KPIs na Overview | Contadores decorativos são ruído | Um contador acionável ajudaria a priorizar? |
| D-09 | Tratamento visual do conflito OCC | Warning + recarregar comunica "o registro mudou", não "quebrou" | O usuário entende o que aconteceu? |
| D-10 | Tratamento de alta fidelidade das outras 12 superfícies | Deliberadamente não iniciado | — |
| D-11 | Detalhes visuais de confiança no guest flow | Fora do slice | — |
| D-12 | Teste com leitor de tela real | Não executado (sem NVDA/VoiceOver no ambiente) | Executar antes de Pilot |
| D-13 | Accent blue-indigo como identidade | Passa contraste, não conflita com status | Transmite a personalidade certa? |

## 36. Claude Review (Round A)

Autoavaliação sobre os eixos do §157, feita depois de rodar a aplicação no navegador — não sobre
a intenção do código.

**Achados próprios, corrigidos nesta rodada:**

| # | Achado | Sev. | Correção |
|---|---|---|---|
| A-01 | `.ui-table__group-count` a 4,48:1 sobre o cabeçalho de grupo | S2 | `text-tertiary` → `text-secondary` |
| A-02 | Especificidade: `.ui-table td` (0,1,1) vencia `.ui-table__cell--primary` (0,1,0); no layout empilhado o emissor era empurrado para a direita | S2 | Seletores qualificados com `td` |
| A-03 | "Urgência: Ativo" ao lado de "Situação: Ativo" — os dois conceitos que §32 exige separar liam como o mesmo | S2 | "Sem urgência" / "Não se aplica" |
| A-04 | Link identificador com alvo de 19px de altura | S3 | `inline-block` + padding vertical → ≥25px |
| A-05 | Sublinhado permanente em 140 linhas = exatamente o ruído que a direção existe para evitar | S3 | Sublinhado em hover/focus; link continua distinto por cor + peso + posição |
| A-06 | Lista de atributos do Detail esticando 1440px, rótulo e valor a meia tela | S3 | `max-width: 56rem` + painel com padding |
| A-07 | Notice de página com linha de ~200 caracteres | S3 | `max-width: 64rem` |

**Julgamento honesto sobre as duas mudanças estruturais:**

- *`<ul>` → `<table>`*: **justificado**. Os registros compartilham atributos e a tarefa é
  comparar/escanear; a lista era o primitive errado e é onde a densidade falha. Mesmos dados,
  mesma ordenação, mesmo agrupamento, mesmo comportamento de filtro, mesmo contrato de rota.
- *rótulos de urgência*: **justificado, e é um achado, não uma preferência**. A ambiguidade só
  ficou visível ao colocar os dois conceitos lado a lado, que é precisamente o que §32 pede.
  Nenhum threshold, agrupamento, ordenação ou tom mudou — só dois rótulos. Registrado como D-03
  para confirmação com usuários.

**Autoavaliação Claude (Round A): 9,1/10.** O que segura a nota: nenhum teste com leitor de
tela real; as baselines visuais não estão gatilhadas no CI (limitação de plataforma, com
caminho de adoção documentado); e três dos sete achados próprios só apareceram ao medir a
página renderizada, o que sugere que a revisão de código sozinha teria deixado passar.

## 37. Codex Review (Round B)

Revisão adversarial **independente e real**, via `codex exec --skip-git-repo-check`
(`AGENTS.md` §4), sobre o código real da branch — não sobre um relato textual. Codex recebeu a
checklist de 50 itens, o contexto de escopo e de Epistemic Integrity, e os dois pontos que eu
próprio marquei como discutíveis (a troca de `<ul>` por `<table>` e a mudança de rótulos de
urgência).

**Nota Codex (Round B): 8,63/10** — abaixo do threshold de 9,0, o que reabriu a rodada em vez
de arredondar.

Cinco achados, todos reais e todos apontando para arquivo e linha:

| ID | Achado | Sev. |
|---|---|---|
| B-01 | `Button` usava `disabled={disabled ?? pending}`. `RenewItem` passa `disabled={conflict}`, que numa renovação normal é `false` — **não** `undefined` — então o `??` curto-circuitava no `false` explícito e deixava o botão de submit ativo enquanto exibia "Renovando…". Regressão real de proteção de mutação | **S2** |
| B-02 | Os cabeçalhos de grupo da tabela usavam `scope="colgroup"`, mas "Vencidos"/"Vence em breve"/"Demais ativos" encabeçam **linhas**, não colunas. Tecnologia assistiva associa o cabeçalho à dimensão errada — justamente o auxílio de navegação de que uma tabela de 140 linhas depende (checklist item 17) | **S2** |
| B-03 | Os botões de filtro anunciavam `aria-current="page"`. Eles não representam páginas; selecionam qual subconjunto de ciclo de vida da **mesma** coleção é exibido | S3 |
| B-04 | O container de scroll era um tab stop incondicional, embora o próprio comentário dissesse que só deveria ser focável quando pudesse rolar. Abaixo de 820px o layout empilha e nada transborda — sobrava uma parada de teclado vazia | S3 |
| B-05 | `tokens.css` e `playwright.config.ts` citavam `docs/frontend/visual-language-and-design-system.md`, ausente da branch no momento da revisão | S3 |

**Verificados como NÃO violados** pelo Codex: itens 1–16, 18–47 e 49–50 da checklist.
Explicitamente: nenhum `CLEAN` como aprovação, nenhum `SATISFIED` como conformidade atual,
nenhum `UNKNOWN_OUTCOME` como falha, nenhuma cópia de "agendado" como "entregue", nenhum status
apenas por cor, nenhuma cor hard-coded vazando para feature, nenhum dado crítico escondido no
mobile, nenhuma dependência de framework, **nenhuma cópia do Remindax**, nenhuma expansão de
escopo, nenhuma alegação de validação com usuários ou de finalidade.

Sobre as duas mudanças estruturais, o veredito independente foi que ambas são **justificadas**:
a tabela porque os registros são comparáveis e o caso de estresse de 140 itens a exige, com
filtro/ordenação/agrupamento/rotas/dados preservados; e os rótulos de urgência porque "Sem
urgência" descreve corretamente um item ACTIVE além do limiar de 7 dias e "Não se aplica"
impede que um estado de ciclo de vida encerrado seja repetido como urgência — nenhum dos dois
altera estado de domínio, agrupamento ou limiar.

Sobre a direção visual: *"apropriadamente contida — o snapshot denso permanece table-first e
operacionalmente escaneável, com uso limitado de accent, sem explosão de cards, sem sombras
dominantes, e uma identidade reconhecivelmente própria."*

## 38. Reconciliation (Round C)

Resposta achado a achado (formato §159). **Nenhum achado foi rejeitado** — os cinco eram
reais.

| ID | Veredito | Correção | Evidência de regressão |
|---|---|---|---|
| B-01 | **Aceito** | `disabled={Boolean(disabled \|\| pending)}` | Teste novo com exatamente a forma que `RenewItem` produz (`{ disabled: false, pending: true }`), afirmando `toBeDisabled()` e `aria-busy` |
| B-02 | **Aceito** | `scope="rowgroup"` | Teste novo afirmando o atributo **e** que o cabeçalho encabeça as linhas certas; role muda de `columnheader` para `rowheader`, e as 3 suítes que consultavam por role foram atualizadas |
| B-03 | **Aceito** | `aria-pressed={tab.value === status}`; o seletor CSS acompanhou (`[aria-pressed="true"]`) — trocar o atributo sem trocar o seletor teria deixado o estado selecionado invisível | E2E e testes de componente do filtro continuam verdes |
| B-04 | **Aceito** | Hook `useIsOverflowing` com `ResizeObserver` observando container **e** tabela; `tabIndex` e `role`/`aria-label` aparecem e desaparecem juntos, para que um elemento focável nunca fique anônimo. Sem `ResizeObserver` (jsdom) o fallback é `false` — a resposta honesta, já que ali não há layout para transbordar | Verificado no navegador real em três larguras: 1440px → sem tab stop (overflow 0); **860px → `tabindex="0"` + `role="region"` (overflow real de 5px)**; 375px → sem tab stop (empilhado). Mais um teste de componente para o caso não-scrollável |
| B-05 | **Aceito** | Este documento passou a integrar o change set | — |

Observação honesta sobre B-05: o documento não existia porque a revisão foi disparada em
paralelo à sua redação. O achado é legítimo do ponto de vista do que estava na branch, e a
correção é factual, não uma discordância.

## 39. Verification Evidence

| Verificação | Comando | Resultado |
|---|---|---|
| Typecheck | `npm run typecheck` (frontend) | limpo |
| Lint (inclui `jsx-a11y`) | `npm run lint` | limpo, `--max-warnings=0` |
| Unit/component | `npm test` | **112 passed** (era 110; +4 novos, −2 substituídos) |
| E2E funcional | `npm run test:e2e` | **15 passed** (era 12; +3 de densidade) |
| Regressão visual | `npm run test:visual` | **10 passed**, reproduzível em execução repetida |
| Build de produção | `npm run build` | limpo; JS inalterado, CSS 22,7 kB (4,4 kB gzip) |
| Contraste computado | script próprio no navegador | **0 falhas** |
| Percurso de teclado | script próprio no navegador | 22/22 paradas com anel visível, ordem correta |
| Reduced motion | script próprio no navegador | `1.4s`→`0.001s`, `0.12s`→`0.001s` |
| Forced colors | script próprio no navegador | bordas de badge → `CanvasText`, rótulos sobrevivem |
| Inspeção visual em navegador | manual | Overview, Collection densa (desktop + 375px), Detail (desktop + 375px), Create, Create com erros, Renew/OCC, estado de erro, foco |
| Drift de documentação | `npm run check-docs` (raiz) | limpo |

**Não executado, e declarado como tal:** teste com leitor de tela real (NVDA/VoiceOver
indisponíveis); `axe` (não faz parte do toolchain do `frontend/`, não adicionado por decisão);
smoke em Firefox/WebKit (o projeto só instala Chromium no CI; transformar isso em blocker seria
artificial).

## 40. Final Status

_A ser preenchido após a convergência Claude↔Codex._

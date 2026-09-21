# Expiration Tracker — Design System

Micro-SaaS pt-BR de **controle de vencimentos e renovações** (certificados, contratos, apólices,
licenças, certidões) com lembretes multi-canal. Backend AWS serverless (TypeScript/Node 20,
DynamoDB single-table); frontend React + Vite + react-router + TanStack Query.

O produto é uma ferramenta **operacional**: quem usa responde, várias vezes por dia, a uma
pergunta só — *o que precisa da minha atenção agora?* Toda decisão visual aqui serve a isso.

## Fontes deste design system

| Fonte | O que foi lido |
| --- | --- |
| Codebase anexado `frontend/` | `src/styles/tokens.css`, `src/styles/base.css`, `src/components/ui/**`, `src/components/forms/**`, `src/components/AsyncStates.*`, `src/shell/AppShell.tsx`, `src/routes/**`, `src/api/presentation.ts` |
| GitHub `marcelo-jgoncalves/expiration-tracker` | `README.md`, `docs/frontend/interface-quality-standard.md`, `prototype/README.md`, varredura de assets (nenhum) |
| `guidelines/visual-language-and-design-system.md` | **Documento normativo da linguagem visual** (APPROVED — PROVISIONAL PENDING USER VALIDATION), enviado pelo usuário. Cópia integral; é a autoridade sobre qualquer coisa que este readme diga |
| Capturas enviadas | `uploads/01-overview-desktop.png` … `uploads/06-renew-desktop.png` — usadas como diagnóstico, não como fonte de verdade |

Repositório: <https://github.com/marcelo-jgoncalves/expiration-tracker> — vale explorar
`docs/frontend/` (12 documentos de planejamento de interface: jornadas, inventário de telas,
wireframes, avaliação heurística) antes de qualquer trabalho novo de design. Nada substitui esses
documentos: eles são a razão de o produto ser como é.

**Não encontrado nas fontes (e por isso ausente aqui):** nenhum arquivo de logo, nenhum webfont,
nenhum ícone (SVG, sprite ou icon font), nenhuma imagem, nenhum deck. Onde uma marca apareceria, o
produto escreve o nome em tipo. Não foi desenhado nenhum símbolo nem substituído nenhum ícone —
`assets/` não existe porque não havia nada para copiar.

---

## Índice

- `styles.css` — ponto de entrada único (só `@import`s). Consumidores linkam este arquivo.
- `tokens/` — `colors.css`, `typography.css`, `spacing.css`, `shape.css`, `motion.css`, `layout.css`
- `base.css` — defaults de elemento, anel de foco, skip link, utilitários
- `refinements.css` — **camada de refinamento de craft** (delta sobre o produto; ver seção própria)
- `components/` — primitivos React: `core/`, `layout/`, `data/`, `forms/`, `feedback/`, `shell/`
- `guidelines/` — 19 cards de especímenes + `visual-language-and-design-system.md` (documento normativo)
- `ui_kits/webapp/` — recriação click-through das telas de Vencimentos + `README.md` próprio
- `github.md` — associação com o repositório de origem e mapa tela → arquivo
- `SKILL.md` — empacotamento como Agent Skill

### Componentes

| Grupo | Componentes |
| --- | --- |
| `core/` | **Button**, **ButtonLink**, **StatusBadge**, **UrgencyIndicator**, **InlineNotice** |
| `layout/` | **PageHeader**, **Section**, **Toolbar** (+ **ToolbarSpacer**), **Panel**, **FilterGroup**, **DetailList** |
| `data/` | **DataTable** (+ **CellSecondary**) |
| `forms/` | **TextField**, **FormErrorSummary** |
| `feedback/` | **EmptyState**, **ErrorState**, **CollectionSkeleton**, **InitialLoading**, **BackgroundRefreshIndicator**, **AsyncFeedback** |
| `shell/` | **AppShell** |

O inventário é exatamente o que o codebase define. **Adições intencionais** (duas, ambas extraídas
de markup que o produto já escreve à mão, nenhuma nova ideia de UI):

- **FilterGroup** — `Layout.css` já define `.ui-filter`, mas o markup vive solto em
  `ItemsCollection.tsx`. Virou componente para que o filtro de status seja uma decisão só.
- **DetailList** — existia como componente local dentro de `ItemDetail.tsx`.

---

## Fundamentos de conteúdo

A escrita é a parte mais madura deste produto e a mais fácil de estragar. A regra que governa tudo
está nos documentos do repositório como **Epistemic Integrity**: *a interface nunca apresenta um
estado com grau de certeza maior do que o domínio suporta.*

- **Idioma:** pt-BR em toda a interface. Termos de domínio em português; nada de "item", "due
  date", "status" vazando para o usuário. `lang="pt-BR"` no documento.
- **Pessoa:** o sistema fala com o operador em segunda pessoa quando o assunto é dele ("**Seus**
  vencimentos ativos", "Você não tem acesso a este conteúdo") e em terceira quando descreve o
  domínio ("Renovar cria um novo ciclo de vencimento"). O sistema nunca diz "eu".
- **Caixa:** sentence case em tudo — títulos, botões, badges, cabeçalhos de coluna. `text-transform:
  uppercase` só existe na camada de refinamento, para cabeçalhos de coluna e micro-rótulos —
  nunca para conteúdo escrito por humano.
- **Botões:** verbo no infinitivo + objeto: "Criar vencimento", "Confirmar renovação", "Renovar",
  "Atualizar", "Recarregar", "Tentar novamente". Estado pendente troca o rótulo: "Criando…",
  "Renovando…" (com `…`, nunca "...").
- **Nunca overclaim.** Exemplos reais do produto: `Document.CLEAN` é escrito "Verificado
  (segurança) — conteúdo não conferido", nunca "Aprovado". `SATISFIED` é "Vinculado a um
  vencimento", nunca "Em dia". Um resultado incerto é "Não foi possível **confirmar** se este
  vencimento foi criado. Verifique a lista antes de tentar novamente" — nunca "Falhou".
- **Datas sempre absolutas, com o relativo ao lado:** "29/08/2026 · Vence em 3 dias". Nunca "em
  breve" sozinho. Formato `DD/MM/AAAA`.
- **Obrigatoriedade em palavras:** "(obrigatório)" / "(opcional)" ao lado do label. Nunca um
  asterisco cujo significado se aprende em outro lugar da página.
- **Erros dizem o que fazer:** "Recarregue para ver o estado atual antes de renovar novamente."
- **Estados vazios não mentem:** "Nada cadastrado ainda" (existe nada) é diferente de "Nenhum
  resultado para este filtro" e de "Não é possível carregar isto agora".
- **Sem emoji.** Nenhum. Nem em vazio, nem em sucesso. (Só o prototype interno usa 🧪 na barra de
  cenários, que declaradamente não faz parte do produto.)
- **Vibe:** sóbria, precisa, sem entusiasmo. Ninguém é parabenizado por cadastrar um alvará.

## Fundamentos visuais

**Cor.** Rampa neutra levemente fria (azulada) — não é um produto "documento" bege nem uma
ferramenta de dev cinza puro. Um único acento azul-indigo (`#2f4fd0`) serve link, preenchimento
primário e anel de foco, escolhido por contraste verificado (6,67:1 nos dois sentidos). Cores de
status (vermelho/âmbar/verde/azul) são independentes do acento e nunca herdam a marca. Máximo dois
fundos por tela: `surface-page` (#f7f8fa) e `surface-default` (#fff).

**Tipografia.** Stack de sistema, sem webfont — decisão explícita do produto, não omissão. Sete
tamanhos em rem, três pesos (400/550/650), tracking negativo (-0.01/-0.02em) só em títulos.
`font-variant-numeric: tabular-nums` em qualquer coluna de data ou número.

**Espaçamento e layout.** Base 4px com ritmo de 8px acima de 8; dez passos. Rail de navegação de
216px, conteúdo até 1280px, prosa e formulários até 42rem. Nada é fixo ou sticky exceto o skip
link e (na camada de refinamento) o cabeçalho da tabela dentro do próprio painel — garantia
estrutural de que o foco nunca fica escondido (WCAG 2.2 SC 2.4.11).

**Fundos e imagens.** Nenhum. Sem gradiente, sem textura, sem padrão, sem ilustração, sem
full-bleed, sem grão. Superfícies são chapadas. Não há fotografia no produto, portanto não há
"vibe" de imagem para descrever — se um dia houver, ela precisa de decisão própria.

**Bordas, cantos e cards.** Hairline de 1px (`border-subtle` para separar, `border-default` para
delimitar, `border-interactive` para controles). Raios 8/12/18px (`sm`/`md`/`lg` — maiores que a
direção v1, parte da migração v2); pill **só** em badge. O único container de agrupamento é o
**Panel**: superfície branca, hairline, raio `lg` (18px), **com `shadow-raised`** (v2 — v1 não
tinha sombra em Panel), e nunca dentro de outro Panel. Não existe "card" neste sistema.

**Sombras.** Duas, ambas contidas: `shadow-raised` (0 2px 8px, 6% neutro) e `shadow-overlay`
(0 20px 48px, 12%, tom violeta — alinhado ao acento v2) — reservada para o que realmente flutua
(hoje: skip link em foco, e o próprio Panel via `shadow-raised`). Hierarquia continua vindo
principalmente de superfície, borda e espaço, não só de elevação.

**Transparência e blur.** Não usados. Nenhum `backdrop-filter`, nenhuma camada translúcida, nenhum
gradiente de proteção — não há imagem sob texto para proteger.

**Animação.** Três durações (0/120/160ms), uma curva (`cubic-bezier(0.2, 0, 0.2, 1)`). Transições
só em `background-color` e `border-color`. Nenhuma animação de entrada, nenhum bounce, nenhum
spinner. A única animação em loop é o pulso de opacidade (0.35 → 1) do skeleton e do indicador de
refresh. `prefers-reduced-motion` zera tudo.

**Hover / press / foco / disabled.** Hover escurece o preenchimento (accent-600 → 700) ou aplica a
superfície de hover; press escurece mais um passo (accent-800) — nunca escala, nunca sombra.
Nenhum press state usa transform. Foco: um único anel `outline` de 2px no acento, offset 2px,
resistente a forced-colors. Disabled: superfície cinza + texto desabilitado + `cursor: not-allowed`
— e "pendente" é um estado distinto de "desabilitado" (o rótulo muda).

**Nunca cor sozinha.** Todo status carrega três pistas: rótulo em texto, marcador de forma
(círculo cheio / anel / triângulo / bloco) e cor. Erro de campo carrega borda mais grossa + régua
vertical vermelha + mensagem. Página atual na navegação carrega tinta + peso + barra inset.

## Iconografia

**Lucide** (paths embutidos como SVG, sem dependência de CDN dentro dos componentes; CDN só nos
templates/UI kit v2) é o sistema de ícones adotado a partir da direção v2 (2026-08-27) — reverte a
decisão original abaixo, mantida aqui como registro histórico. `StatusBadge` e `InlineNotice` usam
um helper interno `components/core/Icon.jsx` (sem `.d.ts` — não é um componente público, é
implementação) com um conjunto fixo de ícones (dot/info/check-circle/alert-triangle/x-circle).
Ícones são SVG com `stroke="currentColor"`, `stroke-width="2"`, `stroke-linecap`/`linejoin="round"`
— sem preenchimento (exceto o `dot` neutro). Nenhum ícone é decorativo puro: nav, botões de ação
primária e chips de status sempre carregam o rótulo em texto ao lado, nunca só o ícone.

**Decisão original, pré-v2 (histórico):** não existia sistema de ícones — nenhum SVG, sprite, icon
font, PNG ou emoji; o vocabulário gráfico era só marcadores de forma em CSS e glifos de texto no
badge/notice. Essa decisão foi revertida pela direção v2; hoje `StatusBadge`/`InlineNotice` usam o `Icon` interno
descrito acima. Ver "Direção visual oficial" acima.

---

## Direção visual oficial (v2 — violeta)

**Atualização (2026-08-27):** por decisão do usuário, a exploração "world-class" — paleta violeta
(`#7c3aed`), tipografia Plus Jakarta Sans, ícones reais (Lucide) — é a direção visual oficial deste
design system. `tokens/colors.css` (acento) e `tokens/typography.css`/`tokens/fonts.css`
(tipografia) já foram migrados: **todo o sistema** (27 componentes, tokens, templates e o UI kit)
usa a mesma paleta agora, sem divergência entre camadas.

- **Cor:** ramp de acento trocada de indigo (`#2f4fd0`) para violeta (`#7c3aed`), aplicada só nos
  primitivos (`--color-accent-*`) — a camada semântica (`--color-action-primary` etc.) não mudou de
  nome, então nenhum componente precisou de edição.
- **Tipografia:** `--font-family-sans` agora é Plus Jakarta Sans, carregada via `@import` do Google
  Fonts em `tokens/fonts.css` (nenhum arquivo de fonte local foi fornecido — **flag para o
  usuário**: se enviar os arquivos de fonte, troco por `@font-face` local).
- **Ícones:** Lucide (CDN) é o sistema de ícones adotado nos templates/UI kit v2; dentro da
  biblioteca de componentes, `StatusBadge`/`InlineNotice` agora usam um `Icon` interno (mesmos
  desenhos Lucide, embutidos como SVG — sem dependência de CDN) em vez dos marcadores CSS/glifos
  de texto originais. A seção "Iconografia" abaixo foi atualizada — **isso reverte a decisão
  anterior de "nenhum ícone"** que o documento normativo original
  (`visual-language-and-design-system.md`) havia fixado.
- **Sombra/elevação:** `tokens/shape.css` foi migrado — raios maiores (18/12/8px) e `Panel` agora
  tem `shadow-raised`, alinhado aos templates v2. Todo o sistema usa a mesma escala agora.

O protótipo de referência completo é `ui_kits/webapp/index-v2.html` (standalone: `ui_kits/webapp/
Expiration Tracker - Prototipo v2.html`).

## Refinamentos sobre a implementação atual

As capturas enviadas mostram a linguagem visual implementada. A estrutura e as regras estão certas;
o **acabamento** é o que faz as telas parecerem protótipo. `refinements.css` corrige isso em uma
camada só, portável de volta regra por regra. Nada aqui muda arquitetura de informação, nem
adiciona capacidade que o backend não tem, nem enfraquece uma pista não-cromática.

1. **Moldura da página** — conteúdo medido em 1280px com gutter de 32/48px; título de página a
   28px com tracking apertado; descrição a 16px com medida de 62ch. Antes: página de 1440px de
   ponta a ponta com título de 22px, que lê como wireframe.
2. **Rail de navegação** — hairline sob o wordmark (o rail passa a ter cabeçalho), hit areas
   consistentes, "Sair" separado por uma régua em vez de flutuar no vazio.
3. **Toolbar e link de rodapé viram parte do Panel** — antes o filtro flutuava acima da tabela e
   "Ver todos os vencimentos" flutuava abaixo, deixando a composição aberta nas duas pontas. Agora
   o painel tem cabeçalho (título + contagem + filtro + refresh) e rodapé.
4. **Cabeçalho de coluna vira uma camada** — caixa alta 12px com tracking 0.06em, peso 650, e
   `position: sticky` dentro do painel da coleção densa: os rótulos ficam com os dados que
   rotulam. Densidade `compact` (8px) para volume.
5. **O muro de azul acabou** — o nome do registro era accent-600 semibold em toda linha. Agora é
   accent-800 peso medium: a pista de cor sobrevive, o ruído não. Sublinhado continua no hover/foco.
6. **Pill só para o que pede atenção** — "Ativo" e "Sem urgência" em pill, linha após linha,
   gastavam o tratamento mais alto do sistema no valor menos informativo. `--inline` mantém rótulo
   **e** marcador de forma (as pistas não-cromáticas seguem intactas) e remove só o container.
   Vencido e "vence em breve" continuam em pill.
7. **A data lidera o detalhe** — a data de vencimento é a razão de o registro existir e estava
   enterrada na segunda linha de uma lista de definição. Agora abre a página em 28px tabular, com o
   contexto relativo embaixo, ao lado de categoria, periodicidade e responsável.
8. **Hairlines contínuos na lista de definição** — o `gap` de coluna partia cada régua em dois
   segmentos flutuantes (visível na captura 04). O gap virou padding no rótulo.
9. **Atributos em dois painéis lado a lado** — um registro com 9 atributos deixava 600px de canvas
   vazio embaixo de si. "Identificação do documento" e "Acompanhamento interno" fecham a página.
10. **Formulário deixa de ser 11 caixas idênticas** — dois painéis ("O essencial", "Complemento"),
    campos dimensionados pelo conteúdo (data 200px, número 240px, categoria 340px) e campos curtos
    em duas colunas. Ações separadas por uma régua acima.
11. **Linha de atenção na Visão geral** — três contagens, **cada uma um link** para o grupo de
    registros que ela conta. Não são KPI tiles: um número que não leva a uma tarefa não entra.
    *É a única adição de informação em relação ao produto atual — precisa do seu aval.*
12. **Layout estreito (≤820px)** — rótulos alinhados em coluna em vez de empurrados para bordas
    opostas, nome a 16px semibold, ação de linha em largura total. Nada foi escondido: esse
    requisito continua valendo.

### Alinhamento com o documento normativo

Três propostas minhas colidiam com decisões já fechadas em
`guidelines/visual-language-and-design-system.md`. Todas foram corrigidas em favor do documento:

- **Caixa-alta em cabeçalho de coluna: revertida.** §13 fixa sentence case em todo lugar, e a
  Direction B recusada era justamente a que usava "cabeçalhos de coluna em caixa-alta com
  tracking" (§10). Cabeçalhos agora se distinguem por tamanho, peso e cor, com tracking de
  0,02em — nada de caixa-alta em nenhum lugar da interface.
- **Cabeçalho de tabela fixo (sticky): removido.** §28 garante estruturalmente "zero elementos
  sticky/fixed fora o skip link" (SC 2.4.11) e essa garantia é uma **asserção executável no CI**
  (`A11Y-focus-not-obscured`). Pinar o `thead` exigiria decisão Type 1 e mudança no gate — não é
  um refinamento de acabamento. A prop `stickyHeader` do `DataTable` ficou reservada e sem efeito.
- **Largura de conteúdo: dividida.** §15 diz que coleções densas usam a viewport
  (`--layout-content-max: 1440px`). A medida menor de 1280px passou a valer só para registro e
  formulário (`.ui-page--record`), onde a leitura ganha com isso.

Duas outras propostas respondem a perguntas que o documento deixou **explicitamente abertas** —
portanto não são invenção, são candidatas para User Validation:

- A **linha de atenção** da Visão geral responde D-08 ("um contador acionável ajudaria a
  priorizar?"). Cada contagem é um link para o grupo que ela conta; nenhum número decorativo.
- A **densidade `compact`** (8px de padding de linha, contra os 12px de §16) responde D-04
  ("operadores com 300+ itens querem mais densa?"). O padrão do sistema continua 12px.

**Consequência de processo:** qualquer parte desta camada que for portada altera as 10 baselines
de regressão visual (§31). Pela governança do próprio documento, snapshot que muda é **item de
revisão** — re-gravar com `--update-snapshots` só com a mudança visual explicada no PR.

**Deliberadamente recusado:** barra de ações fixa no rodapé do formulário (pode esconder o campo em
foco — o sistema garante estruturalmente que nada é fixo), busca e ordenação de coluna (o backend
não expõe nenhuma das duas hoje; fingir seria inventar capacidade), tiles de KPI e gráficos de
rosca, toasts, zebra striping.

## Como usar

Consumidores linkam um arquivo: `styles.css`. Componentes leem tokens **semânticos** (`--color-text-
secondary`, `--color-surface-default`), nunca primitivos (`--color-neutral-700`) e nunca hex.

```jsx
<PageHeader title="Vencimentos" description="Tudo o que está sendo acompanhado."
  actions={<ButtonLink href="/items/new" variant="primary">Novo vencimento</ButtonLink>} />
<Panel header={<><h2 className="ui-panel__title">Ativos</h2><span className="ui-panel__count">18 registros</span></>}>
  <DataTable caption="Vencimentos — Ativos" density="compact" stickyHeader … />
</Panel>
```

Cada componente tem `<Name>.prompt.md` ao lado com "o que & quando", exemplo e variantes.

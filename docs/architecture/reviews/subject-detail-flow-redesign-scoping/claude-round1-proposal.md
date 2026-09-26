# Redesenho do fluxo de detalhe de Fornecedor (pós-clique em um fornecedor) — Proposta Rodada 1 (Claude)

## Pedido de Marcelo (2026-09-26)

"Isso não está nada intuitivo. Todo esse fluxo e telas depois que clicamos em um fornecedor
específico precisa ser auditado e melhorado. Está confuso e pouco intuitivo, com muitas telas
pequenas." Pedido explícito de acionar o protocolo Claude↔Codex para repensar essa parte.

## Escopo confirmado antes de propor (nenhum documento aprovado cobre isso hoje)

`docs/frontend/omnivence-screen-implementation.md` (o redesign OmniVence recente, itens 31-33 do
backlog) **não cobre o fluxo de detalhe de fornecedor** — só a listagem (`OmniVence-fornecedores-
especificacao-implementacao.md`, escopo explícito: "listagem, busca, alternância... acesso a
detalhe/edição" — não especifica o QUE existe dentro do detalhe). O fluxo pós-clique (A09 Hub +
A11 Requisitos + A14 Solicitações + A17 Dossiê) nunca teve uma especificação de navegação própria
— foi implementado incrementalmente ao longo de Blocks 3/6/7/10 sem um desenho de conjunto. Isto
não é reabrir uma decisão fechada; é a primeira vez que esse fluxo específico é avaliado como um
todo.

## Achados reais (leitura direta do código, `frontend/src/routes/subjects/`)

1. **Hub-de-cards para páginas de nível superior desconectadas, sem casca persistente.**
   `SubjectHub.tsx` (`/subjects/:subjectId`) é uma página com 3 cards (`MetricCardGrid`) que
   levam a 3 destinos DIFERENTES: dois caem em `/requirements?subjectId=...` (rota de nível
   TOPO, fora de `/subjects/`), um cai em `/subjects/:subjectId/requests`. Cada destino
   reimplementa seu próprio cabeçalho/back-link do zero — não existe uma casca (header com nome
   do fornecedor + navegação) que persista entre as telas. O usuário "entra" no fornecedor e cada
   clique parece uma navegação para um lugar novo e não relacionado, não uma aba dentro do mesmo
   contexto.

2. **Dois cards do Hub levam à MESMA tela.** "Requisitos documentais" e "Documentos"
   (`SubjectHub.tsx:88` e `:102`) apontam para a EXATA MESMA URL
   (`/requirements?subjectId=...`) — o comentário do próprio código admite a razão: "A12's
   dedicated Documents Collection doesn't exist yet - degrades to the same requirements list,
   filtered". Do ponto de vista do usuário, dois botões com nomes e contadores diferentes abrem a
   mesma lista, com o mesmo título "Requisitos documentais" nas duas vezes — nunca uma tela sobre
   "Documentos". É um problema de produto (falta uma visão de documentos própria), não só de
   estilo.

3. **Perda de contexto inconsistente entre os destinos.** `SubjectRequests.tsx:133` e
   `DossierExport.tsx:170` fazem `above={<Link>← Voltar para {subject.displayName}</Link>}` —
   corretos, nomeiam o fornecedor. `RequirementsCollection.tsx` (destino de 2 dos 3 cards do Hub)
   **não tem link de volta nenhum** e seu `<h1>` fica sempre "Requisitos documentais", nunca "de
   {fornecedor}" — só a descrição abaixo muda de texto (`:147`), sem nomear QUAL fornecedor. Um
   usuário que chega em "Requisitos documentais" via um fornecedor não tem como voltar para ele
   sem usar o botão "Voltar" do navegador.

4. **`RequirementDetail` é um overlay dentro de uma página global, não uma rota própria.**
   `RequirementsCollection.tsx:92/162` guarda `viewingRequirement` em `useState` local e renderiza
   o detalhe como overlay — a URL nunca muda, não é possível voltar/avançar pelo navegador nem
   compartilhar um link direto para um requisito específico. Diverge do padrão do resto do app
   (`ItemDetail`, `DocumentDetail` são rotas reais).

5. **Nenhum componente de abas existe no design system hoje.** `Layout.tsx` documenta
   explicitamente que `StatusFilter` (o componente mais próximo) **não é** um tablist ("nunca uma
   ARIA tablist, que prometeria um tabpanel/modelo de teclado que não existe aqui"). Ou seja, uma
   casca com abas de verdade seria a PRIMEIRA do tipo no app — não reaproveita nada existente,
   mas também não colide com nada.

## Direção proposta (mecanismo, não pixel-perfect - isso fica para uma segunda fatia depois da
direção aprovada)

Substituir o padrão "hub de cards → páginas desconectadas" por uma **casca persistente de
fornecedor** com abas reais:

- Uma rota-container `/subjects/:subjectId` com layout compartilhado: cabeçalho fixo (nome,
  tipo/identificador, badge de arquivado, ações Editar/Exportar dossiê/Excluir — o que já existe
  em `SubjectHub.tsx` hoje) + um `role="tablist"` real (Conformidade | Requisitos | Solicitações),
  usando `<Outlet>`/rotas aninhadas do React Router (o app já usa rotas aninhadas em
  `app/:orgId/*`, mesmo mecanismo, um nível mais fundo).
- **Conformidade** (aba padrão): o painel que hoje é `CompliancePanel` em `SubjectHub.tsx` — vira
  a aba inicial, não uma seção isolada no topo de uma página de cards.
- **Requisitos**: versão ESCOPADA de `RequirementsCollection` (não a página global) — mesma lista/
  criação/detalhe, mas vivendo dentro da casca do fornecedor, sem duplicar como 2 cards diferentes
  para a mesma coisa. O card "Documentos" desaparece como destino próprio até A12 existir de
  verdade (não fingir uma segunda tela que não existe) — ou os itens da lista de Requisitos já
  mostram a evidência/documento vinculado diretamente (o que `requirementsQuery.data.requirements
  .filter(r => r.evidenceVersionId)` já calcula hoje, só nunca virou uma visão própria).
- **Solicitações**: `SubjectRequests` (A14) sem mudança de conteúdo, só passa a viver como aba em
  vez de rota irmã com seu próprio cabeçalho duplicado.
- **Exportar dossiê**: continua uma ação (não uma aba) — é um fluxo de uma tacada só (preview →
  confirmar → gerar → baixar), não uma visão persistente do fornecedor; abrir como modal (mesmo
  padrão já usado pelos itens 31 de conversão rota→modal) em vez de rota própria é candidato a
  avaliar na Rodada 2, mas não é o problema central levantado por Marcelo.
- `RequirementDetail` ganha rota própria aninhada (`/subjects/:subjectId/requirements/:requirementId`)
  em vez de `useState` local, fechando o achado 4 de quebra.

## Nível de risco e processo

Nível 5 (`change-risk-scale.md`): introduz um padrão de navegação novo (abas reais, primeira do
tipo no app) que precisa ser bem desenhado antes de aplicar - decisão difícil de reverter só
depois de replicada. Não nível 6 porque não muda modelo de dados/contrato de API, só a casca de
apresentação de telas já existentes. Pesquisa externa (E-014): `SIM PARCIAL` — o padrão "entity
detail com abas persistentes" é extremamente estabelecido (Linear, GitHub issue/PR pages, Stripe
Dashboard customer detail) mas a composição específica de quais 3 abas e o que cada uma mostra é
interna a este produto.

## Perguntas em aberto para a Rodada 2 (Codex)

1. Este mecanismo (rota-container + `<Outlet>` + tablist) é o caminho certo, ou existe um jeito
   mais simples dado que o app não tem NENHUM tablist hoje (ex.: replicar o padrão pill-tabs já
   usado na listagem de Fornecedores/Vencimentos do protótipo, que É clicável mas nunca foi
   desenhado como ARIA tablist real - `role=group`+`aria-pressed`, como `StatusFilter` já faz)?
2. "Documentos" deveria mesmo desaparecer como destino separado (fundido em Requisitos), ou isso
   está descartando cedo demais uma necessidade real de produto (ver a lista de documentos por
   fornecedor, não por requisito)?
3. Mobile: a casca com abas precisa de um tratamento específico (abas viram lista/accordion?) -
   nenhuma tela do app hoje tem esse padrão para copiar.

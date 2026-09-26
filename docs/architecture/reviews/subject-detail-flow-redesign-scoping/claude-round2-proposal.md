# Redesenho do fluxo de detalhe de Fornecedor — Proposta Rodada 2 (Claude)

Revisão da Rodada 1 (7,5/10) incorporando a crítica do Codex integralmente — não uma defesa da
proposta original.

## Premissa corrigida (achado real do Codex, aceito)

Existe sim design aprovado anterior: `docs/frontend/prototype-screen-specs/A09-subject-hub.md`
(revisado 2026-09-09) descreve deliberadamente um **hub de cards** (não abas persistentes) como
modelo de navegação, com um gap conhecido e aceito à época ("Documentos" degradar para a lista de
Requisitos com filtro de evidência, até A12 fechar). Minha Rodada 1 errou ao dizer que "nenhum
documento cobre isso".

**Por que ainda assim proponho ir além do que o A09 spec descreve** (não é reabrir uma decisão à
toa): o pedido de Marcelo nesta sessão não é "a implementação divergiu do spec" — é "esse modelo
de navegação (hub de cards → páginas desconectadas) está confuso, com muitas telas pequenas",
dito depois de ele mesmo navegar o fluxo real. Marcelo é a autoridade final de produto
(`AGENTS.md` §1) e um pedido direto dele supera um spec de 2026-09-09 que nunca foi validado com
ele navegando o fluxo de verdade (a etapa "User Validation" do planejamento de interface segue
não iniciada, `docs/frontend/README.md`). Isso não invalida o A09 spec como trabalho — a parte de
RBAC/estados/composição visual dele continua correta e é reaproveitada abaixo; só o mecanismo de
navegação entre os "destinos" muda.

**Também aceito integralmente**: o card "Rastreamento legado" do A09 spec está morto (retirado por
completo em D-334, 2026-09-25, depois do spec) — mais um sinal de que este documento precisa de
reconciliação, não só desta sessão.

## Mecanismo revisado (aceitando a recomendação do Codex)

- **Rota-container + `<Outlet>` + `<nav aria-label="Seções do fornecedor">` com `NavLink`**,
  espelhando o mecanismo já usado em `AppShell.tsx:137` — nunca um `role="tablist"` ARIA novo sem
  justificar semântica de teclado que a proposta não demonstrou precisar.
- **Conformidade deixa de ser uma seção/aba própria** — vira um resumo compacto (percentual +
  fração + 3 badges, exatamente o que `CompliancePanel` já renderiza) fixado ACIMA da lista de
  Requisitos, que passa a ser a **seção padrão de entrada** (sem clique intermediário). Fecha
  diretamente a reclamação de "muitas telas pequenas" — hoje são 2 cliques (Hub → card) para
  chegar em qualquer conteúdo real; com isso vira 1 (entrar no fornecedor já mostra Conformidade +
  Requisitos juntos).
- **Solicitações** vira a 2ª seção da navegação local (mesmo conteúdo de `SubjectRequests` hoje,
  só sem cabeçalho duplicado).
- **"Documentos" como destino separado desaparece** (o link duplicado que aponta pro mesmo lugar
  que Requisitos é o achado mais claro e menos contestável da Rodada 1) — mas, ao contrário da
  proposta original, isso só entra na MESMA fatia se o achado abaixo (evidência sem link pro
  documento) for fechado junto; não removo o destino e deixo a tarefa documental pela metade.
- **Dossiê continua como ação, não seção** — mantém rota própria (`/subjects/:subjectId/dossier`),
  aceitando o achado do Codex de que `runId` na URL é retomável e uma migração pra modal
  quebraria essa propriedade sem uma reconciliação própria, fora de escopo aqui.
- **`RequirementDetail` ganha rota própria** (`/subjects/:subjectId/requirements/:requirementId`),
  mesmo precedente já existente de "diálogo governado pela rota" que o Codex apontou
  (`/subjects/:subjectId/series/:seriesId`) — não crio um padrão novo, replico um que já existe.

## Os 4 achados novos do Codex — como cada um entra no escopo

1. **Nome do requisito abre o fornecedor, não o requisito** (`RequirementsCollection.tsx:227`) —
   bug real e independente da casca; corrigido junto (nome deveria abrir o requisito, igual ao
   botão "Ver" já faz; o link para o fornecedor, se ainda fizer sentido fora do contexto
   filtrado, vai no nome do FORNECEDOR listado ao lado, não no nome do requisito).
2. **Campo de fornecedor editável na criação escopada** (`RequirementsCollection.tsx:354`) — dentro
   da casca nova, o formulário de criação passa a receber o `subjectId` do CONTEXTO da rota
   (parâmetro, nunca um campo de formulário) — a escapatória de "trocar de fornecedor
   silenciosamente" deixa de existir por construção, não por validação a mais.
3. **Evidência vinculada sem link pro documento real** — pré-requisito para remover "Documentos"
   como destino (ver acima). A lista de Requisitos (dentro da nova seção) ganha o link direto para
   `/documents/:documentId` quando `evidenceDocumentId` existir (o dado já existe no contrato,
   `types.ts:170`, só nunca virou link).
4. **"Nova solicitação" inconsistente entre entradas** (`RequirementDetail.tsx` sempre promete
   e-mail; `SubjectRequests.tsx` oferece as 3 opções reais de entrega) — `RequirementDetail`
   passa a reaproveitar o MESMO componente/opções de entrega que `SubjectRequests` já usa
   (`DELIVERY_OVERRIDE_OPTIONS`/`RadioGroup`), fechando a promessa que a entrada de
   `RequirementDetail` fazia sem sustentação.

## Mobile (resposta à pergunta 3 da Rodada 1, endossada pelo Codex)

Mesmos links/URLs, sem accordion automático — disposição horizontal quando couber, quebra/
empilha quando não. "Persistente" significa contexto preservado entre rotas, não header preso à
viewport no celular.

## Pesquisa externa (E-014) — declaração formal, faltou na Rodada 1

**SIM PARCIAL.** O padrão "entity detail com resumo + seções de navegação local" é estabelecido
(GitHub issue/PR pages, Linear, Stripe Dashboard customer detail — container com identidade fixa
e navegação por link/`NavLink`, nunca um ARIA tablist para isso) — fonte: WAI-ARIA Authoring
Practices Guide, padrão Tabs (`https://www.w3.org/WAI/ARIA/apg/patterns/tabs/`, já citado pelo
Codex na Rodada 1) confirma que tablist promete um modelo de teclado/seleção que uma navegação por
rota não deveria simular sem necessidade real. A composição específica de quais seções este
produto precisa (Conformidade+Requisitos fundidos vs. Solicitações) é interna, não um padrão
externo a seguir cegamente.

## Nível de risco (revisado)

Nível 5, mantido — mudança de organização de navegação com intenção de padrão reutilizável, mas
sem reversão de decisão de design system já fechada (Codex concordou que não há motivo pra nível
6). A implementação em si (container+links dentro de uma direção já aprovada) é nível 3-4 uma vez
que esta Rodada feche ≥9,0 — não precisa de nova rodada de protocolo por peça implementada depois.

## Pendência explícita fora desta fatia

`docs/frontend/prototype-screen-specs/A09-subject-hub.md` precisa de reconciliação formal (card
"Rastreamento legado" morto, seção "Documentos" trocada por seção fundida) — registrar como
follow-up de documentação após esta decisão fechar, não bloquear a decisão em si por isso.

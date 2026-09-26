# Redesenho do fluxo de detalhe de Fornecedor — CONVERGIDO (Rodada 3)

**Nota cega final: Claude 9,2/10 — Codex 9,1/10. Ambos ≥9,0, sem arredondar. APROVADO** (design,
não implementação/testes — Codex explicitamente distingue os dois na Rodada 3).

Régua estável (9,2/9,1) — os 5 critérios pesados de `claude-round3-proposal.md` são a base de
avaliação; ambos os lados confirmam que a proposta atende aos 5. Pesquisa externa (E-014): SIM
PARCIAL, 2 fontes NN/g verificadas (`local-navigation`, `breadcrumbs`, consultadas 2026-09-26) +
WAI-ARIA APG Tabs (já citada desde a Rodada 1) — 1 fonte não verificável removida na Rodada 3.

## Decisão final (mecanismo, pronto para implementação)

1. Rota-container `/app/:orgId/subjects/:subjectId` com `<Outlet>` + navegação local (`NavLink`,
   mesmo mecanismo de `AppShell.tsx:137`) — identidade do fornecedor (nome/tipo/ações) nunca
   desmonta ao trocar de seção.
2. **Conformidade funde como resumo compacto acima de Requisitos** — Requisitos vira a seção de
   entrada padrão (fecha o clique intermediário que hoje existe).
3. **Solicitações** vira 2ª seção da navegação local (mesmo conteúdo de `SubjectRequests` hoje).
4. **"Documentos" desaparece como destino duplicado** — condicionado a: a lista de Requisitos
   ganha link real para `/documents/:documentId` quando `evidenceDocumentId` existir. Ressalva
   registrada e mantida: isso NÃO é uma Coleção de Documentos completa do fornecedor (A12
   collection, gap de produto separado, não fechado aqui).
5. **Dossiê continua ação com rota própria** (`/subjects/:subjectId/dossier`) — não vira seção,
   preserva `runId` retomável na URL.
6. **`RequirementDetail` ganha rota própria** (`/subjects/:subjectId/requirements/:requirementId`),
   mesmo precedente de "diálogo governado pela rota" já usado por
   `/subjects/:subjectId/series/:seriesId`.

## 4 bugs reais a corrigir junto (achados do Codex, Rodadas 1-3)

1. Nome do requisito na lista (`RequirementsCollection.tsx:227`) deve abrir o REQUISITO (mesmo
   destino de "Ver"), não o fornecedor.
2. Dentro da casca, `subjectId` vem do parâmetro da rota, nunca de um campo de formulário editável
   (fecha a escapatória de troca silenciosa de fornecedor na criação escopada,
   `RequirementsCollection.tsx:354`). A criação a partir da coleção global (fora da casca) continua
   exigindo seleção explícita de fornecedor.
3. Evidência vinculada ganha link real para o documento (`evidenceDocumentId`, `types.ts:170`) —
   pré-requisito para o item 4 acima.
4. `RequirementDetail`'s "Nova solicitação" adota o contrato comportamental INTEIRO de
   `CreateAvulsoDialog`/`SubjectRequests.tsx:373-408` (estado inicial `DEFAULT`, envio de
   `initialInviteDelivery`, e-mail obrigatório só para `EMAIL`, omissão de destinatário vazio,
   erros reais do servidor — nunca promessa incondicional de envio). Implementação: extrair
   `CreateAvulsoDialog` como formulário/lógica compartilhada entre as 2 entradas, com apresentação
   adequada a cada uma (`RequirementDetail` já é um `Dialog` — não aninhar diálogo dentro de
   diálogo).

## Pendência de documentação registrada (não bloqueia esta decisão)

`docs/frontend/prototype-screen-specs/A09-subject-hub.md` precisa de reconciliação formal depois
desta implementação (card "Rastreamento legado" morto desde D-334; seção "Documentos" trocada
pela fusão em Requisitos) — follow-up separado, não parte desta decisão.

## Próxima ação

Implementação real (nível 3-4, aplicação direta de decisão já aprovada — protocolo Claude↔Codex
não precisa de nova rodada por peça implementada, `AGENTS.md` §4).

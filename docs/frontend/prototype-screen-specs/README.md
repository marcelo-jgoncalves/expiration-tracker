# Expiration Tracker — Especificações de Tela (protótipo Claude Design)

**Proveniência**: pacote gerado por uma sessão do Claude Design a partir de
`docs/frontend/p0-screen-inventory-plan.md` (D-247), recebido como .zip em 2026-09-09
("Expiration tracker_ pesquisa concluída.zip", extraído e renomeado para este diretório — os
nomes de arquivo originais eram uma numeração sequencial 01-24 sem relação com os IDs de tela do
plano; renomeados aqui para `<ID-da-tela>-slug.md`, mesmo ID usado em `p0-screen-inventory-plan.md`,
para permitir correspondência direta 1:1). Os assets do design system (`_ds/*.css`, `_ds_bundle.js`)
referenciados abaixo NÃO vieram neste pacote — são de uma entrega separada.

**Status**: material de apoio para implementação (specs de UI concretas: componentes, props,
dados de exemplo, regras de RBAC por tela), gerado por IA a partir do plano `APPROVED`. Não passou
pelo protocolo Claude↔Codex (não é decisão de arquitetura) e não deve ser tratado como fonte
normativa acima do plano em si — em caso de divergência, `p0-screen-inventory-plan.md` vence.

**Lacuna real encontrada ao organizar este pacote (2026-09-09), fechada em 2026-09-10**: o plano
original tem 25 telas incluindo **A10 — Legacy Tracked Requirements** (`RequirementAssignment`,
rota `/app/:orgId/subjects/:subjectId/tracking`). Este pacote **não continha uma spec para A10** — o
Hub do Fornecedor (A09, aqui `A09-subject-hub.md`) referencia um card "Rastreamento legado" que
navegaria para ela, mas nenhum arquivo `A10-*.md` havia sido gerado pelo Claude Design. Diferente das
outras 24 telas (geradas pelo pacote e depois auditadas), `A10-rastreamento-legado.md` foi **escrita
do zero nesta sessão**, já aplicando diretamente as 5 lições de sistema convergidas no audit das
outras 24 (`docs/architecture/reviews/screen-spec-audit-2026-09-09/system-level-findings.md`), e
auditada com o mesmo instrumento (ver `A10-audit-record.md` na mesma pasta) — WORLD-CLASS-READY,
Functional 94.0/Visual 92.0/Consolidado 92.4. O conjunto de 25 telas do plano está agora
completamente coberto por spec.

## Sistema de design

- **Fonte:** Plus Jakarta Sans
- **Cor de destaque:** violeta `#7c3aed` (var `--color-action-primary`)
- **Ícones:** Lucide (via componente `Icon` do DS, prop `name`)
- **Todos os tokens são CSS custom properties** carregadas de `_ds/expiration-tracker-design-system-.../tokens/*.css` (colors, fonts, typography, spacing, shape, motion, layout) + `base.css`, `refinements.css`, `styles.css`, e o bundle JS `_ds_bundle.js` que expõe o namespace global `ExpirationTrackerDesignSystem_f760aa` com todos os componentes React.
- **Idioma:** Português (pt-BR) em toda a UI.
- **Não usar cor fora do design system.** Toda cor vem de `var(--color-*)`.

## Stack de implementação

Cada tela é um arquivo único que carrega os CSS tokens do design system + o bundle JS, monta um `AppShell` (para telas autenticadas) e usa componentes do bundle: `PageHeader`, `Panel`, `DataTable`, `DetailList`, `StatusBadge`, `UrgencyIndicator`, `InlineNotice`, `Button`, `ButtonLink`, `FilterGroup`, `CellSecondary`, `EmptyState`, `AsyncFeedback`, `Icon`, `TextField`. O engenheiro deve reimplementar essa árvore de componentes (ou equivalentes) no framework de destino — a especificação de cada tela lista exatamente quais componentes, props e dados cada um recebe.

## Navegação global (AppShell) — telas autenticadas

Item de menu ativo (`current: true`) varia por tela; a lista é sempre a mesma, nesta ordem:

1. Visão geral — ícone `layout-dashboard` — rota Dashboard (A03)
2. Vencimentos — ícone `calendar` — rota Vencimentos (A04)
3. Fornecedores — ícone `building` — rota Fornecedores
4. Requisitos — ícone `list-checks` — rota Requisitos (A11)
5. Revisões — ícone `clipboard-check` — rota Fila de revisão (A13)
6. Relatórios — ícone `file-text` — rota Relatórios (A16)
7. Configurações — ícone `settings` — rota Tipos de documento/Time/Preferências (A18–A22)

Rodapé do shell: botão terciário pequeno "Sair" (logout).

## RBAC — papéis

`OWNER` > `ADMIN` > `MEMBER` > `VIEWER`. Regras observadas nas telas (aplicar como regra geral onde não especificado):
- **VIEWER**: somente leitura em tudo.
- **MEMBER**: leitura + escrita operacional (criar/editar vencimentos, requisitos, revisar documentos, solicitações), sem administração de organização.
- **ADMIN**: tudo que MEMBER faz + gestão de time (exceto remover OWNER), catálogos (tipos de documento, templates de requisito), exportação de dossiê, configurações de organização.
- **OWNER**: tudo, incluindo encerrar a organização e não pode ser removido/rebaixado enquanto for o único OWNER.
- Exportar dossiê de fornecedor (A17): restrito a OWNER e ADMIN mesmo que o usuário seja o responsável direto pelo fornecedor.
- Membership suspensa: organização aparece desabilitada em A02 com badge "Suspensa".

## Convenções de UI reaproveitadas em todas as telas

- **Compliance/conformidade**: sempre mostrar porcentagem E fração (numerador/denominador), nunca só uma das duas.
- **Ações destrutivas** (excluir, arquivar, encerrar, rejeitar, revogar, remover): variant `danger` ou `tertiary`, sempre na barra de ações inferior, nunca como ação primária de cabeçalho.
- **Barras de ação com duas zonas**: ações contextuais/secundárias à esquerda, ações de decisão (aceitar/confirmar) à direita.
- **Filtros de status**: componente `FilterGroup` dentro de um wrapper `overflow-x:auto` (evita vazamento horizontal do painel em telas estreitas), com contagem por opção.
- **Links "voltar"** (`above` do PageHeader): `← Voltar para X`, sempre presente em telas de detalhe.
- **Estados assíncronos**: usar `AsyncFeedback` com `state="PENDING"` + mensagem; sucesso via `InlineNotice tone="success"`; erro via `InlineNotice tone="critical"`.
- **Wizards multi-etapa** (Importação CSV, upload de convidado): badges de etapa no topo, etapa ativa destacada, navegação Voltar/Continuar.
- **Tabelas**: sempre via `DataTable` com `density="compact"`, `columns`, `rows`, `rowKey`, `caption` (para leitores de tela).
- **Contraste**: texto mínimo 4.5:1; badges usam tons `neutral` (default/ativo), `warning` (atenção), `critical` (bloqueante/vencido/erro).

## Índice de telas

| Arquivo spec | ID no plano (`p0-screen-inventory-plan.md`) | Tela | Rota |
|---|---|---|---|
| A01-sign-in.md | A01 | Entrar | `/sign-in` |
| A02-onboarding.md | A02 | Organizações / Onboarding | `/organizations` |
| A03-dashboard.md | A03 | Visão geral | `/dashboard` |
| A04-vencimentos.md | A04 | Vencimentos (lista) | `/expirations` |
| A05-vencimento-detalhe.md | A05 | Detalhe do vencimento | `/expirations/:id` |
| A06-politica-lembrete.md | A06 | Política de lembrete | `/expirations/:id/reminders` |
| A07-arquivos-vencimento.md | A07 | Arquivos do vencimento | `/expirations/:id/files` |
| A08-fornecedores.md | A08 | Fornecedores (lista) | `/subjects` |
| A09-subject-hub.md | A09 | Hub do fornecedor | `/subjects/:id` |
| A10-rastreamento-legado.md | A10 | Rastreamento legado (`RequirementAssignment`) | `/subjects/:id/tracking` |
| A11-requisitos.md | A11 | Requisitos (lista) | `/requirements` |
| A12-documento-detalhe.md | A12 | Detalhe do documento | `/documents/:id` |
| A13-fila-revisao.md | A13 | Fila de revisão | `/reviews` |
| A14-solicitacoes-recorrencia.md | A14 | Solicitações e recorrência | `/subjects/:id/requests` |
| A15-importacao-csv.md | A15 | Importação em massa (CSV) | `/import` |
| A16-relatorios-exportacoes.md | A16 | Relatórios e exportações | `/reports` |
| A17-dossie-fornecedor.md | A17 | Exportar dossiê do fornecedor | `/subjects/:id/dossier` |
| A18-preferencias-notificacao.md | A18 | Minhas preferências de notificação | `/settings/notifications` |
| A19-time-organizacao.md | A19 | Time e organização | `/settings/team` |
| A20-catalogo-tipos-documento.md | A20 | Catálogo de tipos de documento | `/settings/document-types` |
| A21-templates-requisitos.md | A21 | Templates de requisitos | `/settings/requirement-templates` |
| A22-config-entrega-solicitacao.md | A22 | Configuração de entrega de solicitação | `/settings/request-delivery` |
| A23-log-auditoria.md | A23 | Log de auditoria | `/audit-log` |
| G01-upload-convidado-legado.md | G01 | Upload de convidado (legado) | `/guest/upload/:token` |
| G02-solicitacao-documento-convidado.md | G02 | Solicitação de documento (convidado) | `/guest/request/:token` |

Nenhuma spec para o mecanismo de cota de storage (D-249, adicionado ao plano depois deste pacote
ter sido gerado) — outra lacuna esperada, não é um erro do pacote em si, só reflete que ele foi
gerado antes dessa adição ao plano.

Cada arquivo de spec é autocontido: pode ser entregue individualmente a uma IA/engenheiro de implementação.

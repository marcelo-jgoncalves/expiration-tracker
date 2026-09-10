# A11 — Requisitos documentais (lista, toda a organização)

**Revision history**: revised 2026-09-09 per
`docs/architecture/reviews/screen-spec-audit-2026-09-09/A11-audit-record.md` (batch 3/6) — route
corrected to include `:orgId`, title/nav disambiguated per plan §2.4, creation contradiction removed,
full RBAC action table added, search + assignee added, missing states added, mobile filter-drawer and
table→cards transform specified, motion decision named. **Naming-collision verification**: this
screen is confirmed to use the newer, evidence-backed `Requirement` (document-archive module, 5-state)
— NOT the legacy `RequirementAssignment` (subject module, MISSING/SATISFIED only, lives in A10). See
audit record for the explicit verification.

**Rota:** `/app/:orgId/requirements`
**Nav ativo:** "Requisitos"

## Ações (mapeadas para `authorization.ts`)

| Ação visível | Capability | Tier |
|---|---|---|
| Ler/buscar/filtrar a lista | `docarchive:requirement-read` | todos (READ_ONLY_ROLES) |
| Criar requisito avulso (botão de cabeçalho) ou via Template aplicado (A21) | `docarchive:requirement-create` | WRITE_ROLES |
| Editar / vincular-desvincular evidência de um requisito | `docarchive:requirement-update` | WRITE_ROLES |
| Excluir requisito (menu de linha) | `docarchive:requirement-delete` | **WRITE_ROLES — não ADMIN** (exceção confirmada no plano: esta é uma das poucas ações `-delete` que não é ADMIN_ROLES) |
| Exportar CSV | `docarchive:requirement-export` | ADMIN_ROLES |
| Aplicar Template (abre A21) | `docarchive:requirementtemplate-apply` | WRITE_ROLES |

VIEWER: vê a lista completa e pode buscar/filtrar; não vê o botão "Novo requisito", nem ações de
editar/excluir/vincular evidência na linha, nem "Exportar CSV" (oculto, não desabilitado).

## Estrutura

1. `PageHeader`: título "Requisitos documentais", descrição "Requisitos de documento, com evidência
   vinculada, em toda a organização." Ação de cabeçalho: "Novo requisito" (secondary, WRITE_ROLES —
   abre um formulário curto ou o fluxo de Template, decisão de produto a confirmar; ambos os caminhos
   de criação nomeados no plano coexistem: avulso aqui, ou em lote via A21).
2. **Barra de busca + filtros**: campo de busca (nome do requisito ou fornecedor, debounced 300ms) +
   `FilterGroup` (overflow-x:auto em desktop, drawer em mobile — ver Responsivo) com opções e
   contagem:
   - Todos / Em falta (`MISSING`) / Pendente (`PENDING`) / Satisfeito (`SATISFIED`) / Não satisfeito
     (`NOT_SATISFIED`) / Não se aplica (`NOT_APPLICABLE`)
   - Filtros ativos são anunciados via texto visível (não apenas estado do componente) e têm ação
     "Limpar filtros".
3. `DataTable` compacta, colunas:
   - Requisito (primary): nome (link → abre a aba "Requisitos" do Hub do fornecedor, A09, focada
     neste requisito — destino determinístico, nunca condicional) + fornecedor/subject
     (`CellSecondary`)
   - Responsável: nome do assignee (avatar opcional) ou "Sem responsável" se `assigneeUserId` ausente;
     se o usuário foi removido da organização, mostrar "Responsável removido" em vez do nome.
   - Status: `StatusBadge` — MISSING/NOT_SATISFIED tone `critical`; PENDING tone `warning`; SATISFIED
     tone `neutral` + ícone `check`; NOT_APPLICABLE tone `neutral` + ícone `minus` (distinção visual
     entre os dois estados "neutros", não apenas o tone).
   - Validade (numeric, data em `tabular-nums` ou "—").
   - Ações: menu de linha (ícone `more-vertical`) com "Ver" (sempre), "Editar"/"Vincular evidência"/
     "Excluir" (WRITE_ROLES, oculto para VIEWER).

## Estados

- Loading: skeleton de linhas com a mesma estrutura da tabela.
- `EMPTY_TRUE` (organização sem nenhum requisito): "Nenhum requisito cadastrado ainda." + explicação +
  ação "Aplicar um template" (se WRITE_ROLES).
- `EMPTY_FILTERED` (filtro/busca sem resultado): "Nenhum requisito encontrado para estes filtros." +
  "Limpar filtros".
- Erro ao carregar: `InlineNotice tone="warning"` com "Tentar novamente".
- Resultado parcial (paginação): indicador explícito de "mostrando N de M" quando M > N.
- Evidência do requisito pendente/rejeitada/expirada: mostrado como nota secundária na coluna Status
  (ex. "Pendente · evidência rejeitada em 03/09").
- `NOT_APPLICABLE` explicitamente distinto de `MISSING` (ver Status acima).
- Ao aplicar um Template (A21) e retornar: itens duplicados por nome são sinalizados como
  `DUPLICATE_NAME` — visível no preview da A21, não recriados aqui silenciosamente.
- Exclusão: dialog de confirmação nomeando o requisito e o fornecedor (nunca "Tem certeza?" sozinho).

## Dados de exemplo (8 registros)

| Requisito | Fornecedor | Responsável | Status | Validade |
|---|---|---|---|---|
| Certificado de Regularidade FGTS | Conservare Facilities ME | Marina Costa | MISSING | — |
| CND Federal | Conservare Facilities ME | Marina Costa | SATISFIED | 12/03/2027 |
| CND Federal | Atlas Schindler | Sem responsável | PENDING | — |
| Contrato de manutenção | Atlas Schindler | João Silva | SATISFIED | 30/06/2027 |
| Apólice vigente | Porto Seguro | João Silva | SATISFIED | 01/02/2027 |
| Contrato de locação atualizado | Imobiliária Vértice | Responsável removido | MISSING | — |
| Comprovante de propriedade | Imobiliária Vértice | Sem responsável | NOT_APPLICABLE | — |
| Contrato de fornecimento | Comerc Energia | Marina Costa | SATISFIED | 15/09/2026 |

## Regras de negócio

- Esta é a visão cross-fornecedor de todos os Requisitos documentais da organização; a visão
  por-fornecedor filtrada vive dentro do Hub do Fornecedor (A09).
- `PENDING` = versão de documento enviada mas ainda não aceita pela revisão (ver A13 Fila de revisão).
- Este `Requirement` (document-archive, evidence-backed, 5 estados) é um conceito distinto do
  `RequirementAssignment` legado (A10) — nunca rotular ambos apenas como "Requisito"; esta tela usa
  sempre "Requisito documental" em título/nav/breadcrumb.

## Responsivo

- Desktop: tabela como descrita acima.
- Mobile (<768px): filtros migram para um `Drawer` acionado por um botão "Filtros (N)"; a tabela vira
  lista de cards com prioridade de campos: Requisito → Status → Fornecedor → Validade → Responsável
  (disclosure).
- Filtros ativos permanecem anunciados mesmo dentro do drawer fechado (chip resumo acima da lista).

## Motion

- Mudança de filtro/busca: sem animação — troca de conteúdo instantânea (lista de alta frequência
  operacional, animação atrasaria o trabalho repetido).
- Abertura do drawer de filtros em mobile: `motion.normal` (180ms), consistente com o padrão de
  overlays do sistema.
- Respeita `prefers-reduced-motion`: drawer abre sem transição de slide, apenas aparece.

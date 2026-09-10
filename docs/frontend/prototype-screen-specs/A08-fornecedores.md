# A08 — Fornecedores (lista de sujeitos rastreados)

**Revisão 2026-09-09 (screen-spec-audit-2026-09-09, batch 2/6)**: reescrita após auditoria NOT PASS
(ver `docs/architecture/reviews/screen-spec-audit-2026-09-09/A08-audit-record.md`). Correções: rota
carrega `:orgId`; busca adicionada (era ausente apesar de ser tarefa primária da tela); RBAC de
edição/exclusão explicitada (era só criação); tipo mapeado para o enum real do backend; tags/contato
adicionados; estados EMPTY_TRUE/duplicidade/exclusão-bloqueada nomeados; transformação
tabela→cards mobile especificada (era ausente); composição autoral em torno de risco de pendência
(ordenação por pendências, não apenas alfabética).

**Rota:** `/app/:orgId/subjects`
**Acesso:** todos os papéis (leitura); criação/edição WRITE_ROLES; exclusão ADMIN_ROLES
**Nav ativo:** "Fornecedores"

## Estrutura

1. `PageHeader`: título "Fornecedores", descrição "Terceiros que precisam manter documentação em dia
   com você.", ação "Novo fornecedor" (`primary`, abre A09 em modo de criação — não apenas um link
   solto; navega para `/app/:orgId/subjects/new` e trata o "Hub do fornecedor" como formulário de
   criação quando não há `:subjectId`).
2. **Painel único**, header composto: título "Fornecedores" + contagem; campo de busca
   (`TextField`, placeholder "Buscar por nome ou CNPJ/identificador…", debounce, com botão de limpar)
   ao lado de `FilterGroup` (overflow-x:auto) com opções "Ativos" / "Arquivados" + contagem cada.
   Busca e filtro combinam (busca dentro do subconjunto filtrado); nenhum resultado de busca mostra
   `EmptyState` "Nenhum fornecedor encontrado para '{termo}'" + ação "Limpar busca" — distinto do
   EMPTY_TRUE abaixo.
3. `DataTable` compacta, ordenada por padrão com pendências primeiro (fornecedores com
   `pending > 0` no topo, depois os demais por nome — o risco de pendência lidera a leitura, não a
   ordem alfabética pura), colunas:
   - Fornecedor (primary): nome (link → Hub do fornecedor, A09) + identificador externo/CNPJ
     (`CellSecondary`, `tabular-nums`)
   - Tipo — rótulo de exibição mapeado do enum real (`COMPANY`→"Empresa", `VENDOR`→"Fornecedor",
     `CLIENT`→"Cliente", `EMPLOYEE`→"Colaborador", `ASSET`→"Ativo", `LOCATION`→"Unidade",
     `CUSTOM`→rótulo customizado definido pelo tenant); a descrição de negócio mais específica (ex.
     "Prestador de serviço", "Seguradora") vive como um subtítulo opcional dentro da mesma célula,
     abaixo do rótulo de tipo, nunca substituindo-o.
   - Responsável (nome + avatar iniciais; "—" se não atribuído)
   - Tags (até 2 pills visíveis + "+N" se houver mais, `Popover` no hover/foco para ver todas)
   - Requisitos (numeric, `tabular-nums`, ex. "2 no total")
   - Pendências: `StatusBadge` tone `warning` com ícone `alert-circle` "{N} pendente(s)" se
     `pending>0`; senão texto neutro com ícone `check` "Tudo vinculado".
   - Ações (menu `⋯`, aparece no hover/foco da linha): "Editar" (WRITE_ROLES), "Arquivar"/"Reativar"
     (WRITE_ROLES), "Excluir" (ADMIN_ROLES apenas, sempre a última opção do menu, separada por
     divisor).

## Estados

- **EMPTY_TRUE** (tenant novo, zero fornecedores cadastrados, sem filtro ativo): `EmptyState`
  calmo — "Nenhum fornecedor cadastrado ainda" + "Cadastre o primeiro fornecedor para começar a
  acompanhar a documentação dele." + ação "Novo fornecedor" — lido como estado de sucesso de um
  tenant novo, nunca como erro.
- **EMPTY_FILTERED**: nenhum resultado sob o filtro/busca atual — mensagem distinta de EMPTY_TRUE
  (ver Estrutura, item 2).
- **Carregando**: skeleton com a mesma estrutura de colunas da tabela (nunca página em branco).
- **Falha ao carregar**: `InlineNotice tone="critical"` "Não foi possível carregar os fornecedores."
  + ação "Tentar novamente".
- **Identificador externo duplicado** (ao criar/editar): validação inline no formulário de A09,
  "Este CNPJ/identificador já está cadastrado para {nome do fornecedor existente}" com link para o
  registro existente — nunca uma mensagem genérica de erro.
- **Exclusão bloqueada por regra de negócio** (Requisitos ativos vinculados): ao tentar excluir,
  `Dialog` explica "Não é possível excluir '{nome}' — existem {N} requisito(s) ativo(s) vinculados a
  este fornecedor." + ação "Ver requisitos" (→ A11 filtrado por este Subject) em vez de apenas negar a
  ação sem alternativa.
- **ARCHIVED**: linhas aparecem esmaecidas (opacidade reduzida) sob o filtro "Arquivados"; ação de
  menu vira "Reativar" no lugar de "Arquivar".
- **DELETED**: fornecedor excluído não aparece em nenhum filtro desta lista (soft-delete final,
  consistente com A07's tratamento de arquivos excluídos).

## Dados de exemplo (5 registros, filtro padrão = Ativos, ordenados por pendência)

| Nome | Ext. ID | Tipo (enum → subtítulo) | Responsável | Tags | Total | Pendentes | Status |
|---|---|---|---|---|---|---|---|
| Conservare Facilities ME | 14.221.900/0001-55 | Fornecedor · Prestador de serviço | Marina Costa | Operacional | 2 | 1 | ACTIVE |
| Atlas Schindler | 58.470.834/0001-27 | Fornecedor · Prestador de serviço | Marina Costa | Manutenção | 2 | 1 | ACTIVE |
| Imobiliária Vértice | 22.884.410/0001-02 | Fornecedor · Locador | Diego Alves | Contratos | 2 | 1 | ACTIVE |
| Porto Seguro | 61.198.164/0001-60 | Fornecedor · Seguradora | Diego Alves | — | 1 | 0 | ACTIVE |
| Comerc Energia | 09.071.232/0001-88 | Fornecedor · Energia | Marina Costa | — | 1 | 0 | ARCHIVED |

## RBAC

| Ação | OWNER | ADMIN | MEMBER | VIEWER |
|---|---|---|---|---|
| Ver / buscar / filtrar | ✓ | ✓ | ✓ | ✓ |
| Criar / editar / arquivar / reativar | ✓ | ✓ | ✓ | — |
| Excluir | ✓ | ✓ | — | — |

VIEWER: sem botão "Novo fornecedor" e sem itens de menu de linha (menu `⋯` some inteiramente, não
aparece desabilitado). MEMBER: menu de linha sem "Excluir".

## Responsivo e acessibilidade

- Tabela → cards empilhados <768px: cada card mostra nome+CNPJ (topo, papel de maior peso), tipo,
  responsável e o badge de pendências (o campo de maior prioridade de leitura, logo abaixo do nome —
  não ao final do card); tags e contagem de requisitos ficam sob "Ver mais ▸" por padrão. Ação de
  linha vira menu acessível por toque no próprio card.
- Busca e filtro permanecem no topo (não colapsam para dentro de um menu) em qualquer largura, dado
  que localizar um fornecedor é a tarefa primária da tela.
- Todo controle interativo (busca, filtro, links de linha, menu de ações) tem `focus-visible` e nome
  acessível; tabela usa `caption` para leitores de tela.

## Motion

- Reordenação da tabela ao trocar de filtro ou concluir uma busca não anima reposicionamento de
  linha por linha (evita distração em uma lista operacional de alta frequência) — a lista atualiza
  instantaneamente, com um `InlineNotice` sutil de contagem atualizada substituindo o header do
  painel. O menu de ações (`⋯`) abre com `motion.fast` (120ms). Nenhuma outra transição decorativa.
  `prefers-reduced-motion`: sem alterações adicionais necessárias, já que nenhuma animação acima
  depende de movimento contínuo.

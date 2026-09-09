# Fornecedores — Lista de fornecedores/terceiros

**Rota:** `/subjects`
**Acesso:** todos os papéis; VIEWER sem criação
**Nav ativo:** "Fornecedores"

## Estrutura

1. `PageHeader`: título "Fornecedores", descrição "Terceiros que precisam manter documentação em dia com você.", ação "Novo fornecedor" (primary, link).
2. **Painel único**, header composto: título "Fornecedores" + contagem; `FilterGroup` (overflow-x:auto) com opções "Ativos" / "Arquivados" + contagem cada.
3. `DataTable` compacta, colunas:
   - Fornecedor (primary): nome (link → Hub do fornecedor, A09) + identificador externo/CNPJ (`CellSecondary`)
   - Tipo (ex. "Prestador de serviço", "Seguradora", "Locador", "Fornecedor de energia")
   - Responsável
   - Requisitos (numeric, ex. "2 no total")
   - Pendências: `StatusBadge` tone `warning` "{N} pendente(s)" se `pending>0`; senão texto neutro com ícone `dot` "Tudo vinculado"

## Dados de exemplo (5 registros, filtro padrão = Ativos)

| Nome | Ext. ID | Tipo | Responsável | Total | Pendentes | Status |
|---|---|---|---|---|---|---|
| Conservare Facilities ME | 14.221.900/0001-55 | Prestador de serviço | Marina Costa | 2 | 1 | ACTIVE |
| Atlas Schindler | 58.470.834/0001-27 | Prestador de serviço | Marina Costa | 2 | 1 | ACTIVE |
| Porto Seguro | 61.198.164/0001-60 | Seguradora | Diego Alves | 1 | 0 | ACTIVE |
| Imobiliária Vértice | 22.884.410/0001-02 | Locador | Diego Alves | 2 | 1 | ACTIVE |
| Comerc Energia | 09.071.232/0001-88 | Fornecedor de energia | Marina Costa | 1 | 0 | ARCHIVED |

## RBAC

- VIEWER: sem botão "Novo fornecedor".

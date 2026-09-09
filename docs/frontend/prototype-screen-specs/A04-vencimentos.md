# A04 — Vencimentos (lista)

**Rota:** `/expirations`
**Acesso:** todos os papéis; VIEWER sem os botões de criação/edição (ver seção RBAC)
**Nav ativo:** "Vencimentos"

## Estrutura

1. `PageHeader`: título "Vencimentos", descrição "Itens com prazo de validade, independente de fornecedor ou documento.", ações no cabeçalho: "Importar CSV" (tertiary, link → A15) + "Novo vencimento" (primary, link).
2. **Painel único** com header composto (coluna): título "Vencimentos" + contagem de registros na linha 1; `FilterGroup` (dentro de wrapper `overflow-x:auto`) na linha 2, com opções e contagem por status:
   - Todos
   - Vencidos (`OVERDUE`)
   - Vence em breve (`EXPIRING`)
   - Válidos (`VALID`)
   - Permanentes (`PERMANENT`, sem data de vencimento — ex.: licenças sem prazo)
3. `DataTable` compacta, colunas:
   - Vencimento (primary): nome (link p/ A05) + categoria (`CellSecondary`)
   - Responsável (texto)
   - Data de vencimento (numeric; "—" se permanente)
   - Urgência: `UrgencyIndicator` (tons: critical=vencido, warning=vence em breve, neutral=sem urgência/não se aplica)

## Estado / lógica

- Estado local: `status` (filtro selecionado, default `ALL`).
- Filtragem client-side (ou query param) por status ao trocar o `FilterGroup`.
- Contagem de cada opção do filtro é sobre o dataset completo, não afetada pelo filtro atual.

## Dados de exemplo (5 registros)

| Nome | Categoria | Responsável | Vencimento | Status | Urgência |
|---|---|---|---|---|---|
| Alvará de Funcionamento — Unidade Centro | Licenças | Marina Costa | 25/08/2026 | OVERDUE | Vencido (critical) |
| Certificado Digital e-CNPJ A3 | Certificados | Diego Alves | 12/09/2026 | EXPIRING | Vence em 3 dias (warning) |
| CND Federal — Atlas Schindler | Fornecedores | Marina Costa | 15/09/2026 | EXPIRING | Vence em 6 dias (warning) |
| Apólice de Seguro Patrimonial | Seguros | Diego Alves | 09/12/2026 | VALID | Sem urgência (neutral) |
| Licença Ambiental de Operação | Licenças | Marina Costa | — | PERMANENT | Não se aplica (neutral) |

## RBAC

- VIEWER: oculta "Importar CSV" e "Novo vencimento" do cabeçalho (somente leitura).
- MEMBER+: pode criar e importar.

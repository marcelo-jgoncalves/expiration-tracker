# A20 — Catálogo de tipos de documento

**Rota:** `/settings/document-types`
**Acesso:** ADMIN+
**Nav ativo:** "Configurações"

## Estrutura

1. `PageHeader`: título "Tipos de documento", descrição "Catálogo compartilhado, com campos de metadados customizados.", ação "Novo tipo" (primary).
2. **Painel "Catálogo"** (header: título + contagem): `DataTable`, colunas:
   - Tipo de documento (primary, link para editor de campos)
   - Campos de metadados (ex. "3 campos")
   - Status: `StatusBadge` "Ativo" (neutral) / "Descontinuado" (warning)
   - Visível para convidados: "Sim" / "Não (descontinuado)" — tipos descontinuados nunca aparecem para convidados
   - Ações: "Editar" (tertiary, sm, link) + "Descontinuar" (tertiary, sm, se Ativo) ou "Reativar" (tertiary, sm, se Descontinuado)

## Dados de exemplo

```
CND Federal — 3 campos — Ativo — visível a convidados
Alvará de Funcionamento — 2 campos — Ativo — visível a convidados
Apólice de Seguro (modelo antigo) — 1 campo — Descontinuado — não visível a convidados
```

## Regras de negócio

- Tipos de documento são compartilhados por toda a organização (não por fornecedor).
- Cada tipo define um conjunto de campos de metadados customizados usados no formulário de upload/detalhe (ver A12).
- Descontinuar um tipo não o exclui (preserva histórico) mas o remove de: seleção em novos uploads e visibilidade para convidados (fluxo G02).

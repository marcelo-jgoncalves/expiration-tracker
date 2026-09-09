# A21 — Templates de requisitos

**Rota:** `/settings/requirement-templates`
**Acesso:** ADMIN+ para editar; leitura para outros papéis com acesso à tela
**Nav ativo:** "Configurações"
**Layout:** dois painéis empilhados full-width (catálogo acima, detalhe abaixo) — **não** lado a lado.

## Estrutura

1. `PageHeader`: título "Templates de requisitos", descrição "Checklists reutilizáveis de Requisitos, aplicáveis a um fornecedor de uma vez.", ação "Novo template" (primary).
2. **Painel "Catálogo"**: `DataTable` compacta, colunas:
   - Template (primary): **nome é um botão** que seleciona o template no painel de detalhe abaixo (estilo de link, sem navegação de página).
   - Status: `StatusBadge` "Ativo" (neutral) / "Arquivado" (warning)
   - Itens (numeric, contagem de requisitos no template)
3. **Painel de detalhe**, header = nome do template selecionado + `StatusBadge` de status ao lado. Corpo:
   - Lista de itens do template, cada linha num card com borda: nome do requisito + "posição {n}" (`CellSecondary`) à direita — ordem importa (checklist ordenado).
   - Se arquivado: `InlineNotice tone="neutral"` "Template arquivado — somente leitura para não-admins."
   - **Barra de ações** (2 zonas):
     - Esquerda: "Editar" (secondary, desabilitado se arquivado) + "Duplicar" (secondary) + "Arquivar"/"Reativar" (tertiary, label conforme status).
     - Direita: "Aplicar a fornecedor" (primary).

## Dados de exemplo

```
tpl1 "Fornecedor de serviços — padrão", ACTIVE, itens: CND Federal, CND Estadual, Contrato vigente, Apólice de seguro
tpl2 "Fornecedor de equipamentos", ACTIVE, itens: CND Federal, Certificado de garantia
tpl3 "Checklist antigo (2024)", ARCHIVED, itens: CND Federal
```
Seleção padrão ao carregar: `tpl1`.

## Regras de negócio

- "Aplicar a fornecedor" instancia todos os itens do template como Requisitos reais vinculados a um Subject escolhido (fluxo de seleção de fornecedor fora do escopo desta tela — modal/próxima tela).
- Templates arquivados não podem ser editados nem aplicados por não-admins, mas continuam visíveis/duplicáveis para referência histórica.
- Duplicar cria uma cópia editável independente (não afeta o original).

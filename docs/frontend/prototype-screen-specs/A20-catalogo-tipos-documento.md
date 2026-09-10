# A20 — Catálogo de tipos de documento

**Rotas:** `/app/:orgId/settings/document-types` (catálogo) ·
`/app/:orgId/settings/document-types/:documentTypeId` (editor de campos de um tipo)

**Acesso:** `docarchive:documenttype-read` — **READ_ONLY_ROLES** (OWNER/ADMIN/MEMBER/VIEWER podem
navegar o catálogo e abrir o editor de campos em modo leitura). Mutação (criar/renomear/
descontinuar/reativar tipo, gerenciar campos de metadados) — `docarchive:documenttype-*` /
`docarchive:documenttype-metadata-manage`, **ADMIN_ROLES**.

**Nav ativo:** "Configurações"

## Estrutura — Catálogo

1. `PageHeader`: título "Tipos de documento", descrição "Catálogo compartilhado, com campos de
   metadados customizados.", ação "Novo tipo" (primary) — **visível apenas para ADMIN+**;
   MEMBER/VIEWER veem o mesmo header sem essa ação.
2. **Painel "Catálogo"** (header: título + contagem): `DataTable`, colunas:
   - Tipo de documento (primary, link para o editor de campos — link disponível a todo papel, o
     editor abre em modo leitura para MEMBER/VIEWER).
   - Campos de metadados (ex. "3 campos"; "Sem campos" quando o tipo não define nenhum — estado
     válido, não um erro).
   - Status: `StatusBadge` "Ativo" (neutral) / "Descontinuado" (warning).
   - Visível para convidados: "Sim" / "Não (descontinuado)" — **informativo apenas, sem toggle**:
     todo tipo `ACTIVE` é visível a convidados por construção do backend (não existe uma permissão
     de visibilidade separada) — não inventar um controle aqui.
   - Ações (**coluna inteira ausente para MEMBER/VIEWER**, não apenas desabilitada): "Editar" (link
     estilo texto, todo papel) + "Descontinuar" (`ghost`, sm, se Ativo) ou "Reativar" (`ghost`, sm,
     se Descontinuado) — variantes corrigidas de `tertiary` (inexistente) para `ghost`, ação
     reversível e não-destrutiva (SLF-04).

## Estrutura — Editor de campos (`:documentTypeId`)

3. `PageHeader` do editor: nome do tipo + `StatusBadge` de status; para MEMBER/VIEWER, `InlineNotice
   tone="neutral"` "Modo leitura — apenas administradores editam este catálogo."
4. **Painel "Campos de metadados"**: lista ordenada de campos, cada um num card com borda:
   - Nome do campo, tipo de valor (`TEXT`/`NUMBER`/`DECIMAL`/`DATE`/`BOOLEAN`/`SINGLE_SELECT`),
     indicador "Obrigatório" quando aplicável, opções listadas quando `SINGLE_SELECT`.
   - Reordenação por botões "▲"/"▼" (ou atalho de teclado equivalente) em cada card — **nunca só
     drag-and-drop**, para permitir reordenar via teclado.
   - Campo arquivado: renderiza com opacidade reduzida + `StatusBadge` "Arquivado" (neutral),
     permanece na lista para preservar histórico de Documentos existentes que o referenciam.
   - Ação "Adicionar campo" (primary, ADMIN+ apenas) abre um formulário inline (nome, tipo de valor,
     obrigatório, opções se `SINGLE_SELECT`).
   - Nota fixa abaixo da lista (sempre visível, não só ao adicionar): "Marcar um campo como
     obrigatório nunca invalida retroativamente Documentos já existentes que não o preenchem — a
     obrigatoriedade vale apenas para novos uploads a partir de agora."

## Estados

- **Nome duplicado** ao criar/renomear um tipo: erro inline no campo "Já existe um tipo com este
  nome" (bloqueia submit, não é um aviso soft).
- **Tipo descontinuado ainda referenciado por Documentos ativos**: descontinuar não bloqueia (o tipo
  não é excluído, histórico preservado) mas o painel do tipo mostra `InlineNotice tone="neutral"`
  "Ainda referenciado por N documento(s) existente(s) — eles continuam acessíveis normalmente."
- **Conflito de concorrência (OCC)**: editar um tipo/campo que mudou desde o carregamento mostra
  `InlineNotice tone="warning"` "Este tipo foi alterado por outra pessoa — revise antes de salvar",
  com opção de recarregar.
- **Tipo sem nenhum campo de metadados**: estado válido, célula "Sem campos" no catálogo, editor
  mostra estado vazio "Nenhum campo definido ainda" + ação "Adicionar campo" (ADMIN+).

## Dados de exemplo

```
CND Federal — 3 campos — Ativo — visível a convidados
Alvará de Funcionamento — 2 campos — Ativo — visível a convidados
Apólice de Seguro (modelo antigo) — 1 campo — Descontinuado — não visível a convidados
```

## Regras de negócio

- Tipos de documento são compartilhados por toda a organização (não por fornecedor).
- Cada tipo define um conjunto de campos de metadados customizados usados no formulário de
  upload/detalhe (ver A12).
- Descontinuar um tipo não o exclui (preserva histórico) mas o remove de: seleção em novos uploads e
  visibilidade para convidados (fluxo G02).
- Reordenar campos, adicionar/arquivar campo e marcar obrigatório são todas ações ADMIN_ROLES
  (`docarchive:documenttype-metadata-manage`); a visualização do editor é READ_ONLY_ROLES.

## Responsivo

- Paridade completa. O editor de campos empilha em mobile (um card de campo por linha, cheio da
  largura); os botões "▲"/"▼" de reordenação permanecem alcançáveis por toque e por teclado.

## Motion

- Nenhuma animação na tabela do catálogo (lista estática, sem motivo para movimento). No editor,
  adicionar/remover um campo faz o card entrar/sair com `motion.fast` (120ms, fade + leve
  deslocamento vertical de 4px) para comunicar que a lista mudou sem exigir reler tudo;
  `prefers-reduced-motion` remove o deslocamento, mantém só o fade instantâneo.

# A21 — Templates de requisitos

**Rotas:** `/app/:orgId/settings/requirement-templates` (catálogo + detalhe embutido) ·
`/app/:orgId/settings/requirement-templates/:templateId` (deep-link para um template selecionado,
mesma tela — a seleção no painel de detalhe é refletida na URL para permitir compartilhar/voltar).

**Acesso (corrigido nesta revisão — três níveis, não dois):**
- `docarchive:requirementtemplate-read` — **READ_ONLY_ROLES** (todo papel navega o catálogo e abre o
  detalhe de qualquer template, incluindo arquivados, em modo leitura).
- `docarchive:requirementtemplate-apply` — **WRITE_ROLES** (OWNER/ADMIN/MEMBER — aplicar um template
  só cria Requisitos operacionais comuns, é um tier abaixo de administrar o catálogo; VIEWER não
  aplica).
- Criar/editar/duplicar/arquivar/reativar o **catálogo em si** — `docarchive:requirementtemplate-*`,
  **ADMIN_ROLES** (OWNER/ADMIN apenas — inclusive duplicar, mesmo de um template arquivado; a
  regra anterior desta spec que permitia "duplicar para referência" a não-admins estava incorreta e
  foi removida, ver Regras de negócio).

**Nav ativo:** "Configurações"
**Layout:** dois painéis empilhados full-width (catálogo acima, detalhe abaixo) — **não** lado a
lado.

## Estrutura

1. `PageHeader`: título "Templates de requisitos", descrição "Checklists reutilizáveis de
   Requisitos, aplicáveis a um fornecedor de uma vez.", ação "Novo template" (primary) — **visível
   apenas para ADMIN+**.
2. **Painel "Catálogo"**: `DataTable` compacta, colunas:
   - Template (primary): **nome é um botão** que seleciona o template no painel de detalhe abaixo
     (estilo de link, sem navegação de página; atualiza a URL para `:templateId` via
     `history.replaceState`, permitindo voltar/compartilhar sem recarregar a tela).
   - Status: `StatusBadge` "Ativo" (neutral) / "Arquivado" (warning).
   - Itens (numeric, contagem de requisitos no template).
3. **Painel de detalhe**, header = nome do template selecionado + `StatusBadge` de status ao lado.
   Corpo:
   - Lista de itens do template, cada linha num card com borda: nome do requisito + notas
     (`CellSecondary`, se houver) + indicador de aplicabilidade (ex. "Todos os fornecedores" /
     "Categoria X") + "posição {n}" à direita.
   - Reordenação dos itens por botões "▲"/"▼" (ou atalho de teclado) em cada card, **visível apenas
     para ADMIN+ e apenas quando o template está `ACTIVE`** — nunca drag-only.
   - Rodapé do painel: versão do template (`CellSecondary`, ex. "v3").
   - Se arquivado: `InlineNotice tone="neutral"` "Template arquivado — somente leitura para
     não-admins." (para ADMIN+, o template arquivado permanece editável apenas via "Reativar";
     duplicar continua possível para ADMIN+ mesmo arquivado).
   - **Barra de ações** (2 zonas, cada botão só existe no DOM para o papel autorizado — não apenas
     desabilitado):
     - Esquerda (ADMIN+ apenas): "Editar" (secondary, desabilitado se arquivado) + "Duplicar"
       (secondary) + "Arquivar"/"Reativar" (`ghost`, label conforme status — variante corrigida de
       `tertiary`, inexistente no catálogo, para `ghost`: ação reversível e não-destrutiva, SLF-04).
     - Direita (WRITE_ROLES — OWNER/ADMIN/MEMBER, nunca VIEWER): "Aplicar a fornecedor" (primary).

## Fluxo "Aplicar a fornecedor" (dispara a partir daqui ou de A09/A11)

1. Selecionar o Subject de destino (modal, fora do escopo visual desta tela).
2. **Preview de aplicação** (novo, dentro desta tela): lista os itens do template lado a lado com o
   resultado esperado — `NOVO` (será criado como Requisito) ou `DUPLICATE_NAME` (`StatusBadge`
   warning, "Já existe um requisito com este nome neste fornecedor — será ignorado"). Ação "Confirmar
   aplicação" (primary) só cria os itens marcados `NOVO`; se **todos** os itens forem
   `DUPLICATE_NAME`, o botão fica desabilitado com nota "Nenhum item novo a aplicar."
3. **Conflito de aplicação parcial**: se a criação falhar no meio (ex. erro de rede após criar
   3 de 5 itens), `InlineNotice tone="warning"` resume o que foi criado e oferece "Tentar novamente
   apenas os pendentes" (não reaplica os já criados, evita duplicar).
4. Ao concluir, retorna para A09/A11 com os Requisitos resultantes visíveis.

## Estados

- **Template inválido/vazio** (nenhum item): bloqueia "Aplicar a fornecedor" com tooltip "Adicione
  ao menos um item antes de aplicar"; o template ainda pode ser salvo como rascunho (`ACTIVE` sem
  itens é um estado de catálogo válido, só não é aplicável).
- **Colisão de nome** ao criar/renomear um template: erro inline "Já existe um template com este
  nome" (bloqueia submit).
- Ver "Preview de aplicação" acima para `DUPLICATE_NAME` e conflito parcial.

## Dados de exemplo

```
tpl1 "Fornecedor de serviços — padrão", ACTIVE, v3, itens: CND Federal, CND Estadual, Contrato vigente, Apólice de seguro
tpl2 "Fornecedor de equipamentos", ACTIVE, v1, itens: CND Federal, Certificado de garantia
tpl3 "Checklist antigo (2024)", ARCHIVED, v2, itens: CND Federal
```
Seleção padrão ao carregar: `tpl1`.

## Regras de negócio

- "Aplicar a fornecedor" instancia os itens `NOVO` do template como Requisitos reais vinculados a um
  Subject escolhido; itens `DUPLICATE_NAME` são ignorados e reportados no preview, nunca aplicados
  silenciosamente.
- Templates arquivados não podem ser editados nem aplicados por ninguém (incluindo ADMIN+, exceto
  via "Reativar" primeiro) — **duplicar permanece uma ação ADMIN_ROLES mesmo em templates
  arquivados**, nunca liberada para não-admins (correção desta revisão: a versão anterior da spec
  permitia duplicar a não-admins "para referência", o que contradizia a regra de catálogo
  ADMIN_ROLES-only).
- Duplicar cria uma cópia editável independente, sempre `ACTIVE`, versão reiniciada em v1 (não afeta
  o original).

## Responsivo

- Paridade completa. Em telas estreitas, os itens do template mantêm o card único (nome + notas +
  posição empilhados verticalmente); os botões "▲"/"▼" permanecem alcançáveis por toque e teclado, a
  barra de ações reflui em duas linhas (zona esquerda acima, zona direita abaixo) preservando a
  separação administração/aplicação.

## Motion

- Selecionar um template no catálogo faz o painel de detalhe abaixo atualizar com `motion.fast`
  (120ms fade, sem deslocamento de altura) — comunica troca de contexto sem um salto abrupto. O
  preview de aplicação abre como painel expansível dentro da mesma tela (`motion.normal`, 180ms),
  não uma navegação de página nova. `prefers-reduced-motion`: ambas as transições viram troca
  instantânea.

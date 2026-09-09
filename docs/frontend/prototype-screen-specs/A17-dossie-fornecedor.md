# A17 — Exportar dossiê do fornecedor

**Rota:** `/subjects/:id/dossier`
**Acesso:** **restrito a OWNER e ADMIN** (mesmo o responsável direto pelo fornecedor não pode, se for MEMBER/VIEWER)
**Nav ativo:** "Fornecedores"
**Layout:** coluna única, max-width `var(--layout-reading-max)`. Wizard de 3 estágios num único `Panel`.

## Estrutura

1. `PageHeader`: `above`="← Voltar para {fornecedor}"; título "Exportar dossiê"; descrição "{Fornecedor} · pacote de conformidade em PDF ou Excel."
2. **Painel único, conteúdo por estágio** (`state.stage`):

### Estágio `preview`
- Bloco "Escopo (congelado nesta pré-visualização)": lista rótulo/valor —
  - Requisitos incluídos: "{n} de {total}"
  - Documentos incluídos: "{n} versão(ões) aceita(s)"
  - Hash do escopo: identificador técnico (ex. "scope_8f21ac") — garante que o conteúdo exportado corresponde exatamente ao que foi pré-visualizado, mesmo que dados mudem depois.
- Bloco "Formato": toggle 2 botões PDF / Excel (o selecionado fica `variant="primary"`, o outro `secondary`).
- `InlineNotice tone="neutral"`: "Apenas OWNER e ADMIN podem exportar o dossiê, mesmo que sejam o responsável direto pelo fornecedor." (reforça a regra de RBAC na própria tela).
- Botão "Confirmar e gerar" (primary) → estágio `generating`.

### Estágio `generating`
- `AsyncFeedback state="PENDING"` mensagem "Gerando dossiê…" (spinner/loading).
- (no protótipo há um botão de simulação; na implementação real, esta etapa é automática e transiciona sozinha quando o backend termina.)

### Estágio `ready`
- `InlineNotice tone="success"`: "Dossiê gerado. O link de download é válido por 30 dias."
- Botão "Baixar dossiê" (primary).

## Regras de negócio

- O "escopo" (quais requisitos/documentos entram) é **congelado no momento da pré-visualização** via hash — se dados mudarem depois, o dossiê final ainda reflete o que foi mostrado na pré-visualização, não o estado atual.
- Link de download expira em 30 dias.
- Formatos suportados: PDF, Excel (XLSX).

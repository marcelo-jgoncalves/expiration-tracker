# A15 — Importação em massa (CSV)

**Rota:** `/import`
**Acesso:** MEMBER+ (operação de escrita em massa)
**Nav ativo:** "Fornecedores"
**Layout:** coluna única, max-width 1100px. Wizard de 4 etapas dentro de um único `Panel`.

## Estrutura

1. `PageHeader`: título "Importação em massa", descrição "Envie um CSV para criar Fornecedores, Documentos e Requisitos de uma vez." Sem ações.
2. **Badges de etapa** (fora do painel, acima): "1. Enviar arquivo", "2. Mapear colunas", "3. Pré-visualizar", "4. Confirmar" — etapa atual destacada (borda forte, peso maior).
3. **Painel único, conteúdo muda conforme a etapa** (`state.step`):

### Etapa `upload`
- Dropzone tracejada: ícone `upload`, texto "Arraste um arquivo .csv ou", botão "Selecionar arquivo" (secondary, sm), nota "Até 20 MB · até 10.000 linhas".
- Botão "Enviar e continuar" (primary) → avança para `mapping`.

### Etapa `mapping`
- `InlineNotice tone="warning"` se houver coluna obrigatória sem mapeamento (ex. "1 coluna obrigatória sem mapeamento: "Tipo".").
- Grid 3 colunas (nome da coluna do CSV → seta → campo de destino mapeado): mostra mapeamento automático detectado, incluindo colunas não mapeadas marcadas explicitamente (ex. "tipo → Tipo (não mapeado)").
- Botões: "Voltar" (tertiary) → `upload`; "Pré-visualizar" (primary) → `preview`.

### Etapa `preview`
- `InlineNotice tone="neutral"`: "{n} de {total} linhas válidas. Linhas inválidas não bloqueiam a importação das demais — resultado é reportado por linha." (regra de negócio central: importação é parcial/por-linha, não tudo-ou-nada).
- `DataTable` "Pré-visualização": colunas Linha (nº), Fornecedor (nome), Resultado (`StatusBadge`: "Válida" neutral / "Erro: {motivo}" critical).
- Botões: "Voltar" (tertiary) → `mapping`; "Confirmar importação" (primary) → `commit`.

### Etapa `commit`
- `InlineNotice tone="success"`: "Importação concluída: {n} fornecedores criados, {n} linha(s) ignorada(s) por erro."
- Links: "Ver fornecedores criados" (secondary) → Fornecedores; "Ver relatório de erros" (tertiary).

## Dados de exemplo (preview)

```
Linha 2: Conservare Facilities ME — Válida
Linha 3: Atlas Schindler — Válida
Linha 4: Nova Distribuidora Ltda — Erro: tipo ausente
```

## Regras de negócio

- Importação **nunca falha tudo-ou-nada**: cada linha é processada e reportada independentemente; linhas inválidas são puladas, válidas são aplicadas.
- Coluna obrigatória sem mapeamento não impede avançar à pré-visualização, mas é sinalizada (linhas dependentes dessa coluna provavelmente falharão na pré-visualização).

# A05 — Detalhe do vencimento

**Rota:** `/expirations/:id`
**Acesso:** todos os papéis; ações destrutivas restritas (ver RBAC)
**Nav ativo:** "Vencimentos"

## Estrutura

1. `PageHeader`: `above` = link "← Voltar para Vencimentos"; título = nome do item (ex. "Alvará de Funcionamento — Unidade Centro"); descrição = "{Categoria} · Emitido por {emissor}"; ações: "Editar" (secondary, link) + "Renovar" (primary).
2. **Painel "hero"**: linha com, à esquerda, data de vencimento em destaque (font-size grande, tabular-nums) + texto relativo abaixo (ex. "Vencido há 15 dias"); à direita, `StatusBadge` (situação: Ativo/Arquivado, tone neutral, com `srPrefix="Situação"`) + `UrgencyIndicator` (ex. "Vencido", critical).
3. **Grid 2 colunas** (1 col ≤820px), dois painéis com `DetailList`:
   - "Identificação": Categoria, Periodicidade, Emissor, Número.
   - "Acompanhamento": Responsável, Prioridade, Tags, Versão (indica se veio de rastreamento legado, ex. "v4 (OCC)" = optimistic concurrency control).
4. **Grid de cards de link** (`repeat(auto-fill, minmax(220px,1fr))`), cada um navega para uma subtela:
   - "Lembretes" → A06, nota: "Política ativa · N avisos antes do vencimento"
   - "Arquivos" → A07, nota: "N anexo(s) · [status OCR]"
   - "Histórico de auditoria" → filtro do log de auditoria (A23) por este recurso, nota: última alteração.
5. **Barra de zona de perigo** (alinhada à direita, borda superior separando): "Arquivar vencimento" (tertiary, sm) + "Excluir vencimento" (danger, sm).

## Dados de exemplo

```
Identificação: Categoria=Licenças, Periodicidade=Anual, Emissor=Prefeitura Municipal, Número=AL-2024-00931
Acompanhamento: Responsável=Marina Costa, Prioridade=Alta, Tags=Operacional, Unidade Centro, Versão=v4 (OCC)
```

## RBAC

- Excluir/Arquivar: MEMBER+ (não VIEWER). Considerar exigir confirmação modal antes de excluir (destrutivo e irreversível) — não implementado no protótipo, mas recomendado.
- Renovar/Editar: MEMBER+.

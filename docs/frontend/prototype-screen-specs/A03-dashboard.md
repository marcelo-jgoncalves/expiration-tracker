# A03 — Visão geral (Dashboard)

**Rota:** `/dashboard`
**Acesso:** todos os papéis (OWNER/ADMIN/MEMBER/VIEWER)
**Nav ativo:** "Visão geral"

## Estrutura

1. `PageHeader`: título "Visão geral", descrição "O que precisa da sua atenção agora em {nome da organização}.", sem ações de cabeçalho.
2. **Grid de 4 métricas** (cards-link `<a>`, grid `repeat(4,1fr)` → 2 col ≤900px → 1 col ≤520px):
   - Vencidos — contagem grande (tabular-nums) + label. Link para Vencimentos filtrado por vencidos.
   - Vencem em 7 dias
   - Aguardando revisão — link para Fila de revisão
   - Requisitos em falta — link para Requisitos filtrado
   - Cada card tem texto oculto (`sr-only`, position absolute 1x1px) descrevendo o destino para leitores de tela, via `aria-describedby`.
3. **Painel "Precisa de atenção primeiro"**: header com título + contagem (`{n} vencimentos`), rodapé com link "Ver todos os vencimentos" → A04. Corpo: `DataTable` compacta com colunas:
   - Vencimento (primary): nome (link) + categoria como `CellSecondary` abaixo
   - Data de vencimento (numeric)
   - Urgência: `UrgencyIndicator` com tons `critical` (vencido) / `warning` (vence em N dias) / `neutral`
   - Linhas: ordenadas com vencidos primeiro, depois a vencer em breve (não inclui itens sem urgência).

## Dados de exemplo

```
métricas: overdue=1, soon=2, review=3, missing=4
linhas da tabela: 
  Alvará de Funcionamento — Unidade Centro | Licenças | 25/08/2026 | Vencido (critical)
  Certificado Digital e-CNPJ A3 | Certificados | 12/09/2026 | Vence em 3 dias (warning)
  CND Federal — Atlas Schindler | Fornecedores | 15/09/2026 | Vence em 6 dias (warning)
```

## Regras

- Painel mostra apenas itens vencidos + a vencer em breve, priorizados nessa ordem — não é a lista completa.
- Cada métrica do topo é clicável e deep-links para a view filtrada correspondente (não apenas decorativa).

# A16 — Relatórios e exportações

**Rota:** `/reports`
**Acesso:** todos os papéis para baixar/ver; criar assinatura MEMBER+
**Nav ativo:** "Relatórios"

## Estrutura

1. `PageHeader`: título "Relatórios e exportações", descrição "7 relatórios CSV e assinaturas de envio programado." Sem ações de cabeçalho.
2. **Grid de cards de relatório** (`repeat(auto-fill, minmax(260px,1fr))`), 7 cards fixos, cada um: título do relatório + nota técnica (entidade/filtro) + botão "Baixar CSV" (secondary, sm):
   1. Vencimentos expirados — ExpirationItem · status expirado
   2. Vencimentos a vencer — Janela de 7 dias
   3. Vencimentos renovados — Histórico de renovações
   4. Vencimentos por responsável — Agrupado por assignee
   5. Requisitos em falta — Requirement · MISSING
   6. Requisitos por fornecedor — Requirement · agrupado por Subject
   7. Requisitos por responsável — Requirement · agrupado por assignee
3. **Painel "Assinaturas"** (header: título + contagem + botão "Nova assinatura" secondary sm à direita): `DataTable` compacta, colunas:
   - Relatório (primary)
   - Destinatários (ex. "3 destinatários")
   - Periodicidade (ex. "Semanal", "Diária")
   - Última execução (data)
   - Ações: "Editar" + "Remover" (ambos tertiary sm)

## Dados de exemplo (assinaturas)

```
Requisitos em falta — 3 destinatários — Semanal — última 07/09/2026
Vencimentos a vencer — 1 destinatário — Diária — última 09/09/2026
```

## Regras de negócio

- Os 7 relatórios são fixos/predefinidos (não criados pelo usuário) — apenas as assinaturas de envio recorrente são configuráveis.
- Assinatura = relatório + destinatários + periodicidade; roda automaticamente e envia por e-mail.

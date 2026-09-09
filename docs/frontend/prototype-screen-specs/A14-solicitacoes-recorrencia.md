# A14 — Solicitações e recorrência

**Rota:** `/subjects/:id/requests`
**Acesso:** MEMBER+ para criar/gerar/cancelar; VIEWER somente leitura
**Nav ativo:** "Fornecedores"

## Estrutura

1. `PageHeader`: `above`="← Voltar para {fornecedor}"; título "Solicitações e recorrência"; descrição "{Fornecedor} · geração de solicitações de documento a partir de Requisitos."; ações: "Nova solicitação avulsa" (secondary), "Nova série recorrente" (primary).
2. **Painel "Séries recorrentes"** (header: título + contagem): `DataTable` compacta, colunas:
   - Requisito (primary, link)
   - Status: `StatusBadge` "Ativa" (neutral) / "Cancelada" (critical)
   - Recorrência: duas linhas — texto legível (ex. "Trimestral") + expressão técnica cron abaixo em fonte monoespaçada (ex. "cron: 0 0 1 */3 *"), ou "—" se cancelada
   - Próxima geração (data, "—" se cancelada)
   - Destinatário (e-mail)
   - Ações: se ativa → "Gerar agora" (tertiary, sm) + "Cancelar" (tertiary, sm); se cancelada → texto "Cancelada" (`CellSecondary`, sem ações)
3. **Painel "Solicitações avulsas e materializações"** (header: título + contagem): `DataTable` compacta, colunas:
   - Requisito
   - Gerada em (data)
   - Entrega da credencial: `StatusBadge` — SENT="Enviado" (neutral), SEND_UNCERTAIN="Envio incerto" (warning), MANUAL="Entrega manual" (neutral)
   - Link do convidado (texto: "Ativo · expira em DD/MM/AAAA" | "Resolvido (submissão recebida)" | "Expirado")
   - Ações: "Ver" (tertiary, sm, link)

## Dados de exemplo

```
Séries: 
  s1 CND Federal, ACTIVE, Trimestral (cron 0 0 1 */3 *), próxima 01/12/2026, financeiro@atlasschindler.com
  s2 Contrato de manutenção, CANCELLED, —, —, contratos@atlasschindler.com

Solicitações avulsas:
  r1 CND Federal, criada 01/09/2026, entrega SENT, link "Ativo · expira em 12/09/2026"
  r2 CND Federal, criada 01/06/2026, entrega SEND_UNCERTAIN, link "Resolvido (submissão recebida)"
  r3 Contrato de manutenção, criada 15/03/2026, entrega MANUAL, link "Expirado"
```

## Regras de negócio

- "Série recorrente" gera solicitações automaticamente conforme um cron; "solicitação avulsa" é um disparo único.
- Cada solicitação gera um link de convidado sem login (ver G02) com prazo de expiração.
- `SEND_UNCERTAIN` sinaliza que o sistema não confirma se o e-mail de convite chegou (ex. bounce desconhecido) — não é um erro definitivo, mas precisa de atenção humana eventual.
- Uma série/solicitação cancelada permanece no histórico, nunca é excluída.

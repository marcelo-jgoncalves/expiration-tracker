# A06 — Política de lembrete

**Rota:** `/expirations/:id/reminders`
**Acesso:** MEMBER+ para editar; VIEWER somente leitura
**Nav ativo:** "Vencimentos"
**Layout:** coluna única, max-width `var(--layout-reading-max)` (largura de leitura, não full-width).

## Estrutura

1. `PageHeader`: `above` = "← Voltar para o vencimento"; título "Lembretes"; descrição "{Nome do vencimento}. Configura quando os avisos são disparados, não como cada pessoa os recebe."; ação: "Salvar lembretes" (primary).
2. **Painel "Quando avisar"**: lista de offsets configurados, cada linha = label ("30 dias antes do vencimento", "7 dias antes do vencimento", "No dia do vencimento") + botão "Remover" (tertiary, sm) à direita. Abaixo da lista: botão "Adicionar aviso" (secondary, sm) — abre um seletor de novo offset (dias antes / no dia).
3. **Painel "Canais"**: lista de canais, cada linha = nome do canal + estado:
   - E-mail: `StatusBadge` "Ativo" (neutral) — sempre disponível.
   - WhatsApp: `StatusBadge` "Indisponível" (neutral) — funcionalidade ainda não habilitada nesta versão (não há toggle).
4. `InlineNotice tone="info"` title="Política ativa": "Os avisos são enviados no fuso horário da organização, fora do período de silêncio configurado em cada usuário." (o período de silêncio é config pessoal, ver A18, não desta tela).

## Regras de negócio

- Esta tela configura **quando** os lembretes disparam (por vencimento), não como o usuário individual os recebe (isso é por-usuário, tela A18).
- WhatsApp aparece na lista mas está desabilitado (não editável) até que exista fluxo de consentimento — apenas mostrar como indisponível, não remover da lista (comunica roadmap).
- Cada vencimento tem sua própria política de lembrete independente.

## RBAC

- VIEWER: sem botões "Remover"/"Adicionar aviso"/"Salvar lembretes" — tela vira somente leitura.

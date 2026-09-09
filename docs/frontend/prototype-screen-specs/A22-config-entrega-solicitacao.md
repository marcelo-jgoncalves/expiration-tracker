# A22 — Configuração de entrega de solicitação

**Rota:** `/settings/request-delivery`
**Acesso:** ADMIN+
**Nav ativo:** "Configurações"
**Layout:** coluna única, max-width `var(--layout-reading-max)`.

## Estrutura

1. `PageHeader`: título "Entrega de solicitação", descrição "Política de toda a organização para o convite inicial do fluxo de rastreamento legado."
2. **Painel único**: grupo de rádio com 2 opções, cada uma um card selecionável (borda destacada quando selecionada):
   - "E-mail automático" — "O link é enviado por e-mail no momento da criação da solicitação."
   - "Entrega manual" — "O link é gerado, mas quem criou a solicitação o compartilha por fora."
   - `InlineNotice tone="neutral"`: "Alterar este padrão afeta apenas novos convites — nunca revoga um link já emitido."
3. Rodapé: botão "Salvar padrão" (primary), alinhado à direita.

## Regras de negócio

- Esta configuração é o **padrão organizacional** para o fluxo de rastreamento legado especificamente (ver G01) — não afeta as Solicitações e recorrência padrão (A14/G02), que têm sua própria lógica de entrega por solicitação (`SENT`/`SEND_UNCERTAIN`/`MANUAL`).
- Mudança de padrão é prospectiva apenas: links já emitidos mantêm o comportamento definido no momento da criação.

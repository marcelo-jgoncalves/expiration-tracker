# A22 — Configuração de entrega de solicitação

**Rota:** `/app/:orgId/settings/request-delivery`
**Acesso:** `OWNER_ROLES` apenas (`tenant:configure-document-request-delivery`) — política externa
de comunicação de toda a organização. Esta tela e sua entrada de navegação ("Configurações" →
"Entrega de solicitação") ficam **totalmente ausentes** para ADMIN/MEMBER/VIEWER — não apenas com o
botão "Salvar" desabilitado, o item de nav nem aparece e a rota redireciona/404 se acessada
diretamente por um não-OWNER.
**Nav ativo:** "Configurações" (visível apenas a OWNER, ver acima).
**Layout:** coluna única, max-width `var(--layout-reading-max)`.

## Estrutura

1. `PageHeader`: título "Entrega de solicitação", descrição "Política de toda a organização para o convite inicial do fluxo de rastreamento legado."
2. **Painel único**: `fieldset` com `legend` "Modo de entrega padrão" envolvendo um grupo de rádio com 2 opções, cada uma um card selecionável (borda destacada + ícone de seleção redundante — nunca só a borda — quando selecionada; navegável e ativável via teclado, `role="radio"`/`aria-checked` ou `<input type="radio">` nativo dentro do card, foco visível):
   - "E-mail automático" — "O link é enviado por e-mail no momento da criação da solicitação."
   - "Entrega manual" — "O link é gerado, mas quem criou a solicitação o compartilha por fora."
   - `InlineNotice tone="neutral"`: "Alterar este padrão afeta apenas novos convites — nunca revoga um link já emitido."
3. Rodapé: botão "Salvar padrão" (primary), alinhado à direita.

### Estados de mutação

- **Carregando** (`GET` inicial): esqueleto dos dois cards + rodapé oculto até o valor atual carregar.
- **Erro ao carregar**: `InlineNotice tone="danger"` "Não foi possível carregar a configuração atual." + botão "Tentar novamente".
- **Salvando**: botão "Salvar padrão" em estado `loading` (spinner interno, texto mantido), demais controles desabilitados para prevenir duplo submit.
- **Sucesso**: `Toast tone="success"` "Padrão de entrega atualizado." — sem navegação, permanece na tela.
- **Erro ao salvar**: `InlineNotice tone="danger"` "Não foi possível salvar. Tente novamente." + botão "Tentar novamente"; seleção do usuário é preservada (não reverte para o valor anterior automaticamente).
- **Conflito de concorrência (OCC)**: se o valor no servidor mudou desde o carregamento, `InlineNotice tone="warning"` "Este padrão foi alterado por outra pessoa enquanto você editava. Revise o valor atual antes de salvar novamente." + recarrega o valor atual, mantendo a seleção do usuário visível para comparação (não sobrescreve silenciosamente).
- **E-mail temporariamente indisponível** (aplica-se apenas quando "E-mail automático" está selecionado e o provedor de envio está degradado, sinalizado pelo backend): `InlineNotice tone="warning"` no painel, abaixo do card "E-mail automático": "O envio de e-mail está temporariamente indisponível. Novos convites usarão entrega manual até a normalização." — não bloqueia salvar a preferência em si.

### Movimento

- Troca de seleção entre os dois radio-cards: transição de borda/ícone em `motion.fast` (120ms), sem deslocamento de layout.
- Salvar → sucesso: o toast surge com a transição padrão do design system; foco permanece no botão "Salvar padrão" após a resposta (nunca é perdido).
- Respeita `prefers-reduced-motion`: troca de seleção e aparição do toast tornam-se instantâneas, sem fade/slide.

## Regras de negócio

- Esta configuração é o **padrão organizacional** para o fluxo de rastreamento legado especificamente (ver G01) — não afeta as Solicitações e recorrência padrão (A14/G02), que têm sua própria lógica de entrega por solicitação (`SENT`/`SEND_UNCERTAIN`/`MANUAL`).
- Mudança de padrão é prospectiva apenas: links já emitidos mantêm o comportamento definido no momento da criação. Esta regra deve estar **sempre visível na cópia da UI** (já refletida no `InlineNotice` acima), nunca apenas implícita.
- `tenant:configure-document-request-delivery` é `OWNER_ROLES` — nenhum outro papel visualiza ou aciona esta configuração, em conformidade com a regra de navegação ciente de RBAC do plano (§3): um papel que não pode ver nenhuma tela de um grupo de nav não vê a entrada de nav correspondente.

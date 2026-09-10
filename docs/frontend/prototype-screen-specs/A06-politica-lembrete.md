# A06 — Política de lembrete

**Revisão 2026-09-09 (screen-spec-audit-2026-09-09, batch 2/6)**: reescrita após auditoria NOT PASS
(ver `docs/architecture/reviews/screen-spec-audit-2026-09-09/A06-audit-record.md`). Correções: rota
carrega `:orgId`/`:itemId`/`:policyId?`; ciclo de vida completo criar/ver/editar/desabilitar
(a versão anterior só editava offsets); estados nomeados (sem política, desabilitada, conflito OCC,
scheduler indisponível); `tertiary` substituído; ícones adicionados aos badges; motion nomeado;
composição autoral ligando os offsets à data real de vencimento do item, não uma lista solta.

**Rota:** `/app/:orgId/expirations/:itemId/reminders/:policyId?`
**Acesso:** WRITE_ROLES (OWNER/ADMIN/MEMBER) para editar; VIEWER somente leitura
**Nav ativo:** "Vencimentos"
**Layout:** coluna única, max-width `var(--layout-reading-max)` (largura de leitura, não full-width).

## Estrutura

1. `PageHeader`: `above` = "← Voltar para o vencimento"; título "Lembretes"; descrição
   "{Nome do vencimento} · vence em {data}. Configura quando os avisos são disparados, não como cada
   pessoa os recebe."; ação: "Salvar lembretes" (`primary`, desabilitado enquanto não há alterações
   pendentes — estado "dirty" explícito).
2. **Painel "Quando avisar"** — cada offset é mostrado já resolvido contra a data real do item (não
   uma lista abstrata de números): linha = label composto ("30 dias antes · 12/12/2026", "7 dias
   antes · 06/01/2027", "No dia · 13/01/2027") + botão "Remover" (`ghost`, sm, ícone `x`, nome
   acessível "Remover aviso de {label}") à direita. Abaixo da lista: botão "Adicionar aviso"
   (`secondary`, sm) — abre um seletor de novo offset (dias antes / no dia); duplicar um offset já
   existente é bloqueado inline com "Este aviso já existe" (não permite salvar duplicata). Lista vazia
   (nenhum offset ainda) mostra `EmptyState` compacto: "Nenhum aviso configurado" + "Adicionar
   aviso" — distinto de "política desabilitada" (ver Estados).
3. **Painel "Canais"**: lista de canais, cada linha = nome do canal + estado com ícone+texto+cor:
   - E-mail: `StatusBadge` "Ativo" (neutral, ícone `check`) — sempre disponível.
   - WhatsApp: `StatusBadge` "Indisponível" (neutral, ícone `slash`) — funcionalidade ainda não
     habilitada nesta versão (não há toggle nem afordance interativa — item G5 do plano, sem rota de
     consentimento ainda).
4. **Toggle "Política ativa"** (topo do painel "Quando avisar", `Switch`, WRITE_ROLES): desabilita a
   política inteira sem apagar os offsets configurados — ver Estados.
5. `InlineNotice tone="info"` title="Como os avisos são enviados": "Os avisos são enviados no fuso
   horário da organização, fora do período de silêncio configurado em cada usuário." + link
   "Configurar meu período de silêncio →" (para A18, own-user scope apenas).

## Estados

- **Sem política ainda** (`:policyId` ausente): painéis aparecem vazios com estado inicial "Nenhum
  aviso configurado ainda"; salvar cria a política pela primeira vez (`reminder:manage`).
- **Política desabilitada** (toggle off): painéis "Quando avisar"/"Canais" ficam com opacidade
  reduzida e um `InlineNotice tone="warning"` "Esta política está desabilitada — nenhum aviso será
  enviado." acima deles; os offsets configurados permanecem visíveis (não são apagados) para reativação
  rápida.
- **Conflito de edição (OCC)**: ao salvar, se a política mudou em outro lugar nesse meio-tempo,
  `InlineNotice tone="critical"`: "Esta política foi alterada por outra pessoa. Revise antes de salvar
  novamente." — recarrega os valores atuais sem descartar silenciosamente a edição do usuário.
- **Canal sem entitlement** (ex. WhatsApp): tratado permanentemente como indisponível nesta versão
  (ver Painel "Canais"), nunca como toggle que aparenta funcionar.
- **Scheduler indisponível** (dependência de agendamento fora do ar): `InlineNotice tone="warning"`
  no topo: "Não foi possível confirmar o agendamento agora. Suas alterações foram salvas e serão
  aplicadas assim que o serviço voltar." — nunca falha silenciosamente nem bloqueia o salvamento dos
  dados.
- **Salvando**: botão "Salvar lembretes" em estado `loading` (spinner, texto "Salvando…").
- **Sucesso**: `Toast` "Lembretes salvos".
- **Falha genérica ao salvar**: `InlineNotice tone="critical"` "Não foi possível salvar. Tente
  novamente." mantendo os valores digitados no formulário (nunca descarta a edição do usuário).

## Regras de negócio

- Esta tela configura **quando** os lembretes disparam (por vencimento), não como o usuário individual
  os recebe (isso é por-usuário, tela A18).
- WhatsApp aparece na lista mas está desabilitado (não editável) até que exista fluxo de consentimento
  — apenas mostrar como indisponível, não remover da lista (comunica roadmap).
- Cada vencimento tem sua própria política de lembrete independente.
- Desabilitar a política preserva os offsets configurados (não é equivalente a excluir todos os
  avisos) — permite reativar sem reconfigurar do zero.

## RBAC

| Ação | OWNER | ADMIN | MEMBER | VIEWER |
|---|---|---|---|---|
| Ver política | ✓ | ✓ | ✓ | ✓ |
| Adicionar/remover aviso, ativar/desativar, salvar | ✓ | ✓ | ✓ | — |

VIEWER: sem botões "Remover"/"Adicionar aviso"/"Salvar lembretes"/toggle — tela vira somente leitura
(controles ocultos, não apenas desabilitados).

## Responsivo e acessibilidade

- Coluna única em toda largura (já é o layout desktop, largura de leitura). Em mobile, cada offset
  vira um bloco empilhado (label em cima, botão remover abaixo, alvo de toque 40×40px) em vez de uma
  linha horizontal apertada.
- Foco move-se para o novo campo de offset ao abrir "Adicionar aviso"; ao remover um offset, o foco
  retorna ao botão "Adicionar aviso" (nunca perdido/solto no documento).
- Toggle "Política ativa" tem `role="switch"` e estado anunciado a leitor de tela.

## Motion

- Adicionar/remover um offset anima com `motion.fast` (120ms, ease-out para entrada, ease-in para
  saída) — a linha desliza sem deslocar abruptamente o botão "Adicionar aviso" abaixo. O toggle
  "Política ativa" não anima o conteúdo que ele desabilita além da mudança de opacidade (`motion.fast`).
  Nenhuma transição decorativa entre estados de salvamento — o spinner substitui o texto do botão
  instantaneamente. `prefers-reduced-motion`: todas as transições acima colapsam para mudança
  instantânea de estado.

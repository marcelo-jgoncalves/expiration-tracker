# A18 — Minhas preferências de notificação

**Rota:** `/app/:orgId/settings/notifications`
**Acesso:** `notification:configure`, READ_ONLY_ROLES (OWNER/ADMIN/MEMBER/VIEWER — todo papel real é
um destinatário legítimo de lembrete, isto não é administração de workspace). Edita apenas as
próprias preferências; nunca configura outro usuário a partir desta tela.
**Nav ativo:** "Configurações"
**Layout:** coluna única, max-width `var(--layout-reading-max)`.
**Motion:** sem animação de entrada/saída de seção (a lista é estática, sempre visível por completo)
— apenas o botão "Salvar preferências" faz uma transição `motion.fast` (120ms) de estado
default→saving→success/error no próprio rótulo, sem deslocar layout; sem motion, porque nenhuma
transição de estado nesta tela envolve mudança espacial real. `prefers-reduced-motion`: a transição
do botão vira uma troca instantânea de rótulo.

## Estrutura

1. `PageHeader`: título "Minhas preferências de notificação", descrição "Como você, pessoalmente,
   recebe lembretes. Não afeta outros usuários."
2. **Painel único**, lista de linhas rótulo + controle:
   - **E-mail**: nota "Canal sempre disponível" + checkbox "Ativado" (marcado, sempre disponível —
     único canal obrigatório) + `CellSecondary` mostrando a fonte de consentimento (`consentSource`,
     ex. "Confirmado no cadastro em 12/03/2026").
   - **WhatsApp**: nota "Indisponível no momento — sem rota de consentimento ainda" + `StatusBadge`
     "Indisponível" (neutral, sem controle editável). Continua **sem toggle acionável** — decisão
     confirmada nesta revisão, ver Regras de negócio.
   - **Idioma dos lembretes**: `<select>` com opções "Português (Brasil)" (padrão) / "English (US)".
   - **Horário silencioso**: nota "Nenhum lembrete enviado neste intervalo" + dois campos `time`
     ("das" / "até", ex. 21:00 até 07:00). Validação inline: se "das" == "até", erro "Intervalo
     precisa ter início e fim diferentes"; um intervalo cruzando meia-noite (ex. 22:00–06:00) é
     **válido e interpretado como atravessando o dia** — nota auxiliar abaixo do campo confirma:
     "Este intervalo atravessa a meia-noite."
3. Rodapé: botão "Salvar preferências" (primary), alinhado à direita. Estados: default → `saving`
   (spinner inline, botão desabilitado) → `success` (rótulo momentâneo "Salvo", volta ao default
   após 2s) → `error` (rótulo "Falhou — tentar de novo", `InlineNotice tone="danger"` acima do
   rodapé com o motivo, formulário permanece editável). Alterações não salvas: se o usuário navegar
   para fora com edições pendentes, `ConfirmDialog` "Você tem alterações não salvas" (Salvar/Descartar).

## Estado inicial (usuário novo, preferências nunca persistidas)

- Todos os campos carregam com os **defaults do sistema** (e-mail ativado, idioma pt-BR, sem
  horário silencioso definido) e uma `InlineNotice tone="neutral"` no topo do painel: "Estas são as
  preferências padrão — ainda não personalizadas." Some assim que o usuário salva pela primeira vez.

## Indisponibilidade por tenant vs. pessoal

- Se a organização desabilitar um canal a nível de tenant (kill-switch/entitlement — hoje só
  relevante para e-mail, hipoteticamente, já que WhatsApp já está indisponível por gap de backend),
  a linha do canal mostra `StatusBadge` "Indisponível para esta organização" (neutral) e o checkbox
  fica desabilitado com tooltip "Desativado pela sua organização, não por você" — **visualmente
  distinto** do estado "você desativou pessoalmente" (checkbox desmarcado, mas habilitado, sem
  badge). As duas situações nunca podem parecer idênticas na tela.

## Regras de negócio

- Esta tela é **por-usuário**, distinta da Política de Lembrete (A06), que é por-vencimento/por-
  organização. Um lembrete só chega ao usuário se: (a) a política do vencimento o dispara, E (b)
  está dentro do canal habilitado aqui, E (c) fora do horário silencioso pessoal.
- **G5 (gap de backend não-bloqueante)**: `WhatsAppOptInService.recordOptIn()` não tem rota HTTP
  ainda (D-246). Por isso o WhatsApp nunca é um toggle funcional aqui — é comunicado como "roadmap"
  via `StatusBadge` neutro, sem controle editável algum. Reabrir esta decisão apenas quando a rota
  existir E os pré-requisitos legais (E-019) forem resolvidos — nenhum dos dois é bloqueador de P0.

## Responsivo

- Paridade completa: em mobile, cada linha rótulo+controle empilha (rótulo acima, controle abaixo,
  full-width), mantendo a mesma ordem de leitura do desktop. O rodapé com "Salvar preferências"
  permanece fixo/reachable sem exigir scroll até o fim em telas muito longas (sticky footer dentro do
  painel). Foco de teclado segue a ordem visual; erros de validação (ex. horário silencioso inválido)
  são anunciados via `aria-live="polite"` e associados ao campo via `aria-describedby`.

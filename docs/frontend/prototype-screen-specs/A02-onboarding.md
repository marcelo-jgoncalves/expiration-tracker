# A02 — Organizações / Onboarding

**Revisado em 2026-09-09** — pós auditoria de spec visual (`docs/architecture/reviews/screen-spec-audit-2026-09-09/A02-audit-record.md`). Mudanças: as 3 rotas do plano agora nomeadas como estados desta tela (incluindo o fluxo de criação, antes "fora de escopo"), estados de convite/Membership completos, `tertiary`→`ghost`, motion explícito, tese visual própria.

**Rotas:** `/onboarding` (primeira visita, zero Memberships), `/organizations` (picker normal com ≥1 Membership), `/invitations/accept` (chegada via link de convite). As três são estados desta mesma tela — o roteamento decide qual bloco abre em primeiro plano, mas a estrutura de baixo (grid + convite + criação) é compartilhada.
**Acesso:** autenticado, sem AppShell (tela pré-seleção de organização, ocorre antes de entrar em qualquer org)
**Layout:** coluna única, max-width 720px centralizada, padding `space.8` (32px) no container em desktop / `space.4` (16px) em mobile — segue a régua de content container do design system (§28), não um valor arbitrário.

## Tese visual (achado V7 da auditoria)

Esta tela não é um seletor de lista genérico — ela representa a transição de "identidade da conta"
para "contexto de trabalho de uma organização real". Isso se reflete em 2 decisões concretas, não
apenas na copy:
1. O convite pendente (quando existe) sempre precede o H1 porque representa uma decisão bloqueante
   externa (alguém está esperando a resposta) — enquanto os cards de organização já pertencentes ao
   usuário representam decisões internas, sem urgência externa. Esta é a ordem de leitura
   correta mesmo com múltiplos convites simultâneos (ver seção de estados).
2. Cada card de organização mostra, além de nome/papel, um dado operacional real (contagem de
   vencimentos em atenção) — nunca um card puramente decorativo com só nome e badge. Isso ancora a
   escolha de organização a "o que está acontecendo lá", não a uma lista abstrata de nomes.

## Estrutura (topo → base)

1. Logo + wordmark (mesmo estilo do A01, sem aside).
2. **Bloco de convite pendente** (`InlineNotice tone="info"`, condicional a `hasInvitation`): título
   "Convite pendente: {org}", corpo "Você foi convidado como **{papel}**. O convite expira em
   {data absoluta} ({prazo relativo})." — nunca só o prazo relativo (ele envelhece sem a data). 2
   botões: "Aceitar convite" (primary, sm) e "Recusar" (**ghost**, sm — não `tertiary`, variante
   inexistente no design system; `ghost` é o tom correto para uma ação de baixa ênfase ao lado de
   um primary). **Múltiplos convites simultâneos**: cada um em seu próprio `InlineNotice`,
   empilhados, sem limite artificial — o mais recente primeiro.
3. Título H1 "Suas organizações" (papel `Page Title`) + subtítulo "Escolha uma organização para
   continuar, ou crie uma nova." (papel `Body Large`).
4. **Grid de cards de organização** (`hasOrgs=true`): grid responsivo
   `repeat(auto-fill, minmax(240px,1fr))`, gap `space.4` (16px) — gap interno do card entre
   nome/papel/nota é `space.2` (8px), deliberadamente menor que o gap entre cards (distinção
   intra- vs. inter-grupo exigida pela rubrica V3). Cada card é um `<button>`:
   - Nome da org (papel `Label`, 600) + `StatusBadge` (tone `neutral`="Ativa" / `critical`="Suspensa")
     alinhados nas pontas — nome trunca com reticências + `title` attribute com o nome completo após
     2 linhas de wrap (não 1, para não truncar nomes PT-BR compostos comuns como "Grupo Vértice
     Participações" prematuramente).
   - Papel do usuário nessa org (papel `Metadata`, 12/16, 600).
   - Nota/descrição (papel `Metadata`): dado operacional real (ex.: "3 vencimentos em atenção") ou,
     se suspensa, "Sua Membership está suspensa nesta organização."
   - Estados do card: default, hover (borda `border.control`, fundo `surface.subtle`), focus-visible
     (anel 2px `border.focus`), disabled (Membership suspensa: cursor `not-allowed`, opacidade 0.6,
     `onClick` não navega, mas o card continua legível e focável via Tab — nunca removido da ordem
     de tabulação, para que um leitor de tela ainda anuncie por que a organização está indisponível).
5. **Estado vazio** (`noOrgs=true`, mutuamente exclusivo com #4): `EmptyState kind="true-empty"`,
   título "Nenhuma organização ainda", corpo "Crie a primeira organização para começar a acompanhar
   vencimentos.", ação primária embutida no próprio `EmptyState` (não só no rodapé): botão "Criar
   organização" dentro do componente — nunca deixar o usuário procurar a única ação disponível.
6. Rodapé fixo inferior (visível apenas quando `hasOrgs=true`, já que o `EmptyState` tem sua própria
   ação): nota "Criar uma organização nova cria também sua primeira Membership como Owner." + botão
   secundário "Criar organização". Em mobile (<640px), o rodapé fixo respeita a área segura inferior
   (`env(safe-area-inset-bottom)`) e nunca sobrepõe o último card da grid — a grid ganha
   `padding-bottom` igual à altura do rodapé.

## Fluxo de criação de organização (antes "fora de escopo" — achado Major da auditoria)

- Acionado por qualquer um dos botões "Criar organização" acima. Abre um `Dialog` (não navega para
  rota separada — decisão de escopo: é uma decisão curta, adequada a modal por §47 do design
  system).
- Campos: Nome da organização (`TextField`, obrigatório, erro "Informe o nome da organização.");
  Fuso horário (`Select`, pré-selecionado pelo fuso do navegador, editável).
- Estados: `idle` → `submitting` (botão "Criar" muda para "Criando…", desabilitado, sem fechar o
  dialog) → `success` (dialog fecha, novo card aparece na grid com foco movido para ele, toast
  "Organização criada") → `error` (erro inline no dialog, nunca fecha sozinho, permite corrigir e
  reenviar).
- Regra: sempre atribui papel OWNER ao criador — nunca oferece escolha de papel neste fluxo.

## Estados de convite/Membership (achado Major da auditoria — antes ausentes)

- Convite já aceito (por outra sessão/dispositivo): ao tentar aceitar novamente, mostra
  "Este convite já foi aceito." e remove o bloco.
- Convite revogado/expirado: bloco não aparece mais; se o usuário chegou via link direto
  (`/invitations/accept`) para um convite nesse estado, mostra uma tela de estado "Este convite não
  está mais disponível." com botão "Ver minhas organizações" (nunca distingue revogado de expirado
  externamente — mesma disciplina anti-enumeração usada no fluxo de convidado, G01/G02).
- E-mail do convite diferente da conta logada: mostra "Este convite foi enviado para
  {email-convidado}. Você está conectado como {email-atual}." com opção de trocar de conta.
- Membership SUSPENDED/REMOVED em uma org já listada: card correspondente aparece com o estado
  disabled descrito acima; se REMOVED, o card some da lista na próxima carga (nunca permanece
  fantasma).
- Organização previamente selecionada que ficou inacessível (ex.: fechada, D-19-lifecycle DELETED):
  ao tentar reabrir essa rota, redireciona para esta tela com um `InlineNotice tone="warning"`:
  "A organização que você tentou acessar não está mais disponível."
- Estado "confirmando…" (consistência eventual após aceitar convite ou criar org): botão de ação
  mostra spinner + label "Confirmando…" por até alguns segundos antes de a nova org aparecer na
  grid — nunca falha silenciosamente; se expirar sem confirmar, mostra "Isso está demorando mais que
  o esperado — atualizar" com ação de retry manual.

## Motion (decisão explícita — achado V6 da auditoria)

- Aceitar/recusar convite: o bloco de convite não desaparece com fade — ele colapsa com uma
  transição de altura `motion.normal` (180ms, `ease-out`) para que o deslocamento do conteúdo abaixo
  não pareça um salto abrupto.
- Novo card de organização aparecendo após criação: fade-in `motion.fast` (120ms) + foco movido para
  o card — nunca aparece "piscando" sem transição.
- Dialog de criação: entrada/saída usa a transição padrão de overlay do sistema (não redefinida
  aqui).
- `prefers-reduced-motion`: a transição de colapso do convite e o fade do novo card são substituídos
  por uma troca instantânea de estado.

## Dados de exemplo usados no protótipo

```
orgs: [
  { name: "Conservare Facilities ME", role: "Owner", status: "Ativa" (neutral), note: "3 vencimentos em atenção", disabled: false },
  { name: "Grupo Vértice Participações", role: "Viewer", status: "Suspensa" (critical), note: "Sua Membership está suspensa nesta organização.", disabled: true }
]
invitation: { org: "Atlas Manutenção Predial", role: "Member", expiry: "12/09/2026 (3 dias)" }
```

## Interação

- Clicar em um card de org habilitado → navega para A03 (Dashboard) daquela organização.
- "Criar organização" → abre o dialog de criação especificado acima.
- Aceitar convite → adiciona a org à lista com o papel do convite, entra em estado "confirmando…",
  então atualiza a lista; Recusar → remove o bloco de convite imediatamente (sem confirmação
  adicional — ação reversível, o convite continua existindo, só sai da visão deste usuário).

## Regras de negócio

- Uma organização com Membership suspensa nunca é navegável, independente do papel anterior do
  usuário.
- Criar organização sempre atribui OWNER ao criador.
- Nenhuma causa de indisponibilidade de convite (revogado vs. expirado) é distinguida externamente.

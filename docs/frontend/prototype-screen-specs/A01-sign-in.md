# A01 — Entrar (Sign In)

**Revisado em 2026-09-09** — pós auditoria de spec visual (`docs/architecture/reviews/screen-spec-audit-2026-09-09/A01-audit-record.md`). Mudanças: rotas reconciliadas com `docs/frontend/p0-screen-inventory-plan.md` (3 rotas, não 1), estados de callback/expiração/refresh nomeados, papéis tipográficos e ritmo espacial concretos, estados de componente completos, decisão explícita de motion, uma tese visual própria para a aside.

**Rotas:** `/login` (formulário), `/auth/callback` (retorno do provedor de identidade), `/session-expired` (sessão expirada, requer reautenticação). As três compartilham o mesmo layout-base descrito abaixo; o que muda é o conteúdo da coluna esquerda conforme o estado.
**Acesso:** público (não autenticado)
**Layout base:** tela dividida 2 colunas em desktop (≥960px), 1 coluna em mobile. Sem AppShell/nav — decisão justificada (`JUSTIFIED EXCEPTION` na auditoria): autenticação precede contexto de tenant/RBAC, não há navegação de produto para mostrar ainda.

## Estrutura

- **Coluna esquerda (form, sempre visível):** largura máx 23rem, centralizada vertical e horizontalmente. Espaçamento interno segue a régua do design system: `space.6` (24px) entre logo e conteúdo principal, `space.4` (16px) entre título/subtítulo e o form, `space.3` (12px) entre campos do form, `space.5` (20px) entre form e rodapé — nunca um valor uniforme repetido em todos os pontos (rubric V3: ritmo intra vs. inter-grupo deve ser distinguível).
  1. Logo: quadrado 28×28 (`var(--space-7)`), fundo `action.primary.default`, texto "ET" branco, + wordmark "Expiration Tracker" em papel tipográfico `Label` (14/20, weight 600).
  2. **Banner de erro condicional** (`InlineNotice tone="critical" announce="alert"`), visível só após tentativa falha ou callback inválido: título "Não foi possível confirmar seu acesso", corpo "Verifique o e-mail e a senha informados e tente novamente." Papel tipográfico do título: `Label` (14/20, 600); do corpo: `Body` (14/20, 400).
  3. Título H1 "Entrar" (papel `Page Title`, 28/36 em mobile por já estar abaixo do breakpoint de título grande) + subtítulo "Acesse o controle de vencimentos e renovações da sua organização." (papel `Body Large`, 16/24, 400) — máximo 2 linhas antes de truncar com reticências apenas se a organização tiver nome extenso injetado dinamicamente (não se aplica ao texto estático deste rodapé, mas vale para qualquer variante localizada futura).
  4. Form:
     - Campo `TextField` E-mail — tipo email, obrigatório, papel `Label` (14/20, 600) para o rótulo, `Body` (14/20) para o valor digitado; erro inline "Informe o e-mail." em `Metadata` (12/16, 600) cor `status.danger.text`, nunca cor isolada — sempre acompanhado do ícone de erro do `FormField`.
     - Campo `TextField` Senha — mesmo tratamento tipográfico; erro inline "Informe a senha."
     - Estados de cada campo (completos, não apenas "erro"): default, hover (borda `border.control` → tom mais escuro), focus (`border.focus` + anel 2px conforme design-system §35), filled, disabled (não aplicável nesta tela — nenhum campo é desabilitado aqui), error (`border.danger` + mensagem).
     - Botão submit primário, full-width, altura padrão do sistema **44px** (não 40px — revisado; a versão anterior usava compacto sem justificativa de densidade, achado da auditoria). Estados: default, hover (`purple.700`), pressed (`purple.800`), focus-visible, disabled (form inválido client-side), loading (label muda para "Entrando…" + spinner inline à esquerda do texto, largura do botão não muda — sem layout shift). O botão fica desabilitado durante `pending` para impedir duplo-submit.
  5. Rodapé: "Não tem uma organização ainda? Fale com quem convidou você." (link, papel `Body`, sublinhado só no hover/focus).
- **Coluna direita (aside, oculta <960px):** fundo `neutral.900` (quase preto), texto claro. `aria-hidden="true"` (decorativo, não navegável por teclado/leitor de tela) — mantém-se assim mesmo após a revisão de V7 abaixo, pois seu conteúdo é reforço de marca, não uma tarefa executável.
  - **Tese visual própria (achado V7 da auditoria — a versão anterior deixava a especificidade do produto só na copy)**: a aside não é um painel de marketing genérico intercambiável — ela expõe, em sequência vertical com hierarquia de peso decrescente, os três estágios do problema que o produto resolve, na ordem em que o usuário os experimenta: (1) headline de maior peso "Vencimentos e documentos de fornecedores, sob controle antes que virem urgência." — o verbo "antes que virem" é a âncora de posicionamento: o produto age antes do problema, não depois; (2) uma segunda linha, peso médio, nomeando as categorias de evidência que o produto rastreia: "Certificados · contratos · apólices · licenças · certidões" (separadas por `·`, nunca vírgula — reforça que são categorias paralelas, não uma lista narrativa); (3) o copyright no rodapé, peso mínimo. Esta sequência de 3 pesos decrescentes é a mesma estrutura que deve ser reutilizada em qualquer outra tela que precise de um painel de reforço de marca (candidato a `SYSTEM EVOLUTION CANDIDATE` — só promover a pattern reutilizável depois de confirmado em uma segunda tela real).
  - Logo (mesmo estilo, fundo `brand.default`).

## Estado / lógica

- Estado local: `email`, `password`, `pending` (bool), `emailError`, `passwordError`, `showError` (bool), `callbackState` (`idle | processing | failed`), `sessionState` (`active | expired`).
- Submit (rota `/login`):
  1. Previne default do form.
  2. Valida client-side: e-mail e senha não vazios. Se inválido, seta erros nos campos, foco move para o primeiro campo inválido, não avança.
  3. Se válido: `pending=true`, botão desabilitado, limpa erros de campo, chama API de login.
  4. Sucesso → redireciona para A02 (Onboarding/Organizações) se o usuário não tiver Membership ativa única, ou diretamente para A03 (Dashboard) se tiver exatamente uma. Falha → `pending=false`, `showError=true`, foco move para o banner de erro (`role="alert"`), valores de e-mail/senha permanecem preenchidos (nunca limpar o form em erro).
- `/auth/callback` (retorno do provedor OAuth/OIDC):
  - `callbackState=processing`: tela mostra a mesma coluna esquerda com um `Spinner` centralizado substituindo o form (nunca uma página em branco), texto "Confirmando seu acesso…" — transição transparente ao usuário, sem exigir nova ação dele.
  - Sucesso: mesmo destino de redirecionamento do submit bem-sucedido acima.
  - Falha (`callbackState=failed`): mesmo banner de erro do submit, título ajustado para "Não foi possível concluir o acesso" — usa o layout padrão do form (não o spinner), foco move para o banner.
- `/session-expired`:
  - Mesmo layout do form de login, com um `InlineNotice tone="info"` acima do H1 (não `critical` — expirar não é uma falha do usuário): "Sua sessão expirou. Entre novamente para continuar." Foco move para este aviso ao carregar a tela.
  - `returnPath`: capturado antes do redirecionamento para `/login`, **validado como caminho interno relativo** (`/app/...`) antes de ser reutilizado após reautenticação — nunca aceita URL externa (prevenção de open redirect). Um `returnPath` inválido/externo é descartado silenciosamente e o destino cai no fallback padrão (A02/A03 conforme a regra de Membership acima).

## Motion (decisão explícita — achado V6 da auditoria)

- Transição do botão para o estado `loading`: instantânea na troca de label/spinner (sem fade) — ações de submit são de alta frequência e não se beneficiam de atraso perceptível.
- Aparição do banner de erro: fade-in `motion.fast` (120ms, `ease-out`) — o suficiente para não ser abrupto sem atrasar a leitura do erro; some instantaneamente (sem fade-out) na próxima tentativa de submit.
- Transição de `/auth/callback` do estado `processing` para o form final (sucesso/erro): sem animação de cross-fade — troca direta de conteúdo, pois o usuário já está esperando uma resposta e uma transição decorativa atrasaria a percepção de conclusão.
- `prefers-reduced-motion`: o único movimento real desta tela (fade-in do banner) é desativado; o banner aparece instantaneamente.

## Acessibilidade

- Banner de erro usa `role="alert"`/`aria-live="assertive"` na implementação real; foco move para ele em toda ocorrência (submit falho, callback falho).
- Aviso de sessão expirada usa `aria-live="polite"` e recebe foco ao carregar a tela.
- Aside é puramente decorativo — `aria-hidden`, nunca alcançável por Tab.
- Todos os campos e o botão respeitam o target size mínimo de 44×44px do design system (§36) — o botão de 44px de altura já cumpre isso; os campos de texto seguem a altura padrão de input (44px, §34).

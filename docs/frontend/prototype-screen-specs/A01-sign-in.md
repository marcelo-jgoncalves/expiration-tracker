# A01 — Entrar (Sign In)

**Rota:** `/sign-in`
**Acesso:** público (não autenticado)
**Layout base:** tela dividida 2 colunas em desktop (≥960px), 1 coluna em mobile. Sem AppShell/nav.

## Estrutura

- **Coluna esquerda (form, sempre visível):** largura máx 23rem, centralizada vertical e horizontalmente.
  1. Logo: quadrado 28×28 (`var(--space-7)`), fundo `var(--color-action-primary)`, texto "ET" branco, + wordmark "Expiration Tracker".
  2. **Banner de erro condicional** (`InlineNotice tone="critical" announce="alert"`), visível só após tentativa falha: título "Não foi possível confirmar seu acesso", corpo "Verifique o e-mail e a senha informados e tente novamente."
  3. Título H1 "Entrar" + subtítulo "Acesse o controle de vencimentos e renovações da sua organização."
  4. Form:
     - Campo `TextField` E-mail — tipo email, obrigatório, erro inline se vazio ("Informe o e-mail.")
     - Campo `TextField` Senha — tipo password, obrigatório, erro inline se vazio ("Informe a senha.")
     - Botão submit primário, full-width, 40px altura. Label muda para "Entrando…" durante `pending`.
  5. Rodapé: "Não tem uma organização ainda? Fale com quem convidou você." (link).
- **Coluna direita (aside, oculta <960px):** fundo `var(--color-neutral-900)` (quase preto), texto claro. Contém: logo (mesmo estilo, fundo `--color-accent-600`), headline "Vencimentos e documentos de fornecedores, sob controle antes que virem urgência.", subtexto "Certificados · contratos · apólices · licenças · certidões", copyright "© 2026 Expiration Tracker" no rodapé. `aria-hidden="true"` (decorativo, não navegável por teclado/leitor de tela).

## Estado / lógica

- Estado local: `email`, `password`, `pending` (bool), `emailError`, `passwordError`, `showError` (bool).
- Submit:
  1. Previne default do form.
  2. Valida client-side: e-mail e senha não vazios. Se inválido, seta erros nos campos e não avança (`showError` permanece false).
  3. Se válido: `pending=true`, limpa erros de campo, chama API de login (mock: `setTimeout` 900ms).
  4. Nesta versão mock, a chamada **sempre falha**: ao final do timeout, `pending=false`, `showError=true` (mostra o banner de erro genérico). **Implementação real deve substituir por chamada de API real** com sucesso → redirecionar para A02 (Onboarding/Organizações) ou A03 (Dashboard, se só há 1 org).

## Acessibilidade

- Banner de erro usa `announce="alert"` (deve virar `role="alert"` ou `aria-live="assertive"` na implementação real).
- Aside é puramente decorativo — `aria-hidden`.

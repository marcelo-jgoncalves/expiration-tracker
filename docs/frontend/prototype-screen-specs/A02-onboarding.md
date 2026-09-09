# A02 — Organizações / Onboarding

**Rota:** `/organizations`
**Acesso:** autenticado, sem AppShell (tela pré-seleção de organização, ocorre antes de entrar em qualquer org)
**Layout:** coluna única, max-width 720px centralizada, padding generoso.

## Estrutura (topo → base)

1. Logo + wordmark (mesmo estilo do A01, sem aside).
2. **Bloco de convite pendente** (`InlineNotice tone="info"`, condicional a `hasInvitation`): título "Convite pendente: {org}", corpo "Você foi convidado como **{papel}**. O convite expira em {prazo}." + 2 botões: "Aceitar convite" (primary, sm) e "Recusar" (tertiary, sm).
3. Título H1 "Suas organizações" + subtítulo "Escolha uma organização para continuar, ou crie uma nova."
4. **Grid de cards de organização** (`hasOrgs=true`): grid responsivo `repeat(auto-fill, minmax(240px,1fr))`, gap 16px. Cada card é um `<button>`:
   - Nome da org (semibold) + `StatusBadge` (tone `neutral`="Ativa" / `critical`="Suspensa") alinhados nas pontas.
   - Papel do usuário nessa org (ex.: "Owner", "Viewer") em texto pequeno.
   - Nota/descrição (ex.: "3 vencimentos em atenção" ou, se suspensa, "Sua Membership está suspensa nesta organização.").
   - Card com `disabled=true` quando a Membership do usuário está suspensa: cursor `not-allowed`, opacidade 0.6, `onClick` não navega.
   - Hover: muda borda/fundo. Focus visível com outline.
5. **Estado vazio** (`noOrgs=true`, mutuamente exclusivo com #4): `EmptyState kind="true-empty"`, mensagem "Você ainda não faz parte de nenhuma organização. Crie a primeira para começar a acompanhar vencimentos."
6. Rodapé fixo inferior: nota "Criar uma organização nova cria também sua primeira Membership como Owner." + botão secundário "Criar organização".

## Dados de exemplo usados no protótipo

```
orgs: [
  { name: "Conservare Facilities ME", role: "Owner", status: "Ativa" (neutral), note: "3 vencimentos em atenção", disabled: false },
  { name: "Grupo Vértice Participações", role: "Viewer", status: "Suspensa" (critical), note: "Sua Membership está suspensa nesta organização.", disabled: true }
]
invitation: { org: "Atlas Manutenção Predial", role: "Member", expiry: "3 dias" }
```

## Interação

- Clicar em um card de org habilitado → navega para A03 (Dashboard) daquela organização.
- "Criar organização" → abre fluxo de criação (fora do escopo desta tela; ao concluir, cria org + Membership OWNER para o usuário atual).
- Aceitar convite → adiciona a org à lista com o papel do convite e navega/atualiza a lista; Recusar → remove o bloco de convite.

## Regras de negócio

- Uma organização com Membership suspensa nunca é navegável, independente do papel anterior do usuário.
- Criar organização sempre atribui OWNER ao criador.

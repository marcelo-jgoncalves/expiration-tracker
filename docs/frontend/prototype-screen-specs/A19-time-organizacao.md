# A19 — Time e organização

**Rotas:** `/app/:orgId/settings/team` (aba "Membros e convites", default) ·
`/app/:orgId/settings/storage` (aba "Armazenamento") ·
`/app/:orgId/settings/organization` (aba "Organização")

**Acesso por aba (corrigido nesta revisão — ver Findings do audit):**
- "Membros e convites": **READ_ONLY_ROLES** (OWNER/ADMIN/MEMBER/VIEWER veem o roster; apenas
  ADMIN+ veem/usam convidar, mudar papel, remover — ver RBAC abaixo).
- "Armazenamento": **READ_ONLY_ROLES** (todo papel que pode fazer upload deve conseguir ver por que
  um upload seria recusado — sensibilidade diferente de identidade/ciclo de vida da organização).
- "Organização": **OWNER apenas**. ADMIN não vê esta aba (nem em modo leitura) — mais restritivo que
  "ADMIN vê mas não usa Encerrar", que era a regra pré-revisão e estava incorreta.

**Nav ativo:** "Configurações"

## Estrutura

1. `PageHeader`: título "Time e organização", descrição "Membros, convites e configurações da
   organização {nome}."
2. **Tabs** (estilo underline, não pill), renderizadas condicionalmente por papel do ator — a aba
   "Organização" simplesmente não existe no DOM para não-OWNER (não é apenas escondida via CSS):
   "Membros e convites" | "Armazenamento" | "Organização" (OWNER apenas). Tab ativa: texto principal
   + borda inferior de destaque (cor de ação primária).

### Aba "Membros e convites" (default)

- **Painel "Membros"** (header: título + botão "Convidar membro" secondary sm à direita, **visível
  apenas para ADMIN+** — MEMBER/VIEWER veem o painel sem este botão): `DataTable`, colunas:
  - Membro (primary): nome + e-mail (`CellSecondary`).
  - Papel: para ADMIN+, `<select>` OWNER/ADMIN/MEMBER/VIEWER; para MEMBER/VIEWER, texto simples
    (somente leitura, sem controle). Regras do `<select>` (ADMIN+ apenas):
    - Opção "OWNER" **habilitada apenas se o ator autenticado for OWNER**; para um ator ADMIN a
      opção fica desabilitada com tooltip "Somente o Owner pode promover ou rebaixar outro Owner" —
      nunca 403 silencioso depois do submit.
    - Linha correspondente ao **único OWNER ativo restante** (calculado, não "qualquer linha com
      papel OWNER" — pode haver mais de um Owner) tem o `<select>` inteiro desabilitado com tooltip
      "Não é possível rebaixar o último Owner".
    - Linha correspondente ao **próprio ator autenticado** tem o `<select>` desabilitado com tooltip
      "Use 'Sair da organização' para alterar sua própria participação" (ver Ações abaixo).
  - Status: `StatusBadge` "Ativo" (neutral) / "Suspenso" (warning) / "Removido" (`CellSecondary`
    tracejado, linha permanece por 1 sessão para desfazer acidental — ver Estados).
  - Ações:
    - Linha do próprio ator: botão "Sair da organização" (`ghost`, sm) — **sempre self-only**, nunca
      afeta outro Membership. Desabilitado, com tooltip "Transfira a titularidade antes de sair",
      se o ator for o único OWNER ativo.
    - Linha do único OWNER restante (quando não é o ator): texto "Último OWNER" (`CellSecondary`,
      sem botão).
    - Demais linhas, visível apenas para ADMIN+: botão "Remover" (`danger`, sm) — remover acesso de
      um membro é uma ação de segurança consequente (perda imediata de acesso à organização), por
      isso `danger` e não `ghost`, distinto de "Revogar convite" abaixo (SLF-04: variantes
      corrigidas para o catálogo real — `primary/secondary/ghost/danger`, sem `tertiary`).
- **Painel "Convites pendentes"** (visível apenas para ADMIN+ — convites não aparecem para
  MEMBER/VIEWER): `DataTable`, colunas: E-mail convidado (primary), Papel, Status (`StatusBadge`):
  "Pendente · expira em {n} dias" (neutral) / "Expirado" (warning) / "Revogado" (`CellSecondary`,
  linha oculta por padrão, visível só com filtro "mostrar histórico"). Duplicar convite para um
  e-mail já pendente substitui o anterior (não empilha duas linhas) — nota inline confirma "Convite
  anterior substituído". Ações: "Revogar" (`ghost`, sm — reversível, re-convidar é trivial, distinto
  de "Remover" acima).

### Aba "Armazenamento"

- **Painel único** "Uso de armazenamento": barra de progresso horizontal com **rótulo textual acima
  da barra** (nunca só cor) — "{usedGB} GB de {limitGB} GB usados ({usedPercent}%)". Estados de cor/
  tom da barra: OK (neutral, <80%), `WARNING` (warning tone, ≥80%), `CRITICAL` (danger tone, ≥95%),
  `OVER` (danger tone + `InlineNotice tone="danger"` abaixo: "Limite excedido — novos uploads
  bloqueados até liberar espaço ou aumentar o limite; arquivos existentes não são afetados.").
  `reservedBytes` > 0 some como uma segunda faixa sutil dentro da mesma barra (não uma barra
  separada), com legenda "{reservedGB} GB em processamento" — nunca tratado como um número acionável
  à parte.
  Não há nenhuma ação de editar o limite nesta versão — `limitBytes` é somente leitura por design
  (G9, fora de escopo em P0); a tela **não** mostra um botão/ícone de editar ao lado do limite, para
  não sugerir uma capacidade inexistente.
  Fonte: `GET /document-archive/storage-usage`, `docarchive:read`.

### Aba "Organização" (OWNER apenas)

- **Painel "Identidade da organização"** (padded): `DetailList` com Nome de exibição, Fuso horário,
  Situação; botão "Editar organização" (secondary) abaixo.
- **Painel "Ciclo de vida"** (padded, visível apenas quando `Situação` ≠ `ACTIVE`): mostra o estado
  atual (`DELETING` / `HELD_FOR_RECOVERY` / `DELETED`) com explicação em linguagem simples; durante
  `HELD_FOR_RECOVERY`, botão "Cancelar encerramento" (secondary) — única janela em que
  `organization:cancel-close` é alcançável, conforme a régua de datas mostrada ("recuperável até
  {data}").
- **Painel zona de perigo** (padded, visível apenas quando `Situação` = `ACTIVE`): linha com texto
  "Encerrar organização" + nota "Ação irreversível-adjacente. Requer confirmação deliberada." à
  esquerda, botão "Encerrar organização" (danger) à direita. Ao clicar: `ConfirmDialog` **full-screen
  em qualquer viewport** (não apenas mobile), foco forçado no campo de confirmação (ex. digitar o
  nome da organização), sem possibilidade de fechar clicando fora — reflete que esta é a ação de
  maior consequência do sistema.

## Dados de exemplo

```
Membros: Marina Costa (OWNER, ativo) | Diego Alves (ADMIN, ativo) | Renata Souza (MEMBER, ativo) | Paulo Lima (VIEWER, suspenso)
Convites: julia@comerc.com, MEMBER, "Pendente · expira em 5 dias"
Organização: Comerc Facilities, America/Sao_Paulo, Ativa
Armazenamento: 3.2 GB usados de 5 GB (64%, OK), 0.1 GB reservado
```

## Regras de negócio

- Sempre deve existir ao menos 1 OWNER ativo; a linha do **último** OWNER ativo (calculado
  dinamicamente, não hardcoded) nunca é rebaixável/removível pela UI — se houver 2+ Owners, os
  demais permanecem editáveis por outro Owner.
- `membership:leave` **sempre e apenas** o Membership do próprio ator — nunca há um botão "Sair" na
  linha de outra pessoa.
- Trocar o papel do próprio ator, ou removê-lo, está bloqueado no dropdown/ação de linha; o caminho
  correto é "Sair da organização".
- Promover/rebaixar de-ou-para OWNER exige que o **ator** seja OWNER — não basta ser ADMIN. A opção
  fica desabilitada (nunca escondida) no dropdown para um ator ADMIN, para não parecer um bug de UI.
- "Encerrar organização" exige confirmação adicional (modal full-screen com foco forçado, ver acima).
- `cancel-close` só é alcançável durante a janela `HELD_FOR_RECOVERY`.

## Responsivo

- Paridade completa. Em mobile, cada membro vira um card (nome/e-mail, papel, status, ação) em vez
  de linha de tabela, preservando a mesma hierarquia de leitura. O diálogo de "Encerrar organização"
  é full-screen em qualquer largura, com foco forçado no controle de confirmação. A barra de
  armazenamento mantém o rótulo textual acima da barra em qualquer largura.

## Motion

- Troca de aba: conteúdo do painel faz *cross-fade* `motion.fast` (120ms) sem deslocamento de
  layout — nunca um salto abrupto de altura. Abertura do `ConfirmDialog` de encerramento usa
  `motion.normal` (180ms) por ser a ação de maior consequência do sistema (leve ênfase intencional).
  `prefers-reduced-motion`: ambas as transições viram troca instantânea sem fade/scale.

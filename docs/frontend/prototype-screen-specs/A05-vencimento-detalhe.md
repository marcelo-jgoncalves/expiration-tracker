# A05 — Detalhe do vencimento

**Revisão 2026-09-09 (screen-spec-audit-2026-09-09, batch 2/6)**: reescrita após auditoria NOT PASS
(ver `docs/architecture/reviews/screen-spec-audit-2026-09-09/A05-audit-record.md`). Correções:
rota agora carrega `:orgId`; RBAC de exclusão corrigida para ADMIN_ROLES (era erroneamente MEMBER+,
achado Crítico); adicionados campos/estados faltantes (descrição, datas completas, RENEWED/DELETED,
`renewedFromId`, watchers, OCC), variante `tertiary` substituída, decisão de motion nomeada,
composição autoral em torno de linhagem de renovação/risco temporal (não apenas grid genérico).

**Rota:** `/app/:orgId/expirations/:itemId`
**Acesso:** todos os papéis (leitura); ações destrutivas restritas (ver RBAC)
**Nav ativo:** "Vencimentos"

## Estrutura

1. `PageHeader`: `above` = link "← Voltar para Vencimentos"; título = nome do item (ex. "Alvará de
   Funcionamento — Unidade Centro"); descrição = "{Categoria} · Emitido por {emissor}"; ações:
   "Editar" (secondary) + "Renovar" (primary, oculto se status = ARCHIVED/DELETED/RENEWED —
   renovar só faz sentido em item ACTIVE).
2. **Painel "hero"** — hierarquia de risco temporal, o elemento de maior peso visual da tela:
   - Esquerda: data de vencimento em destaque (papel tipográfico "Display", `tabular-nums`) + texto
     relativo abaixo (Label role) — ex. "Vencido há 15 dias" (tone `critical`, ícone de alerta) ou
     "Vence em 12 dias" (tone `warning`) ou "Vence em 90 dias" (tone `neutral`); nunca só a cor —
     ícone + texto sempre presentes.
   - Direita: `StatusBadge` de ciclo de vida (Ativo/Arquivado/Renovado/Excluído, tone neutral,
     `srPrefix="Situação"`, ícone por estado) + `UrgencyIndicator` (derivado da data, independente do
     StatusBadge — um item RENOVADO não mostra urgência, por exemplo).
   - Estado RENEWED: o hero substitui a data de vencimento por "Renovado em {data}" + link "Ver item
     renovado →" (para a nova instância desta mesma tela, via `renewedFromId`/sucessor); nenhuma ação
     de edição/renovação fica visível neste estado (somente leitura, exceto navegação).
   - Estado DELETED: tela abre em modo somente-leitura com `InlineNotice tone="critical"`
     "Este vencimento foi excluído em {data} por {ator}" no topo, sem ações de edição/arquivamento/
     renovação; permanece acessível via link direto (ex. a partir do log de auditoria) para contexto
     histórico.
3. **Grid 2 colunas** (1 col ≤820px), dois painéis com `DetailList`:
   - "Identificação": Categoria, Descrição (line-clamp 3 linhas com "ver mais"), Periodicidade,
     Emissor, Número.
   - "Acompanhamento": Responsável (nome + avatar iniciais, nunca só cor), Prioridade, Tags,
     Observadores ("N pessoas · Gerenciar" → abre um `Popover`/lista simples de watchers com
     adicionar/remover, ação `item:watch`), Origem (se `renewedFromId` existir: "Renovado de: {nome do
     item anterior} →", link para essa instância de A05; se o item de origem foi removido, mostrar
     "Item de origem indisponível" em vez de quebrar o link), Versão técnica (colapsada por padrão sob
     "Detalhes técnicos ▸", nunca exposta como rótulo principal — ex. "v4" com tooltip explicando OCC
     em linguagem simples: "protege contra edições simultâneas").
4. **Grid de cards de link** (`repeat(auto-fill, minmax(220px,1fr))`), cada um navega para uma
   subtela — cada card assume peso maior quando o conteúdo indica algo pendente:
   - "Lembretes" → A06, nota: "Política ativa · N avisos antes do vencimento" ou, se não configurada,
     tone `warning`: "Nenhuma política configurada — configurar agora".
   - "Arquivos" → A07, nota: "N anexo(s) · {pior status entre os anexos}" (ex. tone `critical` se
     algum anexo está REJECTED/TIMEOUT, tone `warning` se algum está SCANNING/PENDING_UPLOAD).
   - "Histórico de auditoria" → filtro do log de auditoria (A23) por este recurso, nota: última
     alteração (ator + timestamp relativo).
5. **Barra de zona de perigo** (alinhada à direita, borda superior separando, oculta inteiramente
   para VIEWER — não apenas desabilitada): "Arquivar vencimento" (`ghost`, sm) + "Excluir vencimento"
   (`danger`, sm, visível somente a ADMIN_ROLES). Excluir sempre abre `Dialog` de confirmação
   nomeando o item ("Excluir '{nome}'? Esta ação move o item para o histórico e não pode ser desfeita
   pela interface.") com foco inicial no botão de cancelar, nunca no de confirmar.

## Estados

- **ACTIVE**: fluxo normal descrito acima.
- **ARCHIVED**: hero mostra "Arquivado em {data}"; "Renovar"/"Editar" ocultos; ação "Reativar"
  (`secondary`) substitui "Arquivar vencimento" na zona de perigo, mesma tier RBAC (WRITE_ROLES).
- **RENEWED** / **DELETED**: ver painel hero acima.
- **Conflito de edição (OCC)**: ao salvar "Editar" com versão desatualizada, `InlineNotice
  tone="critical"` no topo do formulário: "Este vencimento foi alterado por outra pessoa enquanto você
  editava. Revise as mudanças abaixo antes de salvar novamente." — o formulário recarrega os valores
  atuais lado a lado com os que o usuário digitou (nunca sobrescreve silenciosamente); usuário escolhe
  manter seus valores ou aceitar os novos, campo a campo.
- **Renovação em progresso**: botão "Renovar" mostra estado `loading` (spinner interno, texto
  "Renovando…", desabilitado); um retry da mesma requisição (ex. timeout de rede) nunca cria um
  segundo item renovado — a interface trata a operação como idempotente e, se a renovação já havia
  sido concluída no backend, apenas navega para o resultado existente.
- **Carregamento inicial**: skeleton reproduzindo a estrutura do hero + grid (nunca página em branco).
- **Falha ao carregar**: `InlineNotice tone="critical"` com "Não foi possível carregar este
  vencimento." + ação "Tentar novamente".
- **Sucesso de ação** (editar/renovar/arquivar/excluir): `Toast` confirmando ("Vencimento renovado",
  "Alterações salvas") — nunca a única confirmação de exclusão, que usa navegação de volta à lista com
  `InlineNotice tone="success"` no topo da lista.

## Dados de exemplo

```
Identificação: Categoria=Licenças, Descrição="Alvará de funcionamento da unidade Centro, emitido pela
  Prefeitura Municipal.", Periodicidade=Anual, Emissor=Prefeitura Municipal, Número=AL-2024-00931
Acompanhamento: Responsável=Marina Costa, Prioridade=Alta, Tags=Operacional, Unidade Centro,
  Observadores=2 pessoas, Origem=(nenhuma), Versão técnica=v4
```

## RBAC

- `item:read`, `audit:read`: todos os papéis (READ_ONLY_ROLES).
- `item:update` (editar/renovar/arquivar/reativar), `item:watch`, `reminder:manage` (abre A06),
  `document:reserve-upload`/`document:read` (abre A07): WRITE_ROLES (OWNER/ADMIN/MEMBER) — VIEWER não
  vê os botões/ação nem a barra de zona de perigo (oculta, não apenas desabilitada).
- `item:delete`, `document:delete` (dentro de A07): **ADMIN_ROLES (OWNER/ADMIN) apenas** — MEMBER não
  vê "Excluir vencimento" nem "Excluir" em anexos (correção do achado crítico da auditoria: a versão
  anterior desta spec permitia exclusão a MEMBER+, contradizendo `authorization.ts`).
- Excluir exige confirmação modal com foco inicial em "Cancelar" (ver Estrutura, item 5).

## Responsivo e acessibilidade

- Paridade total (nenhuma ação removida em mobile). Grid 2 colunas → 1 coluna ≤820px, hero permanece
  no topo em largura total. Grid de cards de link empilha em coluna única <480px.
- Zona de perigo nunca é a ação mais alcançável — permanece ao final do scroll da página em qualquer
  largura, nunca fixada/sticky.
- Todo elemento interativo (links de card, botões, badges de link) tem `focus-visible` de 2px e nome
  acessível; `UrgencyIndicator`/`StatusBadge` carregam texto lido por leitor de tela, não apenas cor.
- Alvo de toque mínimo 40×40px (44×44 para ações primárias), conforme design system.

## Motion

- Transição de estado do hero (ex. ACTIVE → status "Renovando…") usa `motion.fast` (120ms, ease-out)
  no badge/indicador, sem reflow do restante da página. Abertura do Dialog de exclusão usa
  `motion.normal` (180ms) com foco movido ao abrir. Navegação entre esta tela e A06/A07 não anima
  (troca de rota instantânea) — não há benefício de continuidade espacial entre páginas distintas do
  shell. `prefers-reduced-motion`: todas as transições acima colapsam para troca instantânea de
  estado, sem exceção.

## RBAC (resumo tabular)

| Ação | OWNER | ADMIN | MEMBER | VIEWER |
|---|---|---|---|---|
| Ler / auditoria | ✓ | ✓ | ✓ | ✓ |
| Editar / Renovar / Arquivar / Reativar | ✓ | ✓ | ✓ | — |
| Gerenciar observadores | ✓ | ✓ | ✓ | — |
| Excluir vencimento | ✓ | ✓ | — | — |

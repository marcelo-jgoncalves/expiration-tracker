# A13 — Fila de revisão

**Revision history**: revised 2026-09-09 per
`docs/architecture/reviews/screen-spec-audit-2026-09-09/A13-audit-record.md` (batch 3/6) — route
corrected to include `:orgId`, one-state-per-call contract made explicit (verified against D-248's
real `listReviewQueue` route mechanics), OWNER/ADMIN-bypass RBAC fixed, missing operational states
added, mobile list→detail sequence specified, motion decision named. **Route-mechanics verification**:
this screen's two-tab design is confirmed compatible with the real backend — `GET
/document-archive/reviews?state=RECEIVED|UNDER_REVIEW` takes exactly one `state` per call (GSI5
partitions by state, no server-side merged "ALL" mode) — see audit record for the explicit
verification.

**Rota:** `/app/:orgId/reviews`
**Nav ativo:** "Revisões"
**Layout:** dois painéis empilhados full-width (lista acima, detalhe abaixo) — **não** lado a lado
(exceção local justificada — ver audit record; validar no gate de render).

## Ações (mapeadas para `authorization.ts` + regra de serviço)

| Ação visível | Capability | Tier |
|---|---|---|
| Ver a fila e o detalhe | `docarchive:read` | todos (READ_ONLY_ROLES) |
| Reivindicar (claim) | `docarchive:review` | WRITE_ROLES, só sobre item RECEIVED ainda não reivindicado |
| Aceitar / Rejeitar | `docarchive:review` | WRITE_ROLES, **mais o gate de serviço**: um MEMBER só decide um item que reivindicou ou que está sem reivindicação; **OWNER/ADMIN sempre podem decidir qualquer item elegível, mesmo reivindicado por outro revisor** |

VIEWER: vê a fila e o detalhe, nunca vê a barra de ações (Reivindicar/Aceitar/Rejeitar).

## Estrutura

1. `PageHeader`: título "Fila de revisão", descrição "Versões de documento recebidas ou em revisão,
   aguardando decisão." Sem ações de cabeçalho.
2. **Painel de lista**: header com `FilterGroup` (overflow-x:auto) com abas de estado:
   - Recebidas (`RECEIVED`) — contagem
   - Em revisão (`UNDER_REVIEW`) — contagem
   - **Cada aba dispara sua própria chamada paginada `GET .../reviews?state=RECEIVED` ou
     `?state=UNDER_REVIEW`** — nunca uma chamada combinada "todas"; loading, erro e cursor de paginação
     são independentes por aba (mecânica real confirmada em `listReviewQueue`, D-248).
   `DataTable` compacta, colunas:
   - Documento (primary): nome do documento + origem (`CellSecondary`) abaixo. A linha inteira é
     selecionável via um elemento `role="row"` com `aria-selected` e um único controle interativo
     acessível por linha (não um `<button>` envolvendo toda a linha, que cria markup interativo
     aninhado inválido) — seleciona o item para o painel de detalhe abaixo.
   - Fornecedor
   - Recebido em (data/hora)
   - Revisor: `StatusBadge` "Disponível" (tone neutral) se não reivindicado, ou "Com {nome}" (tone
     neutral, não warning — ownership normal de um revisor não é uma exceção) se já reivindicado.
3. **Painel de detalhe** ("Detalhe do item selecionado"), abaixo, full-width:
   - Se nenhum item na fila filtrada: mensagem vazia "Nenhum item nesta fila."
   - Se a fila falhar ao carregar: `InlineNotice tone="warning"` com "Tentar novamente".
   - Senão, corpo com:
     - Grid de 2 `DetailList`: (Documento, Fornecedor, Requisito de origem, Origem, Contadores de
       scan) e (Recebido em, Verificação de segurança, Validade proposta, Revisor — "Não reivindicado"
       se vazio).
     - Se scan estiver pendente: "Verificando segurança" substitui a ação Aceitar (desabilitada com
       explicação, não oculta — o usuário precisa entender por que não pode decidir ainda).
     - Se scan estiver infectado: `InlineNotice tone="danger"` "Arquivo infectado — esta versão não
       pode ser aceita." — oculta Aceitar, mantém Rejeitar.
     - Se o item já foi reivindicado por **outro** revisor:
       - Se o ator é MEMBER (não OWNER/ADMIN): `InlineNotice tone="neutral"` "Reivindicado por
         {nome}." — **oculta a barra de ações** (não pode agir sobre item de outra pessoa).
       - Se o ator é OWNER/ADMIN: mostra a mesma informação de ownership, **mas mantém a barra de
         ações visível** — administradores podem decidir qualquer item elegível independentemente de
         quem reivindicou (regra de serviço `assertReviewerOrAdmin`).
     - Senão, **barra de ações** (`a13-actionbar`, 2 zonas):
       - Esquerda: "Reivindicar" (secondary, só aparece se `reviewer === "—"`) + "Abrir documento"
         (secondary, link → A12 focado nesta versão).
       - Direita: "Rejeitar" (danger, abre um formulário com motivo de um conjunto fechado + opção
         "Outro" com texto livre quando o domínio permitir) + "Aceitar" (primary, desabilitado
         enquanto scan pendente/infectado).

## Estados

- Loading inicial da fila: skeleton de linhas.
- Fila vazia: "Nenhum item nesta fila." (ver Estrutura item 3).
- Erro ao carregar fila ou detalhe: `InlineNotice` com retry.
- Já reivindicado por outro (MEMBER) vs. reivindicado por outro com bypass (OWNER/ADMIN) — ver
  Estrutura item 3.
- Claim expirado: se o claim do ator expirar enquanto ele está na tela, mostrar notice e recarregar o
  item.
- Scan pendente / infectado — ver Estrutura item 3.
- Conflito concorrente: se dois revisores decidirem quase ao mesmo tempo, a segunda chamada recebe
  conflito — "Este item já foi decidido por outra pessoa" + recarrega a fila.
- Rejeição requer motivo de um conjunto fechado, com opção "Outro" (texto livre) quando aplicável.
- Sucesso pós-decisão: item some da fila atual; seleção avança automaticamente para o próximo item da
  lista filtrada, ou mostra "Nenhum item nesta fila" se era o último.
- Paginação: indicador "mostrando N de M" quando há mais itens do que a página atual.

## Dados de exemplo

```
q1: RECEIVED, CND Federal — Atlas Schindler, origem Solicitação (guest), recebido 09/09 08:12,
  revisor "—", scan Verificado
q2: RECEIVED, Apólice de seguro — Porto Seguro, origem Upload manual, recebido 08/09 17:40,
  revisor "—", scan Verificando…
q3: UNDER_REVIEW, Contrato de locação — Imobiliária Vértice, origem Upload manual,
  recebido 07/09 11:05, revisor Marina Costa, scan Verificado
```
Seleção padrão ao carregar: `q1` (primeiro item da aba "Recebidas").

## Regras de negócio

- Trocar de aba de filtro reseta a seleção do detalhe (nenhum item selecionado até o usuário clicar em
  uma linha) e dispara uma nova chamada paginada para o `state` daquela aba.
- Reivindicar é exclusivo entre MEMBERs: uma vez reivindicado por um MEMBER, outros MEMBERs só podem
  visualizar, não agir (nem reivindicar de volta), até liberação. **OWNER e ADMIN sempre podem
  decidir qualquer item elegível, reivindicado ou não** (regra de serviço, não apenas RBAC de tier).
- "Aceitar" transiciona o documento para status `ACCEPTED` (ver A12) e a versão anterior para
  `SUPERSEDED`. "Rejeitar" para `REJECTED`.

## Conexões

- Entrada: A03 (card "Aguardando revisão", quando desbloqueado).
- Item selecionado → "Abrir documento" leva a A12 focado nesta versão.
- Decisão avança automaticamente para o próximo item da fila filtrada.

## Responsivo

- Full parity — ações de decisão nunca são degradadas em mobile.
- Em mobile, o layout vira uma sequência lista→detalhe: selecionar um item na lista navega para uma
  tela de detalhe (voltar retorna à lista, preservando a aba e a posição de scroll).

## Motion

- Seleção de linha: instantânea, sem transição (alta frequência operacional).
- Item decidido (aceito/rejeitado): fade + colapso em `motion.normal` (180ms) antes de avançar a
  seleção para o próximo item.
- Respeita `prefers-reduced-motion`: remove o fade/colapso, item some e seleção avança direto.

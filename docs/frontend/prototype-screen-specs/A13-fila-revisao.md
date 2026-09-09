# A13 — Fila de revisão

**Rota:** `/reviews`
**Acesso:** MEMBER+ para reivindicar/decidir; VIEWER pode ver a fila mas sem ações
**Nav ativo:** "Revisões"
**Layout:** dois painéis empilhados full-width (lista acima, detalhe abaixo) — **não** lado a lado.

## Estrutura

1. `PageHeader`: título "Fila de revisão", descrição "Versões de documento recebidas ou em revisão, aguardando decisão." Sem ações de cabeçalho.
2. **Painel de lista**: header com `FilterGroup` (overflow-x:auto) com abas de estado:
   - Recebidas (`RECEIVED`) — contagem
   - Em revisão (`UNDER_REVIEW`) — contagem
   `DataTable` compacta, colunas:
   - Documento (primary): **linha inteira é um botão clicável** (`<button class="a13-row">`) que seleciona o item para o painel de detalhe abaixo — nome do documento + origem (`CellSecondary`) abaixo.
   - Fornecedor
   - Recebido em (data/hora)
   - Revisor: `StatusBadge` "Disponível" (tone neutral) se não reivindicado, ou "Com {nome}" (tone warning) se já reivindicado por alguém.
3. **Painel de detalhe** ("Detalhe do item selecionado"), abaixo, full-width:
   - Se nenhum item na fila filtrada: mensagem vazia "Nenhum item nesta fila."
   - Senão, corpo com:
     - Grid de 2 `DetailList`: (Documento, Fornecedor, Origem) e (Recebido em, Verificação de segurança, Revisor — "Não reivindicado" se vazio).
     - Se o item já foi reivindicado por **outro** revisor (não o usuário atual): `InlineNotice tone="warning"` "Já reivindicado por outro revisor." — **oculta a barra de ações** (não pode agir sobre item de outra pessoa).
     - Senão, **barra de ações** (`a13-actionbar`, 2 zonas):
       - Esquerda: "Reivindicar" (secondary, só aparece se `reviewer === "—"`) + "Abrir documento" (secondary, link).
       - Direita: "Rejeitar" (danger) + "Aceitar" (primary).

## Dados de exemplo

```
q1: RECEIVED, CND Federal — Atlas Schindler, origem Solicitação (guest), recebido 09/09 08:12, revisor "—", scan Verificado
q2: RECEIVED, Apólice de seguro — Porto Seguro, origem Upload manual, recebido 08/09 17:40, revisor "—", scan Verificando…
q3: UNDER_REVIEW, Contrato de locação — Imobiliária Vértice, origem Upload manual, recebido 07/09 11:05, revisor Marina Costa, scan Verificado
```
Seleção padrão ao carregar: `q1` (primeiro item da aba "Recebidas").

## Regras de negócio

- Trocar de aba de filtro reseta a seleção do detalhe (nenhum item selecionado até o usuário clicar em uma linha).
- Reivindicar é exclusivo: uma vez reivindicado por alguém, outros revisores só podem visualizar, não agir (nem reivindicar de volta), até liberação.
- "Aceitar" transiciona o documento para status `ACCEPTED` (ver A12) e a versão anterior para `SUPERSEDED`. "Rejeitar" para `REJECTED`.

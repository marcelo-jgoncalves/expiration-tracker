# Round 2 — Auto-avaliação às cegas (Claude)

Escrita ANTES de mandar a Rodada 2 ao Codex.

## Contra os 4 bloqueantes da Rodada 1

1. **Pesquisa Jira imprecisa** — corrigido com fonte nova verificada (support.atlassian.com +
   community thread), síntese revisada admite que a convergência externa é MAIS fraca do que eu
   originalmente alegava, não mais forte. Honesto, não maquiado. ✅
2. **TOCTOU bloqueante** — não resolvido por eliminação (impossível dado GSI eventualmente
   consistente + limite de 100 itens por transação), mas agora explicitamente bounded: pior caso =
   status quo já aceito (B2B-11). Isso é uma resposta de engenharia honesta, não uma alegação de
   atomicidade que eu não poderia entregar. Risco: o Codex pode achar que "aceitar o status quo como
   pior caso" ainda é fraco demais para um critério que a própria proposta original chamou de peso
   30%. ⚠️
3. **Checklist subpesa consistência** — reconciliado com um critério novo (peso 25%) dedicado.
   Risco: dividi o peso original de 30% em 25%+25% — a soma dos dois é maior (50%) que o peso
   original do critério 1 sozinho, o que é defensável (consistência é genuinamente mais importante
   do que eu havia ponderado) mas pode ser lido como eu "inflando" a importância do meu próprio
   argumento. ⚠️
4. **Capacidade por tenant não fechada** — não fechei o dimensionamento exato (não tenho como, sem
   telemetria real), mas expliquei por que o teto de retorno (20 itemIds) resolve o problema de UX
   mesmo sem resolver o custo de RCU de um tenant patológico - registrei isso como limitação
   conhecida, não escondida. Aceitável dado `AGENTS.md` §1 (sem produção real). ✅

## Pontos que eu mesmo ainda vejo como frágeis

- Não constatei se `queryByPk`/GSI1 já tem uma função pronta reaproveitável no
  `DynamoDbExpirationStore` que eu possa citar por nome exato, ou se a implementação real
  (fora de escopo desta proposta de design) precisaria escrever uma query nova do zero - isso é
  detalhe de implementação, não deveria bloquear o design, mas pode ser uma pergunta do Codex.
- O nome `AssignedActiveItemsLookup` pode ainda não ser o ideal - não testei alternativas com o
  Codex ainda.

## Nota (às cegas, antes do Codex)

**Claude: 8.6/10** — os 4 bloqueantes têm resposta real e verificável, o checklist reconciliado é
mais honesto que o original, mas a resposta ao TOCTOU (bounded, não eliminado) é uma escolha de
engenharia correta que ainda pode não convencer o Codex de que o peso 25% do novo critério 2 está
genuinamente satisfeito, não só reformulado em palavras melhores.

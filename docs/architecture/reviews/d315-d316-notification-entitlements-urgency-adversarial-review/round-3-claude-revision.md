# D-315/D-316 — Rodada 3 (confirmação, nota Codex 9,0/10 na Rodada 2)

A Rodada 2 já atingiu o gate de 9,0 (Codex 9,0, aceitando explicitamente a divisão de escopo
proposta - corrigir achados 1/4/5, registrar 2/3/6 como pendência do worker M4), mas o protocolo
exige mínimo 3 rodadas. Os únicos achados restantes eram 2 "Baixa" não-bloqueantes. Ambos aplicados:

1. **Overview.tsx - aviso de erro disparando com o summary só pendente, não errado.** Ao remover
   `summaryQuery.isPending` do gate de loading (Rodada 2, achado 5), o `InlineNotice` de erro
   passou a aparecer também enquanto `summaryQuery` ainda estava em voo (não só quando
   genuinamente falhava) - falso positivo temporário. Corrigido: `attention ? <AttentionRow /> :
   summaryQuery.isPending ? null : <InlineNotice />` - nunca reintroduz o bloqueio da tabela (que
   não depende disto), só distingue "ainda carregando" de "falhou de verdade". Teste reforçado
   (`renders the items table before the summary aggregate resolves...`) agora também afirma que o
   aviso de erro NÃO aparece enquanto pendente.

2. **Teste de reativação mais estreito que o nome prometia.** O teste
   `never overwrites an existing NotificationPreferences record...` só comparava
   `emailEnabled`/`consentSource`, deixando `locale`/`quietHours`/`version`/timestamps
   preserváveis-em-teoria mas nunca provados por um valor real e distinguível do default.
   Corrigido: o registro pré-existente agora usa um valor diferente do default em TODOS os campos
   (`locale: "en-US"`, `quietHours` um objeto real, `version: 2`, timestamps distintos), e a
   asserção final é `toEqual(preExisting)` - uma comparação estrutural completa, não campo a campo.

## Sugestão do Codex não aplicada (registrada, não obrigatória para o gate)

Codex sugeriu um builder dedicado para "seed sem sobrescrita" centralizando o padrão
`if_not_exists()`, reaproveitando `defaultNotificationPreferences()`, em vez de duplicar os
literais na `UpdateExpression` hand-rolled. Julgamento consciente de não aplicar agora: o padrão
`if_not_exists()` por campo já é usado exatamente uma vez neste arquivo (o `membershipEntry`
acima, para `version`/`createdAt`) e agora uma segunda vez (o `notificationPreferencesEntry`) -
não há um terceiro call site ainda para justificar extrair um builder genérico (3 estruturas
similares é o limiar usual deste projeto para abstrair, não 2 - AGENTS.md/CLAUDE.md "don't add
abstractions beyond what the task requires"). Também explicitamente confirmado como não-bloqueante
pelo próprio Codex ("não recomendo tornar ConditionExpression opcional indiscriminadamente").

## Nota cega (Claude), Rodada 3

Ver `round-3-claude-selfgrade.md` (arquivo separado).

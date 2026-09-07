# Round 4 — Claude final corrections

Nota 8,1/10 aceita. Os 3 pontos são reais e pontuais — correções cirúrgicas, sem reabrir nada já
fechado nas Rodadas 1-3.

## Correção 1 (dual-write DynamoDB→SQS perde notificação — CRÍTICO, aceito)
Adotada a primeira alternativa sugerida pelo Codex: material de entrega cifrado em store
dedicado, IAM exclusivo, sem reabrir o vazamento do Round 2. Nova tabela DynamoDB dedicada
`exptrk-<env>-guest-credential-delivery` (Terraform, mesmo módulo `dynamo-table` já usado pelas
outras tabelas do projeto — TTL nativo em `expiresAt`, sem GSI nenhum, item pequeno). Política IAM:
`PutItem` só para a role `document-archive-guest-handler` (o único emissor); `GetItem`/`Query`/
`DeleteItem` só para a role de um NOVO worker de entrega dedicado (item 3/19, outro agente) — nunca
anexada à política geral `tenant_facing_read_write_policy_json` (mesma disciplina de isolamento de
GSI3/GSI6 do `AGENTS.md` §7, aplicada aqui a uma tabela inteira em vez de um índice).

O consumidor de issuance agora inclui o `Put` desse item na MESMA `TransactWriteItems` do
DynamoDB principal — sim, uma `TransactWriteItems` pode abranger múltiplas tabelas do mesmo
account/região, confirmado (limite de 100 itens/4MB por transação, sem restrição de tabela única).
5 entradas na transação: `IdempotencyRecord` + `RequestAccessCredential` Put + `DocumentRequest`
Update + `Put` do item de entrega (tabela dedicada, token bruto, TTL curto nativo) — atômico de
verdade, fecha o crash window apontado (nenhum caminho deixa a credencial existir sem o material
de entrega correspondentemente persistido, e vice-versa). O worker de entrega (fatia futura) faz
`Query`/`GetItem` na tabela dedicada, envia, e só então `DeleteItem` — reconciliação por
TTL nativo cobre o caso "nunca entregue", visível por métrica de idade do item, sem depender de
`SendMessage` ter sucesso no mesmo request-response do consumidor de issuance.

## Correção 2 (condição de commit incompleta)
`ConditionExpression` do `Update` do `DocumentRequest`, completa:
```
issuanceGeneration = :expectedGeneration
  AND #status IN (:requested, :opened)
  AND version = :expectedVersion
  AND (attribute_not_exists(activeCredentialSelectorHash) OR activeCredentialSelectorHash = :expectedPointer)
```
(`:expectedPointer` é o valor lido pelo consumidor antes de montar a transação — `undefined`/ausente
na emissão inicial, o selector anterior numa reemissão). Tratamento de falha: o consumidor relê a
`DocumentRequest` de forma consistente após a `TransactionCanceledException` e distingue por
inspeção direta do estado atual (não pelo índice da operação, aceito o ponto do Codex): se
`issuanceGeneration` já avançou -> evento obsoleto, descarta silenciosamente (log informativo); se
`status` não é mais elegível -> request morreu nesse meio tempo, descarta; se `version`/`pointer`
não batem por qualquer outro motivo não coberto pelos dois casos anteriores -> não descarta,
propaga o erro (alerta, não vira ACK genérico) — só os dois casos nomeados e entendidos são
tratados como no-op seguro.

## Correção 3 (revogação idempotente — bug real, `:sameRevokedAt` removido)
Condição corrigida para exatamente o que o Codex propôs:
```
ConditionExpression: "documentRequestId = :did AND selectorHash = :sel"
SET revokedAt = if_not_exists(revokedAt, :now)
```
Sem comparação de igualdade com um timestamp da tentativa atual — `if_not_exists` já garante que
uma segunda tentativa nunca sobrescreve um `revokedAt` existente, e a condição de pertencimento
(`documentRequestId`/`selectorHash`) continua provando que a credencial certa está sendo tocada.
Uma segunda tentativa com a mesma condição sempre sucede (idempotente de verdade, sem `OR` falso).

## Pedido final
Peço reavaliação com estas 3 correções aplicadas — nenhuma outra mudança de escopo desde a Rodada
3. Se restar algum gap, aponte; senão, considero o design pronto para a nota final de ambos os
lados.

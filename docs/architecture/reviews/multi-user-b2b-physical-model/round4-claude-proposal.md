# Multi-User B2B — Physical Model, Wave B2B-1 (Rodada 4, proposta Claude)

Rodada 3: Codex 9,2/10 (≥9,0), Claude autograde 8,4/10 (achado real não coberto pelo Codex nesta rodada: janela de eventual consistency do GSI4 a cada reingresso). Só o delta é registrado — `round1`-`round3` continuam valendo no resto.

## Achado do autograde Claude (não levantado pelo Codex na Rodada 3): janela de eventual consistency do GSI4 a cada (re)ingresso

Regenerar `membershipId` a cada (re)ingresso muda o valor de `GSI4SK`. A propagação da tabela base para o GSI4 é assíncrona (mesma semântica de qualquer GSI do DynamoDB) — entre o commit da `TransactWriteItems` e a propagação, uma consulta a `MembershipByUser` (GSI4) pode transitoriamente ver zero ou duas entradas para o mesmo par `(userId, organizationId)`. O design não declarava isso como esperado nem dizia se os consumidores do GSI4 toleram.

**Correção — contrato explícito de consistência para GSI4**: `MembershipByUser` (GSI4) é **eventually consistent por natureza do DynamoDB e nunca é fonte de autorização** — resolução de `RequestContext`/decisão de acesso sempre faz `GetItem`/`Query` direto na partição base (`PK=TENANT#<organizationId>#ORG#<organizationId>`, `SK=MEMBER#<userId>`), nunca via GSI4 (já era assim desde a Rodada 1 §7, agora declarado explicitamente como invariante, não só implícito). GSI4 serve exclusivamente para LISTAGEM ("quais Organizations este usuário pode acessar" — seletor de organização, tela "minhas organizations"). Consumidores de listagem devem tolerar uma janela curta (tipicamente sub-segundo) de leitura obsoleta/duplicada logo após qualquer mudança de `membershipId` (criação, aceite de convite, reingresso) — comportamento aceitável para uma lista de seleção, não para uma decisão de acesso.

## Hardening de implementação sugerido pelo Codex na Rodada 3 (não bloqueante, incorporado por completude)

- `ConditionExpression` do `Update Membership` ajustada para `attribute_not_exists(PK) OR #status = :REMOVED` (em vez de `attribute_not_exists(#status)`) — mais robusto contra um item existente malformado sem `status` (não há Membership legado real hoje, então isso é hardening preventivo, não correção de bug real).
- `version`/`createdAt` no upsert de `Membership` usam `if_not_exists(version, :one)`/`if_not_exists(createdAt, :now)` para não resetar esses campos num reingresso (só `updatedAt`/`joinedAt`/`membershipId`/`role`/`status` mudam de fato).
- Alias `#status` usado de forma consistente também no `Update Invitation` (mesma transação).

## Fechamento

Com o achado do GSI4 declarado e os 3 ajustes de hardening incorporados, não há achado novo pendente de nenhum dos dois lados até aqui. Pronto para nota de fechamento.

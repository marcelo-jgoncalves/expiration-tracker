# Multi-User B2B — Wave B2B-8 (Invitations/Team), Rodada 3 — Proposta Claude

Régua v2 quase convergida (Codex 8,8/10 na Rodada 2) — 1 ajuste pontual: o critério 3 não ancorava explicitamente a condição completa da transação, e o nome do erro (`InvitationTokenAlreadyConsumedError`) ficava impreciso porque a mesma falha de condição pode ser replay OU expiração-de-corrida-estreita.

## Checklist v3 — critério 3 corrigido (único ajuste)

```text
3. (peso 20%) Anti-replay do token de convite é estrutural na PRÓPRIA transação de aceite —
   `Update InvitationTokenPointer` na MESMA `TransactWriteItems` do aceite, com
   `ConditionExpression: attribute_not_exists(consumedAt) AND expiresAt > :now` (as DUAS
   cláusulas, não só a primeira — fecha replay E a corrida estreita de expiração entre a
   resolução prévia e o commit). Atende: teste prova que aceitar o mesmo token 2x falha, E que
   um token expirado entre resolução e commit também falha na transação (não só na resolução
   prévia); falha da condição mapeia para um erro nomeado GENÉRICO (nunca distingue replay de
   expiração na resposta — a mesma ambiguidade que já existe na resolução prévia por
   anti-enumeration, `guest-token.ts`). Não atende: condição incompleta (só uma cláusula), ou
   um nome de erro que afirma uma causa específica (`AlreadyConsumed`) que a condição não
   consegue distinguir de fato.
```

## Correção de design — nome do erro genérico

`InvitationTokenAlreadyConsumedError` renomeado para **`InvitationTokenUnavailableError`** — cobre replay, expiração-de-corrida, e (defensivamente) qualquer futuro motivo de falha da mesma condição, sem afirmar uma causa que a transação não consegue distinguir. Mapeado a 410 Gone ou 409 Conflict pela camada HTTP (decisão de implementação, não deste escopo) — nunca vaza qual das 2 cláusulas falhou.

Nenhuma outra mudança de design da Rodada 2 (checklist itens 1/2/4/5 e as demais correções já convergidas, sem contestação nesta rodada).

## Pergunta final

Este ajuste fecha o achado da Rodada 2? Se a régua v3 convergir ≥9,0 dos dois lados nesta rodada, favor dar também a nota final do design.

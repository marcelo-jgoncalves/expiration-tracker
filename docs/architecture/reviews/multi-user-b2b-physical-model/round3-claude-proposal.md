# Multi-User B2B — Physical Model, Wave B2B-1 (Rodada 3, proposta Claude)

Revisão da Rodada 2 (nota Claude 8,1/Codex 8,9, ambos abaixo do gate, convergência real no mesmo achado central). Só o delta é registrado aqui — `round1-claude-proposal.md` + `round2-claude-proposal.md` continuam valendo no resto.

## Achado central (Codex + autograde Claude, convergente e independente): semântica de Membership removida/reconvidável não estava especificada

A Rodada 2 corrigiu a mecânica do `TransactWriteItems` (achado Codex #2 da Rodada 1) mas não decidiu o que fisicamente acontece quando uma `Membership` é removida — deixando o `Put` condicionado a `attribute_not_exists(PK)` incorreto se a linha for soft-deleted (retida com outro status) em vez de fisicamente apagada, que é o padrão de retenção/auditoria já preferido pelo resto do projeto (`AuditEvent`, W3-07 usam soft-delete/histórico, não `Delete` cru, como regra geral).

## 4.2''. `Membership.status` — três estados, nunca hard-delete (fecha o achado central)

```text
Membership.status ∈ { ACTIVE, SUSPENDED, REMOVED }
```

`REMOVED` substitui a remoção física — a linha permanece (auditoria/histórico, mesmo princípio já aplicado a `AuditEvent`/W3-07 neste projeto), só o `status` muda. `SUSPENDED` continua distinto de `REMOVED`: um membro suspenso ainda É membro (`ownerCount`/contagens de membro continuam considerando-o parte da Organization, só sem acesso operacional), reversível só por ação administrativa explícita (`unsuspend`, fora do escopo desta rodada); `REMOVED` é o estado que permite reingresso via convite.

### Aceite de `Invitation` — `Update` condicionado, não `Put` (correção final da mecânica)

```text
TransactWriteItems:
  Update Membership { PK=TENANT#<organizationId>#ORG#<organizationId>, SK=MEMBER#<userId>,
                       SET role=:role, status=:ACTIVE, membershipId=:newMembershipId,
                           joinedAt=:now, GSI4PK=USER#<userId>, GSI4SK=ORG#<organizationId>#MEMBERSHIP#<newMembershipId> }
                     ConditionExpression: attribute_not_exists(#status) OR #status = :REMOVED
  Update Invitation { status: ACCEPTED, acceptedAt }
                     ConditionExpression: status = :PENDING
  Delete InvitationDedupPointer
```

`Update` (não `Put`) faz upsert nativo do DynamoDB: se o item não existir, `attribute_not_exists(#status)` é verdadeiro e a operação cria a linha; se existir com `status=REMOVED`, a condição também passa (reingresso legítimo); se existir com `status=ACTIVE` ou `SUSPENDED`, a condição falha e a transação cancela — outcome terminal idempotente "já é membro" (§77 do roadmap), exatamente como antes, sem o bug de bloquear reingresso legítimo. `membershipId` é regenerado a cada (re)ingresso (cada "vida" de membership ganha um ID distinto para correlação de auditoria) — judgment call de baixo risco (nível 3-4 da `change-risk-scale.md`), não uma decisão que precise de outra rodada.

`ownerCount` (§6 da Rodada 1): a transição para `REMOVED` de uma `Membership` `OWNER` `ACTIVE` decrementa `ownerCount` pela mesma disciplina já especificada — `REMOVED` é só mais uma das transições que reduzem a contagem, não um caso novo.

## Correção de caracterização — `DeviceSession` é mecanismo COMPARTILHADO entre os dois caminhos de login, não exclusivo do caminho direto/API

A Rodada 2 caracterizou `DeviceSession` como "caminho direto/API, distinto da sessão BFF" — **isso é factualmente incorreto**, verificado contra o código real: `bff-auth-service.ts:178,471,499` chama `users.upsertDeviceSession`/`logoutDevice`/`logoutAll` diretamente, usando `tenantId`/`userId` da própria sessão BFF. `DeviceSession` já é compartilhado pelos dois caminhos hoje.

Isso muda o raio de impacto real: com `DeviceSession` migrando para `PK=USER#<userId>` (§ Rodada 2, mecanismo de schema mantido, correto), `logoutAll(userId)` (perde o parâmetro `tenantId`) passa a ser **user-global por construção** — uma `Query` na partição `PK=USER#<userId>` retorna todos os `DeviceSession` do usuário, independente de qual Organization estava ativa quando cada um foi criado. **Declaração explícita de contrato, não deferida**: pós-cutover, "logout all" revoga todos os dispositivos do usuário em todas as Organizations, nunca só na Organization ativa no momento da chamada — mesmo princípio já usado para a sessão BFF (§46 da Rodada 1: identidade global sobrevive, seleção de organização é o que se invalida por escopo). Isso não introduz mecanismo novo, só corrige a frase da Rodada 2 que entendia isso como um detalhe de relocação de schema, quando na verdade é uma mudança de contrato de comportamento observável (um usuário que hoje espera "logout all" afetar só uma sessão isolada por tenant passa a ver todas as sessões de todas as Organizations caírem).

## Supersessão explícita — `UserProfile.roles` não sobrevive no `User` global

O `UserProfile` atual tem `roles: string[]` (tenant-scoped, hoje sempre `["OWNER"]` por construção do MVP). O novo `User` global (§1 da Rodada 1) **não tem esse campo** — role deixa de ser propriedade do usuário e passa a ser propriedade de cada `Membership` (por Organization). Omissão da Rodada 1/2, não decisão nova: `Membership.role` já era a fonte de verdade proposta desde §60 do roadmap, só faltava a frase de supersessão explícita.

## Checklist §121 — sem mudança desde a Rodada 2 (Q5/Q11/Q21/Q1 já respondidas explicitamente lá)

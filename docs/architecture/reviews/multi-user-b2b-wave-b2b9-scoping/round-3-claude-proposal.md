# Wave B2B-9 — Round 3 Proposal (refinamento final sobre convergência 9,1/9,1)

Rodada 2 já convergiu numericamente (Claude 9,1/10, Codex 9,1/10, ambos ≥9,0). Per `AGENTS.md` §4
("mínimo 3 rodadas: proposta → crítica → tréplica"), esta Rodada 3 é a tréplica de polimento —
incorpora os 3 refinamentos NÃO-bloqueantes que o próprio Codex deu na Rodada 2, sem reabrir nenhuma
decisão já fechada.

## Refinamento 1 — C2: `LoginAttempt` removido da lista de inventário do DSR

Codex, Rodada 2: `LoginAttempt` não tem `userId`/`cognitoSub` — não é atribuível a um titular
específico antes da autenticação completar, então não pertence à lista de "dado que um DSR de User
inventariaria". **C2 final**: `LoginAttempt` é artefato pré-autenticação, puramente TTL-driven
(mesmo tratamento que já recebe hoje, D-053/D-054) — explicitamente FORA do inventário de titular,
não uma omissão. A lista fica: `GlobalUser`, `DeviceSession`, `Session` (BFF, pós-autenticação, tem
`userId`), `IdentityMapping`, `UserProfile` por organização.

## Refinamento 2 — C2: `NotificationPreferences` citado como exemplo adicional de dado pessoal

Codex, Rodada 2: `NotificationPreferences` (`notification/domain/notification-preferences.ts:37`,
`PK=TENANT#<tenantId>#USER#<userId>`) é preferência PESSOAL do titular dentro de uma organização —
mesma categoria de `UserProfile` (per-organização, mas dado do titular, não dado de negócio
compartilhado), não uma entidade de identidade/sessão em si. **C2 final** passa a citar
explicitamente: "...e preferências pessoais per-organização como `NotificationPreferences`" — mais
preciso que implicar que a lista de 5 entidades é exaustiva para todo dado pessoal possível.

## Refinamento 3 — comentários stale corrigidos (já aceito na Rodada 2, sem mudança de decisão)

`tenant-purge-scan.ts:37-38` e `system-mutation.ts:230-237`: remover a afirmação de que
`IdentityMapping` "declara `tenantId`" (falso desde D-095/B2B-5) — reescrever a justificativa do
guard por chave física (`PK.startsWith("IDENTITY#")`) sem depender dessa premissa incorreta.

## Estado final do design (sem outras mudanças desde a Rodada 2)

1. Fix de purga: `tenant-purge-scan.ts` scan `FilterExpression` + `system-mutation.ts` `PURGE_DELETE`
   `ConditionExpression` ganham a 3ª cláusula `OR organizationId = :tenantId`.
2. Testes novos: adapter-level (`tenant-purge-scan.test.ts`, novo), behavioral em `PURGE_DELETE`
   (`system-mutation.test.ts`), sobrevivência de `GlobalUser`/Membership de outra org
   (`dynamo-tenant-purge.test.ts`), status terminal `DELETED` nomeado explicitamente
   (`bff-organization-context.test.ts`).
3. `privacy-lgpd.md`: nova subseção "User-level vs. Organization-level erasure" (C1/C2 final, 3
   fontes externas verificadas) + 5 linhas novas de `retentionClass` (`Membership`/`Invitation` →
   segue a Organization; `InvitationTokenPointer` → mesma classe de `GuestTokenPointer`;
   `MembershipAuditEvent` → `SECURITY_AUDIT`; `MembershipInviteRateLimitRecord` → `QUOTA_TELEMETRY`).
4. Invariante documentada (sem guard de código, sem call site real hoje): último `OWNER ACTIVE` não
   pode ser removido NEM suspenso; titular sole-owner não pode ser apagado sem antes transferir
   ownership ou deletar a Organization.
5. `decisions-log.md`: D-103 (escopo, este debate) / D-104 (implementação).
6. Fora de escopo: endpoint HTTP de DSR real, guard de código sem call site, orquestrador de purga
   (Step Functions vs. Lambda+EventBridge Scheduler).

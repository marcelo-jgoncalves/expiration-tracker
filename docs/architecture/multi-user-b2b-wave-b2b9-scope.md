# Multi-User B2B — Wave B2B-9 (W3-07 / Privacy Reconciliation), escopo final

**Status: `APPROVED`** via protocolo Claude↔Codex (`AGENTS.md` §4, nível 5-6 de `change-risk-scale.md`),
3 rodadas, nota cega cada rodada: Rodada 1 Claude 8,6/Codex 8,6 (3 achados bloqueantes reais); Rodada
2 Claude 9,1/Codex 9,1 (bloqueantes corrigidos, convergência numérica); Rodada 3 Claude 9,3/Codex 9,3
(tréplica de polimento exigida pelo mínimo de 3 rodadas de `AGENTS.md` §4, sem achado bloqueante novo).
Registrado como `docs/architecture/decisions-log.md` D-103. Evidência completa das 3 rodadas:
`docs/architecture/reviews/multi-user-b2b-wave-b2b9-scoping/`.

**Quarta aplicação real de `docs/engineering/research-protocol.md` (E-014)**, declaração `SIM`:
"delete minha conta" vs. "delete a organização" sob LGPD/GDPR em SaaS B2B multi-tenant é padrão
externo estabelecido. Pesquisado 2026-08-30 (3 vendors, convergência independente no mesmo par de
regras): GitHub (sole owner deve transferir/apagar a Organization antes de apagar a conta pessoal;
exclusão de Organization irreversível, cascateia TUDO), Slack (perfil individual nunca remove
"Customer Data" do workspace — controlado pelo Primary Owner), Atlassian (conta gerenciada por
organização não se autodeleta).

Base obrigatória, usada e não re-derivada: `docs/architecture/w3-07-writer-inventory.md` e a tabela
de impacto §125.4 de `roadmap-evolution/17` ("Purge pipeline: Emenda — precisa incluir
Membership/Invitation"; "BFF session ownership: Refaz" — já fechado por B2B-6/D-102 antes desta wave
começar).

## Achado real de código que motivou o fix desta wave

`InvitationTokenPointer` (`organization/domain/invitation-token.ts`, `PK=INVITATION_TOKEN#
<selectorHash>`, mesma família tenantless de `GuestTokenPointer`) declara `organizationId`, não
`tenantId`, como atributo de escopo. O scan/`PURGE_DELETE` ampliados em D-082/B1 só cobriam o nome
`tenantId` (para `GuestTokenPointer`/`TextractJob`) — deixando este pointer órfão para sempre após a
exclusão de uma Organization. Confirmado por grep exaustivo: nenhum outro writer B2B tem o mesmo gap
(`Membership`/`Invitation`/`InvitationDedupPointer`/`MembershipAuditEvent`/
`MembershipInviteRateLimitRecord` já são `PK=TENANT#<organizationId>#...`, cobertos estruturalmente).

## Escopo final

### Fix de purga (código)

`tenant-purge-scan.ts`'s `FilterExpression` e `system-mutation.ts`'s `PURGE_DELETE`
`ConditionExpression` ganham uma 3ª cláusula `OR organizationId = :tenantId` (mesma disciplina do
fix B1 original). Comentários stale sobre `IdentityMapping` "declarar `tenantId`" corrigidos em
ambos (falso desde B2B-5/D-095 — sem mudança de comportamento, só precisão textual).

### `privacy-lgpd.md` §4.1 — User-level vs. Organization-level erasure

**Organization-level erasure** (mecanismo já existente, W3-07/D-081-083, emendado aqui): apaga
incondicionalmente todo dado tenant-scoped da Organization — irreversível, afeta todos os membros.

**User-level erasure** (regra formalizada, endpoint real fora de escopo — `DataSubjectRequest`
continua "não implementado ainda", decisão pré-existente não revisitada): removeria/anonimizaria só
identidade/sessão/perfil do titular — `GlobalUser`, `DeviceSession`, `Session` (BFF),
`IdentityMapping`, cada `UserProfile`/`NotificationPreferences` per-organização, e as próprias
`Membership`s do titular — nunca cascateia para dado de negócio organization-owned. `LoginAttempt`
fora do inventário (sem `userId`/`cognitoSub`, TTL-only).

**Invariante de último OWNER** (consistente com `ownerCount` de §125.2): titular `OWNER` `ACTIVE`
único de uma Organization `ACTIVE` não pode ser apagado nem suspenso até transferir a role ou a
Organization ser deletada. Documentada, sem guard de código (sem call site real hoje — mesmo
raciocínio de proporcionalidade de B2B-3 para `ownerCount`).

### `privacy-lgpd.md` §4 — retenção (nenhuma classe nova, todas reaproveitadas)

`Invitation` → `ACCOUNT_ACTIVE`; `InvitationTokenPointer` → `TRANSIENT` (14 dias); `MembershipAuditEvent`
→ `SECURITY_AUDIT`; `MembershipInviteRateLimitRecord` → `QUOTA_TELEMETRY`.

### Provas por teste adversarial (sem mudança de comportamento nova além do fix de purga)

`GlobalUser`/Membership de outra Organization sobrevivem a uma purga completa; sessão se autocura
para o estado terminal `DELETED` (não só `DELETING`) e para a Organization sobrevivente em cenário
multi-org real — mecanismo já existente de B2B-6, confirmado, não alterado.

## Decomposição (per `definition-of-done.md`)

| Subitem | Camada | Risco |
|---|---|---|
| B2B-9.1 | Código — 3ª cláusula OR em `tenant-purge-scan.ts`/`system-mutation.ts`, comentários stale corrigidos | 5 |
| B2B-9.2 | Documentação — `privacy-lgpd.md` §4.1 (fronteira User/Organization erasure + invariante) e §4.2 (purga, entidades B2B) + 4 linhas de retenção | 4 |
| B2B-9.3 | Testes — G-V3 desde a escrita: adapter-level shape test (`tenant-purge-scan.test.ts`, novo), behavioral `PURGE_DELETE` (`InvitationTokenPointer` purgável + isolamento), `GlobalUser`/Membership-outra-org sobrevivem, `DELETED` terminal + self-heal multi-org | 3 |

## Fora de escopo

Endpoint HTTP real de DSR (`DataSubjectRequest`) — decisão pré-existente de `privacy-lgpd.md`, não
revisitada. Guard de código para "bloquear exclusão de User" — sem call site real, seria código
morto. Orquestrador do purge pipeline (Step Functions vs. Lambda+EventBridge Scheduler, D-083) —
decisão de infraestrutura/operação ortogonal ao escopo de retenção/modelo de dados desta wave,
registrada como pendência separada em `multi-user-b2b-wave-tracker.md`.

# Multi-User B2B — Wave B2B-11 (Responsibility + Notifications), escopo final

**Status: `APPROVED`** via protocolo Claude↔Codex (`AGENTS.md` §4, nível 5 de `change-risk-scale.md`),
3 rodadas, nota cega cada rodada: Rodada 1 Claude 8,5/Codex 8,0 (3 achados bloqueantes reais); Rodada
2 Claude 9,0/Codex 8,7 (1 achado bloqueante adicional); Rodada 3 Claude 9,2/Codex 9,2 (fechamento,
ambos ≥9,0, sem arredondar). Registrado como `docs/architecture/decisions-log.md` D-107. Evidência
completa das 3 rodadas: `docs/architecture/reviews/multi-user-b2b-wave-b2b11-scoping/`.

Escopo per `roadmap-evolution/17` §116 (texto integral, deliberadamente terso): "Integrar:
responsible member, ItemWatch, notification routing — para que Multi-User seja funcionalmente útil,
não apenas infra de autorização."

## Achados reais de código (verificados por leitura, não hipotéticos)

1. **`NotificationRecipientResolver` validava contra `UserProfile`**, vestigial para autorização
   desde B2B-5/D-095 (o próprio comentário de `user-repository.ts` confirma) — não distingue
   corretamente um membro removido da Organization.
2. **`resolveCandidateUserId()`'s fallback (`assignee ?? tenantId`) estava estruturalmente quebrado**
   pós-B2B — `tenantId` é `organizationId`, nunca um `userId` real; sem assignee, o candidato
   resolvido nunca existe (fail-closed por acidente, não por design).
3. **`ItemWatchService.addWatcher`/`removeWatcher` aceitavam qualquer string como `userId`**, sem
   validar `Membership` real antes de gravar a linha `ItemWatch`.
4. **`assigneeUserId` (create/update de `ExpirationItem`) sem validação nenhuma** contra `Membership`
   real da Organization.

## Declaração E-014: SIM PARCIAL

Pesquisado 2026-08-30 — convergência real 2/2 (GitHub "Assigning issues and pull requests", Linear
`docs/assigning-issues`) sobre **"quem pode ser responsible/assignee deve ser um membro real e
ativo"** (Linear: usuários suspensos explicitamente não podem receber atribuição) — confirma os
achados #3/#4. **Sem convergência clara** sobre "quem é notificado quando não há assignee" — essa
parte fica sob proporcionalidade própria (`principles.md` #1), não inventando um destinatário padrão
não pedido pelo §116.

## Rodadas de correção

**Rodada 1 → 2** (achado bloqueante do Codex): a correção do fallback não podia mudar o tipo de
retorno de `resolveCandidateUserId` para `string | undefined` — o caller real
(`notification-router-workflow.ts`) já assume `string` e chama `.trim()`, e um teste existente
(`notification-router-workflow.test.ts`) dependia do comportamento antigo (quebrado, "funcionando
por acidente"). Corrigido: tipo de retorno continua `string`, só o VALOR do fallback muda de
`tenantId` para `""` (o caller já trata string vazia via `candidateWasEmpty`). Também corrigido: a
migração `UserProfile → Membership` preservando a distinção `RECIPIENT_NOT_FOUND` (Membership nunca
existiu) vs. `RECIPIENT_NOT_ELIGIBLE` (existe mas inativo) — não colapsar em um único estado. E:
e-mail de entrega migrado de `UserProfile` (lazy, per-Organization) para `GlobalUser` (garantido
disponível desde antes da Membership existir — `AcceptInvitationService` exige `GlobalUser` já
existente antes de criar a Membership).

**Rodada 2 → 3** (achado bloqueante do Codex): elegibilidade não pode checar só
`Membership.status === "ACTIVE"` — precisa também `GlobalUser.identityStatus === "ACTIVE"` (mesma
regra dupla que `resolve-request-context.ts` já aplica para autenticação normal). `Membership ACTIVE`
+ `GlobalUser SUSPENDED` → `active: false` (RECIPIENT_NOT_ELIGIBLE), nunca `undefined`.

## Escopo final implementado

- **`recipient-resolver.ts`** (port): `resolveCandidateUserId({assigneeUserId})` — `tenantId` removido
  dos parâmetros, fallback `""`.
- **`dynamodb-recipient-resolver.ts`**: migrado para `Membership`+`GlobalUser`, 2 condições.
- **`notification.ts`** (composition root): `resolveRecipientEmail` migrado para `GlobalUser`.
- **`MemberEligibilityChecker`** (novo port em `expiration/ports/member-eligibility.ts`) — porta
  estreita no módulo consumidor, implementada no composition root (`expiration.ts`) contra
  `Membership`+`GlobalUser` diretamente (mesmas 2 condições).
- **`ItemWatchService.addWatcher`** valida `MemberEligibilityChecker` antes de gravar (`removeWatcher`
  NÃO valida — remover/limpar um watch inválido é sempre seguro, nunca concede acesso novo).
- **`ExpirationService.createItem`/`updateItem`** validam `assigneeUserId` quando fornecido/alterado
  (nunca no `renewItem`, que só copia um valor já validado anteriormente).
- **`IneligibleAssigneeError`** (novo, `app-error.ts`) — categoria `NOT_FOUND`/404 deliberadamente
  (nunca distinguir por status HTTP "existe mas não elegível" de "não existe", evita enumeração).

## Decomposição (per `definition-of-done.md`)

| Subitem | Camada | Risco |
|---|---|---|
| B2B-11.1 | `NotificationRecipientResolver`/`resolveCandidateUserId`/e-mail via `GlobalUser` | 5 |
| B2B-11.2 | `MemberEligibilityChecker` (port novo) + `ItemWatchService`/`ExpirationService` | 5 |
| B2B-11.3 | Testes — G-V3 desde a escrita, mutação verificada em 3 pontos (fallback do resolver, condição dupla Membership+GlobalUser, teste estagnado do router atualizado) | 2-3 |

## Fora de escopo

Destinatário padrão quando não há assignee (sem convergência externa, não pedido pelo §116). UI de
atribuição de responsável/watcher (B2B-10 fechou o frontend tenant-aware básico; picker dedicado
fica para pedido de produto explícito). Qualquer mudança em RBAC/Invitation/Membership backend (já
fechado B2B-7/B2B-8).

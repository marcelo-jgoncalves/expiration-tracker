# Wave B2B-9 — Round 2 Proposal (correções sobre a Rodada 1, nota Codex 8,6/10)

Mantém integralmente a Rodada 1 (`round-1-claude-proposal.md`) exceto pelos 3 pontos abaixo,
verificados por leitura direta de código antes de propor a correção (nenhuma delas é especulativa).

## Correção 1 — C2 reformulado (achado bloqueante real do Codex)

C2 antigo ("só `GlobalUser` e `Membership`s do próprio usuário são afetadas") estava incompleto.
Verificado por leitura: um titular real tem, além de `GlobalUser`/`Membership`, também:
- `DeviceSession` (`global-user-repository.ts:51`, `PK=USER#<userId>`, `SK=SESSION#<deviceId>` —
  global, não organization-scoped);
- `Session`/`LoginAttempt` na tabela BFF (`session.ts`, pointers tenantless, D-053/D-054);
- `IdentityMapping` (`identity-mapping-repository.ts:19`, `PK=IDENTITY#cognitoSub#<sub>`, sem
  `tenantId` desde B2B-5/D-095 — global);
- `UserProfile` **por organização** (`user-repository.ts:16/41`, `PK=TENANT#<tenantId>#USER#<userId>`
  — uma linha DIFERENTE para CADA organização de que o usuário é membro).

**C2 corrigido**: um DSR de exclusão de `User` (titular) deveria inventariar e remover/anonimizar
TODA a identidade/sessão/perfil do titular — `GlobalUser`, todo `DeviceSession`, `Session`/
`LoginAttempt` (BFF), `IdentityMapping`, e CADA `UserProfile` que o titular tem em CADA Organization
de que é membro — mas **nunca cascateia para dado de negócio organization-owned** (`ExpirationItem`,
`Document`, `DocumentRequest`, `TrackedSubject`, etc.) que pertence à Organization e que outros
membros ainda dependem. A fronteira certa não é "linha pessoal vs. linha da organização" (isso
excluiria `UserProfile`, que é per-organization mas ainda assim dado do TITULAR, não dado de negócio
compartilhado) — é "dado que identifica/autentica/representa a PESSOA" vs. "dado que representa o
TRABALHO/NEGÓCIO da Organization". Continua fora de escopo desta wave construir o endpoint real
(mesma razão de C6) — esta correção só torna a REGRA (documentada em `privacy-lgpd.md`) precisa o
suficiente para não subestimar o que uma implementação futura precisaria inventariar.

## Correção 2 — C7: `MembershipInviteRateLimitRecord` adicionado (achado bloqueante real do Codex)

Verificado: `membership-invite-rate-limiter.ts:16-24` — `PK=TENANT#<organizationId>#SETTINGS#
MEMBERSHIP-INVITE...` (3 variantes de chave: por-hora, diária, por-destinatário-hash), já tem
`purgeAfterTtl` físico, semântica de janela com `resetAt`. **Classe correta: `QUOTA_TELEMETRY`**
(já existe em `privacy-lgpd.md`, "quotas/métricas identificáveis", "fim da janela + 30 dias") — não
uma classe nova. Nenhum gap de purga (já `TENANT#`-prefixed, coberto estruturalmente) — só faltava
a linha na tabela de retenção.

## Correção 3 — plano de teste C3 revisado para cobrir o adapter REAL (achado bloqueante real do Codex)

Verificado: nenhum teste hoje referencia `DynamoDbTenantPurgeCandidateSource`
(`shared/dynamodb/tenant-purge-scan.ts`) — só a camada de lógica pura (`dynamo-tenant-purge.ts`,
via `InMemoryIdentityStore`) é exercitada, e essa camada não constrói `ScanCommand` nenhum. O padrão
já estabelecido no repo para "adapter-level shape test" é `test/unit/extraction/
dynamodb-extracted-field-store.test.ts` (client fake que captura `command.input`, assert direto na
string da `FilterExpression`/`ConditionExpression`) — vou replicar esse padrão, não inventar um novo.

Plano revisado:
1. **Novo arquivo** `test/unit/shared/dynamodb/tenant-purge-scan.test.ts` — client fake capturando
   `ScanCommand.input`, prova que `scanTenantItems()` envia
   `FilterExpression: "begins_with(PK, :prefix) OR tenantId = :tenantId OR organizationId = :tenantId"`
   com os 2 `ExpressionAttributeValues` corretos (mutação: reverter a 3ª cláusula faz o teste falhar
   por não bater a string exata).
2. **`test/unit/system-mutation.test.ts`**, describe `PURGE_DELETE`: novo teste behavioral (mesmo
   padrão dos testes B1 já existentes ali, linha ~292) provando que um `InvitationTokenPointer`-
   shaped row (`PK=INVITATION_TOKEN#...`, atributo `organizationId`, SEM `tenantId`) agora é
   purgável quando `organizationId` bate o tenant reivindicado, e continua rejeitado quando não bate
   (isolamento) — exercita o `ConditionExpression` real via `InMemoryIdentityStore` (já um
   avaliador de condição genérico, não um mock hand-rolled — confirmado pelo padrão dos testes B1
   existentes no mesmo describe block).
3. Mantido de C4: teste em `dynamo-tenant-purge.test.ts` (camada de lógica pura) provando que
   `GlobalUser`/`Membership` de outra Organization sobrevivem a uma purga completa.
4. Mantido de C5: teste em `bff-organization-context.test.ts` nomeando o status terminal `DELETED`
   explicitamente (hoje só `DELETING` é nomeado).

## Achado não-bloqueante aceito — comentário stale

`tenant-purge-scan.ts:37-38` e `system-mutation.ts:230-237` afirmam que `IdentityMapping` "declara
`tenantId`" — falso desde B2B-5/D-095 (`identity-mapping-repository.ts:8`, campo removido). Isso não
é um bug funcional (o guard por chave física `PK.startsWith("IDENTITY#")` não depende do atributo, e
sem `tenantId` a linha nem seria retornada pelo Scan hoje) — só o comentário está desatualizado.
Corrigido oportunisticamente ao tocar esses 2 arquivos nesta wave, sem mudança de comportamento.

## Respostas às 3 perguntas abertas (Rodada 1) — confirmadas pelo Codex, incorporadas

1. Nenhum outro writer B2B tem o mesmo gap — `InvitationTokenPointer` é o único caso real
   (confirmado independentemente por mim via grep exaustivo E pelo Codex por leitura própria).
2. `MembershipAuditEvent` reutiliza `SECURITY_AUDIT`, sem classe nova (confirmado).
3. A regra C1 deve cobrir suspensão do último OWNER ativo também (consistente com `ownerCount` de
   §125.2) — documentada como invariante em `privacy-lgpd.md`, sem guard de código novo (sem call
   site real de suspensão de Membership hoje — mesmo raciocínio de proporcionalidade de C6).

## Sem mudanças

Classificação de risco, escopo do fix de código (item 1 da Rodada 1), fora-de-escopo (endpoint DSR,
guard sem call site, orquestrador de purga) — todos permanecem como na Rodada 1.

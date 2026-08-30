# Wave B2B-13 — Round 3 Proposal (4 achados reais, nota Codex 8,8/10, régua E-014 9,1/10)

Todos os 4 achados aceitos como reais.

## Correção 1 — citação de linha corrigida

`document-chasing-dispatch/dispatch.ts:178` (não 169) é a chamada real a
`resolveInternalUserEmail`. Verificado.

## Correção 2 — matriz Q1/Q12/Q22 com arquivo:linha precisos

- **Q1**: `bootstrap-identity.ts:81` (transação de 2 itens, `GlobalUser`+`IdentityMapping`, sem
  `tenantId`).
- **Q12**: `test/unit/workers/tenant-purge/dynamo-tenant-purge.test.ts:82` (teste real) +
  `privacy-lgpd.md` §4.1 (fronteira formal User-level vs. Organization-level erasure).
- **Q22**: `src/modules/expiration/ports/member-eligibility.ts:12` (port) +
  `src/modules/expiration/application/expiration-service.ts:705` (call site real) +
  `test/unit/expiration/expiration-service.test.ts:128` + `test/unit/expiration/item-watch-service.test.ts:70`
  (testes reais).

## Correção 3 — reaproveitar `DynamoDbNotificationRecipientResolver` real (unit-tested), não um
terceiro helper novo em composition root

Achado aceito e corrigido de forma mais forte do que a Rodada 2 propôs: um helper novo em
`runtime/aws/composition/member-eligibility.ts` teria o mesmo problema que toda função de
composition root já tem neste projeto — **composition roots não são unit-testados diretamente**
(precedente explícito de D-109: "sem teste novo — composition roots não são testados diretamente
neste projeto"). Um helper com a regra de 2 condições ali dentro nunca teria G-V3 real.

Corrigido: em vez de um terceiro código com a mesma regra, **reaproveitar literalmente a mesma
classe já testada**, `DynamoDbNotificationRecipientResolver`
(`notification/persistence/dynamodb-recipient-resolver.ts`, já `test/unit/notification/
dynamodb-recipient-resolver.test.ts`) — composition roots já cruzam módulos livremente por design, e
verificado que `subject.ts` já importa de `notification/` hoje (`notification/providers/
ses-email-adapter.ts:23`, não é o primeiro import cross-módulo desse par), então instanciar essa
mesma classe de `notification/persistence/` não é um precedente novo de fronteira, só mais um import
do mesmo tipo já existente. `ResolvedRecipient`
(`notification/ports/recipient-resolver.ts`) ganha um campo `email?: string` (aditivo, nunca quebra
os 2 call sites existentes que não o leem) — `DynamoDbNotificationRecipientResolver.resolve()` já lê
`GlobalUser` no mesmo `Promise.all` que lê `Membership`; devolver `globalUser?.emailNormalized`
junto não custa uma leitura a mais. `notification.ts`'s `resolveRecipientEmail` e `subject.ts`'s
`resolveInternalUserEmail` passam a instanciar essa classe e usar `result?.active ? result.email :
undefined`.

**Documentação explícita da consistência entre os 3 pontos** (per seu achado #3): comentário em
`recipient-resolver.ts` (perto de `ResolvedRecipient`) cita os 3 lugares que usam a MESMA regra
(`Membership.status==="ACTIVE" && GlobalUser.identityStatus==="ACTIVE"`) — `DynamoDbNotification-
RecipientResolver` (agora com 2 consumidores reais via reuso direto), e `MemberEligibilityChecker`
(`expiration/ports/member-eligibility.ts`, forma diferente — boolean, não e-mail, porque valida um
candidato a watcher/assignee, não resolve destinatário de entrega) — nunca fundidos (formas de
retorno genuinely diferentes, per a nota do próprio Codex), mas documentados como a mesma regra
intencional, não 3 implementações que podem divergir silenciosamente.

## Correção 4 — teste G-V3 real para o 2º TOCTOU (document-chasing)

`test/unit/subject/document-chasing-dispatch.test.ts` ganha um teste novo, estendendo o padrão já
existente de `:274` ("EXPIRED with no resolvable internal user email"): fixture com
`Membership.status !== "ACTIVE"` (ou `GlobalUser.identityStatus !== "ACTIVE"`) para
`request.requestedByUserId` — `deps.resolveInternalUserEmail` (agora backed pela classe real
reaproveitada) deve retornar `undefined`, `emailProvider.sent` deve ficar vazio, intent vira
`FAILED`/`INTERNAL_USER_EMAIL_NOT_FOUND` — mesma asserção do teste de "email não encontrado", mas a
CAUSA agora é elegibilidade revogada, não ausência de `GlobalUser`. G-V3: mutação nomeada
(reintroduzir a leitura antiga, só `GlobalUser`, sem checar `Membership`) deve fazer este teste
específico falhar (o e-mail seria enviado), provando que é o CHECK de Membership, não outra coisa,
que fecha o gap.

## Sem mudanças

Achado #6 original (mesmo TOCTOU em `document-chasing`), remoção do teste de presigned URL mal
desenhado (Correção 3 da Rodada 2), evidência de Q16 estendida a `import-service.ts`, E-014 com
fonte+data, auditoria de fixture IDs ampliada às 10 palavras-chave — o Codex concordou
explicitamente com todos na Rodada 2, sem achado que os conteste.

# W3-07 — Round 3 (Claude, autocrítica antes de reenviar — correção de uma alegação não verificada da Rodada 2)

Antes de pedir reavaliação, refiz o levantamento de `entityType` que a Rodada 1 (achado 2/3) já
tinha provado errado uma vez — a Rodada 2 listou uma tabela sem verificar `version`/`tenantId`
linha a linha contra o código real. Fiz isso agora de verdade (grep exaustivo de todo
`entityType: "..."` em `src/modules/**`, 39 tipos reais, cada um com `version`/`tenantId`
confirmados por leitura direta do arquivo). Dois achados novos, mais sérios que uma correção de
tabela:

## Achado novo 1 — segunda tabela física, não coberta por nenhuma versão anterior deste desenho

`Session`/`LoginAttempt`/`DeviceSession` (módulo `bff`) vivem em uma **tabela DynamoDB
inteiramente separada** (`bff-session-table`, `infra/main.tf:317`/
`infra/modules/bff-session-table/`), não na tabela principal (`exptrk-dev-table`). Nenhuma
versão anterior deste documento mencionava isso — um `Scan` de `exptrk-dev-table`, por mais
correto que fosse, **nunca encontraria essas 3 entidades**. Corrigido: `TenantCascadeDeletionService`
recebe uma lista de tabelas a varrer (`[{ tableName: mainTable, ... }, { tableName: bffSessionTable, ... }]`),
mesma lógica de descoberta+exclusão aplicada a cada uma independentemente. As três já têm
`purgeAfterTtl` real (TTL nativo da tabela, `session.ts:33-36`/`68`) — isso NÃO as isenta de
inclusão aqui (diferente de `GuestTokenRateLimit`, ver achado 2): elas carregam dado de sessão
real (refresh token cifrado, `cognitoSubject`) que o direito de eliminação cobre — esperar o TTL
natural (até dias) em vez de apagar imediatamente na exclusão de tenant seria mais fraco que o
precedente já estabelecido (`Document`/W3-06 nunca trata TTL como mecanismo primário).

## Achado novo 2 — tabela de classificação corrigida (verificada, não presumida)

Duas categorias reais (a terceira, exclusão do Scan, continua só para os 2 casos já
justificados na Rodada 2), com a lista completa dos 39 `entityType`s reais do sistema:

| Categoria | Condição de exclusão | `entityType`s (verificados) |
|---|---|---|
| **OCC versionado** (`version` presente) | `Delete` condicionado: `attribute_exists(PK) AND attribute_exists(SK) AND version = :v AND tenantId = :t` (+ `legalHold` para `Document`) | `DeviceSession`, `Document`\*, `DocumentChasingIntent`, `DocumentChasingOccurrence`, `DocumentPurgeReceipt`, `DocumentRequest`, `DocumentRequestDeliveryPreference`, `DocumentSubmission`, `ExpirationItem`, `ExtractedField`, `ExtractionRun`, `GuestTokenPointer`, `ImportJob`, `ItemWatch`, `LoginAttempt`, `NotificationAttempt`, `NotificationEntitlements`, `NotificationIntent`, `NotificationPreferences`, `ReminderOccurrence`, `ReminderPolicy`, `RequirementAssignment`, `Session`, `TextractJob`, `TrackedSubject`, `UploadSlot`, `User` (\* `Document` também apaga o objeto S3 real antes, via `pickObjectToDelete` do W3-06) |
| **Sem versão** (nunca mutado após criação — ledger/pointer/counter) | `Delete` condicionado só em existência: `attribute_exists(PK) AND attribute_exists(SK) AND tenantId = :t` | `AuditEvent`, `SubjectAuditEvent`, `IdentityMapping`, `ImportDedupRecord`, `NotificationAttemptLookup`, `OutboxEvent`, `WebhookInbox`, `IdempotencyRecord`, `TenantQuota`, `ReminderPolicyRef` (após correção abaixo) |
| **Excluído do Scan, autopurgável** | Não tocado | `GuestTokenRateLimit`, `InitialInviteRateLimit` — sem `tenantId` no momento da escrita (por design, convidado ainda não resolvido / mesmo mecanismo duplicado), já carregam `purgeAfterTtl` real, nunca guardam PII além de um hash |

**Correção de código real que este levantamento força** (achado genuíno, não cosmético):
`ReminderPolicyRef` (`reminder-policy.ts:69-72`) hoje **não tem `tenantId`** (confirmado por
leitura direta, zero ocorrências no bloco da interface) — a Rodada 2 já tinha notado isso, mas
por engano o classificou junto da categoria versionada; `PolicyRef` também não tem `version`
(é um ponteiro criado uma vez via `attribute_not_exists`, nunca atualizado). Correção: adicionar
só `tenantId` (valor já disponível em `reminder-policy-service.ts:239`, `input.tenantId`) e
classificar na categoria **sem versão** (existência apenas) — não na OCC-versionada.

Nenhum `entityType` fora desta tabela é tocado — mesma regra fail-closed já proposta na Rodada 2
(achado 4 original: `BLOCKED_UNKNOWN_ENTITY_TYPE`, alarme dedicado, revisão humana antes de
estender a tabela).

## Estado do design após Rodada 3

Mecanismo (sem GSI6, convergência via re-scan até zero, fallback sequencial por item conflitante
em lote, sem `purgeAfter`/imediato por definição) mantido da Rodada 2. Esta rodada corrige uma
alegação que não tinha sido verificada linha a linha (mesmo erro de categoria que a Rodada 1 já
tinha pego uma vez — não repetido desta vez, confirmado por grep exaustivo) e adiciona a segunda
tabela física (`bff-session-table`) que nenhuma rodada anterior tinha considerado. Peço
reavaliação completa, com atenção especial a qualquer `entityType` que este levantamento ainda
possa ter classificado errado.

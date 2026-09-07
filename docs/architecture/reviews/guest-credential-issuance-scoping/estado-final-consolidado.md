# Guest Credential Issuance Orchestration — estado final consolidado

**APPROVED** — 7 rodadas, Claude 9,2/10, Codex 9,2/10 (nota cega, sem arredondar).
Resolve D-222 (`decisions-log.md`), fecha o item 9 do roadmap P0.

## Declaração E-014
**NÃO** — decisão de fronteira interna entre módulos/Lambdas deste projeto (como uma Lambda sem
o pepper de guest aciona uma operação que só a Lambda com o pepper pode executar), não um padrão
de mercado a replicar. Confirmado contra `docs/engineering/research-protocol.md` antes de declarar.

## Decisão central (Achado 1 de D-222 — bloqueador)
Outbox assíncrono (mesmo mecanismo já usado no projeto, `src/shared/outbox/outbox.ts`), nunca
invocação Lambda-a-Lambda síncrona nem compartilhamento do pepper (preservaria D-146 intacta):

1. A Lambda autenticada (`document-archive-handler`), na MESMA `TransactWriteItems` que cria um
   `DocumentRequest` (interativo `materializeAttempt`, worker `materializer.ts`, ou o novo
   `createDocumentRequest` avulso — builder único `buildDocumentRequestCreatedOutboxEntry`,
   nunca duplicado por call site), grava um `OutboxRecord` com destino
   `SQS_DOCUMENT_REQUEST_CREDENTIAL_ISSUANCE_V1` e evento `DocumentRequestCredentialIssuanceRequested`.
   Payload MÍNIMO: `{ tenantId, subjectId, documentRequestId, issuanceGeneration }` — nunca
   `requirementId`/`deadline`/qualquer dado de negócio (o consumidor sempre relê o
   `DocumentRequest` autoritativo).
2. `DocumentRequest` ganha `issuanceGeneration: number` (inicia em 1, incrementado a cada
   reemissão) e `activeCredentialSelectorHash?: string` — identidade por geração, não por
   `documentRequestId` sozinho, para que reemissões pós-rejeição não colidam com a idempotência
   da emissão original.
3. Consumidor novo, na Lambda guest (`document-archive-guest-handler`, tem o pepper):
   `document-request-credential-issuance-handler.ts`. Uma `TransactWriteItems` de **4 entradas**:
   `IdempotencyRecord` (`GUESTISSUANCE#<documentRequestId>#<issuanceGeneration>`,
   `ConditionExpression: attribute_not_exists(PK)`) + `RequestAccessCredential` Put +
   `DocumentRequest` Update (`ConditionExpression` completa: `issuanceGeneration = :expected AND
   status IN (:requested,:opened) AND version = :expectedVersion AND
   (attribute_not_exists(activeCredentialSelectorHash) OR = :expectedPointer)`) + `Put` do item de
   entrega numa **tabela DynamoDB dedicada nova** (`exptrk-<env>-guest-credential-delivery`, sem
   GSI, TTL nativo) — atômica de verdade, sem dual-write. `TransactionCanceledException` é
   inspecionada via `CancellationReasons` (SDK v3) para distinguir replay seguro (geração
   obsoleta/status inelegível → no-op) de qualquer outro motivo (propaga, não vira ACK genérico).
4. `expiresAt = request.deadline ?? addDays(request.createdAt, DEFAULT_CREDENTIAL_TTL_DAYS=7)` —
   default PROVISÓRIO de segurança (não 30 dias), comentado como tal; recusa emitir se já vencido.
5. **Entrega do material bruto (token) NUNCA toca a tabela DynamoDB principal nem qualquer store
   legível pela política geral `tenant_facing_read_write_policy_json`** — vive só na tabela
   dedicada acima, IAM restrito (`PutItem` só à Lambda guest, `GetItem`/leitura via Stream só ao
   worker de entrega futuro). **DynamoDB Streams (`NEW_IMAGE`) + Event Source Mapping** (filtro
   `eventName = INSERT` na infra E no handler) aciona o worker de entrega — nunca Query/Scan/GSI.
   At-least-once explícito (worker deve assumir reentrega). `maximum_retry_attempts` finito +
   `destination_config.on_failure` para fila SQS `GuestCredentialDeliveryFailures` —
   **reclassificada explicitamente como alerta/evidência de falha, nunca mecanismo de
   localização/reprocessamento** (a mensagem só carrega metadados do lote, não o payload —
   correção factual da Rodada 7). Perda definitiva assumida após a janela de retenção do Stream
   (24h); TTL da tabela é housekeeping de segurança (segredo abandonado), nunca recuperação.

## Achado 2 (DocumentRequest avulso)
`DocumentArchiveService.createDocumentRequest(ctx, input)` — nova action `docarchive:request-create`,
`ConditionCheck` de existência do `Requirement` antes de criar, `IdempotencyRecord` com
`payloadHash` (replay com hash diferente → `ConflictError`), mesma entrada de outbox da decisão
central. `seriesId`/`occurrenceId`/`attemptIndex`/`parentRequestId` ausentes (ponto de extensão já
opcional desde D-147).

## Achado 3 (vínculo reverso / rejectVersion)
`rejectVersion()` (`document-archive-service.ts`), quando `version.requestId` presente E
`request.lastSubmissionId === version.versionId` E `request.status === "SUBMITTED"` (fencing
completo contra rejeição tardia de versão já superada): na MESMA transação já existente, `Update`
do `DocumentRequest` (`status: "REQUESTED"`, `issuanceGeneration: +1`, `lastRejection: {versionId,
reason, occurredAt}`), `Update` condicional da `RequestAccessCredential` antiga
(`ConditionExpression: documentRequestId = :did AND selectorHash = :sel`, `SET revokedAt =
if_not_exists(revokedAt, :now)` — idempotente de verdade, sem comparação de timestamp), e nova
entrada de outbox de reemissão (mesma mecânica da decisão central, nova geração).

## Achado 4 (automated chasing)
Mecanismo implementado (worker produtor `document-request-chasing/producer.ts`, novo namespace
GSI1 `REQUESTDUE` na `DocumentRequest` individual, destino de dispatch PRÓPRIO
`SQS_DOCUMENT_REQUEST_CHASE_DISPATCH_V1`, nunca reaproveitando `SQS_DOCUMENT_CHASING_DISPATCH_V1`
do módulo `subject` sem prova de compatibilidade de contrato) **atrás de flag
`DOCUMENT_REQUEST_CHASING_ENABLED = false`** — nunca ligado em `dev` até decisão de produto.

## Pendências de produto (não decididas por este protocolo, nomeadas explicitamente)
1. **Cadência/quantidade/aprovação humana do chasing** — mecanismo pronto, desligado.
2. **TTL definitivo da credencial de guest quando `deadline` está ausente** — hoje 7 dias,
   default de engenharia provisório; validade de uma capability enviada a terceiro é decisão de
   produto/segurança, precisa de confirmação explícita de Marcelo antes de virar política final.

## Rodadas
`round1-claude.md`/`round1-codex-critique.md` (5,8/10) → `round2-*` (7,2/10) → `round3-*` (8,1/10)
→ `round4-*` (8,8/10) → `round5-*` (8,9/10) → `round6-*` (8,9/10, erro factual da fila de falha
identificado) → `round7-*` (9,2/10, **APPROVED**).

# Round 2 — Claude revised proposal

Aceito a nota de 5,8/10 do Round 1 como justa — os 12 pontos são reais, não cosméticos. Revisão
completa abaixo, item por item.

## Correção 1+2 (idempotência do consumidor + token durável) — desenho unificado
`issueCredential()` continua gerando selector/secret ALEATÓRIOS (nunca derivados de
`documentRequestId` — manteria a propriedade de não-enumerabilidade). A idempotência do
CONSUMIDOR (não da credencial) vem de um `IdempotencyRecord` dedicado, mesmo padrão já usado em
`submitEvidence`/`acceptVersion` (D-143/D-144): chave determinística
`GUESTISSUANCE#<documentRequestId>` (não o `eventId` do SQS — um evento reenfileirado por
`materializeAttempt`/`createDocumentRequest` legitimamente NUNCA acontece duas vezes para o MESMO
`documentRequestId`, então essa chave é estritamente mais forte que `eventId` e sobrevive a um
producer que gere `eventId` novo em cada retry, ponto 6 do Round 1).

O consumidor (`document-request-credential-issuance-handler.ts`, roda na Lambda guest, tem o
pepper) executa UMA `TransactWriteItems`:
1. `Put` do `IdempotencyRecord` (`ConditionExpression: attribute_not_exists(PK)`) — se falhar,
   é um replay do SQS; o handler trata como sucesso (ack a mensagem, no-op), fechando o Achado 1
   do Round 1 sem precisar "lembrar" o token original (nunca tenta recriar).
2. `Put` da `RequestAccessCredential` (mesmo shape de hoje).
3. `Put` de um `PendingGuestNotificationCommand` (nova entidade, mesma partição tenantless da
   credencial, TTL curto de 15 minutos via `purgeAfterTtl`) contendo o TOKEN BRUTO — não o hash —
   destinado exclusivamente ao worker de notificação (item 3/19 do roadmap, outro agente). Esse
   registro nasce e morre na MESMA transação que cria a credencial: nunca existe uma janela onde a
   credencial existe sem um comando de entrega enfileirado (fecha o Achado 2 do Round 1 — "token
   nasce e desaparece"). O worker de notificação consome esse registro (via GSI6 `RECON#...`
   reaproveitando a MESMA convenção de reconciliação do outbox — não uma tabela nova) e apaga o
   campo do token depois do envio confirmado; se o TTL expirar antes do envio, a notificação falha
   visivelmente (métrica), nunca silenciosamente — decisão de engenharia, não de produto (é sobre
   "o que acontece se a entrega falhar", não "quantas vezes tentar" cadência).

Se `issueCredential` lançar depois do passo 1 mas antes do commit da transação (não pode — é uma
única `TransactWriteItems`, atômica pelas 3 entradas), não há estado parcial possível.

## Correção 3 (evento mínimo, nunca confiar em payload para autorização)
Evento renomeado: `DocumentRequestCredentialIssuanceRequested` (aceito o ponto 5). Payload mínimo:
`{ tenantId, subjectId, documentRequestId }`. NUNCA `requirementId`/`deadline`/qualquer dado de
negócio — o consumidor sempre releitura o `DocumentRequest` real do DynamoDB (mesma tabela, sem
pepper necessário para uma leitura simples) e deriva tudo a partir do registro autoritativo: se
`request.status` não for `REQUESTED`/`OPENED` (ainda "live", `isDocumentRequestLive`), o consumidor
trata como no-op (a request pode ter sido cancelada entre o outbox e a entrega — nunca emite
credencial para uma request morta).

`OutboxDestination` novo: `SQS_DOCUMENT_REQUEST_CREDENTIAL_ISSUANCE_V1` (segue a convenção exata
de nome de `SQS_REQUIREMENT_EVIDENCE_REFRESH_V1`). Schema JSON novo:
`schemas/events/document-request-credential-issuance-requested.v1.json`, registrado em
`schema-validator.ts`, com teste de exemplo válido/inválido em `test/contract/`.

## Correção 4 (TTL normativo)
`DocumentRequest.deadline` continua opcional (não é escopo desta tarefa alterar isso). Regra
explícita e nomeada: `expiresAt = request.deadline ?? addDays(request.createdAt, DEFAULT_CREDENTIAL_TTL_DAYS)`,
com `DEFAULT_CREDENTIAL_TTL_DAYS = 30` como constante nomeada e comentada em
`guest-document-access-service.ts` junto de `issueCredential` — decisão de engenharia (fallback
determinístico e seguro quando o negócio não informou prazo), não de produto: não muda quantas
vezes/quando alguém é contatado, só evita um TTL indefinido/infinito quando `deadline` está
ausente, prevenindo credenciais permanentes por omissão.

## Correção 5 — nomenclatura (aplicada acima).

## Correção 6 — builder compartilhado único
Novo helper puro `buildDocumentRequestCreatedOutboxEntry(request: DocumentRequest, tenantId): TransactWriteEntry`
em `document-request-recurrence-service.ts` (mesmo arquivo que já exporta
`buildMaterializeAttemptEntries`), chamado pelos 3 call sites que criam um `DocumentRequest`:
`buildMaterializeAttemptEntries` (usado por `materializeAttempt` interativo E pelo worker
`materializer.ts` — já um ponto único), e o novo `createDocumentRequest` avulso (Correção 7). Nunca
duplicado manualmente em cada call site. `eventId` do outbox é gerado pelo builder a partir de
`request.documentRequestId` de forma DETERMINÍSTICA (`stableHash`, mesmo primitivo puro já
reaproveitado por `computeSeriesOccurrenceId`/`document-chasing.ts` — ponto 6 do Round 1: "gerar
novo eventId a cada retry externo pode contornar deduplicação" — determinismo fecha isso: um retry
do MESMO `documentRequestId` sempre produz o MESMO `eventId`, então mesmo que o outbox relay não
dedupe por si, o consumidor final dedupa por `documentRequestId` de qualquer forma via o
`IdempotencyRecord` da Correção 1).

## Correção 7 — `createDocumentRequest` avulso, especificado
Novo método em `DocumentArchiveService` (não em `DocumentRequestRecurrenceService`, que fica
exclusivo para séries): `createDocumentRequest(ctx, input: { subjectId, requirementId, deadline?, idempotencyKey })`.
- `authorize({ action: "docarchive:request-create", ... })` — nova action, adicionada a
  `identity/domain/authorization.ts`.
- `TransactWriteItems`: `ConditionCheck` de existência do `Requirement` (mesma tabela, mesma
  partição do Subject — prova pertencimento ao tenant/subject antes de criar a Request, ponto 7 do
  Round 1) + `Put` do `DocumentRequest` (`seriesId`/`occorrenceId`/`attemptIndex`/`parentRequestId`
  todos ausentes) + a entrada do outbox da Correção 6, todos atômicos.
- Idempotência HTTP via `idempotencyKey` do chamador (mesmo padrão `IdempotencyRecord` de
  `submitEvidence`) — replay retorna o `DocumentRequest` já criado, nunca duplica.
- Schema HTTP novo + rota `POST /document-archive/requests` na Lambda autenticada existente.

## Correção 8+9+10 (rejectVersion — máquina de estados de reemissão/revogação)
Adiciona a `DocumentRequest` um campo `activeCredentialSelectorHash?: string` — escrito pelo
CONSUMIDOR de issuance (Correção 1, passo 2, no mesmo commit que cria a credencial: um 4º item na
transação, `Update` condicional em `DocumentRequest` por `expectedVersion`) e limpo/trocado a cada
reemissão. Isto dá à Lambda autenticada (sem pepper) uma forma de LOCALIZAR e REVOGAR a credencial
ativa sem nunca precisar recalcular hash algum — revogação é só `SET revokedAt` num item já
endereçável pela chave conhecida (`requestAccessCredentialKey(selectorHash)`), nunca uma operação
que precise do pepper.

`rejectVersion()` (`document-archive-service.ts`) ganha a extensão, condicionada e fenced:
1. Só age se `version.requestId` está presente E `request.lastSubmissionId === version.versionId`
   (a versão rejeitada é de fato a submissão mais recente da request — ponto 9: nunca reabre por
   causa de uma rejeição tardia de uma versão já superada por um reenvio posterior).
2. Só age se `request.status === "SUBMITTED"` (nunca em `CANCELLED`/`EXPIRED`/`REVOKED` — estados
   que este design NÃO introduz agora; a ausência desses estados é uma lacuna pré-existente do
   modelo `DocumentRequest`, fora de escopo desta tarefa, e o código verifica explicitamente
   `status === "SUBMITTED"` como allowlist, nunca uma denylist que um estado futuro esqueceria de
   cobrir).
3. Na MESMA `TransactWriteItems` de `rejectVersion` (já existente: DocumentVersion
   Update+DocumentVersionEvent Put): `Update` do `DocumentRequest` (`ConditionCheck` por
   `expectedVersion` da request, lido antes) para `status: "REQUESTED"`, `rejectionCount: +1`,
   `lastRejection: { versionId, reason, occurredAt: now }` (objeto único, não dois campos soltos —
   ponto 10, mantém `reason` correlacionado ao `versionId`/timestamp exatos, nunca um "último valor
   solto" ambíguo); se `request.activeCredentialSelectorHash` existir, `Update` condicional
   (`attribute_exists`) do item `RequestAccessCredential` correspondente para `revokedAt: now`
   (revogação real da credencial antiga — ponto 8); e a MESMA entrada de outbox
   `DocumentRequestCredentialIssuanceRequested` da Correção 6 (reaproveitando o builder), para que
   uma nova credencial seja emitida pelo mesmo caminho assíncrono já desenhado — nunca um segundo
   mecanismo de emissão.
4. `getRequirement`/leitura da `DocumentRequest` correspondente exige uma leitura extra dentro de
   `rejectVersion` antes de montar a transação (já é o padrão do método hoje, que já lê a
   `DocumentVersion` antes de escrever) — sem chamada a `authorize()` adicional (a ação já
   autorizada é `docarchive:review`, suficiente: reabrir a Request é efeito direto e esperado de
   rejeitar a evidência que a originou, não uma ação distinta que precise de sua própria
   permissão).

## Chasing (Achado 4) — mecanismo apenas, gate explícito
Mantida a separação: mecanismo (worker produtor + outbox + reaproveitamento do destino de
dispatch) é engenharia; VALOR de cadência/quantidade é produto. Round 1 ponto 11 está certo que
"T+3 como placeholder ativo" já é uma decisão de produto disfarçada. Correção: o worker
`document-request-chasing/producer.ts` é implementado e testado nesta mesma sessão (mecanismo
completo, feature-flagged por uma constante `DOCUMENT_REQUEST_CHASING_ENABLED = false`, nunca
ligado em `dev` até Marcelo decidir cadência/quantidade/aprovação humana) — não uma cadência
arbitrária rodando de verdade. Corrigido o índice: o Round 1 errou ao dizer que GSI1 do
`DocumentRequest` individual já existe para "vencido sem submissão" — confirmado por leitura de
`document-request.ts`/`document-request-series.ts` que só a SÉRIE tem `GSI1`
(`SERIESDUE`); a Request individual não tem índice por vencimento. Esta rodada corrige adicionando
`documentRequestGsi1Keys(tenantId, status, deadline, documentRequestId)` — nova namespace GSI1
`REQUESTDUE`, mesmo índice físico, mesma disciplina de D-147 (confirmado por grep que GSI1 é
multi-namespace neste módulo e aceita mais uma). Ponto 12 aceito: destino de dispatch de
notificação do chasing será um `OutboxDestination` PRÓPRIO
(`SQS_DOCUMENT_REQUEST_CHASE_DISPATCH_V1`), nunca reaproveitando
`SQS_DOCUMENT_CHASING_DISPATCH_V1` do módulo `subject` sem prova de compatibilidade de contrato —
mecanismo pronto, consumidor de notificação real (WhatsApp/e-mail) é item 3/19, outro agente,
mesmo padrão "row written before its consumer exists".

## Pendência de produto (mantida, refinada)
Cadência exata de chasing (quantos lembretes, intervalo entre eles, se cada um exige aprovação
humana antes de sair) — `DOCUMENT_REQUEST_CHASING_ENABLED` permanece `false` até essa decisão.

## Pedido ao Codex nesta rodada
Verificar especificamente: (a) se a transação de 3-4 entradas do consumidor de issuance é
realmente atômica e suficiente para as garantias reivindicadas; (b) se `lastSubmissionId`/
`expectedVersion` fencing em `rejectVersion()` cobre toda corrida real possível; (c) se o novo
campo `activeCredentialSelectorHash` introduz algum vazamento de informação cross-boundary que
viole D-146; (d) qualquer gap novo introduzido por estas correções.

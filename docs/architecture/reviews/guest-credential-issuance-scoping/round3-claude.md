# Round 3 — Claude revised proposal

Nota 7,2/10 aceita. Os dois achados centrais (reemissão bloqueada pela própria dedupe; token bruto
numa tabela de leitura compartilhada) são bugs reais introduzidos pela correção anterior — não
apenas subespecificação. Corrigidos abaixo, com fencing exato onde pedido.

## Correção 1 (geração de emissão substitui "uma emissão por request para sempre")
`DocumentRequest` ganha `issuanceGeneration: number` (inicia em `1`, escrito pela própria
transação de criação — `buildDocumentRequestCreatedOutboxEntry` incrementa/inicializa e inclui
`issuanceGeneration` no payload do evento, que NÃO é segredo, é só um contador monotônico) e
`activeCredentialSelectorHash?: string`. `rejectVersion()` (Correção do Round 2, mantida) agora
também incrementa `issuanceGeneration` (`+1`, mesmo `Update` condicional por `expectedVersion` já
usado para `status`/`lastRejection`) e o evento que ele publica leva a NOVA geração.

`IdempotencyRecord` do consumidor: chave `GUESTISSUANCE#<documentRequestId>#<issuanceGeneration>`
(não mais só `documentRequestId`) — cada geração tem seu próprio idempotency record, então uma
reemissão pós-rejeição (geração 2) nunca colide com a idempotência da emissão original (geração
1), fechando o bug apontado no Round 2 item 1 sem reabrir a superfície de duplicação que a Rodada
1 apontou (um replay real do MESMO evento carrega a MESMA geração, continua deduplicado
corretamente).

O `Update` do `DocumentRequest` dentro da transação do consumidor (que grava
`activeCredentialSelectorHash`) é condicionado em `issuanceGeneration = :expectedGeneration` (o
valor lido do evento) — se a request já avançou de geração (ex.: uma segunda rejeição bateu antes
do consumidor processar a primeira), a transação inteira cancela por OCC genuíno, e o consumidor
trata como "evento obsoleto, descartar" (não reprocessa com dados velhos — fecha o TOCTOU do Round
2 item 5).

## Correção 2 (token bruto nunca entra na tabela DynamoDB compartilhada)
`PendingGuestNotificationCommand` é REMOVIDO do desenho. Em vez disso: depois que a
`TransactWriteItems` de identidade (idempotency record + credential + Update do
`DocumentRequest`) commita com sucesso, o mesmo handler consumidor faz UM `SendMessage` direto
para uma NOVA fila SQS dedicada `GuestCredentialDeliveryQueue` (SSE-KMS habilitado, mesma
disciplina de toda fila do projeto), carregando `{ tenantId, subjectId, documentRequestId,
issuanceGeneration, rawToken, expiresAt }`. Política IAM da fila (Terraform,
`infra/modules/sqs-queue/` — mesmo módulo já usado pelas outras filas do projeto): `SendMessage`
só para a role da Lambda `document-archive-guest-handler` (o único emissor), `ReceiveMessage`/
`DeleteMessage` só para a role do worker de notificação (item 3/19, outro agente — mesma disciplina
"fila pronta antes do consumidor existir" já usada por outras filas deste projeto). O token NUNCA
toca a tabela DynamoDB principal — elimina inteiramente o vetor "qualquer role tenant-facing com
`Scan`/`GetItem` na tabela pode ler tokens" apontado no Round 2 item 2, sem precisar de uma tabela
nova/CMK dedicada (o SQS já dá isolamento por IAM+criptografia em repouso, e a visibilidade/retry/
DLQ da fila substituem o esquema de TTL+claim manual do Round 2, respondendo também ao item 3 do
Round 2 — SQS já resolve "entregar exatamente uma vez ao consumidor ativo, com retry e DLQ" sem
reinventar lease/claim).

Se o `SendMessage` falhar depois do commit da transação de identidade: a credencial já existe
(estado correto — o guest tem uma credencial válida), mas a notificação não foi enfileirada.
Documentado como risco residual aceito nesta fatia (alarme CloudWatch em erro de `SendMessage`,
sem retry automático dentro do handler além do retry nativo do SDK) — mecanicamente idêntico ao
"row written before its consumer exists" já aceito pelo projeto em
`SQS_REQUIREMENT_EVIDENCE_REFRESH_V1`, aqui na direção inversa (side-effect não que falta
consumidor, mas que pode falhar depois do efeito principal). Não é um novo padrão, é uma
instância nomeada do mesmo tipo de risco já aceito.

## Correção 3 (distinguir motivo real de `TransactionCanceledException`)
O consumidor usa `err.CancellationReasons` (SDK v3, já usado em outros pontos do repo antes de
`isTransactionCanceled` — precisa de uma nova função `cancellationReasonAt(err, index)` em
`shared/dynamodb/occ.ts`) para inspecionar ESPECIFICAMENTE o índice do `IdempotencyRecord` Put: só
trata como "replay seguro, ACK" se a razão naquele índice for `ConditionalCheckFailed`; qualquer
outro motivo (throttling, tamanho, `TransactionConflict`, condição do `DocumentRequest` falhando
por geração obsoleta — tratado separadamente pela Correção 1) propaga o erro / não dá ACK à
mensagem SQS (deixa o redrive nativo tentar de novo).

## Correção 4 (TTL — reclassificado como pendência de produto/segurança, não engenharia)
Aceito o Round 2 item 7: validade de uma capability enviada a terceiro é decisão de
produto/segurança, não só engenharia. Movida para a seção de pendência abaixo. Enquanto isso,
default PROVISÓRIO deliberadamente conservador (não permissivo): `DEFAULT_CREDENTIAL_TTL_DAYS = 7`
(não 30), explicitamente comentado no código como "default provisório de segurança, aguardando
confirmação de produto — não uma escolha de produto já decidida". Consumidor também recusa emitir
se `expiresAt` computado já está no passado (`expiresAt <= now`) — nesse caso não cria credencial
nenhuma, loga e faz ACK (a `DocumentRequest` já está efetivamente vencida; nenhum estado novo é
inventado para isso, fora de escopo).

## Correção 5 (`createDocumentRequest` — idempotência real)
A transação ganha um 4º item: `IdempotencyRecord` (`payloadHash` de
`{subjectId,requirementId,deadline}`, mesmo padrão de `acceptVersion`/`submitEvidence`) chaveado
pelo `idempotencyKey` do chamador. Replay com o MESMO hash retorna o `resultSnapshot` (o
`DocumentRequest` criado); replay com hash DIFERENTE sob a mesma chave lança `ConflictError`
(nunca retorna silenciosamente a request errada — fecha o Round 2 item 8).

## Correção 6 (revogação — condições exatas)
`Update` condicional do `RequestAccessCredential` em `rejectVersion()`:
`ConditionExpression: "documentRequestId = :did AND selectorHash = :sel"` (prova pertencimento
antes de revogar — Round 2 item 6, primeiro traço) combinado com
`attribute_not_exists(revokedAt) OR revokedAt = :sameRevokedAt` via `SET revokedAt = if_not_exists(revokedAt, :now)`
— idempotente: uma segunda tentativa de revogar a mesma credencial (ex.: replay do processamento de
`rejectVersion`) não falha nem sobrescreve um `revokedAt` já gravado com um valor diferente.

## Estado final por achado do Round 2
1/8/9 (reemissão bloqueada) — RESOLVIDO via `issuanceGeneration`.
2 (vazamento do token) — RESOLVIDO via SQS dedicado, nunca tabela compartilhada.
3 (TTL de item não é lease) — RESOLVIDO (removido o mecanismo de TTL+claim, SQS nativo substitui).
4 (motivo de cancelamento) — RESOLVIDO via `CancellationReasons`.
5 (TOCTOU) — RESOLVIDO via condição de geração no `Update`.
6 (fencing de revogação) — RESOLVIDO, condições exatas acima.
7 (30 dias é produto) — ACEITO, movido para pendência, default provisório reduzido a 7 dias.
8 (`createDocumentRequest` idempotência) — RESOLVIDO.
9 ("comando durável" não é fila real) — RESOLVIDO (substituído por SQS real, não mais um item de
tabela).
10 (chasing) — já aceito como corretamente neutralizado no Round 2, sem mudança.

## Pendência de produto (final, substituindo a do Round 1/2)
1. Cadência/quantidade/aprovação humana do "automated chasing" (mecanismo pronto atrás de
   `DOCUMENT_REQUEST_CHASING_ENABLED=false`).
2. TTL definitivo de uma credencial de guest quando `DocumentRequest.deadline` está ausente —
   hoje um default de engenharia PROVISÓRIO de 7 dias, correto seguir com ele nesta implementação,
   mas precisa de confirmação explícita de Marcelo antes de ser tratado como política final (é uma
   decisão sobre risco de exposição de uma capability de terceiro, não uma escolha técnica pura).

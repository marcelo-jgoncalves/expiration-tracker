# W3-06 — Real physical purge of `USER_DOCUMENT` (`Document` aggregate) — Round 1 (Claude proposal)

> Type 1 decision (`change-risk-scale.md` nível 5-6), protocolo `AGENTS.md` §4, gate padrão 9.0/10.
> Decisão de produto já tomada (D-059, Marcelo): implementar agora. Este documento é só o
> **desenho do mecanismo**. W3-07 (cascata DSR) deve conseguir reusar o mesmo mecanismo depois,
> sem reabrir esta decisão — mas W3-07 em si (state machine `DataSubjectRequest`, export, rotas
> HTTP) fica fora de escopo aqui, per `docs/engineering/principles.md` #1 (não expandir sem
> necessidade).

## 1. Problema

`Document.purgeAfter` (`src/modules/document/domain/retention.ts::computeUserDocumentPurgeAfter`,
`privacy-lgpd.md` §4: exclusão/encerramento + 30 dias) é escrito por
`document-deletion-service.ts` quando um documento é soft-deletado (`status: "DELETED"`), mas
**nada nunca lê esse campo**. Nem TTL nativo do DynamoDB (o campo não está marcado como atributo
TTL da tabela), nem worker, nem lifecycle S3 no bucket `clean`/`quarantine`
(`module.document_buckets`). O objeto S3 (`cleanObject`/`quarantineObject`) e a linha DynamoDB
sobrevivem indefinidamente após a "exclusão". Isso é o único gate real de pilot readiness ainda
aberto (`pilot-readiness-assessment.md` addendum 2026-08-28).

## 2. Padrão de referência já provado: `EXTRACTION_TRANSIENT`

`infra/main.tf:1605-1658` — bucket dedicado com lifecycle S3 fixo (`expiration.days = 1`,
casando `EXTRACTION_TRANSIENT_LIFECYCLE_HOURS`), e deleção explícita feita pelo próprio
`ExtractionValidationTaskHandler` nos dois estados terminais. O lifecycle é **rede de segurança**
para o caminho que nunca chegou a um estado terminal — não é o mecanismo primário.

Diferença estrutural que impede copiar o padrão 1:1: `EXTRACTION_TRANSIENT` tem prazo **fixo a
partir da criação do objeto** (24h), então um `expiration.days` do S3 (que só conta a partir da
criação do objeto) basta sozinho como rede de segurança. `USER_DOCUMENT` tem prazo **variável a
partir de um evento posterior à criação** (exclusão/encerramento + 30 dias) — um objeto pode
viver meses antes de ser excluído. Um lifecycle S3 baseado em `expiration.days` não pode expressar
"30 dias depois da exclusão", só "N dias depois da criação do objeto". Isso é tratado no §4.

## 3. Mecanismo primário — reusar GSI6 (convenção `WORKSTATE#...` global, não o desenho
tenant-scoped original de `data-model.md` §3, que foi superado na prática pelas 3 roles reais
já existentes: `ReminderReconciliation`, `OutboxSweeperReminderDispatch`,
`UploadSlotReconciliationWorker` — todas usam `GSI6PK="WORKSTATE#<estado>"` global)

1. **Novo par de constantes** em `src/modules/document/ports/document-store.ts` (mesmo arquivo que
   já declara `GSI6PK_RECON_UPLOAD_PENDING`): `GSI6PK_PURGE_PENDING = "WORKSTATE#PURGE_PENDING"`
   e `buildDocumentPurgeGsi6Sk(purgeAfter, tenantId, documentId) => `${purgeAfter}#TENANT#${tenantId}#DOCUMENT#${documentId}``
   (mesmo formato de `buildDstCandidateGsi6Sk`/`buildUploadSlotGsi6Sk` — `<ordenável>#TENANT#t#<tipo>#<id>`
   para reconstrução de contexto sem tocar a tabela base).
2. **`document-deletion-service.ts`** grava `GSI6PK`/`GSI6SK` no mesmo `TransactWriteItems` que já
   seta `status: "DELETED"`/`purgeAfter` (mesma transação — nunca dois passos, evita o mesmo bug de
   "ponteiro nunca escrito" que `reserveUpload` teve e que a reconciliação já documenta como lição
   aprendida em `document-store.ts`).
3. **Novo worker `DocumentPurgeWorker`** (`src/workers/document-purge/`, lógica pura,
   clock-injected, mesmo layout de `reminder-reconciliation`/`upload-slot-reconciliation`):
   consulta GSI6 `GSI6PK = WORKSTATE#PURGE_PENDING AND GSI6SK < <now>` (mesmo padrão de
   `KeyConditionExpression` de `dynamodb-reconciliation-candidate-source.ts`), e para cada
   candidato: `deleteObjectVersion` no `quarantineObject` (se existir) e no `cleanObject` (se
   existir) via `DocumentObjectStore` já existente, depois `TransactWriteItems` fazendo
   `DeleteItem` da linha `Document` condicionado a `status = "DELETED"` (falha-fechado se alguém
   reverteu a exclusão entre a leitura e a escrita — mesma disciplina OCC do resto do projeto,
   embora aqui seja delete físico, não update versionado). **Ordem importa**: S3 primeiro, depois
   DynamoDB — se o worker crashar entre os dois passos, o próximo ciclo reencontra o mesmo
   candidato (GSI6SK ainda `< now`, linha `Document` ainda existe) e repete a deleção de S3 de
   forma idempotente (`DeleteObjectCommand` num objeto já ausente não é erro).
4. **Sem `ConditionCheck` de "documento ainda existe"** antes do delete de S3 — diferente do
   padrão de `renewItem`/criação de item (que usa `ConditionCheck` porque a existência ainda não
   está garantida pela mesma transação): aqui a leitura via GSI6 e a deleção acontecem em
   iterações separadas do worker, não na mesma transação de escrita original, então a leitura logo
   antes do delete É a checagem.
5. **IAM**: `DocumentPurgeWorker` vira a **quarta** role a receber `gsi6_read_policy_json`
   (atualizar o comentário "EXACTLY THREE" em `infra/main.tf`/`dynamo-table/main.tf` para
   "EXACTLY FOUR", listando as quatro). Permissão de escrita/delete real: `dynamodb:DeleteItem` na
   tabela base (resource = table ARN, nunca o índice — mesma regra de `tenant_facing_read_write`)
   + `s3:DeleteObject`/`s3:GetObject` nos buckets `quarantine`/`clean` (IAM já existente para
   outros handlers, reusar o padrão de `documents_presign_quarantine_put`/similar, escopado só ao
   novo role).
6. **Agendamento**: `aws_scheduler_schedule` (mesmo mecanismo de `upload_slot_reconciliation`),
   cadência a definir — proposta inicial: a cada 6h (a janela de atraso máxima aceitável é folgada,
   já que o prazo é de 30 dias; não precisa da cadência apertada do `ReminderProducer`).

## 4. Rede de segurança S3 (lifecycle) — adaptada, não copiada 1:1

Como o prazo de `USER_DOCUMENT` não é expressável como `expiration.days` a partir da criação do
objeto, a rede de segurança proposta é um **teto superior generoso**, não uma cópia exata do
prazo de negócio: `expiration.days = 400` nos buckets `quarantine`/`clean`
(`module.document_buckets`). Isso nunca dispara no caminho normal (documento excluído em <370 dias
de vida) e só entra em ação se o worker primário falhar sistemicamente por mais de ~1 ano — mesmo
espírito do lifecycle de `EXTRACTION_TRANSIENT` (rede de segurança para o caminho nunca chegou a
terminal), adaptado à faixa de tempo real deste caso. Alternativa rejeitada: não ter lifecycle
nenhum — rejeitada porque o próprio D-059/pilot-readiness-assessment cita "lifecycle S3 como rede
de segurança" como parte explícita do padrão a replicar.

## 5. Reuso futuro por W3-07 (não implementado agora)

O par `GSI6PK_PURGE_PENDING`/`buildDocumentPurgeGsi6Sk` é deliberadamente parametrizado por
`entityType`/`id` (não hardcoded a `DOCUMENT`) para que uma cascata de exclusão DSR futura possa
escrever o mesmo ponteiro para outras entidades tenant-wide (`ExpirationItem`, etc.) sem inventar
um segundo mecanismo de purge. `DocumentPurgeWorker` em si continua específico de `Document`
(único consumidor real hoje) — generalizar o worker para múltiplos tipos de entidade é trabalho de
W3-07, não desta decisão (evitar abstração especulativa, `principles.md` #1).

## 6. Alternativas consideradas e rejeitadas

- **DynamoDB TTL nativo em `purgeAfter`**: rejeitada como mecanismo primário — `data-model.md`
  §3 já registra a lição "TTL é limpeza auxiliar, nunca gatilho operacional" para GSI6 (evita
  depender do timing assíncrono do TTL, que pode atrasar até 48h e não dispara nenhuma ação em S3
  sozinho). Pode ainda valer como **segunda** rede de segurança barata (marcar `purgeAfter` como
  atributo TTL da tabela, deletando a linha órfã se o worker primário nunca rodar) — proposto como
  adição opcional de baixo custo, não como substituto do worker.
- **Scan geral da tabela filtrando por `purgeAfter`**: rejeitado — `Scan` é caro/lento em escala e
  o projeto já tem o padrão GSI6 exatamente para evitar isso.
- **Cascata de deleção completa (W3-07) implementada junto**: rejeitada por escopo — D-059 e o
  handoff prompt desta sessão são explícitos em escopar o *mecanismo* junto, não a feature DSR
  inteira.

## 7. Impacto em testes

Novo `test/unit/workers/document-purge.test.ts` (clock injetado, fake `DocumentObjectStore`/
`DocumentStore`, casos: candidato com ambos objetos presentes, só quarantine, já sem nenhum objeto
S3 [reentrância pós-crash], `Document` já removido entre leitura e delete [não deve lançar]).
`infra/tests/stack.tftest.hcl` ganha os testes de isolamento GSI6 (quarta role) e o lifecycle novo
dos buckets, seguindo o padrão já existente para as outras três roles.

## 8. Pergunta aberta para a Rodada B (Codex)

A cadência de 6h e o teto de lifecycle de 400 dias em §3/§4 são escolhas de engenharia razoáveis,
não uma decisão de produto formal — pedir crítica adversarial específica sobre: (a) se `DeleteItem`
condicionado a `status = "DELETED"` é suficiente ou se falta um `ConditionCheck` adicional contra
resurreição concorrente; (b) se a ordem S3-antes-de-DynamoDB é a mais segura ou se inverte algum
requisito de auditoria/evidência; (c) qualquer classe de bug estrutural que os workers de
reconciliação existentes já tiveram e que este design possa estar repetindo.

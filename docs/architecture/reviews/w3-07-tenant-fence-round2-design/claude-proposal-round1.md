# W3-07 — Tenant Deletion Fence, Proposta Round 1 (retomada pós-D-063)

> Contexto obrigatório já lido: `w3-07-tenant-cascade-deletion-design/claude-final-status-not-approved.md` (D-062)
> e `w3-07-tenant-deletion-with-fence-design/claude-status-paused-for-next-session.md` (D-063). Este documento
> assume os achados de ambos como verdadeiros e não os redescobre.

## 0. Levantamento exaustivo desta rodada (por ponto de entrada de runtime, não por pasta)

Auditoria completa dos 36 handlers reais em `src/runtime/aws/handlers/` contra o Terraform (gatilho declarado,
não suposto pelo nome). Achados estruturais, na ordem em que mudam o desenho:

1. **Não existe hoje nenhum código de cascata/fence** — greenfield real, nenhuma verificação de "tenant
   excluído" em lugar nenhum.
2. `RequestContextResolver.resolve()` é o único ponto do sistema que checa qualquer status hoje
   (`UserProfile.status !== "ACTIVE"`), e só é alcançado por rotas HTTP autenticadas. A checagem é
   **desacoplada** (lida uma vez no início do handler, fora de qualquer transação).
3. `GuestSubmissionService.resolveToken()` **nunca** consulta tenant/usuário — só token/`DocumentRequest`
   (comentário explícito no código confirmando que é deliberado). Sem fence hoje.
4. `startSubmission()`/`handleReserveUpload`/`handleReserveImport` emitem **URLs S3 presignadas** (PUT) que o
   S3 aceita sem passar por nenhum handler nosso até o evento "Object Created" disparar a finalização —
   minutos depois, com `tenantId` derivado da **key S3 já gravada**, não de contexto revalidado.
5. Toda a cadeia `import-parse → import-commit`, `reminder-producer → reminder-dispatch →
   reminder-materialization-trigger`, `dispatch-outbox-relay`/`outbox-sweeper`, `notification-router →
   email-delivery → ses-callback`, `document-chasing-dispatch`, `malware-result`/`upload-finalizer`,
   `upload-slot-reconciliation` — **nenhuma** checa tenant hoje; `tenantId` vem sempre de um payload já
   enfileirado ou de uma key S3 já materializada antes.
6. A Step Functions `document-extraction` (`extraction-starter → RunTextract → RunDeterministicParser →
   [RunBedrock] → ValidateSchema/CompareExtractors → PersistExtractedFields/MarkPendingConfirmation →
   CompleteRun`) propaga `tenantId` pelo payload de state para state, nunca revalida. As escritas reais
   (`PersistExtractedFields`/`MarkPendingConfirmation`) só acontecem nos dois últimos states — minutos depois
   do início, depois de uma chamada Bedrock paga real e de um `waitForTaskToken` do Textract (até 600s).
7. **Achado que muda o desenho**: apesar da superfície parecer enorme (36 handlers, 3 classes de gatilho,
   Step Functions incluída), praticamente toda escrita de dado de tenant termina em um de dois primitivos
   já existentes e centralizados:
   - `TransactWriteCommand` (DynamoDB), construído em **8 arquivos de persistência**
     (`dynamodb-{extracted-field,document,reminder,subject,import,expiration,reminder-producer,notification}-store.ts`),
     usando os builders de `src/shared/dynamodb/occ.ts` (`buildVersionedUpdate`/`buildVersionedCreate`/
     `buildVersionConditionCheck`/`buildExistenceConditionCheck`) — regra já normativa em `AGENTS.md` §7.
   - `UpdateCommand`/`PutCommand`/`DeleteCommand` single-item, em **11 arquivos de persistência** (mesma lista
     + `dynamodb-extraction-run-store`, `dynamodb-textract-job-store`, `dynamodb-session-store` [tabela
     separada], `dynamodb-outbox-relay-store`, `dynamodb-identity-store`).
   Isso é uma superfície **enumerável e já disciplinada**, não 36 pontos ad-hoc — o oposto do que quebrou
   D-062/D-063.

## 1. O tombstone (sobrevive à cascata)

Entidade nova `TenantLifecycleRecord`, **fora do universo apagável pela cascata** (a rotina de
descoberta+exclusão por Scan de D-062/D-063 exclui explicitamente este `entityType` — mesma disciplina já
usada para excluir a própria tabela `bff-session-table` do Scan).

```
PK = "TENANT#<tenantId>#LIFECYCLE"
SK = "LIFECYCLE"
entityType = "TenantLifecycleRecord"
status = "ACTIVE" | "DELETING" | "DELETED"
deletionStartedAt / deletionCompletedAt
version   (OCC padrão)
```

Vive na tabela principal (não numa tabela separada — precisa ser lido pelo mesmo `TransactWriteItems` que
grava dado de tenant, e `TransactWriteItems` não atravessa tabelas). Nasce `ACTIVE` no primeiro
`createProfileIfAbsent` (mesma transação, custo zero de coordenação adicional).

## 2. Fence estrutural na camada de escrita (fecha os 36 pontos de uma vez, não handler por handler)

Dois wrappers novos em `src/shared/dynamodb/`, substituindo a construção direta de comandos nos 8+11 arquivos
de persistência:

- `fencedTransactWrite(client, { tenantId, items })` — adiciona automaticamente, como **primeiro** item da
  lista, um `ConditionCheck` (via `buildExistenceConditionCheck` já existente) contra
  `TENANT#<tenantId>#LIFECYCLE`/`LIFECYCLE` asserindo `status = "ACTIVE"`. Todo `TransactWriteItems` que
  escreve dado de tenant passa a incluir esse ConditionCheck sem que cada service precise lembrar.
- `fencedSingleWrite(client, { tenantId, command })` — para os `UpdateCommand`/`PutCommand`/`DeleteCommand`
  isolados, reescreve o comando como um `TransactWriteCommand` de 2 itens (a escrita real + o ConditionCheck
  do fence) — DynamoDB não tem `ConditionExpression` cross-item para comando single-item, então a única forma
  atômica de compor "escreva X E confirme que o tenant está ACTIVE" é uma transação de 2 itens. Aceitar o
  custo de WCU/latência adicional (já pago hoje pelos outros usos de `TransactWriteItems` no mesmo código).

**Enforcement estrutural, não convenção**: regra nova de `dependency-cruiser` (mesmo mecanismo que já proíbe
`shared` de importar `modules/**`) proibindo `new TransactWriteCommand(`/`new UpdateCommand(`/`new
PutCommand(`/`new DeleteCommand(` fora de `src/shared/dynamodb/fenced-write.ts` — fecha a classe de erro
"um call site novo esqueceu o fence", que foi exatamente a causa raiz do achado mais grave de D-063
(auditoria incompleta por pasta).

Isso fecha, sem tocar em nenhum dos 36 handlers individualmente: `items-handler`, `documents-handler` (a
persistência do `Document`, não a emissão da URL presignada — ver §4), `guest-documents-handler` (via
`DocumentSubmission`), `import-commit-handler` (mesmo com `systemContextFor()` sintético — o fence não
depende de `RequestContext`, é checado na escrita, não na autorização), toda a cadeia de lembretes/outbox,
`notification-router`/`email-delivery` (a gravação da tentativa, não o `ses:SendEmail` em si — ver §5),
`malware-result`/`upload-finalizer`, `upload-slot-reconciliation`, e as duas tasks de escrita da Step
Functions (`PersistExtractedFields`/`MarkPendingConfirmation`).

## 3. Fechando a ressurreição no resolver (defesa em profundidade, não a defesa primária)

`RequestContextResolver.resolve()` ganha uma leitura do `TenantLifecycleRecord` **antes** de
`createProfileIfAbsent` (não substitui a checagem de `UserProfile.status`, é adicional e anterior). Se
`status !== "ACTIVE"`, rejeita com 403 sem provisionar nada. Isso é defesa em profundidade — mesmo que
faltasse, o §2 já impediria a escrita real do `User` recriado, porque `createProfileIfAbsent` também passa
pelo `fencedSingleWrite`. A checagem no resolver existe para dar um erro claro (403) em vez de deixar o
usuário achar que logou e só descobrir a rejeição no primeiro POST.

## 4. URLs presignadas já emitidas (S3)

Não são revogáveis diretamente. Mitigação real, não best-effort: a finalização (`upload-finalizer-handler`/
`malware-result-handler`/equivalente guest) é exatamente o ponto que persiste `Document`/`DocumentSubmission`
via `fencedTransactWrite` (§2) — se o tenant já está `DELETING`, a transação de finalização falha
(`ConditionalCheckFailedException`), o objeto S3 fica órfão na quarantine (limpo depois por
`document-purge-handler`/lifecycle, mecanismo já aprovado em D-061), mas **nenhuma linha DynamoDB nova
aparece**. Resultado: nenhuma ressurreição de dado consultável, só lixo de storage já coberto por mecanismo
existente. TTL curto (600s) já limita a janela de exposição.

## 5. Efeitos externos irreversíveis (SES, Bedrock, Textract) — protocolo de duas fases, não checagem simples

Nenhum destes tem `ConditionExpression` atômica nativa. Desenho: **a decisão de disparar o efeito precisa
nascer de uma escrita fenced**, não de uma leitura solta:

- `email-delivery-handler`: antes de `ses:SendEmail`, marca `NotificationAttempt.status = "SENDING"` via
  `fencedTransactWrite`. Se o tenant já está `DELETING`, a marcação falha e o handler nunca chama SES. Um
  e-mail cuja marcação já commitou antes do `DELETING` ser escrito ainda sai (janela de milissegundos,
  inerente a qualquer sistema com efeito externo assíncrono — documentado como risco residual aceito, não
  escondido).
- `document-chasing-dispatch-handler`: mesmo padrão — o novo `GuestTokenPointer` só é criado via
  `fencedTransactWrite`; se falhar, nenhum token novo existe, nenhum e-mail é enviado.
- Bedrock/Textract (custo, não dado): `BedrockExtractionTaskHandler`/`TextractTaskHandler` já gravam
  `TenantQuotaService`/`TextractJob` via os stores fenced do §2 — se o tenant foi excluído entre o
  `RunTextract` e o `RunBedrock`, a chamada Bedrock ainda ocorre (custo real, não dado), mas
  `PersistExtractedFields` falha depois. Custo residual pequeno e limitado, não uma garantia de dado quebrada.

## 6. Sequência da cascata (drenagem antes de apagar)

1. `fencedSingleWrite` grava `TenantLifecycleRecord.status = "DELETING"` (create condicional
   `attribute_not_exists(PK)` → falha se uma cascata já está em curso, evita corrida de duplo-start).
2. Best-effort: `StopExecution` em toda execução Step Functions ativa cujo payload referencia o tenant
   (via tag/GSI já existente do desenho de extração) — reduz custo Bedrock/Textract desperdiçado, não é
   requisito de correção (o fence do §2/§5 já garante correção sem isto).
3. Roda a descoberta+exclusão já aprovada (Scan + taxonomia de ~40 `entityType`, convergência por re-Scan),
   reusando `DocumentPurgeWorker`/GSI6 para `Document` (D-061) — mecanismo inalterado desta rodada.
4. `TenantLifecycleRecord` **nunca** é alvo do Scan (exclusão explícita por `entityType`, mesma disciplina já
   usada para `bff-session-table`).
5. Convergência confirmada (zero itens restantes) → `fencedSingleWrite` flip para `status = "DELETED"`
   (permanente; nenhum código reabre um tenant `DELETED` — fora de escopo desta feature).

## 7. O que este desenho NÃO resolve (fora de escopo explícito, registrar e não mascarar)

- Rotas HTTP/confirmação/exportação de DSR completo — já fora de escopo desde D-062, inalterado.
- `PolicyRef` sem `tenantId` (achado independente de D-062) — correção mecânica separada.
- `tenantId` (MVP `tenantId=userId`) ≠ Cognito `sub` — ação administrativa futura no Cognito por tenant
  precisa resolver isso à parte; não bloqueia este desenho porque a cascata nunca chama a API do Cognito.

## 8. Por que isto não repete os erros de D-062/D-063

- O fence não é a mesma linha que a cascata apaga (§1, `TenantLifecycleRecord` explicitamente excluído do
  Scan) — resolve o achado mais grave de D-063.
- A checagem é acoplada (`ConditionCheck` na mesma transação), nunca uma leitura solta antes de agir —
  resolve o segundo achado de D-063 (TOCTOU).
- A cobertura não depende de enumerar 36 handlers corretamente — depende de 19 arquivos de persistência já
  conhecidos + uma regra de lint estrutural que impede um call site futuro de escapar do fence. Reduz a
  classe de erro "auditoria incompleta" de "confiar em uma lista manual" para "confiar numa regra estática
  verificável por `dependency-cruiser`" — resolve a causa raiz comum às duas rodadas reprovadas.

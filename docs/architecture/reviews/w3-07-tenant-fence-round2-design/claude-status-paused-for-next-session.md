# W3-07 (retomada, Round 2) — status: PAUSADO após 3 rodadas (2,8→4,1→4,8/10), planejamento minucioso para sessão dedicada

> Sessão de análise/planejamento (2026-08-28), a pedido explícito do Marcelo. Continuação de
> `w3-07-tenant-deletion-with-fence-design/` (D-063, Rodada 1: 3,2/10). Leia `claude-proposal-round1.md`,
> `claude-proposal-round2.md`, `claude-proposal-round3.md` e as três críticas do Codex (`codex-roundN-critique-full.txt`)
> na ordem, antes de propor qualquer desenho novo — a trajetória de cada rodada explica por que a anterior
> falhou, não redescobrir.

## Trajetória desta sessão

| Rodada | Nota | Mudança principal |
|---|---|---|
| 1 | 2,8/10 | Estratégia nova: fence na camada de escrita compartilhada (tombstone + wrappers), em vez de handler por handler. Direção validada pelo Codex; execução com 8 achados bloqueantes reais (wrapper autocontraditório, bootstrap impossível, dependency-cruiser tecnicamente inviável, inventário incompleto, janela claim→efeito subestimada, bug real do Bedrock, ordem de URL presignada, sem prazo de eliminação física). |
| 2 | 4,1/10 | 3 primitivos separados (bootstrap/write/transição), resolver reestruturado, ESLint em vez de dependency-cruiser, `DRAIN_WINDOW_SECONDS=900`. 1 achado resolvido, 4 parciais, 3 não resolvidos + **achado novo grave**: anexar o fence como primeiro item de `TransactWriteItems` quebra código real que assume índices fixos em `CancellationReasons` (`reminder-dispatch`, `reminder-materializer`). |
| 3 | 4,8/10 | Fence movido para o fim da transação (resolve o achado do índice), limite de 99 itens, bootstrap movido para `modules/identity` com port estendido, ESLint real (`.eslintrc.cjs`), varredura S3 ativa por prefixo substituindo a espera fixa. **Padrão novo identificado**: as correções para fechar o fence em `startExtractionRun`/quota Textract-Bedrock/`completeOcr` quebram mecanismos de recovery/idempotência que o código já tem hoje por boas razões (redelivery, `clientRequestToken`, recuperação de falha transitória entre efeito externo e persistência). |

## Por que não convergiu (o achado central desta rodada, distinto do achado central de D-063)

D-063 travou em "o fence é a mesma linha que a cascata apaga". Esta rodada resolveu isso (tombstone
separado, confirmado pelo Codex como resolvido desde a Rodada 1). O que trava agora é diferente e mais
sutil: **o sistema já tem, em vários pontos, um protocolo de recovery para efeitos externos que falham entre
a chamada e a persistência (Textract `clientRequestToken`, Step Functions `StartExecution` idempotente por
nome, redelivery SQS) — e um fence ingênuo ("só chama o efeito se uma escrita fenced desta invocação
suceder") quebra esse recovery, porque trata toda redelivery como se fosse a primeira tentativa.** A correção
real precisa de um protocolo de **claim + outcome separados** (não um único ConditionCheck):

- **Claim**: registra a intenção antes do efeito externo, de forma que uma redelivery reconheça "eu já
  tentei isto" sem precisar que o efeito tenha necessariamente sucedido.
- **Outcome**: registra o resultado do efeito (sucesso/falha/desconhecido) separadamente, permitindo que uma
  redelivery decida corretamente entre (a) repetir o efeito com idempotency key (seguro, efeito real usa
  `clientRequestToken`/nome de execução determinístico), (b) recuperar um resultado já obtido mas não
  persistido, ou (c) abortar por fence sem perder a possibilidade de recovery futuro caso o fence seja
  removido por engano.
- O fence de tenant entra na decisão de **iniciar um novo claim**, nunca bloqueia a **conclusão de um claim
  já em andamento** — isso é o que preserva o recovery existente.

Isso é desenho de máquina de estados por efeito externo (Textract, Bedrock, Step Functions), não mais um
único wrapper genérico — trabalho substancialmente maior que os "primitivos de escrita" das rodadas 1-3.

## O que sobrevive desta rodada (reusar, não redescobrir)

- **Tombstone `TenantLifecycleRecord` fora do universo apagável pela cascata** — resolvido desde a Rodada 1,
  confirmado nas 3 críticas, nunca reaberto.
- **Três primitivos (bootstrap/write-fenced/transição-administrativa)** em vez de um wrapper único — direção
  correta (Rodada 2), só falta a integração real com `IdentityStore` (estender o port, não criar em
  `shared/dynamodb`).
- **Fence anexado ao FIM de `TransactWriteItems`, não ao início** — resolvido na Rodada 3, confirmado: não
  quebra os índices que `reminder-dispatch`/`reminder-materializer` assumem em `CancellationReasons`.
- **Limite de 99 itens antes do append** — resolvido na Rodada 3, trivial de manter.
- **Enforcement via ESLint (`.eslintrc.cjs` real, `no-restricted-imports` + `no-restricted-syntax` para
  namespace import)** — forma sintática validada pelo Codex; falta só completar a lista de exceções (hoje só
  cobre os dois anchors novos, precisa cobrir todos os adapters legítimos existentes) e fechar
  `new ddb["PutCommand"]()`/`BatchWriteCommand`.
- **Distinção formal "zero linha DynamoDB consultável" ≠ "zero dado físico do titular"** — aceita como real
  pelo Codex, direção da varredura S3 ativa por prefixo (substituindo espera fixa) confirmada como certa,
  só precisa de execução mais rigorosa (ver pendências abaixo).

## Pendências reais para a próxima sessão, por área

### 1. Protocolo claim/outcome para efeitos externos (o gargalo real agora)

Desenhar antes de qualquer outra coisa — os itens 2-5 abaixo dependem deste desenho:
- Textract: hoje usa `clientRequestToken` idempotente (`start-ocr.ts`) para recovery de falha entre
  `StartDocumentTextDetection` e persistência de `TextractJob`. O fence precisa gatear apenas o **primeiro**
  claim (nenhum claim novo depois de `DELETING`), nunca a conclusão/recovery de um claim já registrado antes.
- Bedrock: mesma classe de problema, sem idempotency key nativa hoje (`run-bedrock-extraction.ts`) — avaliar
  se precisa ganhar uma (ex.: `InvokeModel` com algum idempotency token, se a API suportar) como parte deste
  desenho, não como afterthought.
- Step Functions `StartExecution`: já usa nome de execução determinístico (confirmar) — o fence não pode
  transformar o estado intermediário (`STARTING` da Rodada 3) num estado terminal que bloqueia retry; precisa
  ser reentrante.
- `completeOcr`: mesma classe — `TextractJob.status` real hoje é `"STARTED"` (não `"IN_PROGRESS"` como a
  Rodada 3 assumiu sem checar), e a transição para completar precisa aceitar retry depois de `PutObject`
  bem-sucedido mas `SendTaskSuccess`/`SendTaskFailure` falho.
- `TenantQuotaService.consume()`: hoje serve dois usos diferentes (quota agregada tipo `API_REQUEST` e
  reserva idempotente tipo `AI_CALL` por run) sob o mesmo primitivo sem owner/idempotency key no registro —
  não dá para diferenciar "replay do mesmo consumidor" de "outro consumidor excedeu" hoje. Pode precisar de
  um tipo de registro novo (`QuotaReservation` com claim id) só para os usos de reserva-por-run, sem tocar o
  uso agregado.

### 2. Convenção de key S3 — legado real, não só padronização de keys novas

Confirmado nesta rodada (Codex leu o código real):
- Quarantine: `tenant/<tenantId>/...` — já enumerável.
- Import raw/plan: `tenant/<tenantId>/imports/...` — já enumerável.
- **Clean**: `clean/<tenantId>/<itemId>/<documentId>` (`advance-after-evidence.ts`) — **não** começa com
  `tenant/`, mas tem `tenantId` como segundo segmento — enumerável com um prefixo diferente
  (`clean/<tenantId>/`), não com o mesmo prefixo dos outros.
- **OCR**: `ocr/<runId>/<uuid>.json` (`s3-ocr-artifact-store.ts`) — **sem tenantId na key**, não enumerável
  por prefixo de tenant nenhum; precisa de outra estratégia (ex.: indexar `runId→tenantId` via
  `ExtractionRun` antes de apagar as linhas DynamoDB, gerando a lista de keys OCR a apagar a partir dos
  registros, não por listagem de prefixo).
- Definir, bucket a bucket, o prefixo real de varredura (não assumir um único `tenant/<tenantId>/` universal).

### 3. Varredura S3 durável, não uma função sem checkpoint

- Paginação real (`ListObjectVersions` com `KeyMarker`/`VersionIdMarker`) para os 3 buckets versionados
  (quarantine/clean/import — OCR transient não é versionado, confirmado).
- Tratar `DeleteObjects.Errors[]` — sucesso HTTP não significa que todas as versões foram apagadas.
- Mecanismo de checkpoint entre invocações (Step Functions com estado, não uma função sem estado) — uma
  única Lambda não pode assumir que listar+apagar+convergir cabe numa invocação.
- Barreira temporal explícita: provar que nenhuma URL presignada ainda válida existe antes da verificação
  final de zero objetos (não "duas listagens vazias" sozinho, que não é suficiente).

### 4. Itens menores, mecânicos, não bloqueantes de desenho

- Fechar os bypasses residuais do ESLint (`new ddb["PutCommand"]()`, `BatchWriteCommand`, imports dinâmicos)
  e migrar a lista de exceções para cobrir os adapters legítimos existentes, não só os dois anchors novos.
- `bootstrapTenant`: especificar o acesso a `tableName`/abstração equivalente no port estendido, e
  reespecificar o tratamento de corrida (a resposta da Rodada 3 — "propaga o erro que `findOrCreate` já
  lança" — é imprecisa porque o bootstrap novo substitui esse trecho, não convive com ele).

## Próxima sessão — como retomar

1. Ler esta pasta inteira (as 3 propostas + as 3 críticas) antes de propor qualquer coisa nova.
2. Desenhar o protocolo claim/outcome (pendência 1) primeiro — é a dependência de tudo mais.
3. Só depois disso, reespecificar `startExtractionRun`/quota Textract-Bedrock/`completeOcr` em cima do
   protocolo novo.
4. Resolver a convenção de key S3 por bucket real (pendência 2) e a varredura durável com checkpoint
   (pendência 3) — provavelmente como uma Step Functions dedicada de purga por tenant, não uma Lambda simples
   (mesmo padrão de orquestração já usado para `document-extraction`).
5. Reabrir o protocolo Claude↔Codex com o desenho completo — não enviar rodadas parciais que resolvem só um
   subconjunto, dado que as rodadas 1-3 desta sessão mostraram que achados parciais tendem a gerar achados
   novos nas áreas ainda não tocadas.

## Registro de decisão

D-065 em `docs/architecture/decisions-log.md`: 3 rodadas nesta sessão (2,8→4,1→4,8/10), nunca atingiu o gate
de 9,0, pausada por decisão do Marcelo para planejamento adicional (protocolo claim/outcome) numa sessão
dedicada futura — não uma decisão de abandonar o objetivo. Nenhum gate de pilot readiness depende disso (já
registrado em `NEXT_SESSION_PROMPT.md`).

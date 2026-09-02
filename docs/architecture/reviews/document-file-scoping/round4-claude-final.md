# DocumentFile — Rodada 4 (revisão final Claude)

Nota da Rodada 3: 8,3/10. 6 achados reais remanescentes, todos endereçados abaixo com mecanismo
concreto — nenhum ficando em prosa.

## 1. Contradição de correlação da tripla (bloqueador nomeado pelo Codex)

Regra única, simétrica, substituindo a formulação ambígua da Rodada 3: **"o primeiro evento
físico a chegar consolida `quarantineObject.versionId` a partir da própria tripla que ELE
carrega (nunca da Version armazenada), condicionado em `scanStatus IN (PENDING_UPLOAD,
SCANNING)`; o segundo evento a chegar precisa bater exatamente com a tripla já consolidada."**
Isto nunca dependeu de qual writer é "o S3" ou "o GuardDuty" — um finding real do GuardDuty
Malware Protection já carrega `bucket`+`key`+`versionId` do objeto físico que escaneou
(confirmado: é assim que M6 já correlaciona hoje, `malware-scan-result.ts`), então o GuardDuty
não precisa esperar o evento S3 para saber a tripla real. Os dois writers executam o MESMO
algoritmo (`consolidateOrVerify(observedTriple)`), não dois algoritmos distintos por origem —
fecha a contradição apontada.

## 2. `DocumentVersionEvent` reflexivo — campos corretos, sem entidade nova

Em vez de um evento reflexivo vago: `DocumentVersionEvent` ganha 3 campos novos, opcionais,
usados só por este tipo de evento — `fileId?: string`, `fromFileScanStatus?:
DocumentFileScanStatus`, `toFileScanStatus?: DocumentFileScanStatus`. Tipo renomeado
`FILE_REMOVED_INFECTED` → **`FILE_REJECTED_INFECTED`** (nome antigo sugeria uma remoção física
que nunca existiu; renomear é seguro — o tipo nunca teve um writer real, zero itens persistidos
em `dev` hoje, confirmado por grep antes desta rodada). `fromState`/`toState` (campos da Version)
continuam preenchidos com o estado **atual e inalterado** da Version — documentado
explicitamente no comentário do tipo como "contexto informativo, não a transição que este evento
registra" (a transição real está nos 2 campos novos). Não cria `DocumentFileEvent` como entidade
separada — extensão aditiva do log já existente é suficiente e mais barata, sem duplicar o
mecanismo de auditoria append-only.

## 3. GSI6 — revertido, nunca tocado (D-143 Decision 2 não é emendada)

Achado aceito sem ressalva: `GSI6` está formalmente fechado para o domínio documental
(`estado-final-consolidado.md` linha 14, "GSI3/GSI4/GSI6 nunca tocados"), e usá-lo aqui exigiria
reabrir uma decisão já `APPROVED` em outro protocolo — fora de escopo desta rodada. **Correção:
reusa GSI5, já alocado a este módulo** (Review Queue + Version lookup, `document-version.ts`),
seguindo o mesmo padrão de discriminação por prefixo que `GSI1` já usa entre Document/Requirement
— um índice físico, múltiplos namespaces lógicos por `GSI5PK` distinto:
```
GSI5PK: TENANT#<t>#DOCFILE-RECON#PENDING_UPLOAD | TENANT#<t>#DOCFILE-RECON#SCANNING
GSI5SK: <deadlineIso>#FILE#<fileId>
```
Consumido pelo mesmo port de Query já usado pela review queue (`document-archive-service.ts` já
depende de GSI5, nenhuma porta/adapter/IAM novo). A transição `PENDING_UPLOAD→SCANNING`
substitui os dois atributos atomicamente na mesma transação que já consolida `versionId` (item
1) — nunca dois ponteiros simultâneos. Toda transação terminal (achado 5, D-143 Decision 6)
inclui `REMOVE GSI5PK, GSI5SK` do próprio `DocumentFile`, e o `Update` do reconciliador condiciona
no par exato observado (`GSI5PK = :observed AND GSI5SK = :observed`), fechando o "candidato
antigo interfere depois da troca de deadline" citado na Rodada 3.

## 4. Contadores — sem mecanismo novo, é o `buildVersionedUpdate` padrão do projeto inteiro

Correção de over-engineering da Rodada 3: não precisa de condição por-campo
(`pendingFileScans = :observedPending`) nem de "quem faz retry" separado — **é exatamente o
padrão de OCC que toda escrita mutável do projeto já usa**, sem exceção nem extensão:
`buildVersionedUpdate({ key: documentVersionKey(...), expectedVersion, set: { pendingFileScans:
current.pendingFileScans - 1, infectedFileScans: current.infectedFileScans + (threat ? 1 : 0),
...(threatFound && terminal ? {} : {}) }, ... })` — a condição `version = :expectedVersion` do
builder já serializa QUALQUER escrita concorrente na mesma Version (seja outro arquivo
terminando, seja uma nova `reserveUpload`), literal como qualquer outro Update do projeto
(D-151 a D-160 usam exatamente isto). Um `ConflictError` na colisão não precisa de um "dono do
retry" novo: o handler Lambda que processa o evento S3/GuardDuty simplesmente deixa o erro
propagar e a invocação falha — SQS nativo (`maxReceiveCount`+DLQ) faz a redelivery, a mesma
política já `APPROVED` e formalizada em D-128 (`AppError.retryable`, nenhum handler ramifica,
retry é sempre nativo do SQS). Nada disto é mecanismo novo desta decisão.

## 5. `acceptVersion()` — precondição do PRINCIPAL como `ConditionCheck` transacional

Fecha a objeção "checagem em memória não basta": a `TransactWriteItems` de `acceptVersion`
(já até 10 ações por D-143 Decision 2) ganha mais um item — `ConditionCheck` no
`DocumentFile` do `principalFileId`, `condition: scanStatus = "CLEAN"`. Se o PRINCIPAL foi
rejeitado entre a leitura e a transação, a transação inteira cancela (`TransactionCanceledException`
→ `ConflictError`, mesmo mapeamento de erro de sempre) — nunca depende só da leitura anterior.

## 6. Recuperação de `DRAFT` com PRINCIPAL infectado — transição nomeada, não hipotética

Achado menor do Codex: se a ameaça for detectada enquanto a Version ainda está em `DRAFT`
(antes de `commitUpload`), `rejectVersion()` hoje só aceita `RECEIVED`/`UNDER_REVIEW` como
origem. Fechado sem mudar o grafo já `APPROVED`: a Rodada anterior já previa o caminho —
`commitUpload()` continua permitido (seu gate é só `fileSetSealed`, nunca depende de scans
completos, achado 4 da Rodada 2) mesmo com um arquivo já `REJECTED`; a Version avança para
`RECEIVED` normalmente e só então `rejectVersion()` a encerra pelo caminho já existente. Nenhuma
transição nova no grafo do D-143 Decision 1 — só a ordem de operações explicitada.

## Síntese

Os 6 achados da Rodada 3 fecham com: 1 regra simétrica (sem contradição), 3 campos novos num
tipo de evento já existente + 1 rename seguro, reversão para GSI5 (nunca emendando D-143
Decision 2), reconhecimento de que os contadores não precisavam de mecanismo novo algum (o
`buildVersionedUpdate` padrão já resolve), 1 `ConditionCheck` a mais numa transação já existente,
e uma clarificação de ordem de operações sem tocar no grafo de estados já aprovado. Nenhuma
extensão a um builder/mecanismo compartilhado usado por M6 ou por qualquer outro módulo.

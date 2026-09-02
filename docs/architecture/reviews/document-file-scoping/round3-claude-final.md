# DocumentFile — Rodada 3 (revisão final Claude)

Nota da Rodada 2: 7,1/10. Achado principal bloqueante: `removeInfectedFile()` era
contraditório e a remoção do PRINCIPAL não tinha caminho de recuperação. Corrigido abaixo —
todos os pontos da Rodada 2 (5 vereditos parciais + 5 achados novos) endereçados um a um.

## Correção central: não existe `removeInfectedFile()` — infecção já É a transição terminal

A Rodada 2 estava certa: um método separado de "remoção" depois do terminal é contraditório.
**Removido por completo.** `THREATS_FOUND` é, ele mesmo, a transição terminal
`SCANNING|PENDING_UPLOAD → REJECTED` (reaproveita literalmente o nome de estado terminal de M6
para "reprovado por evidência" — nunca um estado novo). A mesma transação da seção 3 (Rodada 2)
que decrementa `pendingFileScans`/incrementa `infectedFileScans` **já é** a remoção — não há uma
segunda operação humana depois. `DocumentVersionEvent(type: "FILE_REMOVED_INFECTED", fileId,
fromState: <estado atual da Version, inalterado>, toState: <mesmo valor>)`: evento **reflexivo**
por definição — `DocumentVersionEvent` já registra transições de `DocumentFile`, não só de
`DocumentVersion` (o nome do tipo já diz "FILE_", não "VERSION_") — campo novo `fileId?: string`
adicionado à interface para o carregar. Nenhum humano aciona isso; é 100% consequência
automática do veredito GuardDuty, gravado na mesma transação atômica do arquivo+contadores.

## Achado novo 2 — recuperação de PRINCIPAL infectado: sem reabrir, nova Version

`acceptVersion()` ganha uma pré-condição nova, checada em memória antes de montar a transação
(não uma invariante de escrita nova): `principalFile.scanStatus === "CLEAN"` — se o PRINCIPAL
foi rejeitado, `acceptVersion` lança o mesmo `InvalidDocumentVersionTransitionError`-equivalente
que qualquer outra pré-condição de negócio já lança hoje (contrato existente, sem mecanismo
novo). **Não existe reabertura do conjunto de arquivos selado.** A única recuperação é a que
D-143 Decision 1 já formaliza para qualquer versão inutilizável: `rejectVersion()` a Version
inteira (RECEIVED/UNDER_REVIEW → REJECTED — nunca removível, current fica preservada) e o
chamador começa uma `DocumentVersion` nova via `commitUpload`/`reserveUpload` do zero, com um
novo `seq`. Isso não é um mecanismo novo desta decisão — é a mesma disciplina já `APPROVED` de
"nunca mutar uma Version de volta para DRAFT", generalizada de "arquivo problemático" para
"conjunto de arquivos problemático". Fecha o achado sem introduzir reabertura transacional nova.

## Achado 1 (Rodada 2, gap 2) + achado novo 4 (reconciliação) — condição terminal e GSI6

**Condição da transação terminal corrigida**: `scanStatus IN ("PENDING_UPLOAD", "SCANNING")`
(nunca só `"SCANNING"`) — GuardDuty e a confirmação de upload chegam por caminhos independentes
e podem chegar em qualquer ordem (o próprio ponto central do modelo de evidência dupla de M6,
que a Rodada 2 já tinha citado mas a condição de escrita ainda não refletia). Isso fecha o gap 1
e o gap 1 da seção de invariantes ao mesmo tempo — é a mesma correção.

**GSI6 real, não "dois filtros" vagos**: `DocumentFile` ganha `GSI6PK?`/`GSI6SK?`, mesmo padrão
esparso de `UploadSlot` (presente só enquanto não-terminal, removido na mesma transação que
alcança um estado terminal — nunca um ponteiro morto). Dois valores de `GSI6PK` distintos
(`RECON_DOCFILE_PENDING_UPLOAD` / `RECON_DOCFILE_SCANNING`), `GSI6SK = <deadline ISO>#FILE#
<fileId>` — mesma forma de `GSI6PK_RECON_UPLOAD_PENDING` já existente. O worker ganha uma
segunda função de varredura (`reconcileScanTimeouts()`, ao lado da já existente
`reconcileExpiredReservations()`), paginada do mesmo jeito, terminando com **a mesma transação
terminal da seção anterior** (não uma transação nova) — `TIMEOUT` é só mais um dos valores
possíveis de `scanStatus` alcançado pelo mesmo mecanismo, condicionado por deadline em vez de
evidência GuardDuty.

## Achado 1 (Rodada 2, gap 1) — correlação de evidência declarada explicitamente

Ambos os writers (S3 Object Created / GuardDuty finding) só aceitam evidência cuja tripla
(`bucket+key+versionId`) bate exatamente com `DocumentFile.quarantineObject` **já consolidado**
no momento da escrita — condição explícita na transação (`quarantineObject.key = :observedKey
AND quarantineObject.bucket = :observedBucket`), nunca "presença de evidência" sozinha. Isso é
reafirmação explícita do que a Rodada 2 descreveu em prosa, agora como condição de escrita real,
fechando a lacuna "não basta dizer que reusa `sameObjectVersion()`, precisa estar na condição".

## Achado 3 (Rodada 2, gap 2) — decremento sem `ADD`, mesma disciplina do resto do projeto

Confirmado por leitura de `occ.ts`: `buildVersionedUpdate()` não suporta expressões aritméticas
(`ADD`), só `SET`/`REMOVE` de valores literais — a Rodada 2 estava certa. **Não estender o
builder compartilhado com uma feature nova de aritmética** (mudaria um contrato genérico usado
por todo o projeto, fora do escopo desta decisão). Em vez disso: a mesma disciplina que
`security-audit-purge`/D-153 já usa para entidades sem `version` (`buildConditionalDelete`,
condicionado no valor exato observado) — aqui, condicionar o `Update` em
`pendingFileScans = :observedPending` (o valor lido segundos antes, na mesma leitura que já
busca `DocumentVersion` para montar a transação) e setar `:observedPending - 1` como literal.
Uma corrida entre dois eventos terminais concorrentes para arquivos diferentes da mesma Version
faz o segundo colidir na condição (`TransactionCanceledException` → retry da leitura+transação,
mesmo padrão de retry que qualquer `ConflictError` de OCC já tem em todo o projeto) — nunca
under/overflow silencioso.

## Achado 4 (Rodada 2) — fence completo em `commitUpload()`

`Update` de `commitUpload()` ganha as 3 condições explícitas na mesma expressão:
`state = "DRAFT" AND version = :expectedVersion AND fileSetSealed = :true` — nunca ler-então-
confiar separadamente. TOCTOU fechado.

## Achado 5 (Rodada 2) — placeholder de `versionId` consumido atomicamente

A transição `PENDING_UPLOAD → SCANNING` (S3 Object Created event) é a **única** escrita que
populações `quarantineObject.versionId` com o valor físico real, condicionada em
`scanStatus = "PENDING_UPLOAD"` — consome o placeholder exatamente uma vez, mesma disciplina de
toda transição terminal/condicional deste design. Um evento GuardDuty que chegue antes dessa
consolidação (ordem invertida) é aceito pela condição ampliada `IN (PENDING_UPLOAD, SCANNING)`
da seção acima — não precisa esperar a consolidação para ser processado, só precisa que a tripla
bata com o que foi observado no próprio evento GuardDuty (que carrega sua própria versão física),
nunca com um valor ainda placeholder.

## Síntese

Todos os achados da Rodada 1 e 2 (10 no total, contando os 5 novos da Rodada 2) têm um mecanismo
concreto acima — nenhum ponto ficou só "documentado em prosa" sem uma condição de escrita real
correspondente. Nenhum mecanismo compartilhado (`occ.ts`, `UploadSlotReconciliationWorker`,
buckets/GuardDuty) foi modificado de forma que quebre seu uso por M6 — toda extensão é aditiva
(novo `GSI6PK` distinto, nova função de varredura ao lado da existente, nenhuma mudança de
assinatura de builder compartilhado).

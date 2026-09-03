# Round 3 (Claude) — Final Revision

**Claude's own blind score for Round 2 (recorded now that Codex's Round 2 score, 7.8/10, exists):
7.6/10.** The direction (async convergence, dropped fan-out) was right, but Codex is correct that
I asserted mutual exclusion, tenant-fence inheritance, and outbox delivery that the code doesn't
actually back — three real gaps, not nitpicks, since a delivery-path decision this leans on
literally doesn't exist yet in `outbox.ts`. Addressing all 11 points below.

## 1. Promoção concorrente — não afirmo mais exclusividade mútua

Corrigido: os dois branches (upload-finalizer, malware-result) PODEM ambos observar
`READY_TO_PROMOTE` e ambos executar `CopyObject`. Isto é seguro, não porque só um execute, mas
porque:

- A chave de destino é determinística (`document-archive/clean/<tenantId>/<documentId>/<versionId>/<fileId>`,
  item 4 da Rodada 2) — um segundo `CopyObject` do MESMO source para o MESMO destino é
  idempotente (mesmo conteúdo, nunca dados divergentes).
- `confirmFileScanClean` já é o único portão real (`apply-file-scan-result.ts`'s
  `isNonTerminalFileScanStatus` + `buildVersionedUpdate` OCC): o primeiro `transactWrite` a
  chegar transiciona `SCANNING → CLEAN`; o segundo recebe `isTransactionCanceled` e a chamada
  já teria retornado antes por `isNonTerminalFileScanStatus(file.scanStatus)` ser falso na
  releitura fresca no topo do loop (`confirmFileScanClean`'s primeira linha de cada tentativa) —
  vira `IGNORED_STALE`, comportamento que a função já tem, sem mudança de código.
- O `CopyObject` "perdedor" é trabalho redundante e inofensivo, nunca uma condição de corrida real
  — não há escrita dupla no DynamoDB nem dois eventos S3 diferentes competindo por
  significados diferentes.

Registro explícito (não estava no design): cada branch verifica o objeto copiado (tamanho, e
quando disponível, checksum — mesma disciplina de `advance-after-evidence.ts`) ANTES de chamar
`confirmFileScanClean`, então o segundo `CopyObject` redundante ainda passa pela mesma
verificação antes de tentar confirmar — nunca confirma um objeto corrompido só porque o outro
branch já promoveu.

## 2. Cerca de tenant — adicionada explicitamente, nunca "herdada"

Corrigido: `applyFileScanResult`/`confirmFileScanClean` ganham um novo parâmetro obrigatório
`tenantActiveCondition: TransactConditionCheck` (o MESMO `ConditionCheck` que
`processMalwareResult`/`processSubmissionMalwareResult` já constroem hoje contra o item
`Tenant`) — os dois novos branches passam essa condição explicitamente na MESMA
`TransactWriteItems` que já grava `DocumentFile`/`DocumentVersion`, nunca uma checagem separada
antes da transação (que teria TOCTOU). Isto é uma mudança de assinatura real das duas funções de
`document-archive/application/apply-file-scan-result.ts`, registrada aqui como parte do contrato
desta rodada, não um detalhe de implementação a inventar depois.

## 3. Rollout — ordem de ativação definida, sem janela de eventos perdidos

Corrigido: a Rodada 2 permitia ativar o promoter e o starter em qualquer ordem, criando a janela
que o Codex apontou (arquivo chega a CLEAN, emite seu único evento S3, starter ainda desligado,
extração nunca dispara — sem replay de eventos S3 históricos). Ordem obrigatória, registrada
como sequência de deploy desta decisão (não um detalhe de implementação livre):

1. Deploy do starter novo com o flag `EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED=true` PRIMEIRO
   — nenhum arquivo `document-archive` chega a `CLEAN` ainda (promoter ainda desligado), então o
   starter fica ocioso, sem risco.
2. Só depois, deploy dos dois branches do promoter
   (`DOCUMENT_ARCHIVE_PROMOTION_ENABLED=true`). A partir deste ponto todo arquivo que chega a
   `CLEAN` já tem um listener pronto — nunca existe uma janela onde `CLEAN` acontece sem o
   starter escutando.
3. Nunca a ordem inversa. Esta sequência é o mecanismo que fecha a lacuna — não backfill, não um
   segundo trigger durável: a own ordenação evita o problema por construção.

## 4. Destino real do outbox — definido, seguindo o padrão já estabelecido (D-192)

Corrigido: `outbox.ts` confirma que não existe caminho genérico EventBridge — todo consumidor real
é roteado explicitamente via `OutboxDestination` + `DispatchOutboxRelay` para uma fila SQS
específica (mesmo padrão que `SQS_IMPORT_PARSE_V1`, D-192). Adoto o mesmo padrão, sem inventar
mecanismo novo:

- Novo `OutboxDestination = "SQS_REQUIREMENT_EVIDENCE_REFRESH_V1"` em `outbox.ts`.
- Nova fila SQS `requirement-evidence-refresh-queue` + DLQ, mesmo módulo Terraform
  (`sqs-worker-queue`) já usado por toda fila deste projeto — nenhum módulo de infra novo.
- `DispatchOutboxRelay` ganha uma nova rota (`destination === "SQS_REQUIREMENT_EVIDENCE_REFRESH_V1"`
  → essa fila), mesmo mecanismo de roteamento que já existe para as outras 5 entradas do enum.
- Novo handler `requirement-evidence-refresh-handler.ts` (SQS), IAM escopado só a essa fila +
  leitura/escrita de `Requirement` — mesmo padrão de least-privilege já convencionado
  (`AGENTS.md` §7).
- Payload do evento: `{tenantId, documentId, versionId}` — **deliberadamente NUNCA inclui
  `validUntil`** (ver item 5, o worker sempre relê o valor corrente, o evento é só um "acorde e
  recompute", nunca um portador de valor).

## 5. Worker de refresh — releitura sempre fresca, nunca aplica o payload cegamente

Corrigido o risco de ordem/perda apontado pelo Codex: o worker NUNCA aplica `validUntil` do
payload do evento — ele é só um sinal de "algo mudou, recompute". Em cada tentativa (loop OCC,
mesmo padrão de `applyFileScanResult`):

1. Relê `DocumentVersion` fresca pelo `{tenantId, documentId, versionId}` do evento — se essa
   versão não existe mais ou foi superseded, segue mesmo assim (uma versão superseded ainda pode
   ser a evidência histórica correta de um Requirement, `deriveRequirementStatus` já lida com
   qualquer `DocumentVersionState`).
2. Via `GSI_EVIDENCE` (item 9 da Rodada 2), lista os `Requirement`s cujo item aponta para esse
   `versionId` — mas ANTES de escrever qualquer um, relê CADA `Requirement` individualmente e
   verifica `requirement.evidenceVersionId === versionId` no momento da escrita (não confia na
   entrada do índice sozinha — `GSI_EVIDENCE` é só o candidato, a condição real é a releitura do
   item base). Se o Requirement já foi religado a OUTRA versão ou desvinculado nesse meio-tempo,
   pula silenciosamente (`IGNORED_RELINKED` — nunca sobrescreve um vínculo mais novo).
3. Recalcula `deriveRequirementStatus`/`evidenceValidUntil` a partir da `DocumentVersion` FRESCA
   lida no passo 1, nunca do payload do evento — isto elimina o problema de ordem: um evento
   antigo processado depois de um mais novo simplesmente recalcula o mesmo estado atual e é um
   no-op (escreve o mesmo valor, ou falha a condição de versão OCC e tenta de novo — nunca
   regride o Requirement para um `validUntil` antigo).
4. Escreve via `buildVersionedUpdate` OCC padrão, um Requirement por vez — nunca uma transação
   com N itens.

Isto fecha os dois problemas apontados: eventos fora de ordem (o worker recomputa do estado atual,
nunca aplica um valor "carregado" pelo evento) e a lacuna de eventual consistency do GSI (mesmo
que o índice ainda não reflita um link recém-criado, o PRÓXIMO evento relacionado a essa mesma
`DocumentVersion` — incluindo o disparado pelo próprio `linkEvidence` que criou o link, ver item 9
— vai reencontrá-lo; e a rede de reparo do item 6 fecha o caso residual).

## 6. Rede de reparo autoritativa — o reindex diário passa a reler `DocumentVersion` ao vivo

Corrigido o achado central do Codex ("o reindex diário usa o próprio cache do Requirement, não é
uma rede de reparo real"): o worker diário `requirement-reindex` (D-179/D-185) já existe e já
escaneia todo Requirement `SATISFIED` com `evidenceValidUntil` definido
(`REQUIREMENT_REINDEX_WORK_TYPE`, `requirement.ts`). Mudança mínima e cirúrgica: seu passo de
re-derivação passa a reler a `DocumentVersion` viva (via `evidenceDocumentId`/`evidenceSeq` ou
`evidenceVersionId`, já denormalizados no próprio Requirement) em vez de comparar só
`evidenceValidUntil` cacheado contra `now`. Isso transforma o worker diário, que já roda e já é
aprovado, na rede de reparo autoritativa contra QUALQUER perda de evento/GSI/outbox — o pior caso
de staleness deixa de ser "ilimitado" e passa a ser "até 24h", o mesmo bounded-staleness que
`requirement.ts`'s comentário já aceita para o caso original de tempo passando. Nenhum worker
novo para isto — uma extensão pontual de um worker já existente e já aprovado.

## 7. Cardinalidade — nomeada com precisão, não mais "3-way"

Corrigido: `confirmField` é uma transação de **3 agregados / 4 ações**
(`DocumentVersion` Update, `ExtractionRun` ConditionCheck, `ExtractedField` Update, `Outbox` Put
— só quando `validUntil` realmente muda, ver item 8's checagem de no-op). `rejectField` continua
**2 agregados / 2 ações** (`ExtractionRun` ConditionCheck, `ExtractedField` Update) — nunca emite
outbox, nunca toca `DocumentVersion`. Ambas cardinalidades são FIXAS (não dependem de N
Requirements) — a propriedade que resolve o achado 3.3 do Codex continua válida, só a contagem
estava imprecisa.

## 8. Equivalência auto-confirm vs. manual — planner único, não só o `set`

Corrigido: `buildDocumentVersionValidityUpdate` (Rodada 2) vira um planner mais completo,
`planDocumentVersionValidityEffect`, chamado por AMBOS os caminhos, que decide (não só o `set`):

- **Estados elegíveis**: idêntico para os dois caminhos — `DocumentVersion.state` precisa estar
  em `RECEIVED | UNDER_REVIEW | ACCEPTED` (mesma lista do item 5 da Rodada 2); fora disso, retorna
  `{ effect: "SKIPPED_INELIGIBLE_STATE" }` para os dois caminhos igualmente.
- **No-op check**: se o `confirmedValue` (ou o valor auto-confirmado) produzir o MESMO
  `validUntil` que a `DocumentVersion` já tem, retorna `{ effect: "NO_CHANGE" }` — nem
  `DocumentVersion` nem outbox são escritos (evita bump de OCC e emissão de evento por um valor
  idêntico, para os dois caminhos).
- **`confirmedBy`/`confirmedAt`**: parâmetro explícito do planner (`ctx.identity` no caminho
  manual, `"SYSTEM_AUTOCONFIRM"` no caminho automático) — nunca um default implícito que um dos
  dois caminhos esqueça de passar.
- **Múltiplos campos mapeando para `validUntil`**: `field-schema.ts` já define, por
  `pipelineVersion`, qual `fieldName` é o campo de validade — é uma invariante do schema que
  exatamente zero ou um campo de validade existe por pipeline, nunca um runtime concern; o
  planner recebe o `fieldName` já resolvido pelo schema, nunca decide sozinho "qual campo é
  validade".
- **Emissão do outbox exactly-once lógica**: o `Put` do outbox está na MESMA `TransactWriteItems`
  que o `Update` de `DocumentVersion` — atômico por construção (mesma garantia que
  `AGENTS.md` §7 já exige para todo evento crítico), nunca uma segunda escrita separada em
  nenhum dos dois caminhos.

`doConfirmField` e `commitRunOutcome` chamam o MESMO `planDocumentVersionValidityEffect` e
aplicam o resultado dentro de sua própria `TransactWriteItems` já existente — nenhuma lógica de
decisão duplicada entre os dois.

## 9. PRINCIPAL-only — mantido como política provisória explícita, com idempotência de duplicata

Mantenho a decisão (registrada como decisão de produto REVISÁVEL, não verdade geral — aceito o
enquadramento do Codex). Adiciono o que faltava: duplicatas do PRÓPRIO evento do arquivo
PRINCIPAL (reentrega S3/SQS) são absorvidas pela identidade de `ExtractionRun` já ser chaveada
por `versionId` (item 7 da Rodada 2) através de uma escrita condicional (`attribute_not_exists`)
em `startExtractionRun` — uma segunda tentativa de criar o mesmo `ExtractionRun` falha a condição
e é tratada como sucesso idempotente (mesmo padrão que toda escrita idempotente deste projeto já
usa, `occ.ts`'s builders). Não é mecanismo novo, é a aplicação da identidade já corrigida na
Rodada 2.

## 10. Checklist E-014 — reescrito em propriedades de resultado, não em conformidade com a solução

Aceito o achado do Codex de que o checklist da Rodada 2 avaliava "usa minha solução?" em vez do
resultado. Reescrito:

1. **(peso 25%) Convergência de `Requirement`/`validUntil` sob duplicação, perda temporária,
   reordenação e relink concorrente — bounded e demonstrável, não "eventualmente, sem prazo".**
   Atende: existe um teto explícito de staleness (o reindex diário, item 6) independente de
   qualquer mecanismo de entrega em tempo real funcionar. Não atende: qualquer design cuja única
   rede de segurança seja "o evento chega".
2. **(peso 25%) Nenhuma extração inicia a partir de um objeto S3 não autoritativo.** Atende: o
   starter sempre releitura o estado do agregado antes de agir, nunca confia só na chave do
   evento. Não atende: qualquer caminho que trate o evento S3 como fonte de verdade.
3. **(peso 20%) Cardinalidade de toda transação é fixa, independente de N (Requirements, arquivos,
   candidatos).** Atende: cada transação nomeada tem uma contagem de agregados/ações constante.
   Não atende: qualquer transação cujo tamanho cresça com dados do tenant.
4. **(peso 15%) Política multi-arquivo é uma decisão de produto registrada, explícita e revisável
   — nunca uma omissão.** Atende: PRINCIPAL-only documentado como provisório, com critério claro
   de quando revisar. Não atende: ambiguidade sobre o que acontece com anexos.
5. **(peso 10%) Caminho automático e caminho humano produzem exatamente o mesmo efeito
   observável no agregado de negócio, por construção (planner único), não por convenção.** Atende:
   um único planner decide os dois. Não atende: qualquer lógica de decisão duplicada.
6. **(peso 5%) Proveniência (`confirmedBy`/`confirmedAt`) sempre presente e nunca inferida.**
   Atende: campo obrigatório do planner, nunca opcional.

## Escopo de infraestrutura desta rodada (registrado, não implementado)

Itens 2 (tenant fence), 4 (outbox/fila/handler novos), 6 (extensão do reindex diário) são mudanças
de nível 5 cada (nova fila, novo destino de outbox, mudança de contrato de leitura de um worker já
aprovado) — nenhuma delas nova em relação ao que já foi debatido, mas registro explicitamente que
a implementação de cada uma é trabalho de fase 3 (implementação), não desta rodada de design.

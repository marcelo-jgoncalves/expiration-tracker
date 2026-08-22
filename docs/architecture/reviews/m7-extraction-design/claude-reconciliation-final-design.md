---
status: approved
owner: claude+codex
authority: design
---

# Reconciliação — rodada 3 — M7 runtime design (Extraction e confirmação)

Incorpora as correções de `claude-critique-round2.md` (minha crítica da proposta Codex) e das
observações do Codex sobre minha proposta (nota 6,8/10, gate não atingido por nenhum lado). Este é
o design final proposto para nova avaliação — não uma terceira proposta independente.

## 1. Decisões fechadas (convergência + correções)

### 1.1 Step Functions Standard — convergência, sem mudança

Mantido como ambos propuseram: histórico auditável, custo irrelevante frente a Textract/Bedrock,
`waitForTaskToken` só é viável em Standard.

### 1.2 Textract assíncrono — adoto a proposta Codex integralmente

`StartDocumentTextDetection` → SNS → SQS → `TextractTaskHandler` → `GetDocumentTextDetection`
paginado → artefato transitório → `SendTaskSuccess/Failure`. Meu argumento original (síncrono,
premissa de 1 página/documento do cost-model) estava errado: o limite de produto já aprovado é 50
páginas (`implementation-blueprint.md:1797`), não 1 — o cost-model é estimativa de custo, não teto
funcional. `ClientRequestToken` determinístico
(`sha256(tenantId|documentId|documentVersion|pipelineVersion|runId)`), `JobTag` só com identificador
opaco, `TextractJob` como correlação transitória com TTL curto, task token nunca em log/métrica/DLQ.

**Correção sobre a proposta Codex (achado do próprio Codex na autocrítica + confirmado por mim)**:
falha em `DetectDocumentType` não pode ir direto para `MarkPendingConfirmation` — isso impede o
parser determinístico de tentar produzir um candidato mesmo sem classificação de tipo bem-sucedida.
Novo comportamento: falha em `DetectDocumentType` (ou em `RunTextract`) segue para
`RunDeterministicParser` da mesma forma que uma falha "degradada" já fazia no ASL do Codex para
`RunTextract` — a única falha que vai direto para `MarkPendingConfirmation` sem tentar o parser é uma
falha do próprio `RunDeterministicParser`.

**Correção de responsabilidade (e correção de um bug de sequenciamento apontado pelo Codex na
rodada 4 — nota 8,7, "CLASSIFY_AND_START_OCR → RunTextract(waitForTaskToken) é inconsistente: o job
não pode ser iniciado antes do task token existir")**: `DetectDocumentType` deixa de ser um ASL Task
state separado. A classificação (heurística própria — extensão do arquivo, magic bytes, metadata do
`Document` já persistido em M6; Textract OCR não classifica tipo de documento) vira o **primeiro
passo interno** da própria invocação de `RunTextract` (o único Task state, usando
`arn:aws:states:::lambda:invoke.waitForTaskToken`), na mesma invocação que já recebe o `taskToken` do
Step Functions. Sequência real dentro de uma única invocação de `TextractTaskHandler` (operação
`START_OCR`):

1. classifica o tipo de documento (heurística); se não suportado, chama `SendTaskFailure` com
   `UnsupportedDocumentType` imediatamente (o ASL captura esse erro e segue para
   `RunDeterministicParser`, nunca para `MarkPendingConfirmation` diretamente — ver correção acima);
2. consulta o kill switch `OCR` no AppConfig; se desligado, chama `SendTaskFailure` com
   `OcrDisabled` (ver semântica exata na seção 1.5.1 abaixo);
3. reserva a quota `AI_CALL` idempotente (`tenantId|runId|"TEXTRACT"`);
4. chama `textract:StartDocumentTextDetection`;
5. na mesma escrita, persiste atomicamente a correlação `TextractJob{jobId, taskTokenCiphertext,
   runId, status: "STARTED"}` — só depois disso a invocação retorna (a Lambda NÃO chama
   `SendTaskSuccess` aqui; a Step Functions fica em espera real via `waitForTaskToken`).

O job só é criado DEPOIS que o token já existe (ele é um parâmetro da própria invocação que o
originou), eliminando a inconsistência apontada. Uma segunda invocação de `TextractTaskHandler`
(operação `COMPLETE_OCR`, disparada pela fila SQS de conclusão do Textract, não pelo Step Functions)
busca o `TextractJob` por `jobId`, pagina `GetDocumentTextDetection`, persiste o artefato transitório,
e só então chama `SendTaskSuccess`/`SendTaskFailure` com o `taskToken` recuperado do registro.

### 1.3 Parser de extração: função nova, não extensão de M6 — adoto minha própria correção

`extraction-parser-sandbox-handler`, role própria, leitura só no bucket clean, escrita só no prefixo
transitório do run, sem DynamoDB/Textract/Bedrock/VPC, mesmos limites numéricos de M6 (50
páginas/25MB/512MB/30s) reaproveitados como **biblioteca de funções puras importada** (não reuso da
Lambda `parser-sandbox` em si, que permanece com seu contrato de M6 intocado). Justificativa: mudar
o contrato de saída/IAM de uma função já em produção real (M6, verificada com GuardDuty real) para
servir a um segundo propósito ampliaria seu blast radius sem passar pela reavaliação que essa mudança
mereceria — mais barato criar uma função nova com o mesmo perfil de risco (parsing não confiável de
PDF) do que reabrir M6.

### 1.4 Retenção do texto OCR: classe `EXTRACTION_TRANSIENT` — adoto a proposta Codex

Bucket/prefixo dedicado, criptografado, sem versionamento/backup/replicação, exclusão explícita ao
concluir/falhar/descartar o run, lifecycle S3 de 24h como safety net, nunca entra em DynamoDB/logs/
traces/eventos/DLQ. `privacy-lgpd.md` §4 precisa ganhar esta classe antes da implementação (decisão
Type 1 de privacidade — registrar como item de design aprovado, não pendência a resolver depois).

### 1.5.1 Semântica exata de `OCR=false` (achado explícito do Codex, não fechado até a rodada 4)

Sem suspensão, sem redrive, sem fila de retomada. `OCR=false` no momento em que `RunTextract` executa
significa: **esta passagem do run nunca terá evidência de Textract** — o job não é criado, não fica
"pendente para quando o switch voltar", e ligar o switch de novo depois NÃO retoma automaticamente
runs que já passaram por esse estado. `RunTextract` chama `SendTaskFailure(OcrDisabled)` de imediato,
o ASL segue para `RunDeterministicParser` normalmente, e o run termina (via `NeedsBedrock`/Bedrock se
aplicável) com o warning `PARTIAL_OCR` ausente — mais precisamente um warning novo,
`OCR_SKIPPED_KILL_SWITCH`, diferente de `PARTIAL_OCR` (que significa "Textract rodou mas com
resultado degradado", não "Textract nunca rodou"). Reprocessar um documento cujo run terminou sob
`OCR=false` exige o mesmo mecanismo de qualquer reprocessamento deliberado: nova `pipelineVersion` ou
comando administrativo auditado (seção 7.1 da proposta original do Codex, já adotada) — nunca
automático. Isso é consistente com o resto do sistema: um kill switch desligado no momento da
operação é tratado como "essa evidência específica não existe para esta passagem", o mesmo padrão
que `MalwareResultWorker`/M6 já usa para `malware_protection_enabled=false` (a extração não
"espera" o GuardDuty voltar; ela segue sem essa evidência).

### 1.5 Kill switch AI/OCR: AppConfig real — convergência, nome de módulo corrigido

AppConfig real (não o toggle Terraform de M6), com a nuance do Codex: `OCR=false` bloqueia só o
caminho que depende do artefato OCR, nunca o parser determinístico puro. **Correção**: o módulo
Terraform não se chama `extraction-appconfig` nem `document-appconfig` — o schema já inclui
`WHATSAPP` (`implementation-blueprint.md:1418`, feature de Notification, não de Document/Extraction).
Nome corrigido: `infra/modules/feature-flags` (transversal, não acoplado a um módulo de domínio
específico), com a aplicação AppConfig compartilhada entre qualquer feature que precisar de kill
switch operacional no futuro.

### 1.6 Toggle Terraform do pipeline inteiro: default `false` — adoto a correção do Codex

```hcl
variable "extraction_pipeline_enabled" {
  type        = bool
  default     = false
  description = "Deploy/activation gate for the complete M7 extraction pipeline — default false: feature nova com custo real por chamada, processamento de dado pessoal, e pré-condições externas (RIPD, região/modelo Bedrock, inventário de subprocessadores) ainda não fechadas."
}
```

Concordo com a correção: minha proposta original (`default = true`, espelhando `malware_protection_enabled`)
estava errada por analogia incorreta — GuardDuty é um requisito de segurança não-negociável (por isso
fail-closed força `true` em prod), extração é uma feature de produto opcional cujas pré-condições
externas (RIPD, região, modelo) ainda não estão fechadas. Habilitar por padrão arriscaria disparar
processamento real antes dessas pré-condições.

### 1.7 Confirmação HTTP: rota do Codex + rejeição explícita (minha contribuição) + AI_CALL idempotente

Rota (adoto a hierarquia do Codex, mais clara que a minha):

```http
POST /items/{itemId}/documents/{documentId}/extractions/{runId}/fields/{fieldName}/confirm
POST /items/{itemId}/documents/{documentId}/extractions/{runId}/fields/{fieldName}/reject
```

Duas ações explícitas (`extraction:confirm` cobre ambas na matriz de autorização — a distinção entre
confirmar e rejeitar é de rota HTTP, não de ação de autorização nova). `reject` nunca toca no
`ExpirationItem`, só marca o campo como `REJECTED` com `correctionReason` opcional — nenhuma das duas
rotas aceita atributo arbitrário de item ou JSON Patch (mantido do Codex).

Body de `confirm` (adoto o do Codex, incluindo `expectedRunVersion` que eu não tinha):

```json
{
  "expectedItemVersion": 12,
  "expectedDocumentVersion": 3,
  "expectedRunVersion": 2,
  "expectedFieldVersion": 1,
  "confirmedValue": "2027-03-31"
}
```

Idempotência via header `Idempotency-Key` (padrão já usado em M2/M6), replay da mesma chave retorna
o mesmo resultado sem reexecutar a transação. Respostas HTTP (200/400/403/404/409/422/429/503)
mantidas da proposta Codex.

### 1.8 `AI_CALL` quota: reserva idempotente + reaproveitamento de `TenantQuotaService.release()`

Adoto a chave de idempotência do Codex (`tenantId|runId|providerOperation`) para a reserva de quota
antes de cada chamada paga (Textract, Bedrock), evitando duplo consumo em retry. **Acréscimo meu**:
a compensação de reserva não consumida (erro local antes do envio ao provider) usa
`TenantQuotaService.release()`, já implementado e testado em M6 (`src/modules/identity/application/quota.ts`)
— não precisa de mecanismo novo, só um `quotaType: "AI_CALL"` adicional na mesma chamada.

### 1.9 `BedrockExtractionRequest`: artefato, nunca texto bruto no payload

Correção sobre minha proposta original (que tinha `ocrText: string` como campo direto): o texto OCR
nunca viaja no payload do request/response entre módulos — só uma referência (`textArtifact:
ExtractionArtifactRef`, já como o Codex propôs) que o adapter Bedrock resolve internamente lendo do
bucket transitório com sua própria permissão de leitura escopada. Isso é consistente com §20.5
("documento/OCR/LLM não aparece em telemetria") de forma mais robusta do que meu design original.

### 1.10 Critério `NeedsBedrock` — contrato corrigido na rodada 4 (Codex apontou que a rodada 3 não era implementável)

A rodada 3 definiu a política mas com um contrato que não carregava os dados necessários para aplicar
a regra (c) (ambiguidade de OCR por campo) nem representava avaliação por `fieldName` de forma
estruturada. Contrato corrigido:

```ts
export interface FieldExtractionAssessment {
  readonly fieldName: string;
  readonly required: boolean;
  readonly deterministicCandidate?: ExtractionCandidateField;
  // Candidatos derivados do texto OCR por uma varredura leve (regex/heurística sobre o artefato
  // Textract, NÃO uma segunda chamada a Bedrock) - 0 candidatos = OCR não sugeriu nada para este
  // campo; 1 = sem ambiguidade; 2+ = ambiguidade real (ex. duas datas candidatas no texto).
  readonly ocrCandidates: readonly ExtractionCandidateField[];
}

export interface BedrockDecisionInput {
  readonly fields: readonly FieldExtractionAssessment[]; // um item por campo do schema, obrigatório ou não
  readonly ocrAvailable: boolean; // false quando OCR_SKIPPED_KILL_SWITCH ou job Textract FAILED
  readonly thresholdVersion: string; // versionado junto de pipelineVersion
}

// needsBedrock = true quando existe ao menos um field com required=true tal que:
// (a) deterministicCandidate ausente; OU
// (b) deterministicCandidate.confidence < 0.75; OU
// (c) ocrAvailable === true && ocrCandidates.length > 1 (ambiguidade real de OCR para ESTE campo,
//     nunca confidence isolada de reconhecimento de caractere - Textract confidence é sobre
//     RECONHECIMENTO, não sobre correção semântica do campo).
```

`decide-bedrock.ts` recebe exatamente esse `BedrockDecisionInput` (montado por
`ExtractionValidationTaskHandler`/`RunDeterministicParser` a partir dos candidatos já produzidos,
nunca uma segunda leitura do artefato OCR bruto). Threshold `0.75` e a lista de campos do schema
ficam em `field-schema.ts`, versionados junto com `pipelineVersion`/`thresholdVersion` — mudar o
threshold é uma nova versão de pipeline, nunca um hotfix silencioso.

### 1.11 Isolamento de prompt — adoto a proposta Codex integralmente

API Converse, mensagem `system` versionada e imutável, bloco `user` explicitamente marcado como dado
não confiável, tool `submit_extraction` de schema fechado com escolha forçada, nenhuma tool de
efeito, temperature 0, limite de tokens, validação externa ao modelo. Corpus adversarial de 13 casos
do Codex adotado integralmente, mais um caso novo: **abuso de custo por reenvio repetido do mesmo
documento** (`threat-model.md`, "Cost abuse — D, Média") — teste que confirma que a idempotência de
`ExtractionRun` (mesma chave `tenantId|documentId|documentVersion|pipelineVersion`) realmente
impede reprocessamento pago de um documento inalterado, mesmo sob many retries do evento S3.

## 2. ASL final (delta sobre o do Codex — só os pontos corrigidos)

**Correção da rodada 5** (Codex, nota 8,6: a seção 2 ainda mostrava `DetectDocumentType` como Task
state separado seguido de `RunTextract`, contradizendo a seção 1.3, que já descrevia corretamente um
único estado callback — a seção 2 é a especificação executável e estava desatualizada). `RunTextract`
é o ÚNICO Task state para esta fase; não existe `DetectDocumentType` no ASL:

```yaml
RunTextract:
  Type: Task
  Resource: arn:aws:states:::lambda:invoke.waitForTaskToken
  HeartbeatSeconds: 120
  TimeoutSeconds: 600
  Parameters:
    FunctionName: textract-task:live
    Payload:
      operation: START_OCR   # classifica -> kill switch -> quota -> StartDocumentTextDetection ->
                              # persiste TextractJob, tudo dentro desta única invocação (§1.3)
      taskToken.$: $$.Task.Token
      input.$: $
  Retry:
    - ErrorEquals: [Lambda.ServiceException, Lambda.AWSLambdaException, Lambda.SdkClientException]
      IntervalSeconds: 2
      BackoffRate: 2
      MaxAttempts: 3
      MaxDelaySeconds: 10
      JitterStrategy: FULL
  Catch:
    # UnsupportedDocumentType (classificação), OcrDisabled (kill switch), e qualquer falha do
    # próprio StartDocumentTextDetection - todas seguem para o parser determinístico, nunca direto
    # para MarkPendingConfirmation (correção da rodada 3).
    - ErrorEquals: [UnsupportedDocumentType, OcrDisabled, TextractUnsupportedDocument,
        TextractPartialFailure, TextractJobPersistenceFailed, States.Timeout, States.HeartbeatTimeout,
        States.ALL]
      ResultPath: $.ocrFailure
      Next: RunDeterministicParser
  Next: RunDeterministicParser
```

**Recuperação do intervalo `StartDocumentTextDetection → persistência`** (achado do Codex: não existe
atomicidade real entre uma chamada externa ao Textract e uma escrita DynamoDB — "persiste
atomicamente" na seção 1.3 precisa dessa qualificação): a ordem real dentro do handler é (1) chamar
`StartDocumentTextDetection` com `ClientRequestToken` determinístico (`sha256(tenantId|documentId|
documentVersion|pipelineVersion|runId)`, já definido na proposta Codex) e (2) só então persistir
`TextractJob`. Se (2) falhar após (1) ter sucesso: o handler tenta novamente a escrita (mesma
invocação, retry local antes de propagar erro); se ainda falhar, propaga `TextractJobPersistenceFailed`
(capturado acima, segue para o parser — o job Textract fica órfão, mas nunca bloqueia o run). O
`ClientRequestToken` determinístico é o mecanismo de reconciliação: se `COMPLETE_OCR` receber uma
notificação para um `jobId` sem `TextractJob` correspondente (o caso órfão), ele consulta
`textract:GetDocumentTextDetection` uma vez para confirmar que o job é real, descarta o resultado (não
há run esperando por ele) e não trata isso como erro — é o mesmo `jobId` que `StartDocumentTextDetection`
já teria retornado de forma idempotente para o mesmo `ClientRequestToken` caso o run tentasse de novo.

Todo o resto do ASL (`RunDeterministicParser`, `NeedsBedrock`, `CheckAiKillSwitch`, `RunBedrock`,
`ValidateSchema`/`CompareExtractors`/`PersistExtractedFields` como Task states distintos de
`ExtractionValidationTaskHandler`, `MarkPendingConfirmation`, `CompleteRun`) mantido exatamente como a
proposta Codex — a separação em Task states distintos (em vez do meu colapso original) está certa:
auditoria por estado, `Catch` específico por estágio, e o overhead de invocação é desprezível frente a
Textract/Bedrock.

## 3. Callback tardio, `PARTIAL_SUCCESS` e limpeza da correlação transitória (fechado na rodada 4)

**Callback tardio** (o Textract conclui e a fila SQS entrega a mensagem de conclusão DEPOIS que a
Step Functions já desistiu da task — `HeartbeatTimeout`, `TimeoutSeconds` da execução, ou a execução
inteira já terminou em `MarkPendingConfirmation` por outro motivo): a invocação `COMPLETE_OCR` de
`TextractTaskHandler` sempre tenta `SendTaskSuccess`/`SendTaskFailure` independentemente de quanto
tempo passou; se o token já expirou/a task não existe mais, a API do Step Functions retorna um erro
(`TaskTimedOut`, `TaskDoesNotExist` ou `InvalidToken`) que o handler **captura e trata como sucesso
silencioso** (não relança, não vai para DLQ) — o resultado chegou tarde demais para importar, mas a
mensagem SQS não deve ficar reprocessando para sempre. `InvalidToken` especificamente é logado como
`warn` (não `error`) antes de ser tratado como terminal, porque também pode indicar corrupção real do
`taskTokenCiphertext` — vale monitorar sem tratar como incidente automático.

**Correção da rodada 5 (bug real apontado pelo Codex: "sempre apaga o artefato" apaga cedo demais —
os estados seguintes do ASL, `RunDeterministicParser`/`RunBedrock`, ainda precisam ler o artefato
depois que `SendTaskSuccess` já foi chamado)**. **Correção da rodada 6** (Codex apontou que a
distinção "callback aceito vs. tardio/rejeitado" da rodada 5 ainda tinha uma corrida real:
`TaskTimedOut`/`TaskDoesNotExist`/`InvalidToken` não provam que o run terminou —
`States.HeartbeatTimeout`/`States.Timeout` já levaram a execução para `RunDeterministicParser`/
`RunBedrock` ANTES do callback tardio chegar, então esses estados podem estar lendo o artefato
exatamente quando `COMPLETE_OCR` o apagaria). Regra única, sem distinção de caso — `COMPLETE_OCR`
**nunca** apaga o artefato transitório, em nenhum caminho:

- `COMPLETE_OCR` tenta `SendTaskSuccess`/`Failure` e trata o resultado por tipo de erro — **correção
  da rodada 7** (Codex: os 3 erros terminais não são os ÚNICOS erros possíveis de `SendTask*`;
  throttling/indisponibilidade/timeout de rede são transitórios e exigem retry via redelivery SQS,
  que só funciona se o token ainda existir):
  - sucesso, ou erro terminal (`TaskTimedOut`, `TaskDoesNotExist`, `InvalidToken` — este último
    logado `warn`, não `error`): zera `TextractJob.taskTokenCiphertext` de forma condicional/idempotente
    (`UpdateItem` com `attribute_exists`/valor atual, tolerando entregas SQS concorrentes da mesma
    mensagem) — nenhum desses casos tem uma segunda chance de usar o token, então não há razão para
    preservá-lo.
  - qualquer outro erro de `SendTask*` (throttling, indisponibilidade, timeout de rede): **mantém**
    `taskTokenCiphertext` intacto e relança o erro — a mensagem SQS volta para a fila (redelivery
    normal, mesma política de DLQ das outras filas do sistema) e uma tentativa futura ainda encontra
    o token persistido para tentar de novo.
- O artefato transitório é apagado **só** por `ExtractionValidationTaskHandler`, no mesmo passo
  lógico que leva o run a um estado terminal (`CompleteRun`, `MarkPendingConfirmation` em caminho
  `FAILED`, ou descarte por exclusão concorrente) — o único ponto do sistema que sabe com certeza que
  nenhum estado subsequente vai mais ler o artefato, porque não há mais nenhum estado subsequente.
  Isso vale igualmente para o caminho onde o callback nunca chegou a tempo (o run seguiu via
  `RunDeterministicParser` sem OCR) — nesse caso o artefato do Textract pode nem ter chegado a ser
  criado, ou existir órfão; de qualquer forma, `ExtractionValidationTaskHandler` é quem decide, no
  fechamento do run, se um artefato associado existe e o remove.
- O restante do registro `TextractJob` (`jobId`, `status`, timestamps, sem o ciphertext) persiste só
  até o TTL curto já definido, para fins de diagnóstico/reconciliação (ver §2).
- O lifecycle S3 de 24h (§1.4/2.6 da proposta original) continua como safety net para qualquer
  artefato que escape dessa limpeza explícita (run que nunca chega a um estado terminal por bug).

**`PARTIAL_SUCCESS`** (Textract processou parte das páginas com sucesso): tratado como um resultado
utilizável, não como falha — os blocos disponíveis alimentam `RunDeterministicParser`/Bedrock
normalmente, e `ExtractionCandidate.warnings` ganha `PARTIAL_OCR` com as páginas afetadas
(`GetTextractResultPage.warnings`, já presente no contrato da proposta Codex). Nunca é promovido a
`FAILED` só por ser parcial — o run pode ainda terminar `COMPLETED` com campos `PENDING_CONFIRMATION`
e o warning visível para quem for confirmar.

## 4. Itens que ficam registrados como pendência explícita (não bloqueiam a aprovação do design, mas bloqueiam ativar `extraction_pipeline_enabled=true` em produção)

1. Escolha e validação de modelo Bedrock + região (UNK-003-like, pesquisa externa).
2. RIPD formal para uso de IA/OCR sobre documento de titular (`privacy-lgpd.md` §6, gatilho já registrado).
3. Comportamento de job Textract "preso" (nunca recebe callback dentro do `HeartbeatSeconds`) —
   coberto pelo `HeartbeatTimeout` do Step Functions já no ASL (trata-se como falha e segue para
   `RunDeterministicParser`, mesma política de qualquer outra falha de `RunTextract`); o runbook
   operacional para calibrar esse timeout com volume real fica para quando M7 tiver dados reais,
   mesmo espírito do que M3 fez com tolerância de dispatch.

**Correção de ordem (achado do Codex na rodada 4)**: a atualização de `privacy-lgpd.md` §4 com a
classe `EXTRACTION_TRANSIENT` NÃO é uma pendência que bloqueia só produção — é uma decisão Type 1 de
privacidade que precisa estar registrada na fonte normativa **antes de qualquer implementação**
(mesmo em `dev`), não depois. Removida da lista de pendências "bloqueiam só produção": passa a ser
pré-requisito de início de implementação, junto com o restante deste documento de design.

Só os itens 1 e 2 acima (modelo/região Bedrock, RIPD formal) bloqueiam exclusivamente a ativação real
em produção (`extraction_pipeline_enabled=true` fora de `dev`) — exatamente como o toggle foi
desenhado para permitir testar em `dev` sem essas pré-condições externas resolvidas.

## 5. Encerramento do protocolo (7 rodadas)

Histórico de notas: proposta Claude round1 avaliada pelo Codex em **6,8/10** (gate não atingido);
reconciliação round3 avaliada pelo Codex em **8,7 → 8,6 → 8,8 → 8,9 → 9,3/10** ao longo de 5 correções
pontuais reais (sequenciamento `RunTextract`/`waitForTaskToken`, semântica de `OCR=false`, contrato
de `NeedsBedrock`, callback tardio/`PARTIAL_SUCCESS`, e duas iterações sobre a corrida de limpeza do
artefato/token transitório — a última delas, distinguir erro terminal de transitório em `SendTask*`,
foi o achado que efetivamente fechou o gate).

**Nota final Codex: 9,3/10 — gate atingido, declarado pelo Codex.**

**Nota final Claude: 9,2/10.** Cada uma das 5 correções pontuais foi uma falha real que eu não tinha
fechado nas rodadas anteriores (não é o Codex sendo excessivamente rigoroso) — a mais séria foi a
corrida de limpeza do artefato OCR, que se implementada como propus na rodada 5 teria causado uma
falha real e intermitente em produção (leitura de um artefato já deletado, exatamente o tipo de bug
que não aparece em teste unitário e só se manifesta sob timing real, como os bugs reais que o
exercício de Camada 3 de M6 encontrou). Não chego a 9,5+ porque a política de retry do Textract job
"preso" (item 3 da seção 4) permanece como runbook a calibrar com volume real, não uma decisão
fechada — aceitável para aprovação de design (é um item operacional, não estrutural), mas impede uma
nota mais alta.

**Ambos ≥9,0, sem arredondamento — GATE ATINGIDO. Protocolo Claude↔Codex para o design de runtime de
M7 (Extraction e confirmação) concluído em 2026-08-22, 7 rodadas (1 proposta independente de cada
lado + 1 crítica cruzada + 5 correções pontuais de reconciliação).**

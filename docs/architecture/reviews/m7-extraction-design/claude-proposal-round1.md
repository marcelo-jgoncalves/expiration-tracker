---
status: proposal-round1
owner: claude
authority: design
---

# Proposta Claude — rodada 1 — M7 runtime design (Extraction e confirmação)

Tradução do design conceitual já aprovado (`implementation-blueprint.md` §12/§19/§23.1, `data-model.md`
ExtractionRun/ExtractedField, `threat-model.md` lacuna #2, `architecture-fase3-consolidada.md` §10/D-019)
em runtime real: Terraform + TypeScript (ADR-0009 — nunca CDK, o layout do blueprint em `src/step-functions/`
é da era CDK e deve ser adaptado). Esta proposta é independente — não vi a proposta do Codex.

## 1. Escopo e por que Step Functions Standard (não Express)

`architecture-fase3-consolidada.md` §10 deixou a escolha Standard/Express para um "ADR dedicado" que nunca
foi escrito; `implementation-blueprint.md` §12.5 já assume Standard no texto (`:1080`) e no stack principal
(`:6`). Adoto Standard aqui, formalizando o que o blueprint já assumiu, pelos mesmos motivos que o tornam
a escolha certa para este pipeline: execuções podem esperar minutos (Textract assíncrono, ver §3), Standard
tem histórico de execução auditável nativamente (relevante para o critério de auditoria de extração
confirmada/rejeitada, `:1215`) e o custo por transição (~US$0,000025) é irrelevante frente ao custo de
Textract/Bedrock por documento (~US$0,0019-0,005, `cost-model.md:40`). Express exigiria reimplementar
auditoria de execução em CloudWatch Logs — não vale a troca para um pipeline de baixo volume por item
(1 execução por documento, não por request).

## 2. Máquina de estados — ASL real

12 estados fechados por `implementation-blueprint.md` §12.5, mas o ASL real precisa de Retry/Catch que o
blueprint não especifica (lacuna real identificada). Proposta:

```
LoadMetadata (Pass, dados já vêm no input de ExtractionStarterWorker)
  -> DetectDocumentType (Task: TextractTaskHandler, Retry: Textract.ThrottlingException/ServiceUnavailable
     3x backoff exponencial; Catch: -> MarkPendingConfirmation com reason=TEXTRACT_FAILED)
  -> RunTextract (Task: TextractTaskHandler, TimeoutSeconds: 120, mesma política de Retry/Catch)
  -> RunDeterministicParser (Task: PdfParserTaskHandler, TimeoutSeconds: 30 — mesmo limite de parede do
     sandbox M6 (`parser-sandbox`), Catch: -> MarkPendingConfirmation reason=PARSE_FAILED)
  -> NeedsBedrock? (Choice: baseado em confidence do parser determinístico E do Textract — só chama Bedrock
     quando ambos concordam mas confidence < threshold, OU quando divergem)
       -> [precisa] CheckAiKillSwitch (Task: BedrockExtractionTaskHandler, primeira linha da função)
            -> [desligado] MarkPendingConfirmation reason=AI_DISABLED (nunca falha silenciosamente)
            -> [ligado] RunBedrock (Task: BedrockExtractionTaskHandler, TimeoutSeconds: 60, Retry:
               Bedrock.ThrottlingException 3x, Catch: -> MarkPendingConfirmation reason=BEDROCK_FAILED)
       -> [não precisa] ValidateSchema direto
  -> ValidateSchema (Task: ExtractionValidationTaskHandler)
  -> CompareExtractors (Task: mesma função, mesmo passo lógico — ver nota abaixo)
  -> PersistExtractedFields (Task: mesma função)
  -> [ramo] MarkPendingConfirmation | CompleteRun
```

Nota sobre estados 8-10: o blueprint (`:1099`) já decidiu que `ValidateSchema`/`CompareExtractors`/
`PersistExtractedFields` compartilham `ExtractionValidationTaskHandler` por superfície de IAM — na prática
isso é **uma única invocação Lambda** que executa os três passos internamente (validar → comparar →
persistir), não três Task states separados chamando a mesma função três vezes (overhead de invocação sem
ganho de auditoria, já que o resultado de cada sub-passo não precisa ser visível separadamente no histórico
de execução). Ajuste ao ASL: colapso os "estados" 8-10 do blueprint em um único Task state
`ValidateAndPersist`, mantendo a distinção lógica só no código da função. `MarkPendingConfirmation` e
`CompleteRun` continuam sendo o resultado dessa mesma invocação (branch de saída via `ResultSelector`), não
Task states adicionais.

`TimeoutSeconds` no nível da execução inteira: 900s (15 min) — cobre o pior caso de Textract assíncrono
(ver §3) sem deixar uma execução travada indefinidamente ocupando `ExtractionRun.status=RUNNING`.

## 3. Textract: síncrono, não assíncrono — decisão real que a Fase 3 deixou em aberto

`architecture-fase3-consolidada.md` §10 apontou "semântica de integração com Textract assíncrono" como não
decidida. Decido aqui: **síncrono** (`DetectDocumentText`/`AnalyzeDocument` request-response direto, não
`StartDocumentTextDetection`+SNS+callback), pelos seguintes motivos:
- `cost-model.md` assume 1 página/documento (`:6`); a API síncrona do Textract suporta até 1 página para
  `DetectDocumentText` sem limite artificial de tamanho de arquivo relevante aqui (documentos ≤10MB, já
  garantido por M6's `MAX_UPLOAD_BYTES`), e multi-página fica para quando o limite realmente for atingido
  (o próprio cost-model já avisa que documentos multi-página mudam a conta linearmente — decisão explícita
  de não resolver isso agora).
- Síncrono elimina a necessidade de um segundo mecanismo de callback (fila SNS→SQS→Lambda) só para acoplar
  o resultado de volta à execução Step Functions — a `TaskToken`/callback pattern do Step Functions existe
  exatamente para esse caso, mas adiciona uma superfície de estado (job pendente, timeout de callback nunca
  recebido) que o volume atual (Stage 0-3, `cost-model.md`) não justifica.
- Se documentos multi-página se tornarem reais, a migração para `StartDocumentTextDetection` fica isolada
  dentro de `TextractTaskHandler` — o contrato do estado `RunTextract` (input/output) não muda.

## 4. Interfaces de client que faltam no blueprint

```ts
// src/modules/extraction/ports/textract-client.ts
export interface TextractDetectRequest {
  readonly bucket: string;
  readonly key: string;
  readonly versionId: string;
}
export interface TextractLine {
  readonly text: string;
  readonly confidence: number; // 0-100, shape nativo do Textract
  readonly boundingBox?: { top: number; left: number; width: number; height: number };
}
export interface TextractResult {
  readonly lines: TextractLine[];
  readonly documentTypeHint?: string; // heurística própria, Textract não classifica tipo de documento
}
export interface TextractClient {
  detectText(request: TextractDetectRequest): Promise<TextractResult>;
}

// src/modules/extraction/ports/bedrock-extraction-client.ts (nomes de campo que o blueprint não define)
export interface BedrockExtractionRequest {
  readonly ocrText: string; // já redigido/truncado antes de sair do processo — nunca o objeto S3 bruto
  readonly deterministicCandidate?: ExtractionCandidateValue; // o que o parser já extraiu, como contexto
  readonly fieldSchema: { name: string; type: "DATE" | "STRING" | "NUMBER" }[]; // schema fechado, nunca livre
  readonly promptVersion: string; // versionado explicitamente (expand/contract, §20.3)
}
export interface ExtractionCandidateValue {
  readonly fieldName: string;
  readonly value: string;
  readonly confidence: number; // 0-1, normalizado (diferente da escala 0-100 do Textract)
}
export interface ExtractionCandidate {
  readonly fields: ExtractionCandidateValue[];
  readonly modelId: string; // qual modelo Bedrock respondeu, para auditoria/custo
}
export interface BedrockExtractionClient {
  extract(request: BedrockExtractionRequest): Promise<ExtractionCandidate>;
}
```

**Isolamento de prompt (threat-model `:36`, prompt injection, ainda pendente)**: `ocrText` nunca é
interpolado como instrução — o prompt real (mantido fora do texto do documento) usa um template fixo com
`ocrText` como um bloco de dados delimitado explicitamente (ex. tags XML-like `<document_text>`) e uma
instrução de sistema que diz literalmente para tratar tudo dentro do bloco como dado, nunca comando. Testes
adversariais (injetar "ignore previous instructions" no corpo de um PDF de teste) fazem parte da suíte de
`BedrockExtractionTaskHandler` — fecha a lacuna residual do threat model.

## 5. Domínio: `ExtractionRun`/`ExtractedField` (TS)

Espelha exatamente `data-model.md` (PK/SK já definidos), seguindo o padrão de `src/modules/document/domain/`:

```ts
// src/modules/extraction/domain/extraction-run.ts
export type ExtractionRunStatus = "RUNNING" | "COMPLETED" | "FAILED" | "DISCARDED";
export interface ExtractionRun {
  readonly tenantId: string;
  readonly documentId: string;
  readonly runId: string;
  readonly documentVersion: number;
  readonly pipelineVersion: string;
  readonly status: ExtractionRunStatus;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly version: number; // OCC, todo agregado mutável tem (§20.2)
}

// src/modules/extraction/domain/extracted-field.ts
export type ExtractedFieldOrigin = "DETERMINISTIC" | "AI" | "MANUAL";
export type ExtractedFieldState = "PENDING_CONFIRMATION" | "CONFIRMED" | "REJECTED";
export interface ExtractedField {
  readonly tenantId: string;
  readonly documentId: string;
  readonly runId: string;
  readonly fieldName: string;
  readonly valueType: "DATE" | "STRING" | "NUMBER";
  readonly candidateValue: string;
  readonly confidence: number;
  readonly sources: ExtractedFieldOrigin[]; // pode ter mais de uma origem quando concordam
  readonly agreement: "MATCH" | "DIVERGENT" | "SINGLE_SOURCE";
  readonly state: ExtractedFieldState;
  readonly confirmedValue?: string; // preenchido só após confirmação humana, pode diferir do candidato
  readonly confirmedBy?: string;
  readonly confirmedAt?: string;
  readonly extractorVersion: string;
  readonly promptVersion?: string; // só quando sources inclui AI
  readonly schemaVersion: string;
  readonly version: number;
}
```

Idempotência da execução (não do campo individual, `data-model.md:86`): chave
`tenantId|documentId|documentVersion|pipelineVersion` via `putIfAbsent` no `ExtractionRun` — mesmo padrão
de `IdempotencyStore` mas usando o próprio agregado como registro de idempotência (`ExtractionRun` já É o
registro; não precisa de uma entidade `IdempotencyRecord` paralela), já que o blueprint não define chave
de idempotência própria por campo.

## 6. Rota HTTP para `extraction:confirm` (lacuna real, sem rota no blueprint)

```
POST /items/{itemId}/documents/{documentId}/fields/{fieldName}/confirm
Body: { runId: string, confirmedValue: string, expectedItemVersion: number,
        expectedDocumentVersion: number, expectedFieldVersion: number }
```

Segue exatamente os 5 passos de `implementation-blueprint.md:1139-1145`: leitura consistente de
item+documento+run+campo; `authorize(ctx, "extraction:confirm")`; verificação das 3 versões esperadas;
`TransactWriteItems` único que marca o campo `CONFIRMED` e (se o campo mapear para `dueDate`) atualiza o
`ExpirationItem` + publica `ItemDueDateChanged` via outbox na mesma transação (reaproveita
`buildVersionedUpdate`/outbox de M2, nenhuma primitiva nova). Divergência de qualquer uma das 3 versões
→ `ConflictError` (409), nunca um merge silencioso — mesma disciplina de OCC já usada em M2/M6.

Rejeição (`extraction:confirm` cobre confirmar OU rejeitar, ação única na matriz):
`REJECTED` não toca no `ExpirationItem`, só marca o campo — permite o usuário dizer "esse valor está
errado, vou preencher manualmente" sem side-effect automático.

## 7. Kill switch AI/OCR — AppConfig real ou reaproveitar o padrão M6?

Decisão: **AWS AppConfig real**, não o padrão de variável Terraform booleana (`malware_protection_enabled`)
usado em M6. Diferença que justifica isso: o kill switch de M6 é uma decisão de infraestrutura fixada no
deploy (dev liga/desliga GuardDuty entre exercícios, muda via `terraform apply`); o kill switch AI/OCR do
blueprint é operacional em produção (`:1774`, runbook "desligar AI/OCR/WhatsApp" — uma ação de
resposta a incidente, não uma reconfiguração de ambiente) e precisa surtir efeito **sobre chamadas já
enfileiradas** (`:1684`) sem reploy. Isso é exatamente o caso de uso do AppConfig (feature flag consultada
em runtime, refresh em segundos, sem `terraform apply`). Módulo Terraform novo: `document-appconfig`
(aplicação AppConfig + perfil de configuração + estratégia de deployment `AppConfig.AllAtOnce` — mudança de
flag operacional deve ser instantânea, não gradual). `BedrockExtractionTaskHandler` consulta via
`@aws-sdk/client-appconfigdata`, cache curto (60s, conforme `:1409` "cache curto, refrescar antes de cada
operação cara"), fail-closed (`AI_EXTRACTION`/`OCR` = `false` se a chamada ao AppConfig falhar).

Quota `AI_CALL` (`data-model.md:100`, `TenantQuota` já prevê este `quotaType`): reaproveita
`TenantQuotaService` de M1/M6 sem mudança de shape, só um novo `quotaType` na chamada.

## 8. Sandbox do parser determinístico — reaproveita a infra do M6, não recria

`PdfParserTaskHandler` tem os MESMOS limites numéricos já implementados em M6's `parser-sandbox-handler`
(50 páginas, 25MB descomprimidos, 512MB memória, 30s parede — `implementation-blueprint.md:1797` bate
exatamente com o que M6 já implementou para validação estrutural). Proposta: **estender** a função
`parser-sandbox` existente com uma segunda responsabilidade (extração de campos candidatos via regex/
heurística determinística sobre o texto, não só validação estrutural), em vez de criar uma função irmã
duplicada — mesmo isolamento de IAM (sem VPC, sem DynamoDB, sem bucket limpo), reaproveitando os guardrails
de `pdf-lib` já testados. Alternativa rejeitada: função nova `pdf-field-parser` separada — rejeitada porque
duplicaria toda a superfície de sandbox (lambda-function module, limites, testes) sem ganho de isolamento
adicional (mesma superfície de risco: parsing não confiável de PDF).

## 9. Retenção de texto OCR intermediário (lacuna em privacy-lgpd.md)

`privacy-lgpd.md` §4 define `USER_DOCUMENT` para Document/S3/campos/runs mas não menciona texto OCR bruto
explicitamente. Decisão: **não persistir texto OCR bruto em S3 ou DynamoDB fora do necessário** — o texto
que o Textract retorna síncronamente (§3) vive só na memória da execução Step Functions (passado entre
estados via `ResultPath`, nunca escrito em S3 como artefato próprio) e é descartado ao fim da execução; só
os `ExtractedField.candidateValue` (valores já estruturados, não o texto corrido) persistem, sob a classe
`USER_DOCUMENT` já definida. Isso é consistente com `implementation-blueprint.md:1120` ("Conteúdo OCR não
entra em logs ou eventos") e simplifica a lacuna: não existe uma classe de retenção separada para OCR
porque OCR bruto nunca é um artefato persistido.

## 10. Toggle de custo (padrão M6, adaptado)

Espelhando a decisão de custo real do M6 (`malware_protection_enabled`): variável Terraform
`extraction_pipeline_enabled` (default `true`) que, quando `false`, remove o `aws_sfn_state_machine` e as
4 Lambdas de extração inteiramente — documentos promovidos a `CLEAN` (M6) simplesmente não disparam
`ExtractionStarterWorker` (a regra EventBridge do evento S3 do bucket limpo não existe). Diferente de
`malware_protection_enabled` (fail-closed force `true` em prod), este toggle não tem essa restrição — é
aceitável ter extração desligada em prod temporariamente (feature não essencial ao core do produto, ao
contrário de malware scanning que é um requisito de segurança não-negociável). AI/OCR continuam com seu
próprio kill switch operacional (AppConfig, §7) independente deste toggle de infraestrutura.

## Resumo do que esta proposta fecha (lacunas reais identificadas antes de escrever)

1. Retry/Catch/timeout do ASL (blueprint só dava a tabela de 12 estados)
2. Textract síncrono vs assíncrono (Fase 3 deixou aberto)
3. `TextractClient`/`BedrockExtractionRequest`/`ExtractionCandidate` com campos reais
4. Rota HTTP de confirmação (não existia)
5. AppConfig real para kill switch AI/OCR vs reaproveitar padrão Terraform do M6
6. Reaproveitamento do sandbox parser-sandbox do M6 em vez de duplicar
7. Retenção de OCR intermediário (resolvido como "nunca persiste bruto")
8. Isolamento de prompt contra prompt injection + testes adversariais
9. Toggle de custo de infraestrutura (`extraction_pipeline_enabled`) separado do kill switch operacional (AppConfig)

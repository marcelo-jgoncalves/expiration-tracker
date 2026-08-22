---
status: draft
owner: engineering
authority: evidence
---

# Proposta Claude (rodada 1, nota cega) — M6 runtime design (Document upload e malware boundary)

Escopo: como M3.5 foi para o Reminder Engine, este design traduz o §12.1-12.4/12.6-12.7 do
`implementation-blueprint.md` (upload+quarentena+malware — **não** §12.5, extração, que é M7 e
depende de M6 existir) em runtime real (Terraform + Lambda + testes). O design conceitual
(interfaces, máquina de estado, limites de IAM, critérios de aceite) já está aprovado — este
round NÃO reabre essas decisões, só decide como implementá-las de verdade nesta stack (Terraform/
ADR-0009, mesmo padrão dos outros milestones reais).

## Escopo exato (M6 real = blueprint M5 original)

Dentro: `reserveUpload` (quota+slot+presigned URL), `UploadFinalizerWorker`, sandbox de parsing
PDF (§12.4), `MalwareResultWorker`, `UploadSlotReconciliationWorker`, exclusão lógica (§12.6,
sem a parte de invalidar execução de extração — isso não existe ainda). Fora: tudo de §12.5
(Step Functions, Textract, Bedrock, `ExtractedField`, confirmação humana) — isso é M7.

## 1. Infraestrutura Terraform (2 módulos novos)

### `infra/modules/document-buckets`
- 2 buckets S3: quarentena (`exptrk-<env>-documents-quarantine`) e limpo
  (`exptrk-<env>-documents-clean`) — nunca um bucket único com "pastas" lógicas, para que a
  fronteira de confiança seja também uma fronteira de IAM/bucket policy real, não convenção.
- Quarentena: Block Public Access total, versionamento OFF (objetos são efêmeros — promovidos
  ou rejeitados, nunca hospedados ali por muito tempo), SSE-S3, lifecycle de expiração agressiva
  (ex. 7 dias) para qualquer objeto nunca finalizado (defesa em profundidade contra slot
  vazado/nunca reconciliado).
- Limpo: Block Public Access total, versionamento ON (documentos reais, precisa de histórico),
  **SSE-KMS** (já decidido, Type 1 APPROVED — `architecture-fase3-consolidada.md` §7/D-016 e
  `threat-model.md` "Leaked documents": "Dois buckets privados, SSE-KMS" — não reabrir).
  Quarentena também usa SSE-KMS pela mesma decisão (o documento já existe fisicamente ali antes
  de ser classificado como CLEAN, mesma exposição de PII em trânsito para o scan).
- Lifecycle de expiração da quarentena alinhado com `privacy-lgpd.md` §4 (classe `TRANSIENT`):
  **24h para slot incompleto** (nunca confirmado), não os 7 dias genéricos que eu tinha proposto
  antes de checar a matriz de retenção real — usar o número já decidido.
- **GuardDuty S3 Malware Protection** habilitado especificamente no bucket de quarentena
  (`aws_guardduty_malware_protection_plan`, feature relativamente nova do provider AWS — GuardDuty
  varre objetos no upload e marca tags/publica finding). Já é o mecanismo principal DECIDIDO
  (`architecture-fase3-consolidada.md` §7: "GuardDuty Malware Protection for S3 como mecanismo
  principal... Fargate scanner isolado como fallback só se GuardDuty não cobrir") — Fargate
  scanner fica fora do escopo desta entrega a menos que a Camada 3 real prove uma lacuna de
  cobertura real do GuardDuty (ex. tipo de arquivo não suportado além do que já vira
  `UNSUPPORTED` por design).
- EventBridge rule real capturando o finding do GuardDuty (`GuardDuty Malware Protection Object
  Scan Result`) → SQS → `MalwareResultWorker` (mesmo padrão de fila+DLQ+idempotência já usado em
  M3.5/M4, não um mecanismo novo).

### Capabilities novas no padrão `scoped-lambda-function`
- `documentQuarantineWrite()` — só a role que gera a presigned URL (via política do próprio S3,
  não do Lambda que só assina) e o `UploadFinalizerWorker` (`s3:GetObject`+`s3:PutObject` restrito
  ao bucket de quarentena).
- `documentCleanRead()`/`documentCleanWrite()` — só `MalwareResultWorker` (escreve, promove) e o
  futuro pipeline de extração M7 (lê) — nenhum handler de negócio hoje precisa ler o bucket
  limpo diretamente (o item guarda metadados, não o conteúdo).
- Nenhuma role de negócio (items-handler etc.) ganha `s3:GetObject` em nenhum dos 2 buckets —
  confirma o critério de aceite do blueprint ("worker de negócio não consegue ler quarentena").

## 2. Handlers Lambda (4 novos, mesmo padrão fino dos existentes)

1. `documents-handler` (HTTP, `POST /items/{itemId}/documents`) — chama `DocumentService.reserveUpload`
   (lógica pura nova em `src/modules/document/`), gera a presigned URL real via
   `@aws-sdk/s3-request-presigner`.
2. `upload-finalizer-handler` (S3 event notification real da quarentena, não polling) — valida
   conforme §12.3, transiciona slot/documento.
3. `malware-result-handler` (SQS, do EventBridge rule acima) — aplica resultado, promove ao
   bucket limpo com role dedicada (cópia real, não move — nunca se apoia em referência cruzada
   de bucket).
4. `upload-slot-reconciliation-handler` (EventBridge Scheduler, mesmo padrão do
   `reminder-claim-reconciliation`) — restitui slots `PENDING` vencidos.

## 3. Sandbox de parsing PDF (§12.4) — decisão de runtime real

Proponho um `parser-sandbox-handler` Lambda **dedicado**, sem VPC (não "com egress negado" via
NAT — mais simples e mais barato que provisionar VPC+NAT só para negar egress; sem VPC uma
Lambda não tem rota de saída à internet por padrão, exceto para outros serviços AWS via IAM,
que essa função também não deve ter). IAM: nenhuma permissão além de `s3:GetObject` no objeto de
entrada específico (não no bucket) e `s3:PutObject` no destino do resultado. Limites já
DECIDIDOS em `implementation-blueprint.md` §23.1 (não valores a inventar nesta rodada): **máx.
50 páginas, máx. 25MB descomprimido, 512MB de memória, timeout de parede 30s**. Biblioteca de
parsing determinística fixada por versão exata, não `^`/`~` no `package.json`.

## 4. Testes (3 camadas, mesmo padrão M3.5)

- Camada 1: lógica pura de `DocumentService`/máquina de estado, testes de contrato para os
  schemas novos (`document-upload-reserved.v1`, evento de malware, etc.).
- Camada 2: `DynamoDbDocumentStore` contra DynamoDB Local (mesma suíte `dynamodb-integration`
  já existente).
- Camada 3 (real, quando decidido): upload real de um arquivo EICAR (padrão da indústria para
  testar antivírus sem malware real) contra o bucket de quarentena real, confirmando que o
  GuardDuty real marca como ameaça e o objeto nunca é promovido — teste real de todo o pipeline
  de segurança, análogo ao teste de IAM negativo já feito para GSI3/GSI6.

## Perguntas genuinamente abertas para a rodada (verifiquei e as 3 anteriores já eram decisão
## fechada — corrigido acima, não reabrir)

1. `aws_guardduty_malware_protection_plan` é relativamente novo no provider AWS — vale confirmar
   suporte real no provider `~> 5.0` já pinado antes de comprometer o design a ele (pode exigir
   subir a versão do provider — mudança de dependência, não decisão de arquitetura, mas real).
2. Tamanho máximo de upload: `capacity-model.md:275` marca **10MB como ASSUMPTION explícita,
   "a confirmar em ADR de upload (Fase 3)"** — nunca formalmente decidido. Proponho fechar isso
   nesta rodada (10MB, consistente com o resto do capacity model) em vez de deixar como
   suposição perpétua.
3. Fila real para `MalwareResultWorker`: o finding do GuardDuty chega via EventBridge — SQS
   intermediário (meu proposto) ou EventBridge→Lambda direto (mais simples, sem fila/DLQ
   própria)? Os outros workers deste projeto sempre usam fila+DLQ para idempotência/retry
   (`§26` já define concorrência 5 + DLQ idempotente por `objectKey` para este worker
   especificamente) — então fila real parece already-decided pelo apêndice, não uma pergunta
   real. Mantenho SQS, listo aqui só para o Codex confirmar que leu o mesmo apêndice.

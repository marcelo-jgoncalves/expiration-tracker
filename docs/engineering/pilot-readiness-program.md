# Pilot Readiness Program — backlog e estado por item

> Documento canônico do "Consolidation + Pilot Readiness Program" (`expiration-tracker-next-days-master-plan-and-ai-prompt.md`, raiz do repo, 2026-08-27). Este arquivo é o backlog vivo pedido pela §13 desse prompt — não duplica o prompt em si (que continua sendo a especificação do programa), só rastreia item-a-item o que já foi feito, o que está bloqueado e por quê, e o que ainda não foi tocado. Atualizar a cada milestone concluído (`AGENTS.md` §6), nunca reescrever entradas fechadas — adicionar uma nova entrada de status em vez de editar o histórico.
>
> Precedência idêntica a `docs/architecture/README.md`: `AGENTS.md` > ADR aceito > documento temático corrente > este documento (rastreamento de programa, não normativo sobre arquitetura/design) > `NEXT_SESSION_PROMPT.md` (estado de sessão).

## Como ler este documento

Cada item tem: ID, Wave, Title, Problem, Evidence, Current state, Desired state, Dependencies, Risk, Priority, User/Pilot impact, Implementation status, Verification, PR, Final status. Status possíveis: `DONE`, `PARTIAL`, `BLOCKED`, `DEFERRED`, `NOT STARTED`.

---

## Wave 0 — State & Documentation Reconciliation

### W0-01 — Reconciliar estado de `develop`/`main`/PRs abertas/deploy `dev`

- **Problem**: Havia 9 commits em `develop` não mergeados em `main` (correções reais de M7 nunca implantadas em `dev`), zero PRs abertas visíveis, e dois documentos-índice (`docs/architecture/README.md`, `docs/frontend/README.md`) descrevendo estado desatualizado.
- **Evidence**: `git log main..develop`, `gh pr list --state open` (vazio), leitura completa de `NEXT_SESSION_PROMPT.md` (304 linhas).
- **Current state**: `develop` e `main` convergidos (PR #67 mergeado, `9772ca7`); CD aplicado com sucesso em `dev` (run `33124613581`).
- **Desired state**: alcançado.
- **Dependencies**: nenhuma.
- **Risk**: baixo (mudança já revisada/commitada em sessão anterior, só faltava o merge).
- **Priority**: P1 (reduz risco real — 2 bugs reais de M7 já corrigidos em `develop` ficaram semanas sem chegar a `dev`).
- **User/Pilot impact**: pipeline M7 em `dev` deixa de estar permanentemente fail-closed (AppConfig) e as rotas `confirm`/`reject` deixam de retornar 500/409 sempre.
- **Implementation status**: `DONE`.
- **Verification**: CI verde nos 4 jobs (`guardrails`, `dynamodb-integration`, `frontend`, `Validate Infra`), CD verde, `git log main..develop` vazio após o merge.
- **PR**: #67.
- **Final status**: `DONE`.

### W0-02 — Corrigir doc drift semântico não coberto por `check-doc-drift.ts`

- **Problem**: `check-docs` só pega link quebrado/referência `AGENTS.md §N` inválida — não pega afirmação factual desatualizada. Dois casos reais achados: `docs/architecture/README.md` linha 7 ainda dizia a verificação E2E do M7 estava "pendente" (foi concluída em 2026-08-27, achou 3 bugs, 2 corrigidos); `docs/frontend/README.md` linha 78 (linha BLOCKER-B) ainda dizia "pendente merge para `develop`" para um PR (#50) mergeado há semanas.
- **Evidence**: comparação direta entre o texto desses dois arquivos e `NEXT_SESSION_PROMPT.md` (que já tinha o estado correto).
- **Current state**: ambos corrigidos.
- **Desired state**: alcançado.
- **Dependencies**: nenhuma.
- **Risk**: baixo.
- **Priority**: P1 (documentation truth, item explícito do programa).
- **User/Pilot impact**: nenhum direto — reduz risco de uma sessão futura (Claude ou Codex) tomar decisão a partir de estado errado.
- **Implementation status**: `DONE`.
- **Verification**: `npm run check-docs` limpo após a mudança (221 arquivos, zero achado).
- **PR**: #68 (junto com W2-02, ver abaixo — mesmo commit `4ab1aa6`).
- **Final status**: `DONE`.

### W0-03 — Protótipo standalone atualizado (fora do Design System vigente)

- **Problem**: Marcelo publicou `Expiration Tracker - Prototipo Standalone (1).html` (raiz do repo, commit `997624b`, pré-existente ao início desta sessão) com telas que deliberadamente não seguem `docs/frontend/visual-language-and-design-system.md` — ele mudou de ideia sobre partes do design e vai atualizar o Design System formal depois.
- **Evidence**: arquivo é um bundle single-file com assets embutidos em base64 (~205k tokens se lido por completo) — não é um documento de design legível linha-a-linha, é uma exportação de protótipo.
- **Current state**: arquivo existe no repo, não analisado em profundidade (custo/benefício de decodificar um bundle binário não vale a pena antes do Design System formal mudar).
- **Desired state**: quando Marcelo atualizar `docs/frontend/visual-language-and-design-system.md` (ou publicar um novo documento normativo), essa atualização vira a fonte vigente (`AGENTS.md` §5 — documento temático corrente) e a Wave 1 (reconciliação de conformidade) roda contra ela.
- **Dependencies**: Marcelo atualizar o Design System formal.
- **Risk**: baixo — nenhuma ação tomada sobre o protótipo evita qualquer risco de regressão.
- **Priority**: N/A até a dependência ser resolvida.
- **User/Pilot impact**: nenhum ainda.
- **Implementation status**: `DEFERRED` — explicitamente, não por falta de token/tempo.
- **Verification**: N/A.
- **PR**: N/A.
- **Final status**: `DEFERRED`, aguardando Marcelo.

---

## Wave 1 — Design System Reconciliation + Frontend Conformance

**Status geral: `DEFERRED`.** O Design System vigente (`docs/frontend/visual-language-and-design-system.md`, `APPROVED ... PROVISIONAL PENDING USER VALIDATION`) não mudou desde a última verificação (2026-08-26) — não há nada novo para reconciliar contra o frontend real. O protótipo standalone novo (W0-03) é candidato a virar a próxima versão do Design System, mas por instrução explícita do Marcelo ("vou atualizar o design system posteriormente") ele ainda não é a fonte vigente. Rodar esta Wave agora seria reconciliar contra uma definição que já sabemos que vai mudar — trabalho descartável, contra o princípio P1 do programa ("nenhuma nova feature/trabalho sem reduzir risco concreto"). Retomar quando o Design System formal for atualizado.

---

## Wave 2 — Operational / M7 / Recovery Evidence

### W2-01 — M7 E2E real em `dev`

- **Problem/Current state**: já executado numa sessão anterior a esta (2026-08-27, antes deste programa existir) — ver `NEXT_SESSION_PROMPT.md` seção "M7 — verificação end-to-end real em `dev`". Cadeia real S3→SQS→Step Functions→Textract→parser→Bedrock(gated)→validação→persistência exercitada de ponta a ponta contra `dev` real, achou 3 bugs reais.
- **Evidence**: 3 execuções reais do state machine documentadas (`run_9a0adc...`, `run_a22df0...`, `run_c1aef1...`), com output real de cada uma.
- **Implementation status**: `DONE` (a verificação em si). Dos 3 bugs achados:
  1. AppConfig lendo o envelope errado (pipeline sempre fail-closed) — `DONE`, corrigido e implantado (W0-01/PR #67).
  2. Rotas `confirm`/`reject` quebradas (schema não registrado + chave OCC malformada) — `DONE`, corrigido e implantado (W0-01/PR #67).
  3. Campo auto-`CONFIRMED` pelo pipeline nunca propaga para `ExpirationItem.dueDate` — **decisão de produto pendente**, não mecânica. Ver W2-01-DECISION abaixo.
- **Priority**: P1.
- **PR**: #67 (bugs 1-2).
- **Final status**: `PARTIAL` — 2/3 bugs fechados, 1 aguardando decisão do Marcelo.

### W2-01-DECISION — Campo auto-CONFIRMED não atualiza `ExpirationItem.dueDate`

- **Problem**: `decideFieldOutcome()` auto-aceita (`state: CONFIRMED`) um candidato de alta confiança sem revisão humana — mas o único código que escreve `ExpirationItem.dueDate` é a rota HTTP `confirm`, que exige `state === PENDING_CONFIRMATION` e devolve 422 para um campo já `CONFIRMED`. No caminho de maior sucesso do pipeline (Textract real + parser determinístico confiante), o `dueDate` nunca é atualizado e não existe rota que o atualize.
- **Evidence**: `run_c1aef1a7c3f1272b9f9ff78cc963ab98` (execução real, `confidence:0.9`, auto-`CONFIRMED`) seguida de uma tentativa real de `confirm` que devolveu 422 `BUSINESS_RULE`.
- **Desired state**: uma de duas alternativas, ambas Type 1 (nível 5-6 da escala de risco, decisão de produto genuína):
  - (a) o pipeline passa a escrever `dueDate` na própria transação de `PersistExtractedFields` quando o outcome é auto-`CONFIRMED`; ou
  - (b) `decideFieldOutcome()` nunca auto-confirma — todo candidato, mesmo de alta confiança, vira `PENDING_CONFIRMATION` e exige revisão humana.
- **Dependencies**: decisão do Marcelo. Não é correção mecânica — muda um comportamento de produto (confirmação automática vs. sempre-humana) já implementado e testado do jeito atual.
- **Risk**: nível 5-6 (change-risk-scale.md) — decisão de arquitetura/produto, protocolo `AGENTS.md` §4 aplicável à implementação escolhida (não à decisão em si, que cabe ao Marcelo por `AGENTS.md` §1).
- **Priority**: P1 (correctness real de um pipeline em produção-`dev`), mas bloqueado.
- **User/Pilot impact**: sem essa decisão, M7 nunca atualiza `dueDate` sozinho mesmo quando o dado é confiável — comportamento observável, não cosmético.
- **Implementation status**: `BLOCKED` — aguardando decisão do Marcelo.
- **Verification**: N/A até a decisão.
- **PR**: N/A.
- **Final status**: `BLOCKED`.

### W2-02 — ASL `ErrorEquals` casava contra `AppError.code`, nunca contra `errorType` real

- **Problem**: Step Functions casa `ErrorEquals` nomeado contra o `errorType` do Lambda (nome da classe JS do erro lançado), nunca contra a propriedade `.code` de `AppError`. O Catch de `RunTextract` e os `Retry` de `PersistExtractedFields`/`MarkPendingConfirmation` usavam os valores de `.code` (`"OcrDisabled"`, `"ExtractionCommitFailed"`, etc.) — nunca bateram. Comportamento observado ficou correto por acidente (o `States.ALL` catch-all seguinte tem o mesmo `Next`), mas o `Retry` morto em `ExtractionCommitFailed` significa que uma falha transitória de commit não é retentada como desenhado.
- **Evidence**: achado menor já registrado em `NEXT_SESSION_PROMPT.md` a partir da verificação E2E real (`TaskFailed` de `RunTextract` trouxe `"error": "OcrDisabledError"`, não `"OcrDisabled"`).
- **Current state**: corrigido — `UnsupportedDocumentTypeError`/`OcrDisabledError`/`TextractUnsupportedDocumentError`/`TextractJobPersistenceFailedError`/`ExtractionCommitFailedError` (nome de classe). Exceção verificada e mantida como estava: `TextractPartialFailure` nunca é lançado como exceção — `completeOcr()` o envia via `SendTaskFailure` explícito com o valor de `.code`, então o literal correto ali é o `.code`, não o nome da classe.
- **Desired state**: alcançado.
- **Dependencies**: nenhuma.
- **Risk**: baixo (correção mecânica sobre contrato já commitado, nível 1-2 da escala de risco — não precisou do protocolo `AGENTS.md` §4).
- **Priority**: P1.
- **User/Pilot impact**: uma falha transitória de `TransactWriteItems` em `PersistExtractedFields`/`MarkPendingConfirmation` agora é retentada como desenhado, em vez de cair direto no comportamento de erro genérico.
- **Implementation status**: `DONE`.
- **Verification**: `npx asl-validator`, `aws stepfunctions validate-state-machine-definition` (real, contra `dev`), `terraform test` (15/15 stack + 5/5 módulo `extraction-workflow`), `terraform plan` real contra `dev` mostrando exatamente o diff de `ErrorEquals`/comentário e nenhuma mudança de topologia.
- **PR**: #68 (commit `4ab1aa6`, aguardando CI no momento em que esta entrada foi escrita).
- **Final status**: `DONE` (pendente confirmação final de CI/merge — atualizar após).

### W2-03..W2-08 — Drills operacionais ainda não executados

Todos `NOT STARTED`. Registrados aqui como itens do backlog, não como trabalho desta sessão — cada um envolve injetar falha ou gerar carga real contra `dev`, o que este programa trata como ação que merece avaliação own-item (não um clique mecânico), e nenhum foi pedido explicitamente ainda.

| ID | Título | Wave §ref | Prioridade |
|---|---|---|---|
| W2-03 | Feature gate M7 — provar "gate off = zero tráfego real" e "gate on = tráfego esperado" | §6.2 | P1 |
| W2-04 | Reminder pipeline drill (policy→materialization→occurrence→dispatch→provider→outcome, incl. falha/retry) | §6.5 | P1 |
| W2-05 | DLQ/replay drill nas filas críticas — provar que replay não duplica side effects | §6.6 | P1 |
| W2-06 | Restore drill real conforme `disaster-recovery.md` — medir RPO/RTO observados | §6.7 | P1 |
| W2-07 | Load test realista vs. SLO/capacity model | §6.8 | P2 |
| W2-08 | Credential compromise drill (sem expor credencial real) + validação de alarmes críticos disparando de fato | §6.9/§6.10 | P1 |

---

## Wave 3 — Privacy + LGPD + Tenant Isolation Readiness

**Status geral: `PARTIAL` (W3-01 iniciado nesta sessão, resto `NOT STARTED`).**

### W3-01 — Threat model executável de tenant isolation

- **Problem**: nenhum inventário existia de quais módulos já tinham teste negativo cross-tenant (dois tenantIds reais, um tentando acessar o outro) vs. quais só herdavam isolamento "por construção" (chave sempre prefixada por tenant) sem prova executável disso.
- **Evidence**: pesquisa dedicada (agente read-only) sobre `test/unit/**`/`test/integration/**` cobrindo 9 áreas: ExpirationItem, Document, Subject/RequirementAssignment/DocumentSubmission, Reminder/ReminderPolicy, Import, Extraction, resolver de identidade/autorização, idempotency store, e os key-builders do DynamoDB.
- **Current state**: achado confirmado — `ExpirationItem` (via `test/integration/expiration-lifecycle.test.ts`) e o choke point de identidade (`test/integration/cross-tenant.test.ts`, `test/unit/identity/authorization.test.ts`) já tinham cobertura forte; `Document`, `Subject`/`RequirementAssignment`/`DocumentSubmission`, `Import`, `Extraction` (rotas confirm/reject) e o CRUD de `ReminderPolicy` **não tinham nenhum teste cross-tenant real** (só isolamento item-vs-item dentro do MESMO tenant, ou negação por falta de membership — não por tenant errado). Todos os 5 gaps concretos foram fechados nesta sessão: 13 testes novos (`getSubject`/`updateSubject`/`archiveSubject`/`deleteSubject`/`listSubjects`, `assignRequirement`/`getRequirementAssignment`/`updateRequirementAssignment`/`linkExpirationItem`/`deleteRequirementAssignment`/`getDocumentSubmission`/`listDocumentSubmissions`, `getDocument`/`listDocuments`/`reserveUpload`, `getImportJob`/`requestCommit`, `confirmField`/`rejectField`, `getPolicy`/`updatePolicy`/`disablePolicy` — todos provando 404, nunca um 403 vazado, quando tenant B usa um id real de tenant A). Nenhum bug real de isolamento foi encontrado — todo teste passou na primeira tentativa, confirmando que o padrão arquitetural (chave sempre `TENANT#<id>#...`, leitura sempre escopada por `ctx.tenant.tenantId` antes de `authorize()`) já era sólido; o valor do trabalho foi transformar uma garantia estrutural implícita numa prova executável e regressível.
- **Smell registrado, não corrigido** (severidade baixa): `textractJobKey(jobId)` (`src/modules/extraction/domain/textract-job.ts`) é a única chave do sistema sem prefixo `TENANT#` — deliberado (o callback SNS do Textract só carrega `jobId`), já documentado e testado como tal (`test/unit/extraction/textract-job.test.ts`), mas nenhuma rota HTTP hoje aceita um `jobId` vindo do cliente para essa store — não corrigido porque não há vetor de ataque real hoje, só registrado como algo a vigiar se isso mudar.
- **Desired state**: alcançado para os 5 gaps identificados. Fora do escopo desta rodada (não pesquisado): presigned URL de download real (o gerador de URL em si não é tenant-aware, a garantia vem inteiramente de quem chama `documentKey` antes — comportamento já coberto indiretamente pelos testes de `getDocument`/`reserveUpload` novos, mas nenhum teste chama o `UploadUrlSigner` real com um path cross-tenant deliberadamente).
- **Dependencies**: nenhuma.
- **Risk**: baixo — só testes novos, nenhuma mudança de comportamento.
- **Priority**: P1.
- **User/Pilot impact**: nenhuma regressão comportamental; reduz risco de uma refatoração futura introduzir silenciosamente um vazamento cross-tenant nessas 5 áreas sem que a suíte pegue.
- **Implementation status**: `DONE` para os 5 gaps identificados (`Document`, `Subject`/`RequirementAssignment`/`DocumentSubmission`, `Import`, `Extraction confirm/reject`, `ReminderPolicy CRUD`).
- **Verification**: 905/905 testes de backend passando (era 892 no início da sessão), `typecheck`/`lint`/`check-boundaries`/`check-docs` limpos.
- **PR**: pendente de abrir (próximo passo desta sessão).
- **Final status**: `DONE` (os 5 gaps concretos), `NOT STARTED` (presigned URL de download real, e as áreas W3-02 em diante abaixo).

### W3-02 — Auditoria de proveniência de `tenantId`

- **Current state**: **`DONE`**. Fase 1 (subproduto de W3-01): todo `authorize()` recebe `resource.tenantId` de uma leitura já escopada, nunca de DTO de cliente; nenhum type de persistência/autorização tem `tenantId` opcional. Fase 2 (pesquisa dedicada, fechando o remanescente de eventos/filas): traçados os 12 workers de `src/workers/**` contra seus handlers em `src/runtime/aws/handlers/**`. Dois padrões, ambos seguros por construção: (a) `tenantId` vem do corpo da mensagem SQS, mas a fila só é alcançável por exatamente 2-3 roles internas privilegiadas (`dispatch_outbox_relay`/`outbox_sweeper`, escopo IAM confirmado em `infra/main.tf`) e o valor foi originalmente lido da própria coluna `tenantId` de um `OutboxRecord` já gravado por código de aplicação (nunca de DTO de cliente) — um `tenantId` malformado/adulterado nunca resolveria para o registro real de OUTRO tenant (a chave `TENANT#<tenantId>#...` simplesmente não bate com nada, o worker cai no branch "não encontrado"); (b) `tenantId` é parseado da própria chave do objeto S3 (evento gerado pela AWS, nunca um campo isolado), com uma segunda checagem de conteúdo (`doc.quarantineObject.key !== input.object.key` → `IGNORED_WRONG_OBJECT`) — defesa em profundidade real, não só estrutura de chave. Os workers de reconciliação (GSI3/GSI6) nunca recebem `tenantId` de input externo — só de uma linha já lida do banco.
- **Evidence**: relatório da pesquisa W3-01 (seções 7/9) + relatório dedicado de continuação (workers/filas), citações arquivo:linha para os 12 workers.
- **Achado registrado, não corrigido (P3, sem valor de segurança real)**: só `reminder-materialization-trigger.test.ts` tem um teste cross-tenant explícito no nível de worker; `reminder-dispatch`/`document-chasing-dispatch`/`malware-result`/`upload-finalizer` não têm o equivalente (provariam o mesmo mecanismo já provado seguro, sem achar bug novo — baixo valor, não implementado).
- **Priority**: P1 (auditoria) — concluída.
- **Implementation status**: `DONE`.
- **Final status**: `DONE` — nenhuma vulnerabilidade real encontrada.

### W3-03 — Auditoria DynamoDB (PK/SK/GSIs/batch/conditional writes)

- **Current state**: **`DONE`**. Fase 1 (W3-01): key-builders sempre exigem `tenantId` obrigatório. Fase 2 (pesquisa dedicada): toda `QueryCommand` com `IndexName` foi localizada — GSI1/GSI7 sempre constroem a partition key a partir de `ctx.tenant.tenantId`; GSI3/GSI6 são deliberadamente globais/não-prefixados por tenant (design já documentado, `reminder-store.ts`), mas IAM-restritos a um conjunto nomeado e exato de workers privilegiados, e toda linha retornada é auto-contida (carrega seu próprio `tenantId`) ou imediatamente pareada com um `get()` chaveado pelo `tenantId` DA PRÓPRIA linha, nunca um valor externo. `BatchGetItem`/`BatchWriteItem`: **zero uso em todo o código** (grep confirmou) — a preocupação não se aplica. `TransactWriteItems`: toda store é um executor passthrough sobre entradas já montadas pela camada de aplicação; a transação mais complexa (`confirm-reject-field.ts`, 4 entidades) usa um único `tenantId` para todas as 4 leituras E valida explicitamente `entity.tenantId !== tenantId → NotFoundError` ANTES de incluir a entidade na transação — checagem redundante explícita, não só confiança na estrutura da chave.
- **Evidence**: relatório de continuação dedicado, citações arquivo:linha para toda query GSI e toda construção de `TransactWriteCommand` do repositório.
- **Achado registrado, não corrigido (P3, sem valor de segurança real)**: o invariante "GSI3/GSI6 são os únicos índices não-prefixados por tenant, acesso restrito por IAM a N roles nomeadas" vive só em comentário de código/Terraform, não em teste executável — documentação, não risco.
- **Priority**: P1 (auditoria) — concluída.
- **Implementation status**: `DONE`.
- **Final status**: `DONE` — nenhuma vulnerabilidade real encontrada; toda escrita multi-item é provavelmente single-tenant por construção.

### W3-04 — Auditoria S3 (object key/presigned URL/KMS/quarentena/clean/extraction transient)

- **Current state**: **`DONE` (auditoria), `PARTIAL` (remediação)**. Pesquisa dedicada (agente read-only) cobrindo os 4 buckets do sistema (quarentena, clean/pós-scan, import raw, extraction transient). **Conclusão geral: isolamento é 100% de disciplina de aplicação (chave sempre construída server-side a partir de `ctx.tenant.tenantId`/token de guest resolvido/linha já lida do DynamoDB, nunca de key/path vindo do cliente), nunca ListObjects de prefixo largo, e a promoção quarentena→clean rederiva a chave a partir da própria linha `Document` em vez de confiar no evento S3 recebido.** Nenhuma vulnerabilidade cross-tenant explorável foi encontrada.
- **Achados reais registrados, nenhum corrigido (nenhum é explorável hoje)**:
  1. A chave do artefato OCR transitório (`ocr/<runId>/<uuid>.json`, `S3OcrArtifactStore`) **não** carrega `tenantId` — isolamento depende inteiramente de `runId` ser um UUID opaco gerado no servidor, nunca exposto a nenhuma rota HTTP. Mesma classe de achado que `textractJobKey` (DynamoDB, já registrado no W3-01), agora confirmado do lado S3 também. Sem vetor de ataque real hoje; vira risco só se uma ferramenta futura (debug/admin/DLQ-replay) algum dia aceitar um `ExtractionArtifactRef` vindo do cliente.
  2. Nenhum teste unitário exercita os adapters S3 reais (`S3UploadUrlSigner`/`S3DocumentObjectStore`/`S3ImportObjectStore`/`S3OcrArtifactStore`) com uma chave deliberadamente cross-tenant — toda prova cross-tenant hoje vive na camada de autorização DynamoDB (404 na leitura), nunca no próprio signer/adapter S3. `S3UploadUrlSigner` em si confia cegamente na chave que recebe (correto architeturalmente, já que quem constrói a chave é sempre o caller confiável) mas não há teste pinning esse contrato.
  3. Nenhuma política de bucket/KMS restringe acesso por prefixo de tenant — todo IAM role tem `Get/Put/Delete` no bucket inteiro, sem `Condition` de `s3:prefix`. Isolamento é inteiramente de camada de aplicação, sem defesa em profundidade nativa da AWS. **Decisão de custo já documentada** (`infra/modules/document-buckets/main.tf`, CMK gerenciada `alias/aws/s3` compartilhada) — não é um achado novo de arquitetura, só a confirmação de que essa mesma decisão também significa zero prefixo-por-tenant no IAM.
- **Desired state**: achados 1 e 3 são aceitáveis como estão (custo/complexidade vs. risco real, sem vetor de ataque hoje) — não viram tarefa de correção a menos que um uso futuro mude o cálculo. Achado 2 é candidato barato a um teste futuro, mas baixo valor (o adapter é um passthrough trivial; o contrato que importa já está coberto indiretamente pelos testes de `reserveUpload`/`getDocument` cross-tenant do W3-01).
- **Dependencies**: nenhuma.
- **Risk**: nenhum novo risco introduzido; achados são observações, não vulnerabilidades.
- **Priority**: P2 para os 3 achados (nenhum bloqueia Pilot).
- **User/Pilot impact**: nenhum — confirma que a superfície de maior sensibilidade (documentos de usuário reais) já está segura por construção.
- **Implementation status**: `DONE` (auditoria).
- **Verification**: relatório do agente, citações de arquivo/linha para as 6 perguntas de investigação.
- **PR**: junto com os outros achados desta sessão.
- **Final status**: `DONE` (auditoria) — os 3 achados ficam registrados como conhecimento, não como pendência bloqueante.

### W3-05 — Redaction real em logs/trace/DLQ

- **Current state**: **`DONE` (auditoria)**. Pesquisa dedicada confirmou que `SecureLogger` (`src/shared/observability/logger.ts`) roda TODA linha de log através de `Redactor.redact()` (`src/shared/observability/redactor.ts`) — não é disciplina de quem chama, é automático e central. Dois mecanismos independentes: denylist de nome de campo (36 entradas, `schemas/sensitive-fields.json`, casamento exato case-insensitive, recursivo até profundidade 6) e regex de padrão de valor (email/bearer-token/key-value) aplicado a QUALQUER string, independente do nome do campo. `Error` é tratado à parte (`redactError`): só `name`/message redigida/primeira linha do stack, nunca o stack completo. Auditados os 63 call sites de `logger.*` do repositório inteiro (todos em `src/runtime/aws/handlers/**` + `security-audit.ts`; **zero** em `src/modules/**`/`src/workers/**`) — nenhum loga corpo bruto de evento, item DynamoDB completo, JWT/cookie, texto OCR ou campo CPF/email diretamente; `AppError.details`/`.cause` nunca são logados por inteiro, só `.message`/`.code`. `EXTRACTION_TRANSIENT` confirmado nunca alcançar log/trace/DLQ: nenhum `logger.*` perto de `ocrText`/prompt/resposta do Bedrock em nenhum handler de extração, e `infra/modules/extraction-workflow/main.tf:30-37` tem `include_execution_data = false`/`level = "ERROR"` **verificado literalmente no Terraform real**, batendo exatamente com a alegação já feita em `NEXT_SESSION_PROMPT.md`/comentários do código. `src/modules/bff/**` e `src/modules/subject/**` (tokens de sessão/guest) não têm NENHUM `logger.*` — nada para vazar por logging hoje.
- **Achados reais registrados, nenhum corrigido (nenhum é vazamento ativo hoje)**:
  1. **`schemas/queues/notification-ses-callback.v1.json` permite `additionalProperties: true` e embrulha o evento SES bruto** — por design documentado no próprio schema, já que o corpo real de bounce/complaint da SES inclui endereços de e-mail do destinatário (`mail.destination`, `bounce.bouncedRecipients[].emailAddress`). Uma mensagem "veneno" que cai na DLQ dessa fila carrega e-mail real de destinatário por até 14 dias (retenção padrão do módulo `sqs-worker-queue`). O código consumidor (`ses-callback-handler.ts`) só lê `messageId`/`timestamp`/`tags`, nunca loga o corpo inteiro — então não é vazamento de LOG, é PII em repouso na própria DLQ, um tradeoff já assumido no schema, nunca testado.
  2. ~~**A denylist de nome de campo do redactor é por casamento EXATO, não fuzzy**~~ — **CORRIGIDO nesta sessão**: tinha `"token"` mas não `"guestToken"` (nome de campo real em `src/modules/subject/**`), tinha `"cognitoSubject"` mas o campo real do código é `"cognitoSub"` (`src/modules/identity/**`). Nenhum dos dois era logado em lugar nenhum (zero vazamento ativo) — mas o risco era real e latente. Corrigido adicionando `"cognitoSub"`/`"guestToken"` a `schemas/sensitive-fields.json`'s `redactedFieldNames` (mudança de config, nível 1-2 da escala de risco, não precisou do protocolo `AGENTS.md` §4) + 1 teste de regressão novo em `test/unit/redactor.test.ts`.
- **Desired state**: achado 1 é aceitável como está (tradeoff documentado, sem alternativa óbvia sem perder o corpo de diagnóstico do bounce/complaint real) — candidato a um teste futuro simulando uma mensagem SES venenosa na DLQ, não urgente. Achado 2 fechado.
- **Dependencies**: nenhuma.
- **Risk**: nenhum vazamento ativo — achado 2 era hardening preventivo, já fechado.
- **Priority**: P3 (achado 1, tradeoff já aceito, não bloqueante).
- **User/Pilot impact**: nenhum hoje.
- **Implementation status**: `DONE` (auditoria + achado 2 corrigido); achado 1 registrado, não corrigido (tradeoff aceito).
- **Verification**: relatório do agente, citações de arquivo/linha para as 6 perguntas de investigação, incluindo verificação literal do `logging_configuration` real no Terraform. 906/906 testes de backend (era 905), `typecheck`/`lint`/`check-boundaries`/`check-docs` limpos.
- **PR**: junto com os outros achados desta sessão.
- **Final status**: `DONE`.

### W3-06 — Verificação de implementação real das classes de retenção

- **Current state**: **`DONE` (auditoria) — achado real de severidade alta, não corrigido, precisa de escopo/priorização do Marcelo antes de qualquer implementação.** Das 9 classes de retenção definidas em `privacy-lgpd.md` §4, **só `EXTRACTION_TRANSIENT` tem enforcement real de ponta a ponta** (`EXTRACTION_TRANSIENT_LIFECYCLE_HOURS = 24` no código bate literalmente com a lifecycle rule real do S3 `infra/main.tf:1625-1642`, MAIS um worker real que chama `delete()` nos dois estados terminais, com teste dedicado provando a invariante de que nunca deleta antes do terminal). As outras 8 classes (`ACCOUNT_ACTIVE`, `CORE_USER_DATA`, `USER_DOCUMENT`, `LEGAL_EVIDENCE`, `DELIVERY_RECORD`, `TRANSIENT`, `SECURITY_AUDIT`, `QUOTA_TELEMETRY`) não têm enforcement real — a maioria nem tem o campo `retentionClass`/`purgeAfter` materializado em código.
- **Achado mais grave, registrado com destaque**: `USER_DOCUMENT` (a classe que cobre **documentos reais de usuário**, o dado mais sensível do produto) tem uma aparência enganosa de estar implementada — `Document` carrega `retentionClass: "USER_DOCUMENT"` e um campo `purgeAfter` computado na exclusão (`document-service.ts`/`document-deletion-service.ts`) — mas **esse relógio não aciona nada**: (1) `purgeAfter` é uma string ISO, um atributo DIFERENTE do atributo real de TTL nativo do DynamoDB (`purgeAfterTtl`, `enabled = true` em `infra/modules/dynamo-table/main.tf:147-150` — mas usado só por `LoginAttempt`/`Session`/tokens de guest, nunca por `Document`); (2) nenhum worker lê `purgeAfter` depois de calculado; (3) o bucket S3 "clean" (`aws_s3_bucket.clean`, onde o conteúdo real do documento fica) **não tem nenhuma lifecycle rule**. Resultado real: um documento marcado `DELETED` hoje permanece fisicamente presente no DynamoDB E no S3 indefinidamente — `DocumentDeletionService` documenta isso explicitamente no próprio comentário de cabeçalho ("physical purge is a separate, later step... out of scope for M6"), mas o gap nunca tinha sido confirmado contra o comportamento real de ponta a ponta antes desta auditoria.
- **Achados menores**: `TRANSIENT` está dividido — `UploadSlot` tem um worker real e testado, mas ele faz reconciliação de quota (flip de status + remoção de ponteiro GSI6), nunca deleta a linha nem lê `purgeAfter`; `WebhookInbox` (também `TRANSIENT`) não tem mecanismo nenhum. `legalHold` **não existe em lugar nenhum do código/infra** (`grep` repo-inteiro, zero ocorrências) — 100% design-only, confirmando o autorrelato já feito em `privacy-lgpd.md` §7. `LEGAL_EVIDENCE` nem é representável no type system atual (`DocumentRetentionClass` exclui esse valor).
- **Doc drift menor encontrado, não corrigido separadamente**: comentário em `infra/main.tf` acima de `aws_s3_bucket.extraction_transient` dizia "item 7, ainda não implementado" — desatualizado, item 7 (`ExtractionValidationTaskHandler`) está implementado e realmente chama `delete()`. Candidato a correção mecânica trivial numa sessão futura.
- **Evidence**: relatório de pesquisa dedicado, tabela completa das 9 classes com entidade/mecanismo/worker/legalHold/cobertura de teste, citações arquivo:linha.
- **Desired state**: decisão do Marcelo sobre prioridade/escopo antes de qualquer implementação — construir 8 mecanismos de purga reais (a maioria precisa de: campo `retentionClass`/`purgeAfter` materializado, decidir TTL nativo do DynamoDB vs. worker explícito como `EXTRACTION_TRANSIENT` já prova funcionar, e para `USER_DOCUMENT`especificamente uma lifecycle rule real no bucket `clean` do S3) é trabalho de escopo substancial — não uma correção mecânica pontual. Ordem de prioridade sugerida se/quando aprovado: `USER_DOCUMENT` primeiro (dado mais sensível, gap mais enganoso), depois `TRANSIENT`/`WebhookInbox`, depois as classes sem nenhum dado pessoal real ainda em produção (`ACCOUNT_ACTIVE`/`CORE_USER_DATA`/`DELIVERY_RECORD`/`SECURITY_AUDIT`/`QUOTA_TELEMETRY`).
- **Dependencies**: decisão de escopo/priorização do Marcelo. Type 1 (nível 5-6 da escala de risco) para o desenho do mecanismo de purga — não é correção mecânica, é uma decisão de arquitetura pequena mas real (padrão a seguir: TTL nativo vs. worker explícito, por classe).
- **Risk**: alto se dados pessoais reais de piloto chegarem à produção antes disso ser resolvido — `USER_DOCUMENT` é diretamente sobre documentos de terceiros reais.
- **Priority**: **P1** (elevado de P2 do prompt mestre original, dado o achado real — documentos de usuário nunca são fisicamente purgados hoje).
- **User/Pilot impact**: gate real de LGPD readiness antes de um piloto com dados pessoais reais — não bloqueia um piloto totalmente sintético/interno, mas bloqueia qualquer piloto com documentos reais de terceiros sem essa lacuna ser ao menos reconhecida e aceita conscientemente.
- **Implementation status**: `DONE` (auditoria); implementação `BLOCKED` (decisão de escopo do Marcelo).
- **Verification**: relatório do agente, tabela completa por classe.
- **PR**: junto com os outros achados desta sessão (só a documentação do achado, nenhum código de purga implementado ainda).
- **Final status**: `BLOCKED` — achado real e severo, aguardando decisão do Marcelo sobre escopo/prioridade antes de qualquer implementação.

Itens ainda `NOT STARTED`, identificados a partir do prompt mestre:

| ID | Título | Wave §ref | Prioridade |
|---|---|---|---|
| W3-07 | DSR (access/export/deletion) — real ou design-only? | §7.8/§7.9 | P2 |
| W3-08 | Inventário de região AWS/subprocessadores + tabela de subprocessor register | §7.11-7.13 | P2 |
| W3-09 | RIPD readiness (inventário técnico, nunca aprovação jurídica) | §7.14 | P3 |

---

## Wave 4 — Identity / Organization / Admin / RBAC Readiness

**Status geral: `NOT STARTED`.** Design de Organization/Membership/RBAC existe em `docs/architecture/roadmap-evolution/05-domain-model-organization-billing.md` (informativo, reconciliado via protocolo, nota 9,2/9,2) mas **não implementado** (M13 gated por gatilho comercial real que não disparou, `AGENTS.md` §1). Itens a registrar:

| ID | Título | Wave §ref | Prioridade |
|---|---|---|---|
| W4-01 | Confirmar contra o código real: `tenantId` ainda é `userId` hoje? Migração para `organizationId` é Type 1 se B2B exigir | §8.8 | P1 (bloqueia qualquer avanço de RBAC) |
| W4-02 | Tenant Admin foundation (Organization/Membership/Invitation/roles) antes de qualquer painel super-admin | §8.2 | P2 |
| W4-03 | Platform Staff — não inventar sem justificativa (por que/quais ações/qual auditoria) | §8.9 | P3 (deferred se não necessário para Pilot) |

---

## Wave 5 — GTR-01 + Guest Trust Readiness

**Status geral: `NOT STARTED`.** `GTR-01` já é um blocker nomeado desde o planejamento de interface (`docs/frontend/README.md`) — simulado no protótipo, nunca resolvido no backend real.

| ID | Título | Wave §ref | Prioridade |
|---|---|---|---|
| W5-01 | Backend real de identidade do solicitante (organização) exposta ao guest, substituindo a string fixa do protótipo | §9.1 | P1 se guest flow entrar no primeiro Pilot; senão DEFER |

---

## Wave 6 — Pilot Readiness Gate Review

**Status geral: `NOT STARTED`** — depende de todas as waves anteriores terem, no mínimo, uma primeira passada. Entregável final: `docs/engineering/pilot-readiness-assessment.md` (ainda não criado).

---

## Decisões pendentes do Marcelo (consolidado, não duplicar contexto — só apontar)

1. **W2-01-DECISION** — campo auto-`CONFIRMED` do M7 não propaga `dueDate`: escolher entre auto-escrever o item ou nunca auto-confirmar.
2. **W0-03** — quando o Design System formal for atualizado a partir do novo protótipo standalone, sinalizar para a Wave 1 rodar.
3. **User Validation** — continua em suspenso por pedido explícito do Marcelo (`NEXT_SESSION_PROMPT.md`); nenhuma ação deste programa deve reabri-la sem sinal dele.
4. **W3-06-DECISION** — 8 das 9 classes de retenção de `privacy-lgpd.md` §4 não têm purga real implementada, incluindo `USER_DOCUMENT` (documentos reais de terceiros nunca são fisicamente apagados após exclusão lógica, apesar de existir um campo `purgeAfter` que parece implementar isso mas não aciona nada). Decisão necessária: prioridade/escopo — implementar `USER_DOCUMENT` primeiro (maior risco real) seguindo o padrão já provado em `EXTRACTION_TRANSIENT` (worker explícito + lifecycle S3 como rede de segurança), ou aceitar o gap conscientemente para um piloto sem dados pessoais reais de terceiros. Ver seção W3-06 acima para a tabela completa.

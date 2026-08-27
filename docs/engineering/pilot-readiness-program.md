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

- **Current state**: **`PARTIAL`, evidência forte já coletada** (subproduto da pesquisa de W3-01, não uma auditoria dedicada). Confirmado por grep exaustivo dos 22 call sites de `authorize()` em `src/modules/*/application/*.ts`: todos passam `resource.tenantId` a partir de um valor já lido do banco numa query escopada por `ctx.tenant.tenantId` — nunca de um DTO/payload de cliente. `RequestContextResolver.resolve()` (`src/modules/identity/application/resolve-request-context.ts`) é o único lugar que deriva `tenantId` de um principal autenticado (cognitoSub → IdentityMapping). Nenhum type de persistência/autorização no repositório tem `tenantId` como parâmetro opcional (grep por `tenantId?:` só achou 3 ocorrências, todas em contexto de observabilidade/logging ou parsing de tag SES não-confiável, nenhuma em caminho de autorização). **Não verificado ainda**: propagação de `tenantId` em eventos/filas (EventBridge/SQS payloads) — os workers confiam no `tenantId` do corpo da mensagem sem revalidação contra outra fonte? Isso fica como o remanescente real deste item.
- **Evidence**: relatório da pesquisa W3-01 (seções 7 e 9).
- **Priority**: P1.
- **Implementation status**: `PARTIAL`.
- **Final status**: `PARTIAL` — persistence/idempotency confirmados; events/queues (mensagens SQS/EventBridge confiando cegamente em `tenantId` do payload) ainda não auditado.

### W3-03 — Auditoria DynamoDB (PK/SK/GSIs/batch/conditional writes)

- **Current state**: **`PARTIAL`**. A parte de key-builders (PK/SK sempre exigindo `tenantId` como parâmetro obrigatório, nenhuma variante insegura) foi confirmada pela pesquisa W3-01 (seção 9) para todo módulo de negócio. **Não verificado ainda**: se alguma query por GSI constrói o `GSIxPK` a partir de um valor não confiavelmente escopado, e se algum `BatchGetItem`/`BatchWriteItem` itera sobre uma lista de chaves sem revalidar o `tenantId` de cada uma individualmente antes de agir.
- **Priority**: P1.
- **Implementation status**: `PARTIAL`.
- **Final status**: `PARTIAL` — key-builders confirmados seguros; GSI query construction e batch operations ainda não auditados especificamente.

Itens ainda `NOT STARTED`, identificados a partir do prompt mestre:

| ID | Título | Wave §ref | Prioridade |
|---|---|---|---|
| W3-04 | Auditoria S3 (object key/presigned URL/KMS/quarentena/clean/extraction transient) contra cross-tenant | §7.4 | P1 |
| W3-05 | Redaction real em logs (CPF/email/document ids/tokens/guest secrets/OCR text) — `EXTRACTION_TRANSIENT` nunca em log/trace/DLQ | §7.6 | P1 |
| W3-06 | Verificação de implementação real das classes de retenção (`retentionClass`/`purgeAfter`/`legalHold`/purge worker) | §7.7 | P2 |
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

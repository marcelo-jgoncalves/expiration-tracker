# Expiration Tracker — Status e Próxima Sessão

## M7 (Extraction e confirmação) — DESIGN APROVADO (2026-08-22), IMPLEMENTAÇÃO AINDA NÃO INICIADA

Decisão explícita do Marcelo: "design completo primeiro, depois eu decido implementar" — dado o
escopo maior que M6 (Step Functions + Textract + Bedrock, 2 integrações de IA com custo real por
chamada). Protocolo Claude↔Codex completo, 7 rodadas (D-035, decisions-log.md): proposta
independente de cada lado → crítica cruzada (Codex deu 6,8/10 na proposta Claude round1, apontando
que Textract síncrono não se sustentava contra o limite de 50 páginas já aprovado, entre outros
problemas reais) → reconciliação com 5 correções pontuais reais, cada uma batendo numa nota real
antes de fechar (8,7→8,6→8,8→8,9→9,3) — a mais séria: uma corrida real de limpeza do artefato OCR
transitório que, se implementada como a rodada 5 propunha, causaria uma falha intermitente real em
produção (exatamente a classe de bug que só timing real revela, como os achados de Camada 3 de M6).
**Nota final: Claude 9,2 / Codex 9,3 — gate atingido.**

Design final: `docs/architecture/reviews/m7-extraction-design/claude-reconciliation-final-design.md`.
Decisões-chave: Step Functions Standard; Textract **assíncrono** com `waitForTaskToken` (a Fase 3
tinha deixado essa escolha para um "ADR dedicado" nunca escrito); parser de extração como função nova
isolada (nunca estende o `parser-sandbox` de M6, para não ampliar o blast radius de uma função já
verificada em produção real); AWS AppConfig real para os kill switches `AI_EXTRACTION`/`OCR` (módulo
Terraform `feature-flags`, transversal — não acoplado a Document, já que o schema também cobre
`WHATSAPP`); classe de retenção `EXTRACTION_TRANSIENT` (pré-requisito de **início** de implementação
em `privacy-lgpd.md` §4, não só de produção); toggle `extraction_pipeline_enabled` com **default
`false`** (diferente do padrão de M6 — feature nova com custo real e pré-condições externas ainda
não fechadas, ao contrário do GuardDuty que é requisito de segurança não-negociável); rotas HTTP
`POST .../extractions/{runId}/fields/{fieldName}/confirm` e `.../reject`; critério `NeedsBedrock`
fechado com threshold versionado por campo (nenhuma das duas propostas originais tinha isso
implementável); isolamento de prompt via API Converse com tool `submit_extraction` forçada.

**Pendências externas que bloqueiam só a ativação em produção** (não a implementação/teste em
`dev`): escolha e validação de modelo Bedrock + região; RIPD formal para uso de IA/OCR sobre
documento de titular (`privacy-lgpd.md` §6, gatilho já registrado).

**Próxima ação real**: implementar M7 seguindo o design aprovado — aguardando decisão do Marcelo
sobre quando começar (não autorizado a iniciar implementação sem essa decisão explícita).

## M6 (Document upload e malware boundary) — IMPLEMENTADO, DEPLOYADO e VERIFICADO EM PRODUÇÃO REAL (2026-08-22)

Design aprovado via protocolo Claude↔Codex (Claude 9.4/Codex 9.6,
`docs/architecture/reviews/m6-document-upload-design/`). Implementação completa: domínio,
aplicação, portas, persistência DynamoDB/S3, HTTP, 4 workers, 5 handlers Lambda, 3 módulos
Terraform novos (`document-buckets`, `document-malware-protection` com o toggle
`malware_protection_enabled` fail-closed em prod, `document-observability`). 345 testes
unitários. Deployado em `dev` via `cd.yml` (PRs #23-#32, todas mergeadas em `main`).

**Decisão de custo real (D-033)**: `document-buckets` usa a chave gerenciada `aws/s3` em vez de
CMKs dedicadas por bucket (decisão direta do Marcelo — corta ~US$2/mês de custo fixo). GuardDuty
Malware Protection for S3 não tem custo de estar ligado, só cobra por GB escaneado.

**6 bugs reais encontrados e corrigidos via o exercício de Camada 3** (upload real de PDF limpo +
arquivo EICAR real contra GuardDuty real, PRs #23-#32 — nenhum destes seria pego por
`terraform plan`/`terraform test`, só por um `terraform apply` real seguido de invocação real):
1. `documents-handler`/`upload-finalizer-handler`/`malware-result-handler` liam nomes de env var
   diferentes dos que `infra/main.tf` configurava (`QUARANTINE_BUCKET_NAME` vs `QUARANTINE_BUCKET`
   etc.) — os 3 handlers teriam falhado desde o cold start.
2. `UploadFinalizerWorker`/`MalwareResultWorker` perdiam permanentemente sua própria evidência na
   primeira colisão de OCC com o outro worker (`isTransactionCanceled` → `IGNORED_STALE` sem
   retry) — corrigido com o mesmo loop de retry limitado que `advanceAfterEvidence` já usa.
3. A promoção copiava de `doc.quarantineObject` (versionId sempre `""`, placeholder) em vez do
   objeto real em `uploadEvidence.object`/`malwareEvidence.object` — S3 rejeitava com "Version id
   cannot be the empty string".
4. `upload-finalizer-handler` só tinha permissão de LEITURA no bucket quarantine — mas
   `advanceAfterEvidence()` (a promoção) é executada por QUALQUER UM dos 2 workers (quem
   completar a evidência que faltava por último), não sempre `malware-result-handler`.
5. `CopySource` usava `encodeURIComponent()` na key inteira, escapando os separadores `/` para
   `%2F` — toda quarantine key real tem múltiplos segmentos, quebrando 100% das promoções reais.
6. A verificação pós-cópia (`headObject` no bucket clean) precisa de `s3:GetObject` (peculiaridade
   do S3: não existe action IAM "HeadObject") — nunca concedido no bucket clean (só `PutObject`).

**Evidência real de que funciona, ponta a ponta** (2026-08-22, ver PR #32 e commits seguintes):
upload real de PDF limpo → GuardDuty real → `NO_THREATS_FOUND` → `status: CLEAN` real, objeto
real no bucket clean, quarantine deletado. Upload real do arquivo EICAR padrão da indústria →
GuardDuty real → `THREATS_FOUND` → `status: REJECTED` real. Alarme `DocumentMalwareThreatsFound`
disparou de verdade (`StateValue: ALARM`). Limpeza completa verificada: buckets vazios, todos os
registros `Document`/`UploadSlot`/`IdempotencyRecord` de teste deletados, usuário/role IAM
temporários criados para diagnóstico de permissão deletados e confirmados (`NoSuchEntity`).

Pendências reais não resolvidas nesta sessão: teste de reconciliação real (timeout de upload slot
expirado, mecanismo implementado e testado unitariamente mas não exercitado em Camada 3);
extração de conteúdo do documento (M7, depende de M6, ainda não iniciado).

## Pendência registrada (2026-08-22): Frontend e BFF de sessão não têm milestone atribuído

Achado ao responder uma pergunta direta do Marcelo sobre em que fase o frontend entra: **não
entra em nenhum milestone nomeado nos M0-M8 atuais.** Isso é uma lacuna real, não uma decisão
fechada — decisão registrada é só sobre O QUE o frontend será (S3+CloudFront, D-012, Type 2),
nunca QUANDO construí-lo. Todos os M0-M8 são 100% backend (identity, expiration core, reminder,
notification, document upload/malware, extraction, hardening). Consequência prática: CSP/
CloudFront Response Headers Policy (adiada em M1, `implementation-blueprint.md` §4.2) e o BFF de
sessão (`/session/refresh`, `/session/logout` — Cognito já configurado para o padrão, endpoints
nunca implementados) seguem em aberto, re-flagueados a cada handoff de sessão desde M1 sem nunca
virar ação concreta (ver linha "Judgment calls" do M1 abaixo e item 2 da lista histórica de
"Próxima ação obrigatória").

**Decisão explícita do Marcelo (2026-08-22): registrar como pendência para etapa posterior, não
resolver agora.** Não bloqueia M7/M8 (ambos são backend). Quando o projeto entrar na fase de
construir uma interface de usuário real, esse é o ponto para: (1) decidir formalmente em qual
milestone (provavelmente um M9 novo, pós-M8, ou uma iniciativa paralela) o frontend entra; (2)
implementar CSP/CloudFront Response Headers Policy junto da distribuição CloudFront real; (3)
implementar as rotas HTTP do BFF de sessão. Até lá, todo teste/exercício real deste projeto
continua sendo feito via chamada direta a Lambda/API (padrão já usado em M0-M6), nunca via UI.

## Renumeração de milestone registrada (2026-08-22) — leia antes de qualquer trabalho de M6/M7

Achado real de drift de contexto: "M5" já foi usado para Observabilidade (inserção ad hoc, não
fazia parte do `implementation-blueprint.md` original — `decisions-log.md` D-030). O blueprint
original define M5="Document upload e malware boundary", M6="Extraction e confirmação",
M7="Hardening operacional" — esses 3, ainda não implementados, agora são tratados como **M6**,
**M7**, **M8** neste projeto (nota registrada em `implementation-blueprint.md` §19, mesmo padrão
de inserção já usado para M3.5). `docs/architecture/diagrams/project-status.html` já atualizado.
**Próxima ação real de produto: M6 = Document upload e malware boundary** (upload presigned,
quarentena S3, GuardDuty, promoção CLEAN, exclusão segura) — não "Extraction/AI" como uma
referência vaga anterior sugeria; extração (M7) depende de M6 existir primeiro.

## Progresso real desta sessão (2026-08-21/22, resumo — ver seções datadas abaixo para detalhe)

Camada 3 real (IAM negativo + DLQ/redrive, decisão do usuário de reusar a conta `dev`) achou um
bug crítico colateral: `reminder-producer` parado ~1 dia inteiro (EventBridge Scheduler +
`jsonencode()` HTML-escapando o placeholder) — corrigido e verificado. Na sequência, 2 achados
abertos da rodada focada de auditoria foram fechados via protocolo Claude↔Codex completo,
implementados, deployados e verificados em produção real: mecanismo de rollback (alias+versão
Lambda, manifesto S3, `rollback.yml`, exercitado de ponta a ponta) e trilha de auditoria de
segurança (negação de autorização + acesso GSI3/GSI6, 3 alarmes reais). 255→274 testes.

## Trilha de auditoria de segurança — MVP implementado, commitado em `develop` (2026-08-22), aguardando deploy

Achado real aberto da rodada focada (Segurança-Logging/OWASP A09:2025 + SRE-Detecção) fechado via
protocolo Claude↔Codex completo (nota cega round1: Codex 9.4/10 com proposta muito mais completa
que a minha inicial; round2 reconciliação aceita com 2 ajustes — divisão MVP-desta-sessão vs.
entrega futura, módulo em `src/shared/observability/`). Design:
`docs/architecture/reviews/security-audit-trail-design/codex-reconciliation-round2-final-design.md`.

Implementado: `src/shared/observability/security-audit.ts` (3 funções de taxonomia fechada —
`auditAuthorizationDenied`/`auditGlobalIndexAccess`/`auditGlobalIndexAccessDenied` — nunca
`Record<string, unknown>` arbitrário); `AuthorizationDeniedError` agora expõe `action` como
propriedade real (bug real corrigido); os 4 handlers HTTP (`item-handlers.ts`,
`policy-handlers.ts`, `preferences-handlers.ts`, `test-route-handler.ts`) emitem 1 evento exato
por negação real, sem alterar a resposta HTTP; os 3 adapters GSI3/GSI6
(`dynamodb-reminder-producer-store.ts`, `dynamodb-reconciliation-candidate-source.ts`,
`dynamodb-outbox-relay-store.ts`) emitem 1 evento de sucesso por chamada lógica (mesmo paginada)
e 1 evento de negação real em `AccessDeniedException`, sem alterar retry/DLQ;
`outbox-sweeper-handler.ts` corrigido (não chamava `runWithContext`, achado real do Codex — sem
isso os eventos de GSI6 do sweeper não tinham `correlationId`); novo módulo Terraform
`infra/modules/security-audit-observability` com 3 alarmes reais (`SecurityAuthorizationDeniedBurst`,
`SecurityAuthorizationTenantBoundaryDenied`, `SecurityGlobalIndexAccessDenied`) ligados ao
`alert-topic` real de M5. Nova regra de `dependency-cruiser` (`shared-must-not-reach-modules`)
adicionada para não deixar essa arquitetura ser violada silenciosamente no futuro.

274 testes (era 264), incluindo cobertura real da trilha (formato/redação, 1-evento-por-chamada
mesmo paginada, `AccessDeniedException` sintético não altera retry, 1-evento-por-negação real via
`authorize()` de verdade em 2 dos 4 handlers). `terraform test` (módulo novo + raiz) verde;
`terraform plan` real contra `dev`: 14 a adicionar, 26 a mudar (todas as 13 funções recebem nova
versão/alias porque o módulo compartilhado novo entra no bundle de todas), 0 destroy.

**Fora do MVP desta sessão, explicitamente**: alarme de anomalia de volume de acesso a GSI3/GSI6
(a instrumentação `pageCount`/`resultCount` já existe para gerar dado, mas o alarme em si só pode
ser calibrado depois de observar baseline real em `dev` — não fechar isso especulativamente).

**Deployado e verificado em produção real (2026-08-22)**: PR #22 mergeado, `cd.yml` real.
**Achado real durante o deploy**: `terraform apply` falhou na primeira tentativa —
`aws_cloudwatch_log_metric_filter` para `items-handler`/`reminders-handler` exigia log group
já existente, mas essas 2 das 13 funções nunca tinham sido invocadas em `dev` (CloudWatch só cria
o log group no primeiro `Invoke` real). Corrigido criando os 2 log groups vazios via
`aws logs create-log-group` (fora do Terraform, não é `apply` manual — só supre um pré-requisito
de uma API que o Terraform não gerencia), deploy re-executado com sucesso
(`gh run rerun --failed`). Achado estrutural registrado (não corrigido agora): qualquer função
nova adicionada a este módulo que nunca tenha sido invocada reproduz o mesmo erro — candidato a
melhoria futura (`lambda-function` module gerenciar `aws_cloudwatch_log_group` explicitamente).

Verificação real pós-deploy: evento real `security.global_index_access` confirmado nos logs reais
de `reminder-producer` (gerado pelo schedule real, correlacionável por `correlationId`); os 3
alarmes reais exercitados `OK→ALARM→OK` via `aws cloudwatch set-alarm-state`, todos publicando de
verdade no tópico SNS real de M5. Evento de negação de autorização real **não** exercitado via
API real por decisão deliberada (exigiria fabricar identidade quebrada na tabela real de `dev`,
sem valor que justifique o risco) — aceito como evidência suficiente os 2 testes reais
(não-mockados) que já exercitam `authorize()` de verdade. Detalhe completo:
`docs/architecture/reviews/security-audit-trail-design/real-exercise-2026-08-22.md`.

## Mecanismo de rollback — entrega 1 implementada, commitada em `develop` (2026-08-21/22), NÃO deployada

Achado real da rodada focada (rollback/roll-forward inexistente) fechado via protocolo
Claude↔Codex completo (nota cega round1: Codex 8.6-8.7×2 propostas independentes convergiram no
mesmo mecanismo; round2 reconciliação com 3 ajustes meus aceitos — bucket S3 dedicado, gate de
aprovação humana no `workflow_dispatch`, canários semânticos fatiados como entrega 2 — nota final
9.1-9.2 dos dois lados). Design completo:
`docs/architecture/reviews/rollback-mechanism-design/codex-round2-final-design.md`.

Implementado: alias `live` real + versionamento em `infra/modules/lambda-function` (todo
invocador real — API Gateway, event source mappings, EventBridge Scheduler — aponta pro alias,
nunca `$LATEST`); módulo novo `infra/modules/deploy-manifest-bucket` (bucket S3 dedicado,
privado, versionado, nunca dado de tenant); `cd.yml` com `plan -out=tfplan`/`apply tfplan` (fecha
de brinde o achado de "artefato recalculado, não promovido"), verificação real de alias
pós-apply, manifesto de deploy + ponteiro `current-healthy` só avançado após sucesso completo;
`rollback.yml` novo (`workflow_dispatch` manual, `environment: dev` — precisa de required
reviewer configurado nas settings do GitHub, passo operacional ainda pendente de confirmação),
com compensação real de falha parcial.

`terraform test` (módulo + raiz) verde; `terraform plan` real contra `dev`: 23 a adicionar, 31 a
mudar (12 são replace de `aws_lambda_permission` só para adicionar `qualifier="live"`,
esperado), 0 destroy de dado/infra crítica.

**Decisão do usuário (2026-08-21/22): sem required reviewer no environment `dev`, deliberadamente.**
Perguntado sobre configurar isso (eu tentei via API, bloqueado pelo classificador de permissões
do Claude Code — mudança de configuração de repositório), a resposta foi: "não quero que você
não consiga trabalhar de maneira autônoma, então não acho que seja interessante me colocar como
reviewer no momento". Ou seja, o gate de aprovação humana que o design original do `rollback.yml`
previa como "critério operacional obrigatório da entrega" foi **deliberadamente não configurado**
— trade-off consciente entre segurança extra e permitir que o agente dispare `cd.yml`/
`rollback.yml` sem pausar esperando aprovação manual. Não reabrir essa pergunta em sessões
futuras sem um motivo novo e real (ex. um incidente causado por disparo não intencional).

**Mergeado e deployado com sucesso (2026-08-22)**: PR #20 mergeado (usuário: "pode fazer o merge
e prosseguir... você não precisa de minha autorização"), `cd.yml` real aplicou via pipeline.
Verificação real pós-deploy (não só o smoke test do próprio `cd.yml`, verificação independente
nesta sessão):
- As 13 aliases `live` reais confirmados via `aws lambda get-alias`, todos em `v1`.
- Manifesto real persistido em `s3://exptrk-dev-deploy-manifests/deployments/32547276849-1.json`
  + `pointers/current-healthy.json` (mesmo conteúdo, `previousHealthyDeploymentId: null` — é o
  primeiro deploy healthy desde que a entrega 1 existe).
- Zero erros reais nas 3 funções agendadas (`reminder-producer`/`reminder-reconciliation`/
  `outbox-sweeper-reminder-dispatch`) nos minutos seguintes ao deploy.
- Chamada HTTP real contra o endpoint real da API (`GET /test/ping` sem token) retornou
  **401** (não 500/502) — prova que a cadeia real API Gateway→autorizer JWT→integração→alias
  `live`→Lambda está intacta depois do rewiring simultâneo das 13 funções.

**Rollback exercitado de ponta a ponta com evidência real (2026-08-22)** — rodada 3 focada
(`docs/engineering/reviews/full-audit-round1-focused-round3-summary.md`) reavaliou os 2
critérios ainda abaixo do gate; Codex encontrou e eu corrigi 2 bugs reais em `rollback.yml`
(passo de compensação sem `id:` classificava toda falha parcial incorretamente; validação de
manifesto não checava conjunto exato de nomes de função nem formato de versão). Depois disso,
mudança trivial e reversível forçou um segundo deploy real (`test-ping-handler` v1→v2),
seguido de um rollback real disparado via `gh workflow run rollback.yml` — verificado
independentemente via AWS CLI: alias voltou pra v1, `current-healthy` restaurado ao manifesto
anterior, registro real `routing_restored`/`health_verified`/`completed`, API real continuou
respondendo corretamente (401) depois do rollback. Detalhe completo:
`docs/architecture/reviews/rollback-mechanism-design/rollback-exercise-2026-08-22.md`. **Os 2
critérios agora batem o gate ≥9.0** (9.3 e 9.1). Achado residual não bloqueante: caminho de
compensação de falha parcial nunca foi exercitado com uma falha real induzida (só por leitura
de código); ausência de validação diferenciada por blast radius de schema/GSI/KMS permanece
real, candidato a design futuro. Canários semânticos (entrega 2) continuam registrados como
escopo futuro explícito, não implementados.

## Passo 1 concluído (2026-08-21) — rodada focada Claude↔Codex, ver `full-audit-round1-focused-round2-summary.md`

2 dos 6 critérios fecharam (nota ≥9.0 dos dois lados): Debuggability & Operational Feedback (9.2),
e Correção do Serviço de Lembretes/preferências (9.3, depois de corrigir achado real do Codex —
`getOrCreatePreferences()` marcava proveniência falsa `consentSource: "ONBOARDING"` num bridge que
não é o onboarding real; corrigido para `"MIGRATED_DEFAULT"`, valor do enum que já existia para
esse caso exato). Achado documental corrigido (afetava 2 critérios): `incident-runbooks.md`
afirmava falsamente que não havia `alarm_actions`/SNS — atualizado para refletir M5 real.

**4 critérios permanecem abaixo do gate, achado real não-arredondado, classificado como trabalho
de design/feature (não ponto-fix desta rodada)**: rollback/roll-forward real ausente em `cd.yml`
(afeta Delivery/Recovery e SRE-Deploy/Rollback); trilha de auditoria de segurança dedicada ausente
para negação de autorização/acesso a GSI3/GSI6 (afeta Segurança-Logging e parcialmente
SRE-Detecção/Resposta, que também carece de um exercício humano completo de incidente, não só o
teste de transporte de alarme já realizado). Candidatos para uma sessão dedicada de design de
deploy/segurança — decidido nesta sessão (ver abaixo) que a próxima prioridade estrutural é a
Camada 3, não esses 4 itens diretamente.

## Passo 2 concluído (2026-08-21) — template de e-mail real e versionado

Decisão do usuário: motor = string interpolation simples versionada em código (sem motor
externo/dependência nova); localização = só pt-BR por agora. Implementado:
`src/modules/notification/providers/email-templates.ts` (registro `templateId`→`templateVersion`→
`locale`→renderer, fail-closed em combinação desconhecida, escapa HTML), `ses-email-adapter.ts`
passou a chamar `renderEmailTemplate()` real em vez do placeholder ad-hoc anterior. Teste novo
`test/unit/notification/email-templates.test.ts` (4 casos: render real, defaults, escape de
HTML/injection, fail-closed em combinação desconhecida). 259/259 testes, typecheck/lint/
check-boundaries/validate-schemas/check-docs limpos.

**Spike de validação das tags SES em sandbox real continua bloqueado** — usuário confirmou que
ainda não tem identidade SES verificada; permanece pendência externa genuína, não tentar sem
identidade real.

## Camada 3 — primeiros testes reais executados (2026-08-21), achado severo encontrado e corrigido

Decisão do usuário: reusar a conta `dev` real (sem conta nova), da forma mais segura possível, com
verificação explícita de limpeza depois de cada teste.

1. **Teste de IAM negativo real** (`aws iam simulate-principal-policy`, motor de avaliação real da
   AWS contra as políticas reais anexadas — zero recursos criados, nada para limpar): confirma
   exatamente o isolamento desenhado em M3.5 — as 10 roles não-privilegiadas negadas em GSI3 e
   GSI6; `reminder-producer` permitida só em GSI3; `reminder-reconciliation` e
   `outbox-sweeper-reminder-dispatch` permitidas só em GSI6, nenhuma com as duas. Controle
   positivo confirma que a role tem acesso real à tabela base (não é role sem permissão alguma).
   Evidência completa: `docs/architecture/reviews/camada3-iam-negative-test-2026-08-21.md`.
2. **Teste real de poison message → DLQ → redrive** contra `exptrk-dev-reminder-dispatch`: mensagem
   sintética real esgotou `maxReceiveCount=5` e caiu na DLQ real (~4.5min); redrive real via
   `aws sqs start-message-move-task` executado com o event source mapping temporariamente
   desabilitado (nunca deixando a mensagem ser reprocessada de verdade); limpeza verificada
   (fila/DLQ voltaram a 0, event source mapping reabilitado, estado idêntico ao baseline). Nenhum
   recurso ficou órfão. Evidência: `docs/architecture/reviews/camada3-dlq-redrive-test-2026-08-21.md`.
3. **Achado severo real, não relacionado aos testes acima, encontrado ao investigar telemetria
   real durante a Camada 3**: `exptrk-dev-reminder-producer` estava falhando em **100% das
   invocações desde 2026-08-20T14:41:39Z** (~1 dia inteiro) — motor de lembretes real de `dev`
   efetivamente parado. Causa: `jsonencode()` do Terraform HTML-escapa `<`/`>` do placeholder
   `<aws.scheduler.scheduled-time>`, o que quebra a substituição textual literal que o
   EventBridge Scheduler faz — o handler recebia o texto literal do placeholder em vez de um
   timestamp real, e essa função em particular valida `scheduledTime` como fatal. As outras 3
   schedules (`reminder-claim-reconciliation`/`reminder-dst-reconciliation`/
   `outbox-sweeper-reminder-dispatch`) tinham o mesmo bug de armazenamento, mas **sem impacto
   funcional real** — verificado que seus handlers não validam nem usam `scheduledTime` na
   lógica (reconciliação só loga o valor; sweeper nem lê o campo). Corrigido em
   `infra/modules/reminder-schedule/main.tf` (input via string HCL literal, não `jsonencode()`)
   para as 4, por consistência/prevenção, não só pela produtora.
   **Achado adicional**: os testes Terraform existentes comparavam contra o mesmo `jsonencode()`
   usado em produção, certificando o bug como correto — corrigidos para comparar contra o texto
   literal esperado, com um teste novo de regressão anti-escape na raiz.

**Deployado e verificado em produção real (2026-08-22)**: PR #19 (`develop→main`) mergeado,
`cd.yml` aplicou via pipeline com sucesso. Confirmado via `aws scheduler get-schedule` que o
`Input` armazenado não tem mais escaping, e via métricas CloudWatch (`Invocations`/`Errors` de
`exptrk-dev-reminder-producer`) que, após o backlog de retries assíncronos remanescentes drenar,
a função passou a invocar com sucesso de forma sustentada (`Invocations=1`/`Errors=0` por
minuto). Detalhe completo, impacto real por função e verificação pós-deploy:
`docs/architecture/reviews/camada3-eventbridge-scheduler-escaping-bug-2026-08-21.md`.

## Passo 3 concluído (2026-08-21) — decisão de próximo marco estrutural

Usuário delegou a decisão. Escolhido: **Camada 3 de teste (sandbox AWS efêmero)** antes de M6/M7 —
motivo: é pendência estrutural reaberta a cada milestone desde M3.5, nunca fechada, e destrava
diretamente achados classificados como "Camada 3 pendente" em 3 eixos do full-audit
(Arquitetura/Segurança/Operações) simultaneamente — maior alavancagem que abrir superfície de
produto nova (M6/M7) enquanto essa dívida estrutural continua se acumulando. Próxima sessão deve
COMEÇAR desenhando o escopo real da Camada 3 (ambiente efêmero dedicado, distinto de `dev`; IAM
negativo real, redrive de DLQ real, invocação real do EventBridge Scheduler) — provavelmente
precisa de decisão de arquitetura (ambiente novo, custo, ciclo de vida) antes de implementar,
avaliar se o protocolo Claude↔Codex (`AGENTS.md` §4) se aplica antes de desenhar.

## Plano priorizado (2026-08-21, histórico — Passo 1 concluído acima, Passos 2/3 continuam válidos)

Análise feita ao final desta sessão: dos 8 eixos do full-audit round1 que ficaram abaixo do
gate de 9,0 (ver seção "Status mais recente" no histórico abaixo), a implementação e o deploy
real de M4/M5 nesta sessão geraram **achado novo real** — não cosmético — para 6 critérios
específicos, espalhados em 3 eixos diferentes. Isso NÃO significa reabrir os 8 eixos inteiros
(`AGENTS.md` §"não reabrir rodadas... só se houver achado novo real" continua valendo para o
resto) — só esses 6 têm evidência nova genuína desde 2026-08-20:

| Eixo | Critério | Por que há achado novo |
|---|---|---|
| Qualidade de Engenharia | Delivery/Release/Recovery Discipline | `cd.yml` real usado, corrida CI/CD real corrigida, bug pós-deploy real caçado via `aws lambda invoke` e corrigido |
| Qualidade de Engenharia | Debuggability & Operational Feedback | M5 implementou exatamente o mecanismo que faltava (`AsyncLocalStorage`/`SecureLogger` contextual) |
| Segurança da Informação | Critério 7 (alarmes sem destino de notificação real) | M5 entregou SNS→e-mail real, testado de verdade (`OK→ALARM→OK`) |
| Operações/SRE e Continuidade | Critério 3 (detecção/resposta a incidente) | Mesmo alerta real de M5 |
| Operações/SRE e Continuidade | Critério 6 (deploy/rollback) | Mesma evidência de `cd.yml` real de Qualidade |
| Governança de Produto Multi-tenant | "Correção do Serviço de Lembretes" (nota 8,6 — "entrega/feedback de provider é M4+") | M4 entregou SES real + rota `/notifications/preferences` self-service |

### Passo 1 — Rodada focada Claude↔Codex (só esses 6 critérios, não os eixos inteiros)

Protocolo `AGENTS.md` §4, nota cega, mínimo 3 rodadas, ≥9,0 sem arredondar por critério (não
por eixo — os outros critérios de Qualidade/Segurança/Operações/Produto continuam como estavam,
não fazem parte desta rodada). Ler `docs/engineering/joint-review-criteria.md` para o texto
exato de cada critério antes de avaliar contra o estado real do repositório (não contra intenção
documentada). Registrar o resultado em
`docs/engineering/reviews/full-audit-round1-<eixo>-round2-*` (mesmo padrão de nomenclatura já
usado) e atualizar os `*-summary.md` correspondentes.

### Passo 2 — Fechar os residuais reais de M4 (não bloqueantes, mas pontuais)

1. **Spike de validação das tags SES em sandbox real** — depende de uma identidade SES
   verificada (passo manual, fora do Terraform) antes de rodar; perguntar ao usuário se já tem
   uma identidade de e-mail/domínio pra verificar, ou se isso continua bloqueado externamente.
2. **Template de e-mail real e versionado** (`templateId`+`templateVersion`, hoje placeholder em
   `ses-email-adapter.ts`) — decisão de produto sobre motor de template/localização antes de
   implementar; não é ponto-fix trivial, calibrar `docs/engineering/change-risk-scale.md` (é
   Nível 3-4, não deveria precisar do protocolo Claude↔Codex, mas confirmar).

### Passo 3 — Decidir o próximo marco estrutural (M6/M7 ou Camada 3)

Duas opções reais, mutuamente não-exclusivas, mas uma decisão de prioridade é necessária:
- **M6/M7** (`implementation-blueprint.md` §19: Document/AI, evidência operacional final) — é o
  próximo marco de produto per o blueprint original.
- **Camada 3** (sandbox AWS efêmero: teste negativo de IAM real, redrive de DLQ real, invocação
  real do EventBridge Scheduler) — pendência estrutural reaberta a cada milestone desde M3.5,
  nunca fechada. Destravaria diretamente vários achados de Arquitetura/Segurança/Operações
  classificados como "Camada 3 pendente" no full-audit.

Não presumir qual vem primeiro sem perguntar ao usuário — é decisão de priorização de produto,
não técnica.

### Pendências não relacionadas a este plano, mantidas como estavam (ver full-audit no histórico)

Privacidade/Jurídico (DSR/purge, DPA, parecer jurídico, região AWS), Governança de IA (processo,
não arquitetura), Produto Multi-tenant (control plane, catálogo de planos — exceto o critério do
Passo 1), e os critérios de Operações que exigem tráfego/incidente/backup real — nenhum desses
muda com código desta sessão, continuam exatamente como classificados no full-audit round1.

---

## Status atual (2026-08-21) — M5 implementado, deployado, verificado em produção real e operacionalmente fechado.

**M5 (Observabilidade)** está implementado, revisado pelo protocolo Claude↔Codex e **verificado
funcionando na conta AWS `dev` real** — não só "código no repo". Linha do tempo resumida (detalhe
completo no histórico abaixo, se precisar dos porquês):

1. Implementação de `correlationId`/`tenantId` contextual via `AsyncLocalStorage`, ADOT tracing,
   alerta SNS→e-mail — revisão Claude↔Codex 7,4→8,8→**9,1/10**.
2. Achado colateral (`reminder.dispatch.v1` nunca cumpria seu próprio schema de envelope) —
   corrigido no mesmo dia, revisão Claude↔Codex **9,2/10** de primeira (Nível 5 da escala de
   risco, `DispatchCommand` passou a emitir `messageVersion`/`messageId`/`createdAt`/
   `correlationId` reais).
3. Deploy real via `cd.yml` exigiu 3 correções de infra que nada tinham a ver com o código do
   milestone: role de CI/CD trocada para `GITHUB-OIDC-ROLE` (decisão do usuário — essa role tem
   policy `Action:*/Resource:*`, admin total da conta, mantida assim deliberadamente após o
   risco ser avisado), trust policy da role corrigido para o formato "imutável" do `sub` claim
   OIDC do GitHub (`repo:owner@orgId/repo@repoId:*`, não só o clássico), e `dev.tfvars` com
   `alert_email`/`adot_layer_arn` reais (verificados via CLI, não placeholders).
4. **Bug real e severo pós-deploy**, achado via `aws lambda invoke` real: a ADOT layer quebrava
   as 12 funções (`Cannot redefine property: handler` — esbuild exporta `handler` como getter
   não-configurável, o `shimmer`/instrumentation do OTel não consegue envolvê-lo). Corrigido em
   `scripts/build-lambdas.ts` (esbuild `footer` reatribui `module.exports` a um objeto plano
   novo) + teste de regressão real (`test/unit/build-lambdas-export-shape.test.ts`). Verificado
   corrigido via novo `aws lambda invoke` real após redeploy.
5. **Achado de infra separado, também corrigido**: `ci.yml` e `cd.yml` disparavam ambos em
   `push: branches: [main]`, competindo pelo mesmo lock nativo do state no S3 — quem perdia
   falhava com "Error acquiring the state lock" (parecia lock travado, era só corrida). Corrigido:
   `cd.yml` agora dispara via `workflow_run` (`workflows: ["CI"]`), só depois da CI real terminar
   com sucesso — verificado funcionando sequencialmente num merge real subsequente.
6. **Subscription SNS confirmada pelo usuário** (`tchelojg@gmail.com`, deixou de ser
   `PendingConfirmation`). **Teste real de alarme→e-mail executado**: `exptrk-dev-reminder-producer-errors`
   tinha um estado `ALARM` real e antigo (de 2026-08-20, antes do M5 ter destino de notificação) —
   limpo para `OK`, depois forçado `OK→ALARM→OK` via `aws cloudwatch set-alarm-state` (método
   prescrito pelo próprio design M5 §4 para esse teste), publicando de verdade no tópico
   `exptrk-dev-alerts` já confirmado.

**Nenhuma pendência técnica bloqueante conhecida para M5.** Todas as PRs (#8–#16) mergeadas em
`main`, todas revisadas/testadas conforme o protocolo aplicável, suíte de testes verde, deploy
real confirmado saudável.

### Pendências reais não-M5 ainda abertas (backlog do projeto, nenhuma bloqueante)

- **M4**: spike de validação das tags SES em sandbox real (nunca provado contra API real),
  template de e-mail real versionado (hoje placeholder em `ses-email-adapter.ts`).
  - ~~Rota HTTP `PUT /notifications/preferences`~~ **FECHADA nesta sessão**: novo
    `GET`/`PUT /notifications/preferences` (`src/modules/notification/http/preferences-handlers.ts`
    + `NotificationPreferencesService` + `notifications-handler.ts`/infra novos). Achado real
    descoberto ao implementar: `defaultNotificationPreferences()` nunca era chamado em lugar
    nenhum do `src/` — "hoje só via onboarding" no backlog era aspiracional, não código real.
    Bridge pragmático: o `GET` cria o registro padrão na hora se ele não existir (em vez de
    depender de um onboarding que não existe), e o `PUT` reusa a mesma lógica. Ação
    `notification:configure` já existia na matriz de autorização (`ADMIN_ROLES`/OWNER) — sem
    mismatch real porque o MVP é `tenantId=userId`/tenant single-owner (`authorization.ts:36`),
    então o usuário editando as próprias preferências já É o OWNER daquele tenant.

    **Bug real pós-deploy encontrado via smoke test real** (`aws lambda invoke` contra
    `exptrk-dev-notifications-handler` real): `GET` funcionou (200), `PUT` retornou 500
    "Unknown schema $id". Causa: `schema-validator.ts`'s `defaultSchemaRegistry` usa imports
    estáticos explícitos de cada schema (necessário pro bundle esbuild-cjs — `import.meta.url`
    não funciona nesse formato, então a varredura dinâmica de diretório resolveria zero
    schemas em cold start real). O novo schema foi criado no disco mas eu esqueci de
    adicioná-lo a essa lista estática — o próprio comentário do arquivo já avisava
    explicitamente sobre esse passo manual. **Nunca pego por nenhum teste** porque
    `test/contract/schemas.test.ts` valida contra `loadAllSchemasFromDisk()` (registro
    diferente, só usado por testes/`validate-schemas`, nunca por um handler real) — só o
    `defaultSchemaRegistry` real importa os schemas estaticamente. Corrigido (linha de import +
    entrada no array) + novo teste de regressão real
    (`test/unit/notification/preferences-handlers.test.ts`) que exercita o handler de verdade
    contra o `defaultSchemaRegistry` real — confirmei que esse teste falha sem o fix (revertido
    temporariamente, reproduziu o mesmo 500) antes de restaurar. 255/255 testes,
    typecheck/lint/check-boundaries/validate-schemas/check-docs limpos.

    **Segundo bug real, mais severo, encontrado no smoke test seguinte** (agora `PUT` real
    depois do fix do schema): 400 "DynamoDB rejected IdentityStore.updateConditional:
    ValidationException". Causa real (via `aws logs`/leitura do código, não só suposição):
    `DynamoDbIdentityStore.updateConditional` (`src/modules/identity/persistence/
    dynamodb-identity-store.ts`) usava o nome de atributo `count` **direto** (sem placeholder
    `ExpressionAttributeNames`) numa `ConditionExpression` — `count` é palavra reservada do
    DynamoDB. Isso quebra **toda rota HTTP autenticada** (`items-handler`, `reminders-handler`,
    `notifications-handler`, `test-ping-handler` — todas usam `TenantQuotaService.consume()`),
    mas só na **segunda** chamada da mesma tenant dentro da mesma janela de 60s (a primeira
    usa `putIfAbsent`, sem essa `ConditionExpression`; só a partir da segunda o
    `updateConditional` é exercitado). Bug pré-existente desde M1, nunca pego por nenhum teste
    porque `InMemoryIdentityStore` (fake) não interpreta `ConditionExpression` como o DynamoDB
    real — só um teste contra DynamoDB Local real pegaria isso. Corrigido (placeholder
    `#count`) + novo teste de integração real
    (`test/integration-dynamodb/quota.dynamodb.test.ts`, Camada 2, roda no job `dynamodb-integration`
    da CI — passou de verdade contra DynamoDB Local real, não pude rodar localmente por falta de
    Docker nesta máquina). **Verificado corrigido em produção real**: duas chamadas `PUT`
    consecutivas (mesma janela de 60s) contra `exptrk-dev-notifications-handler` real, ambas
    200 — a segunda é exatamente o caminho `updateConditional` que antes quebrava sempre.
    255/255 testes, typecheck/lint/check-boundaries/validate-schemas/check-docs limpos.

  **Rota fechada e totalmente verificada em produção real** (`GET`/`PUT` funcionando, ambos os
  bugs pós-deploy corrigidos e confirmados via `aws lambda invoke` real).
- **Camada 3 de teste** (sandbox AWS efêmero: IAM negativo real, redrive de DLQ real, invocação
  real do EventBridge Scheduler) — pendência estrutural desde M3.5, nunca fechada por falta de
  ambiente de teste efêmero dedicado (distinto do ambiente `dev` real já em uso).
- **Full-audit round1** (9 eixos, ver histórico abaixo): só o eixo Engenharia de Contexto bateu o
  gate de 9,0. Os outros 8 têm achados reais classificados como impedimento externo (parecer
  jurídico, DPA de fornecedor) ou escopo de produto maior (control plane multi-tenant, DSR/purge)
  — não reabrir rodadas só para tentar melhorar nota, só se houver achado novo real.
- **Trace real X-Ray/ADOT**: **CONFIRMADO nesta sessão** via `aws xray get-trace-summaries` —
  traces reais existem para `exptrk-dev-reminder-producer` (sem `HasFault`/`HasError`), provando
  que a instrumentação ADOT está gerando telemetria de verdade, não só configurada. Não visto
  ainda no console web (só via CLI) e não confirmado especificamente para o caminho
  SQS→Lambda→DynamoDB ponta-a-ponta (só para uma invocação single-function) — refinamento
  possível, não bloqueante.

---

Design `APPROVED` (seção histórica abaixo) foi implementado de ponta a ponta nesta sessão:
`src/shared/observability/context.ts` (`runWithContext`/`getContext` via `AsyncLocalStorage` +
`correlationIdFromSqsRecord`), `SecureLogger` integrado (contexto ambiente mesclado, explícito
sempre vence), `buildOutboxRecord` copiando `event.correlationId` para `OutboxRecord`
(`outboxRecordCorrelationId` com fallback `eventId`), wiring por-record nos 12 handlers Lambda
(fontes por tipo de evento conforme o design: `MessageAttributes.correlationId` nas filas SQS
que o próprio relay/sweeper alimenta — ver achado novo abaixo —, `SequenceNumber` nos handlers
Streams, novo UUID nos produtores EventBridge Scheduler, `requestContext.requestId` nos 3
handlers HTTP), propagação real via `MessageAttributes.correlationId` no `SendMessageCommand`.
`tenantId` aninhado via `runWithContext` composto em `reminder-dispatch-handler`,
`ses-callback-handler` e `notification-router-handler` — **não** nos 3 handlers HTTP
(`items-handler`/`reminders-handler`/`test-ping-handler`), decisão deliberada aceita pelo Codex
como follow-up não bloqueante (aninhar exigiria tocar 12 funções `handleXxx` em 3 módulos sem
duplicar a chamada `resolver.resolve()`, que bate no DynamoDB — não é ponto-fix trivial).

Infra Terraform: `infra/modules/lambda-function` ganhou `adot_layer_arn` (sem default) +
`layers`/`AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler`; novo módulo `infra/modules/alert-topic`
(SNS→e-mail); `alarm_actions` wired em todos os alarmes existentes
(`reminder-observability` + os 4 `sqs-worker-queue`). `terraform test` verde em todos os módulos
afetados + raiz (mock_provider/plan real contra `claude-dev`, nunca apply);
`terraform plan -var-file=env/dev.tfvars` real: **0 a destruir/substituir** (só `layers`/
`alarm_actions`, atributos mutáveis).

Revisão de implementação via protocolo Claude↔Codex (`AGENTS.md` §4, mesmo padrão de M3.5):
7,4 → 8,8 → **9,1/10 final**, 3 rondas reais. Achados reais corrigidos: causalidade
outbox→SQS→reminder-dispatch quebrada (handler ignorava o `MessageAttributes.correlationId`
que o relay já propagava — corrigido, extraído para `correlationIdFromSqsRecord()` testável);
4 handlers batch com `try/catch` fora do `runWithContext` (logs de falha perdiam o contexto —
corrigido, `try/catch` agora fica dentro); fallback de Streams usando a fonte errada
(`eventId` do sweeper em vez de `SequenceNumber` — corrigido); teste de partial batch failure
exigido pelo design §5 estava ausente (3 records, 2º falha — adicionado, exigiu extrair
`dispatch-outbox-relay-processor.ts`/`notification-email-outbox-relay-processor.ts` sem efeitos
colaterais de topo para ficarem unit-testáveis).

**Achado novo e real, descoberto durante a revisão, registrado como pendência separada — não é
escopo de M5, mas é bloqueante para prontidão operacional real do Reminder Dispatch**:
`schemas/queues/reminder-dispatch.v1.json` exige (via `allOf` de `command-envelope.v1.json`)
os campos de envelope `messageVersion`/`messageId`/`createdAt`/`correlationId` no corpo da
mensagem SQS — mas o `DispatchCommand` real construído em
`src/workers/reminder-producer/producer.ts` (e serializado como o body real via
`buildOutboxRecord`'s `payload: event.data` → relay's `JSON.stringify(payload)`) nunca teve
esses campos, só `commandType`/`tenantId`/`deduplicationKey`/`data`. Isso significa que
`reminder-dispatch-handler.ts`'s validação de schema contra o corpo real **falharia sempre**
em produção real (mensagem tratada como poison/schema-invalid) — bug pré-existente a M5, nunca
exercitado por nenhum teste (`test/integration/reminder-engine.test.ts` chama `dispatchOccurrence()`
diretamente, nunca passa pelo handler/JSON.parse/validate; `test/contract/schemas.test.ts` só
valida um exemplo de envelope escrito à mão, nunca o objeto real). **Divergência temporária e
consciente do design M5 registrada aqui**: para este contrato legado específico, a fonte real do
`correlationId` no `reminder-dispatch-handler` é `MessageAttributes.correlationId` (que o
relay/sweeper já propaga corretamente), não `record.body` como o design prescreve em geral para
SQS — isso não é evidência de que o envelope atual está correto, é uma exceção temporária até o
bug ser corrigido.

**Próxima ação real (nova, alta severidade para prontidão operacional, antes do próximo deploy
que exercite Reminder Dispatch de verdade)**: decidir formalmente o formato de wire completo de
`reminder.dispatch.v1` (adicionar `messageVersion`/`messageId`/`createdAt` reais ao
`DispatchCommand`, ou revisar o schema/envelope) — muda um contrato SQS já em uso desde M3,
provavelmente Type 1 (`AGENTS.md` §4, avaliar se precisa do protocolo Claude↔Codex) — e então
adicionar um teste de contrato real producer→outbox→relay→body JSON→validação do consumer, que
hoje não existe em lugar nenhum (o gap que deixou esse bug invisível).

**Ainda não feito (pendências explícitas do design, registradas como critério de aceite, não
"resolvido" por este `terraform plan`)**: confirmação manual da subscription SNS→e-mail (passo
humano — `infra/env/dev.tfvars`'s `alert_email`/`adot_layer_arn` são placeholders/valores a
verificar antes de um `apply` real via pipeline: e-mail real do operador, e o ARN/versão real da
ADOT layer publicada pela AWS no momento do primeiro `cd.yml` que tocar isso); teste real de
alarme→e-mail; trace real X-Ray/ADOT verificado em ambiente real (mesma pendência estrutural de
Camada 3 de M3.5/M4).

---

## Status M5 (2026-08-20, histórico — superado pela seção acima): design APPROVED (Claude 9,1 / Codex 9,3, 4 rondas reais) — implementação ainda não começou

`docs/architecture/m5-observability-design.md` está **APPROVED** (protocolo `AGENTS.md` §4).
Escopo: correlationId/tenantId contextual via `AsyncLocalStorage` (granularidade por-record em
handlers batch, propagado ponta a ponta via `DomainEvent.correlationId` — já obrigatório, sem
mudança de schema — copiado explicitamente para `OutboxRecord`, nunca lido de contexto ambiente
no momento do envio); tracing distribuído via **ADOT Lambda layer exportando para X-Ray**
(não `aws-xray-sdk-core`, SDK legado em manutenção — achado real da revisão do Codex, corrigido
na ronda 1→2); alerta real de alarme via **SNS→e-mail** com confirmação manual da subscription
registrada como critério de aceite explícito (não fechado só pelo `terraform apply`). ADR
formal: `docs/architecture/adr/ADR-0010-observability-correlation-tracing-alerting.md`.
Histórico completo das 4 rondas (nota 6,8→8,6→8,9→9,3): `docs/architecture/reviews/
m5-observability-design/codex-round{1,2,3,4}.txt`.

**Limite explícito registrado no design, não pendência a "resolver"**: APIs são HTTP API
(D-011), sem segment X-Ray nativo do API Gateway — a borda HTTP de entrada é correlacionada por
log (`correlationId`), não por span de tracing; migrar para REST API só por isso foi
explicitamente rejeitado como desproporcional a este estágio.

**Nada foi implementado ainda** — design apenas, nenhum commit de código/infra desta sessão além
dos documentos de design/ADR/decisions-log. Próxima ação real: implementar seguindo o mesmo
padrão de M3→M3.5→M4 (lógica pura → adapters/infra → testes) — a ordem sugerida pelo próprio
design é: (1) `runWithContext`/`getContext` em `src/shared/observability/` + testes de
isolamento ALS; (2) `buildOutboxRecord` copiando `correlationId` + testes de causalidade
outbox→relay→SQS + partial batch failure; (3) wiring por-record nos 12 handlers Lambda; (4)
ADOT layer + `infra/modules/lambda-function` (`adot_layer_arn`, sem default, pinado por
região+arquitetura); (5) `infra/modules/alert-topic` (SNS→e-mail) + `alarm_actions` nos alarmes
existentes; (6) confirmação manual da subscription + teste real de alarme→e-mail (passo que
depende do usuário, mesmo padrão do spike SES pendente de M4).

## Status M4 (2026-08-20, histórico — superado pela seção acima quanto à próxima ação): design APPROVED + implementação completa (Camada 1 + adapters + workflows + handlers Lambda + infra Terraform) — só falta o spike de sandbox e a rota HTTP de preferências

`docs/architecture/m4-notification-engine-design.md` está **APPROVED** (protocolo `AGENTS.md` §4, nota cega Claude 9,3/10 · Codex 9,4/10, 4 rodadas reais). Nesta sessão, M4 foi implementado de ponta a ponta seguindo o mesmo padrão de M3→M3.5 (lógica pura → adapters → composition-root workflows → handlers Lambda finos → infra Terraform), tudo commitado e pushado em `develop`, CI verde (workflow 32413826928, `conclusion: success`).

**Código de aplicação** (`src/modules/notification/`):
- `domain/` — `NotificationPreferences`, `NotificationEntitlements`, `NotificationAttempt` (+ `NotificationAttemptLookup`, ponteiro tenant-scoped, + `leaseExpiresAt`), `NotificationIntent` estendido (`kind: REPLACEMENT | CORRECTIVE`, `recipientUserId`, `routedChannels`, `cancelledChannels`).
- `ports/` — `NotificationRecipientResolver`, `EmailProviderAdapter`, `NotificationStore` (com `queryAttemptsByIntent`).
- `application/` — lógica pura (`notification-router.ts`, `quiet-hours.ts`, `corrective-intent-service.ts`, `email-delivery.ts`, `ses-callback-processor.ts`) + os 3 workflows composition-root reais: `notification-router-workflow.ts` (`routeNotificationIntent`), `email-delivery-workflow.ts` (`processEmailDelivery`), `ses-callback-workflow.ts` (`processSesCallback`) — cada um carrega entidades com leitura consistente e produz UMA `TransactWriteItems`.
- `persistence/` — `DynamoDbNotificationStore`, `DynamoDbNotificationRecipientResolver` (validação tenant-scoped em duas camadas).
- `providers/ses-email-adapter.ts` — `SesEmailAdapter` real via `@aws-sdk/client-sesv2` (nova dependência instalada), classifica falhas em CONCLUSIVE_RETRYABLE/CONCLUSIVE_TERMINAL/AMBIGUOUS.

**2 bugs reais pegos pelos testes antes de qualquer deploy**: intent REPLACEMENT/CORRECTIVE usava a versão obsoleta do item/policy em vez da atual; schema `notification-email-deliver.v1` (existente desde M3) não carregava `attemptId`, necessário para o worker saber qual `NotificationAttempt` atualizar — ambos corrigidos.

**Handlers Lambda** (`src/runtime/aws/handlers/`): `notification-router-handler.ts`, `notification-email-outbox-relay-handler.ts`, `email-delivery-handler.ts`, `ses-callback-handler.ts` (inclui parser do envelope real SNS/SES) — todos finos, mesmo padrão de `dispatch-outbox-relay-handler.ts`. `outbox-sweeper-handler.ts` generalizado para cobrir os dois destinations (reminder + notification-email) na mesma role privilegiada. `scripts/build-lambdas.ts` atualizado e verificado (12 handlers empacotam com esbuild sem erro).

**Infra Terraform** (`infra/`): módulo `reminder-queue` renomeado para `sqs-worker-queue` (genérico, SIDs sem nome de reminder — achado real da crítica cruzada de M4) e reusado para as 3 novas filas (`router`, `email-deliver`, `ses-callback`); novo módulo `ses-notifications` (SES Configuration Set → SNS → policy restrita ao topic ARN exato, nunca wildcard); 4 novos módulos `lambda-function` com IAM mínimo (nenhum dos 4 tem acesso a GSI3/GSI6); event source mappings com `ReportBatchItemFailures`. Nova variável `ses_from_address` (sem default — falha rápido até a verificação real de identidade SES). `terraform test` do módulo novo (4/4) e da stack raiz (10/10, isolamento de GSI3/GSI6 e alarmes de DLQ estendidos para os 4 novos componentes) verificados com `AWS_PROFILE=claude-dev`; `terraform plan` real: 48 a adicionar, 11 a atualizar in-place, **0 a destruir/substituir**. CI (`ci.yml`, plan-only) verde.

223/223 testes de aplicação, typecheck/lint/check-boundaries/check-docs/validate-schemas limpos em cada commit.

**Ainda NÃO feito** (próxima ação real, nenhuma bloqueante para considerar M4 "codado"):
1. **Spike de validação das tags SES em sandbox real** — `ses-callback-workflow.ts` já assume que as tags (`et_attempt_id`/`et_intent_id`/`et_tenant_id`) sobrevivem nos eventos SES reais de `DELIVERY`/`BOUNCE`/`COMPLAINT`; isso nunca foi provado contra a API real. Requer uma identidade SES verificada (manual, fora do Terraform) antes de rodar.
2. **Rota HTTP de preferências** (`PUT /notifications/preferences`) — o runtime depende de `NotificationPreferences` existir (via onboarding), mas não há endpoint para o usuário editar depois. Não bloqueia o exit criterion se um usuário de teste for criado via fixture/migração.
3. Template real de e-mail (hoje é um placeholder em `ses-email-adapter.ts`/`composition/notification.ts`) — versionado, localizado, per `templateId`+`templateVersion`.
4. Camada 3 (sandbox AWS efêmero) — mesma pendência estrutural de M3.5, nunca fechada por falta de ambiente de teste efêmero disponível nesta sessão.

Depois disso, M4 está pronto para ser considerado "implementado" no sentido pleno do design aprovado.

**Reforço explícito do usuário (2026-08-20) sobre a infra desta fase de runtime**: toda implantação na AWS é via **Terraform modularizado** (novos módulos ou reuso disciplinado dos existentes em `infra/modules/`, seguindo boas práticas — nunca um bloco monolítico de recursos soltos) e **só via pipeline** (`ci.yml` plan-only em PR, `cd.yml` apply em push a `main`, OIDC) — nunca `terraform apply` local. Já era a política vigente (ADR-0009, `AGENTS.md` §7), mas o usuário pediu para reafirmar antes da fase de infra de M4 (filas, SNS, SES, EventBridge Scheduler) começar.

## Decisão do usuário (2026-08-20): Observabilidade world-class é o passo seguinte após M4 (implementação, não só design)

**O usuário decidiu que, assim que a implementação de M4 estiver concluída (não apenas o design, que já está aprovado), o próximo passo é um milestone/ADR dedicado de Observabilidade** (correlationId/tenant propagado automaticamente no logger, tracing distribuído ponta a ponta API→SQS→Lambda→DynamoDB, destino real de notificação para alarmes) — não abrir isso em paralelo a M4, só depois.

Motivação (levantada nesta sessão, ver `docs/engineering/joint-review-criteria.md`): o tema "logging/tracing world class" não tem eixo próprio no full-audit — está fatiado em 3 critérios diferentes, cada um com achado real abaixo do gate:
- **Qualidade/Debuggability** (7.7/7.5): `SecureLogger` não propaga `correlationId`/tenant automaticamente ao contexto — precisa de mecanismo de logger contextual (ex. `AsyncLocalStorage`), não ponto-fix.
- **Segurança/Logging Seguro & Incident Response** (~5.4, bem abaixo do gate): alarmes existem mas sem destino de notificação real (SNS/PagerDuty/Slack — decisão deliberadamente adiada, `infra/lib/reminder-observability.ts:11-15`); eventos de auth negada não geram trilha de segurança dedicada.
- **Tracing distribuído**: não existe nenhuma menção a X-Ray/OpenTelemetry no código nem nos critérios formais — maior lacuna real, nenhum span cobre o pipeline ponta a ponta.

Nenhum desses 3 é corrigível como ponto-fix isolado — um milestone dedicado resolveria os três de uma vez em vez de remendar cada eixo separadamente. Avaliar no início dessa sessão futura se precisa do protocolo Claude↔Codex (§4, provavelmente sim — decisão de arquitetura transversal) antes de desenhar.

## Status mais recente (2026-08-20 — leia isto primeiro, supera tudo abaixo)

**Os 9 eixos formais do full-audit round1 (`docs/engineering/joint-review-criteria.md`) estão TODOS concluídos.** Resultado real (nota cega Claude↔Codex, `AGENTS.md` §4, sem arredondar):

| Eixo | Nota final (mais baixa dos dois lados) | Gate ≥9.0? | Classificação do que falta |
|---|---:|---|---|
| Engenharia de Contexto | Claude 9,08 / Codex 9,09 | **Sim** (5 rodadas reais) | — fechado |
| Arquitetura | ver `full-audit-round1-arquitetura-summary.md` | Não | acompanhar summary — achado real de cold-start corrigido |
| Qualidade de Engenharia | ver `full-audit-round1-qualidade-summary.md` | Não | acompanhar summary |
| Segurança da Informação e AppSec | ver `full-audit-round1-seguranca-summary.md` | Não | acompanhar summary |
| Privacidade e Governança de Dados | ver `full-audit-round1-privacidade-summary.md` | Não | endpoints DSR/purge são escopo M4+ |
| Operações/SRE e Continuidade | ver `full-audit-round1-operacoes-summary.md` | Não | acompanhar summary |
| Governança de IA e Controles Internos | ver `full-audit-round1-governanca-ia-summary.md` | Não | acompanhar summary |
| Governança Jurídica, Contratual e de Terceiros | Codex 5,015/10 | Não | 2/8 critérios são impedimento externo genuíno (parecer jurídico, DPA de fornecedor não contratado); os demais são escopo de produto/processo maior. 2 fixes reais aplicados nesta sessão (LICENSE + `docs/engineering/third-party-inventory.md`). |
| Governança de Produto e Serviço Multi-tenant | Codex 4,65/10 | Não | 1 achado de concorrência real corrigido (`TenantQuotaService` tinha lost-update sob consumo concorrente — ver `full-audit-round1-produto-summary.md`); o resto é feature de produto ainda não construída (control plane de tenant, DSR/purge, ferramenta de suporte, métricas), consistente com o estágio pré-produção. |

Só o eixo Contexto bateu o gate formal de 9.0 dos dois lados. Os outros 8 ficaram honestamente abaixo, cada achado remanescente classificado como impedimento externo real ou escopo maior — **não é falha do protocolo, é o resultado esperado de auditar um projeto pré-produção sem usuários reais, sem parecer jurídico contratado e sem frontend**: a maior parte das lacunas exige trabalho que não é ponto-fix de uma sessão de engenharia (feature de produto, contrato real, decisão de negócio). Não reabrir rodadas adicionais desses 8 eixos só para tentar empurrar a nota — só reabrir se houver achado NOVO e real, ou se o projeto avançar de estágio (ex. primeiro usuário real destrava reavaliar Privacidade/Jurídico/Produto).

**Trabalho real aplicado nesta sessão além de nota/documentação** (não apenas avaliação):
- `LICENSE` + `package.json` (`license: UNLICENSED`) — antes inexistentes.
- `docs/engineering/third-party-inventory.md` — inventário versionado de fornecedores, novo.
- **Bug de concorrência real corrigido**: `TenantQuotaService.consume()` (`src/modules/identity/application/quota.ts`) fazia read-modify-write sobre um `PutCommand` incondicional, permitindo lost-update sob consumo concorrente da mesma quota. Corrigido com `IdentityStore.updateConditional()` (CAS via `ConditionExpression`) + loop de retry limitado (20 tentativas). Teste de regressão novo prova a propriedade (25 chamadas concorrentes, `limit=10` → exatamente 10 passam). Suite: 137/137 (era 136/136), typecheck/lint/check-boundaries limpos.

**Migração CDK→Terraform (ADR-0009) e primeiro deploy AWS real já concluídos numa sessão anterior a esta** (ver `docs/architecture/adr/ADR-0009-cdk-to-terraform-migration.md`, `infra/`, `.github/workflows/{ci,cd}.yml`) — CDK removido, 95 recursos reais provisionados na conta `975707451904`/`us-east-1` via pipeline (nunca `apply` local). As seções "Mudança de rumo em G8/deploy" e "Próxima ação obrigatória (histórico)" abaixo descrevem esse trabalho como pendente — **estão desatualizadas nesse ponto específico**, preservadas como histórico de como a decisão foi tomada, não como próximo passo.

### Possíveis próximas ações reais (nenhuma delas obrigatória — julgamento do usuário)

1. Retomar M4 (Notification Engine) — é o próximo marco estrutural de produto (`implementation-blueprint.md` §19), e resolveria diretamente vários achados abaixo do gate nos eixos Produto/Privacidade (endpoints DSR, control plane de tenant, ferramenta de suporte dependem de mais superfície HTTP/produto existir).
2. Fechar os 2 fixes documentais restantes do eixo Jurídico que ainda são corrigíveis sem parecer jurídico (ex. matriz de responsabilidades regulatória, calendário de revisão) — impacto pequeno na nota, mas genuinamente ponto-fix.
3. Se o usuário quiser badge/relatório consolidado do full-audit (nota por eixo, achados corrigidos, achados pendentes) num único documento novo — ainda não existe um `docs/engineering/reviews/full-audit-round1-CONSOLIDATED.md`, só os 9 summaries individuais.

---

## Próxima ação obrigatória (2026-08-19, superada pela seção acima quanto ao full-audit — preservada como histórico da decisão original)

**A próxima sessão deve COMEÇAR (antes de qualquer outra coisa, inclusive antes de retomar G8/Camada 3 abaixo) rodando o processo formal de nota do protocolo Claude↔Codex (`AGENTS.md` §4) contra os 9 eixos já formalizados em `docs/engineering/joint-review-criteria.md`** (Arquitetura, Qualidade de Engenharia, Engenharia de Contexto, Segurança/AppSec, Privacidade e Governança de Dados, Operações/SRE e Continuidade de Negócio, Governança de IA e Controles Internos, Governança Jurídica/Contratual/Terceiros, Governança de Produto e Serviço Multi-tenant — **não** o eixo FinOps, que segue deliberadamente sem critérios).

Para cada eixo: nota inicial cega de ambos (Claude e Codex, sem ver a nota um do outro) contra o estado REAL do repositório (não contra intenção documentada) → proposta de correção pontual para cada achado abaixo de 9.0 → réplica → tréplica → repetir até nota ≥9.0 de ambos em todo eixo, sem arredondar (8.99 não vira 9) — mesmo protocolo já usado em M3.5 (design 9.0/9.3, implementação 5.8→7.4→9.3 em 3 rodadas reais).

**Única exceção ao "chegar a 9.0"**: quando o achado que impede a nota tem um impedimento real e externo que não pode ser resolvido nesta sessão. Nesse caso, registrar explicitamente qual achado ficou abaixo de 9.0, por quê, e o que destravaria a correção — nunca arredondar/ignorar/fingir que fechou. Eixos sem esse tipo de impedimento (ex. Contexto, Qualidade de Engenharia, Governança de IA) não têm desculpa para não chegar a 9.0 — se a nota vier baixa, é achado real a corrigir, não celebrar como "descoberta interessante" e deixar aberto.

Registrar o resultado de cada eixo (nota final, achados corrigidos, achados com impedimento real) em `docs/engineering/reviews/full-audit-round1-<eixo>-*` (mesmo padrão de nomenclatura já usado para `security-axis-criteria-round1-*` etc.) e um resumo consolidado no topo deste arquivo ao final.

## Mudança de rumo em G8/deploy (2026-08-19, decidida ao final desta sessão — NÃO implementada ainda)

**Credenciais AWS reais já existem** — perfil AWS CLI `claude-dev` (conta `975707451904`, `us-east-1`), confirmado funcional (`aws sts get-caller-identity --profile claude-dev`). Isso desbloqueia G8/Camada 3 em tese, **mas o usuário decidiu explicitamente NÃO fazer deploy manual via `cdk deploy` a partir da CLI** — quando perguntado, a resposta foi: **"não usamos isso. Temos que criar uma pipeline e o deploy será feito por lá via terraform. vamos continuar na próxima sessão."**

Isso muda o próximo passo real de G8/M3.5 — **não** é mais "rodar `cdk bootstrap`/`cdk deploy` localmente" como as seções abaixo (histórico) ainda descrevem. É uma decisão nova, não totalmente especificada ainda, que precisa ser esclarecida no início da próxima sessão antes de qualquer implementação (nível 5-6 de `docs/engineering/change-risk-scale.md` — mudança de ferramenta de infra é decisão Type 1, protocolo Claude↔Codex provavelmente aplicável):

- O projeto usa **AWS CDK** (`infra/lib/*.ts`, `aws-cdk-lib`) desde M1 para toda a infraestrutura. A instrução de usar Terraform não especificou se isso **substitui** CDK, **coexiste** com ele (ex. Terraform só para a pipeline/bootstrap de conta, CDK continua definindo os recursos da aplicação), ou se o CDK deveria ser **reescrito** em Terraform/HCL — não presumir nenhuma dessas opções sem perguntar.
- "Pipeline" aqui não foi definida — GitHub Actions (já existe um esqueleto em `.github/workflows/deploy-dev.yml`, feito para CDK+OIDC, provavelmente precisa ser refeito para Terraform), outra ferramenta, ou algo já decidido em outro lugar que esta sessão não viu.
- **Antes de escrever qualquer HCL**: perguntar ao usuário o escopo exato (CDK vs Terraform vs coexistência), se há um repositório/padrão de pipeline de referência (ex. o projeto irmão `event-discovery-platform` já tem `infrastructure/terraform/` com módulos e OIDC — pode ser o padrão a seguir, mas não presumir sem confirmar), e revisar `docs/engineering/change-risk-scale.md`/`AGENTS.md` §4 para decidir se isso precisa de ADR formal antes de implementar.

---

## Histórico (2026-08-19, sessão de implementação M3.5 — superado pela seção acima, preservado como contexto de G8)

Milestone M3.5 (runtime real do Reminder Engine / fechamento de G8): design **APPROVED** (Claude 9.0/Codex 9.3, `docs/architecture/m3.5-runtime-design.md`) e implementação **revisada e aprovada pelo protocolo Claude↔Codex** (`AGENTS.md` §4, 3 rodadas: 5.8 → 7.4 → **9.3/10 final**, achados reais corrigidos a cada rodada — ver `docs/architecture/reviews/m3.5-runtime-design/codex-output-implementation-*.txt`). Tudo mergeado em `main` (PRs #2 e #3): wiring CDK completo (fila+DLQ+Streams+4 EventBridge Schedules, zero placeholder `501`), 8 handlers Lambda reais, 5 adapters DynamoDB reais, outbox relay+sweeper, ciclo de vida completo dos ponteiros GSI6 (`WORKSTATE#CLAIMED`/`WORKSTATE#DST_PENDING`).

**Camada 2 do plano de testes do design (DynamoDB Local via Testcontainers) executada e verde nesta sessão** — Docker Desktop foi instalado nesta mesma sessão. `test/integration-dynamodb/` (rodar com `npm run test:dynamodb`, requer Docker; job `dynamodb-integration` no CI, não bloqueante de `guardrails`) prova o exit criterion do M3 (materialize→claim→outbox→relay→dispatch→reconciliação) contra DynamoDB Local real, não fakes. 150 testes de Camada 1 + 2 de Camada 2, tudo verde.

**[Correção pós-sessão: credenciais AWS já existem — perfil `claude-dev` — e a rota de deploy mudou para pipeline+Terraform, ver seção "Mudança de rumo" acima. O parágrafo abaixo é histórico, preservado como contexto do que ainda falta tecnicamente, não como plano de ação vigente.]**

**Pendente real, única coisa que falta para declarar G8 tecnicamente fechado**: **Camada 3 (sandbox AWS efêmero)** — não executada. Sem ela faltam: teste negativo de IAM real (`AccessDenied` em GSI3/GSI6 para role tenant-facing), redrive de DLQ real, invocação real do EventBridge Scheduler (o `Input` usa `<aws.scheduler.scheduled-time>`, sintaxe confirmada correta pela documentação AWS na revisão do Codex, mas nunca invocada de verdade). Infra de deploy já preparada: `cdk.json` + `infra/bin/app.ts` (stack `ExpirationTrackerStack-Dev`, `us-east-1` — confirmado pelo usuário como escolha de ambiente dev descartável, **não** a decisão definitiva de região de produção, que segue pendente por LGPD), `aws-cdk` CLI instalado, `.github/workflows/deploy-dev.yml` (pipeline manual via OIDC, com os 4 passos de setup de conta documentados como pré-requisito — provider OIDC, IAM role, `cdk bootstrap`, variável `AWS_DEPLOY_ROLE_ARN` — nenhum feito ainda).

**Próxima ação real**: (1) confirmar/configurar credenciais AWS (`aws sts get-caller-identity`); (2) `cdk bootstrap aws://<conta>/us-east-1` uma vez; (3) `cdk deploy` real (local, via CLI — o pipeline GitHub Actions é para depois, quando OIDC estiver configurado); (4) Camada 3 de testes contra os recursos reais implantados; (5) só então atualizar `ENGINEERING.md`/`ARCHITECTURE STATUS` declarando G8 fechado — não antes.

---

## Próxima ação obrigatória (histórico — superada pela seção acima, preservada como contexto de G8)

Engineering Maturity Review concluída (checkpoints 0, 1, 2-9, 12; ver `ENGINEERING.md` na raiz para o relatório completo). Veredito: `ENGINEERING FOUNDATION STATUS: NOT APPROVED`, bloqueador único e conhecido: **G8 (recuperação real de falha assíncrona)**.

**Decisão do usuário (2026-08-19)**: tratar o fechamento pleno de G8 como **novo milestone dedicado** (mesma disciplina de M0-M3: pesquisa/design → implementação → teste real → revisão Claude+Codex), não como remediação de sessão. Escopo desse milestone, per `ENGINEERING.md` (seção "Decisão pendente: escopo de G8"):

- Adapters DynamoDB reais implementando os ports (`ReminderStore`, `ExpirationStore`, `IdentityStore`) contra AWS real — hoje só existem fakes em memória para teste.
- Handlers Lambda reais substituindo os placeholders `exports.handler = async () => ({statusCode: 501})` em `infra/lib/expiration-tracker-stack.ts`.
- Filas SQS + DLQ com redrive policy para o pipeline producer→dispatch.
- EventBridge Scheduled Rule disparando o `ReminderProducer` periodicamente (a cada minuto) e a `ReminderReconciliation` periodicamente.
- Testes de fault injection contra esse runtime real (timeout de dependência, poison message, redrive).

Antes de começar esse milestone: ler `docs/engineering/reviews/checkpoint-12-redteam/summary.md` (red team formal já identificou 5 P1 relacionados: pipeline sem recuperação, idempotência não provada no limite do efeito externo, false-green CI, concorrência/estado obsoleto entre renew/cancel/materialização/dispatch/reconciliation, blast radius cross-tenant do GSI3 via workers privilegiados) — usar como input de design, não redescobrir do zero.

Trabalho já feito nesta sessão de engenharia (não repetir): CI real corrigido e confirmado verde em 5 execuções; branch `develop` estabelecida como padrão de trabalho (`AGENTS.md` §3), `main` protegida; `dependency-cruiser` como enforcement real de boundary (achou e corrigiu 2 violações genuínas de arquitetura); testes de `reconciliation.ts`/`producer.ts` que não existiam; tentativa de fechar a vulnerabilidade de devDependency (EX-001) via upgrade do Vitest foi revertida por quebrar CI real (bug upstream do npm, não repetir sem verificar correção).

---

**Correção de 2026-08-19 (Engineering Maturity Review, Checkpoint 2-9)**: as seções abaixo (escritas ao longo das sessões de M0-M3) afirmam "nada foi commitado" e citam contagens de teste por marco que, somadas, não batem com a realidade medida agora. Estado real verificado por execução: M0-M3 **já está commitado** num único commit (`154d6e0`), e `npm test` roda **123 testes** no total (19 arquivos), não a soma das contagens individuais citadas abaixo. As seções não foram reescritas (preservadas como histórico de sessão), mas não devem ser lidas como estado de commit/contagem de teste vigente — confiar em `git log`/`npm test` reais, não nesses números. Ver `docs/engineering/03-repository-baseline.md` e `docs/engineering/reviews/checkpoint-02-09-consolidated/` para a análise completa desta divergência.

Projeto: micro-SaaS de controle de vencimentos/renovações. Pasta: `c:\Users\Usuario\Desktop\projects\expiration-tracker\`. Repo GitHub: `marcelo-jgoncalves/expiration-tracker` (privado).

Mapa completo de documentação, status vigente e regra de precedência: `docs/architecture/README.md`. Regras de processo e ferramentas: `AGENTS.md`. Log cronológico de sessões: `docs/architecture/session-log.md`.

## Status atual

```text
DESIGN MATURITY STATUS: APPROVED (arquitetura conceitual + Implementation Blueprint)
ARCHITECTURE STATUS: NOT APPROVED
```

Todo o processo de design (Fases 0-3 do prompt mestre + os 14 entregáveis das seções 35-52 + threat model seção 33 + Implementation Blueprint seção 60) está completo e aprovado — ver `ARCHITECTURE.md` na raiz para o documento consolidado. `ARCHITECTURE STATUS: NOT APPROVED` é o estado normativo correto até haver implementação real testada sob falha/carga (rubrica B, `requirements.md` §13.1) — **não é reprovação de mérito, e não muda com a conclusão do blueprint**: o blueprint é design detalhado, não evidência operacional.

## Concluído nesta sessão — Implementation Blueprint (seção 60) — APPROVED

`docs/architecture/implementation-blueprint.md`. Componentes/módulos (Identity, Expiration, Reminder, Notification, Document, Audit + workers assíncronos), interfaces concretas, eventos/schemas reais (grounded em `data-model.md`), ordem de deploy, milestones M0-M7, critérios de aceite técnicos por componente, e as 7 lacunas do `threat-model.md` incorporadas como requisito desde o início (não apêndice). Processo: 2 propostas independentes (Claude/Codex) → crítica cruzada (17 problemas reais encontrados, incluindo um erro técnico presente nas duas propostas — chave do GSI3 do scheduler não era consultável) → convergência → 5 rodadas de nota cega com correção pontual a cada achado (cabeçalho prematuro, contradição de kill switch, tabela incompleta, decisões Type 1 não propagadas às seções operativas, mapeamento de estado da Step Functions incompleto). **Nota final: Claude 9.20 / Codex 9.2 (exato)** — ambos ≥9.0 sem arredondar, 8 rodadas totais, nenhum gate violado. Decisão Type 1 nova registrada: chave global do GSI3 (`GSI3PK=DUE#yyyyMMddHHmm#NN`, exceção documentada à regra de toda chave começar por `TENANT#tenantId`) — a decisão está fechada no blueprint; falta só o registro mecânico em `data-model.md` (não bloqueia implementação).

## Concluído nesta sessão — M0 "Guardrails e contratos" (implementation-blueprint.md §19)

Todas as entregas de M0 implementadas e testadas (53 testes, `npm test`/`typecheck`/`lint`/`validate-schemas` verdes): estrutura TypeScript (`src/shared/*`, alinhada a `implementation-blueprint.md` §2), schemas JSON (`schemas/{events,queues,api}` + `sensitive-fields.json`, validados via Ajv em `src/shared/contracts/schema-validator.ts`), `SecureLogger`+`Redactor` central (`src/shared/observability/`, corpus de teste com valores canário provando que nada vaza), configuração tipada fail-fast (`src/shared/config/config.ts`), taxonomia de erro normalizada retryable/terminal (`src/shared/errors/app-error.ts`), idempotência via `PutItem attribute_not_exists(PK)` (`src/shared/idempotency/idempotency.ts`, chaves por operação conforme `data-model.md` §4), OCC com `ConditionExpression: version=:expected` (`src/shared/dynamodb/occ.ts`, `data-model.md` §5), outbox transacional (`src/shared/outbox/outbox.ts`, shape de `implementation-blueprint.md` §5.3), pipeline supply-chain (`.github/workflows/ci.yml`: npm ci imutável, actions pinadas por SHA, SBOM CycloneDX, audit, gate de schema). `AGENTS.md` §7 atualizado com comandos/convenções (número de seção corrigido em auditoria posterior; à época da escrita era §6, antes de `AGENTS.md` ganhar a seção de estratégia de branch como novo §3). Nada foi commitado (working tree aberto para revisão).

Judgment calls (blueprint estava silente): Ajv+ajv-formats para validação de JSON Schema; Vitest como test runner; ESLint `no-console` (com exceção para `src/shared/observability/**`) como o mecanismo que faz "chamada direta a `console.*` falhar no lint" (`implementation-blueprint.md` §14.1); idempotência/OCC/outbox construídos como builders puros de parâmetros DynamoDB (sem `@aws-sdk` ainda) para ficarem testáveis sem tabelas reais, que só existem a partir de M1; SLSA/assinatura de artefato adiada para M1+ (não há alvo de deploy ainda); SHAs de actions no CI pinados no momento da escrita — revisar antes do primeiro run real.

## Concluído nesta sessão — M1 "Foundation, Identity e isolamento" (implementation-blueprint.md §19)

Todas as entregas implementadas e testadas (89 testes, `npm test`/`typecheck`/`lint`/`validate-schemas` verdes): `src/modules/identity/{domain,application,ports,persistence,http}` (resolver central, matriz de autorização como código, `IdentityMapping`/`User`/`DeviceSession`/`TenantQuota` via portas SDK-agnósticas) e `infra/{lib,bin}` (`ExpirationTrackerTable`, `ExpirationTrackerAuth`, `ScopedLambdaFunction`, `ExpirationTrackerApi` com a rota `GET /test/ping`). Suíte cross-tenant negativa em `test/integration/cross-tenant.test.ts` (9 casos, exit criterion do marco) e synth de infra em `test/infra/stack.test.ts` (6 casos, via `aws-cdk-lib/assertions`, sem AWS CLI). Detalhe completo em `docs/architecture/session-log.md`.

Judgment calls (blueprint silente ou pendência externa já conhecida): (1) MFA implementado como prop configurável (`OFF`/`OPTIONAL`/`REQUIRED`, default `OPTIONAL`) pois UNK-006 segue pendente de pesquisa externa — não bloqueava M1; (2) CSP/CloudFront Response Headers Policy **não implementado nesta sessão** — não há distribuição CloudFront/frontend ainda no repositório, e o texto do blueprint (§4.2) coloca CSP no contexto do SPA estático servido por CloudFront; tratado como pertencente ao milestone que introduzir o frontend, não forçado em M1 (revisar se essa leitura estiver errada); (3) sessão/revogação modelada como campo `globalLogoutAfter` no item `User` + item filho `DeviceSession` (`TENANT#t#USER#u`/`SESSION#<deviceId>`) em vez de uma entidade `Session` de primeira classe — `data-model.md` não define uma; (4) `ScopedLambdaFunction` mantém a lista de entidades por capability como metadado/documentação, mas o IAM real concedido é table-level (`grantReadWriteData`) — DynamoDB IAM não expressa restrição por SK/entidade da forma que a sintaxe do blueprint sugere visualmente; per-entity IAM mais fino fica como follow-up; (5) `TenantQuota` implementado como janela fixa (fixed-window), não sliding-window/leaky-bucket — mais simples e ainda satisfaz "decremento atômico, sem race condition" do `data-model.md`; (6) BFF de sessão (`/session/refresh`, `/session/logout`) **não implementado como rota HTTP nesta sessão** — o Cognito client já está configurado para o padrão (client secret, tokens de vida curta), mas os endpoints do BFF em si ficam para quando a Expiration/Notification API skeleton crescer além da rota de teste; revisar se isso deveria ter sido parte do exit criterion. `cdk synth` real via CLI não foi executado (o pacote `aws-cdk` CLI não está instalado, só a lib `aws-cdk-lib`); a sintetização foi verificada programaticamente via `Template.fromStack` nos testes, que é equivalente para fins de validação estática.

## Concluído nesta sessão — M2 "Expiration core e Audit" (implementation-blueprint.md §19)

Todas as entregas implementadas e testadas (134 testes, `npm test`/`typecheck`/`lint`/`validate-schemas` verdes): `src/modules/expiration/{domain,application,ports,http}` — CRUD/renew (`ExpirationService`: createItem/getItem/updateItem/archiveItem/deleteItem/renewItem/listDashboard), OCC via `shared/dynamodb/occ.ts`, `ItemDueDateChanged` por outbox (`shared/outbox/outbox.ts`) na MESMA `TransactWriteItems` do item quando `dueDate` muda (updateItem e renewItem), `AuditEvent` append-only gravado em toda mutação na mesma transação, dashboard via GSI1. `renewItem` cria um item sucessor (`renewedFromId`) em vez de mutar `dueDate` no agregado de origem, que transiciona para `RENEWED`; é idempotente via `IdempotencyStore` de M0. Rotas HTTP CDK adicionadas em `infra/lib/api.ts`/`expiration-tracker-stack.ts` (`ItemsHandler`, mesmo authorizer JWT de M1). Suíte de integração `test/integration/expiration-lifecycle.test.ts` prova o exit criterion do marco end-to-end via handlers HTTP reais. Detalhe completo em `docs/architecture/session-log.md`.

Judgment calls (blueprint silente): (1) evento `ItemDueDateChanged` segue exatamente o schema já existente desde M0 (`schemas/events/item-due-date-changed.v1.json`: `itemId`/`previousDueDate`/`newDueDate`/`itemVersion`, `additionalProperties: false`) em vez do exemplo mais rico do texto do blueprint §8.3 (que inclui `timeZone`/`reminderPolicyId`/`changeReason`) — o schema já testado/versionado é a fonte de verdade de contrato per `AGENTS.md` §7, o exemplo em prosa não; campos adicionais ficam para quando M3 (Reminder) precisar deles, exigindo `.v2` aditivo; (2) `renewItem` também dispara `ItemDueDateChanged` (para o item novo, `previousDueDate: null`) — o blueprint só descreve esse evento no contexto de `updateItem`, mas renovação também é uma "mudança de vencimento" do ponto de vista do futuro `ReminderProducer` (M3), e a alternativa (renovação silenciosa) deixaria o dashboard/scheduler sem sinal de que um novo item precisa de agendamento; (3) `archiveItem` usa a ação de autorização `item:update` (não uma ação dedicada — a matriz de M1 não define uma para archive) enquanto `deleteItem` usa `item:delete` (ADMIN_ROLES), seguindo a granularidade que já existe; (4) idempotência de renovação aceita uma `idempotencyKey` explícita do chamador (header `Idempotency-Key`) com fallback determinístico `itemId|expectedVersion|cycle` quando ausente, já que o blueprint define a CHAVE de dedupe mas não de onde ela vem por HTTP; (5) `ExpirationStore.transactWrite` foi adicionado ao port (não existe em `IdentityStore`) porque nenhuma escrita de M1 precisava de `TransactWriteItems` multi-item — a fake em memória (`test/unit/expiration/in-memory-store.ts`) só entende as duas formas exatas de `ConditionExpression` que este código produz (mesma limitação documentada, mesmo espírito de `InMemoryIdentityStore`).

## Concluído nesta sessão — M3 "Reminder Engine" (implementation-blueprint.md §19)

Todas as entregas implementadas e testadas (123 testes, `npm test`/`typecheck`/`lint`/`validate-schemas` verdes): `src/modules/reminder/{domain,application,ports,http}` (policies CRUD, `ReminderMaterializer` com conversão local→UTC IANA-aware — DST tratado explicitamente, horário inexistente e ambíguo — reagindo a `ItemDueDateChanged` via `cancelStaleOccurrences`) e `src/workers/{reminder-producer,reminder-dispatch,reminder-reconciliation}` (lógica pura testável com relógio falso). GSI3 com shard versionado (`shardFnVersion`) e producer com janela de lookback `[M-5min, M]`; dispatch faz `CLAIMED→TRIGGERED`+`NotificationIntent`+outbox numa única transação; reconciliação é um único job (claim-expiry + DST). Exit criterion provado end-to-end em `test/integration/reminder-engine.test.ts`. **Bug real de infraestrutura corrigido**: `Table.grantReadWriteData`/`grantReadData` do CDK sempre incluíam `<tableArn>/index/*`, vazando `dynamodb:Query` no GSI3 para QUALQUER função da tabela (inclusive as tenant-facing de M1/M2) — a salvaguarda de isolamento documentada desde M1 nunca foi de fato aplicada. Corrigido em `infra/lib/dynamo-table.ts` com `PolicyStatement`s explícitos; teste de isolamento novo em `test/infra/stack.test.ts` prova via CDK synth que só `ReminderProducer` referencia `/index/GSI3`. Detalhe completo em `docs/architecture/session-log.md`.

Judgment calls (blueprint silente): (1) `occurrenceId` derivado deterministicamente (hash da chave de idempotência de data-model.md §4) em vez de UUID + registro `IdempotencyStore` separado — o próprio `putIfAbsent` condicional já garante a idempotência de materialização, mesmo padrão que data-model.md documenta para `WebhookInbox`; (2) cancelamento de ocorrência stale não remove `GSI3PK`/`GSI3SK` (o builder de `occ.ts` é SET-only, sem REMOVE) — deixa um ponteiro órfão no índice, mas o `Query` condicional `SCHEDULED→CLAIMED` do producer falha sobre ele de forma inofensiva; (3) tolerância de dispatch (`toleranceMs`, default 30min) e TTL de claim (default 2min) não estão fixados no blueprint — valores razoáveis documentados no código, revisar contra dados reais de produção; (4) reconciliação DST/claim-expiry recebe os candidatos como parâmetro (batch) em vez de fazer sua própria varredura via GSI6 — a wiring desse índice de "políticas ativas"/"claims expirados" real fica como follow-up de infra, o mecanismo de reconciliação em si (o que a tarefa pediu) está implementado e testado; (5) Lambda handlers reais (bundling com `@aws-sdk`) não foram escritos — mesmo estágio que M0-M2, CDK usa código inline placeholder via `ScopedLambdaFunction`; a lógica testável é o entregável real desta fase, igual às anteriores.

## Próxima ação obrigatória (histórico — superada pela seção do topo)

**Superada em 2026-08-19**: a Engineering Maturity Review identificou G8 (recuperação real de falha assíncrona) como bloqueador de engenharia — o milestone de runtime real (adapters/handlers/filas/EventBridge, ver seção do topo) é pré-requisito antes de M4 fazer sentido operacionalmente, ainda que M4 não dependa dele estruturalmente. Lista original preservada abaixo como histórico, não como próxima ação vigente.

1. **M4 — Notification Engine** (`implementation-blueprint.md` §19, depende de M3 ✅): router de `NotificationIntent`→canal, delivery workers (email/WhatsApp stub-first), `NotificationAttempt`, resolução de destinatário/template.
2. Decidir e fechar os itens abaixo (BFF de sessão como rotas reais, CSP/CloudFront quando o frontend existir) antes de considerar a lacuna de "session theft" do threat model totalmente fechada — ainda não resolvido, re-flagueado a cada sessão desde M1 para não se perder: M1 fechou o mecanismo de revogação/matriz de autorização, não o endpoint BFF completo; M2/M3 não tinham escopo de frontend/sessão (confirmado no blueprint) então também não o resolveram.
3. **Ratificar formalmente em `data-model.md` a exceção do GSI3** (chave global do scheduler, já decidida e justificada em `implementation-blueprint.md` §9.2/§23.3 item 10) — passo de manutenção documental, não nova rodada de debate. M3 já corrigiu o enforcement real do isolamento em IAM; falta só o registro mecânico no documento.
4. Wiring real do GSI6 (ou índice equivalente) para alimentar a reconciliação de M3 com o batch real de "políticas ativas"/"claims a verificar" em produção — hoje o mecanismo de reconciliação recebe esse batch como parâmetro injetado (testável), a query real fica pendente.
5. Testes de carga real (cenários de drenagem do pico extremo, `capacity-model.md`, com SLO de drenagem UNK-CAP-006 a formalizar em `slo.md` antes do gate de M7), teste de restore real (gate já definido em `disaster-recovery.md` §6), exercício do runbook de credencial comprometida.
6. Reavaliação sob rubrica (B) — Operational Evidence — só então `ARCHITECTURE STATUS` pode legitimamente virar `APPROVED`. **Não declarar isso antes de haver evidência operacional real.** Implementar M0/M1/M2/M3 não é evidência operacional.
7. Decisões ainda pendentes de pesquisa externa (não bloqueiam M4 estruturalmente, mas bloqueiam habilitar os canais/features específicos, ver `implementation-blueprint.md` §23.3): provider inicial de e-mail, BSP WhatsApp (pricing real, UNK-003), modelo Bedrock específico, região AWS (bloqueante para LGPD/transferência internacional), MFA obrigatório vs. opcional (UNK-006), ferramenta de backup S3 (RPO≤24h), ferramenta de assinatura/provenance do pipeline de CI.

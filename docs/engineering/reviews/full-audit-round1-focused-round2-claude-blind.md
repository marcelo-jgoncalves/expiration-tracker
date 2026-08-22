---
status: active
owner: engineering
authority: normative
---

# Rodada focada (Passo 1, NEXT_SESSION_PROMPT.md 2026-08-21) — nota cega Claude

Escopo: só os 6 critérios listados na tabela do plano (NEXT_SESSION_PROMPT.md topo), não os eixos inteiros. Avaliado contra o estado real do repositório em `develop` (M4/M5 implementados e deployados), texto de critério de `docs/engineering/joint-review-criteria.md`.

## 1. Qualidade de Engenharia — Delivery, Release & Recovery Discipline (peso 11%) — **7.5/10**

Evidência real: `cd.yml` dispara via `workflow_run` (não `push`), corrigindo a corrida real de lock de state documentada no próprio workflow; `apply` só roda se a CI antecedente teve sucesso; artefato identificável via `npm run build:lambdas` (esbuild) consumido pelo `terraform apply`; smoke test pós-deploy real (`describe-table`/`describe-user-pool`/`get-queue-attributes`) — explicitamente não é smoke test de aplicação ponta a ponta, o próprio comentário admite isso. Bug real pós-deploy (ADOT quebrando handler) foi caçado e corrigido via `aws lambda invoke` real, não simulado.

**Achado real que impede 9.0**: não existe NENHUM mecanismo de rollback/roll-forward — nem alias/versão de Lambda, nem `terraform apply` de estado anterior, nem revert automático quando o smoke test falha (o job simplesmente falha, deixando o que já foi aplicado). O critério pede explicitamente "rollback" como parte da definição — está ausente, não só não documentado.

## 2. Qualidade de Engenharia — Debuggability & Operational Feedback (peso 7%) — **9.2/10**

Evidência real: `src/shared/observability/context.ts` implementa `runWithContext`/`getContext` via `AsyncLocalStorage` de verdade; `correlationIdFromSqsRecord` com fallback correto (`messageId` quando não há atributo do producer). Wiring confirmado em pelo menos 2 handlers reais (`reminder-dispatch-handler.ts`, `ses-callback-handler.ts`) com aninhamento correto (contexto externo do batch + contexto interno do record). **Fechando o loop que faltava**: `logger.ts:80` confirma `SecureLogger` mescla `getContext()` automaticamente (`{...getContext(), ...this.baseContext, ...context}`, explícito sempre vence) — não é só contexto disponível, é auto-injetado em todo log real.

Gap residual, não bloqueante: nenhuma correlação entre records dentro do mesmo batch de uma invocação Lambda (aceitável — é por-record, coerente com o design).

## 3. Segurança da Informação — Critério 7: Logging Seguro, Detecção & Resposta a Incidentes (peso 8%) — **7.8/10**

Evidência real: `infra/modules/alert-topic` (SNS + e-mail), `alarm_actions` real em todos os alarmes relevantes (`sqs-worker-queue`, `reminder-observability`), teste real `OK→ALARM→OK` documentado em `NEXT_SESSION_PROMPT.md` contra a subscription confirmada.

**Achado real que impede 9.0**: `docs/architecture/incident-runbooks.md` está desatualizado — afirma explicitamente ("nenhum alarme tem alarm_actions/SNS", "sem PagerDuty/SNS configurado hoje") o que passou a ser falso desde M5. Um runbook que contradiz a realidade operacional é um risco real de resposta a incidente (operador seguindo o doc não saberia que já existe notificação automática, ou tomaria decisões com premissa errada). O critério exige "runbook de contenção/revogação/investigação" coerente com o sistema real — não está.

## 4. Operações/SRE — Critério 3: Detecção, Resposta & Comunicação de Incidentes (peso 15%) — **7.5/10**

Mesma evidência de alarme real do item 3 — teste `OK→ALARM→OK` é um exercício real, não simulado, prova que a notificação funciona sob condição real. Matriz de severidade/SLA existe (`incident-runbooks.md`, SEV-1..4).

**Achados reais que impedem 9.0**: mesmo runbook desatualizado do item 3 (agora pesando mais porque o critério inclui explicitamente "comunicação" e "exercícios comprovam funcionamento"); "dono/escalonamento" hoje é só "quem estiver de plantão informal" — aceitável para estágio solo/pré-produção, mas o próprio critério pede dono/escalonamento como parte da definição, então não arredondo.

## 5. Operações/SRE — Critério 6: Prontidão de Deploy, Rollback & Mudança Operacional (peso 10%) — **6.5/10**

Mesma evidência de `cd.yml` do item 1: artefato identificável, checks pré-deploy reais (typecheck/lint/boundaries/testes, espelhando `ci.yml`), checks pós-deploy reais (ainda que rasos). Mudança de schema/GSI passa pelo mesmo `plan`/`apply`/smoke-test sem validação diferenciada por blast radius.

**Achado real que impede 9.0**: o critério cita rollback/roll-forward explicitamente na própria definição — confirmado ausente (não é ponto de documentação, é lacuna de mecanismo real). Nenhuma validação proporcional adicional para mudança de GSI/KMS/provider vs. mudança rotineira.

## 6. Governança de Produto — Critério 4 (sub-achado: entrega/feedback de provider é M4+, rota de preferências) (peso 15% no eixo geral) — **9.1/10**

Evidência real: `GET /notifications/preferences` cria o registro padrão lazily (`getOrCreatePreferences`), `PUT` usa OCC real (`If-Match`/`requireExpectedVersion`) + validação de schema real; wiring de rota confirmado em `notifications-handler.ts` (`GET /notifications/preferences` / `PUT /notifications/preferences` mapeados para os handlers reais). Dois bugs reais pós-deploy (schema registry estático, `count` palavra reservada DynamoDB) foram achados via `aws lambda invoke` real contra a Lambda real, corrigidos, e reverificados com chamadas reais consecutivas — exatamente o padrão que expõe o bug (segunda chamada na mesma janela de 60s). Testes de regressão reais existem (`test/unit/notification/preferences-handlers.test.ts`, `test/integration-dynamodb/quota.dynamodb.test.ts`).

Sem achado que impeça 9.0 — mecanismo real, testado, verificado em produção real duas vezes (dois bugs pós-deploy diferentes, ambos fechados com evidência real).

---

**Resumo**: 2 de 6 critérios (itens 2 e 6) batem o gate ≥9.0 sem arredondar. Os outros 4 (itens 1, 3, 4, 5) ficam abaixo por achados reais e específicos (rollback ausente; runbook desatualizado desde M5) — não por impedimento externo genuíno, então não são exceção ao gate; são candidatos reais a fix pontual antes de fechar esta rodada.

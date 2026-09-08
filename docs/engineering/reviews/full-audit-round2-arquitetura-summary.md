---
status: closed-round2-cycle
owner: engineering
authority: audit-record (referencia docs/engineering/joint-review-criteria.md; nao redefine pesos)
---

# Full-audit round2 — Eixo Arquitetura — Resumo consolidado

Segunda execução do protocolo `AGENTS.md` §4 contra `docs/engineering/joint-review-criteria.md`
("Eixo: Arquitetura", 11 critérios) desde a Rodada 1 (`full-audit-round1-arquitetura-summary.md`,
fechada em 2026-08-20, Claude 7.966/Codex 8.743). Entre as duas rodadas o projeto avançou de D-043
para D-231+: Multi-User B2B completo (14 waves), Document Archive completo (DocumentFile/
DocumentType/Requirement/DocumentRequest/Series/Dossier/Reports/Metadata configurável/
ExternalShareLink/WhatsApp), CDK substituído por Terraform (ADR-0009), 9 GSIs, 30 workers
assíncronos, 63 handlers Lambda.

3 rodadas reais executadas (nota cega Rodada 1 → réplica com achado novo → fechamento). Nenhum lado
chegou a 9.0 ponderado — o eixo **não fecha** por este critério do protocolo, mas convergiu de forma
genuína (ambos os lados mudaram de posição com justificativa nova, não por média).

## Verificação executada nesta auditoria (evidência real, não presumida)

- `npm run check-boundaries` → 0 violações (630 módulos, 2400 dependências).
- `npm test` completo → **2625/2625 passando** (236 arquivos), rodado ao vivo nesta sessão.
- `AWS_PROFILE=claude-dev terraform test` (raiz `infra/`) → **23/23 passando** contra AWS real,
  rodado ao vivo nesta sessão (não fake/local-only).
- Leitura direta de `infra/main.tf`, `infra/modules/feature-flags/main.tf`,
  `infra/modules/*-observability/main.tf`, `src/workers/guest-credential-delivery/deliver.ts`,
  `src/runtime/aws/handlers/guest-credential-delivery-handler.ts`, `AGENTS.md`,
  `docs/architecture/README.md`, `NEXT_SESSION_PROMPT.md` (D-114 a D-231).

## Notas ponderadas finais por rodada

| Rodada | Claude | Codex |
|---:|---:|---:|
| 1 (nota cega) | 8.42 | 9.085 |
| 2 (réplica com achado novo) | 8.55 | 8.782 |
| 3 (fechamento, confirma R2) | 8.55 | 8.782 |

Nenhuma nota foi arredondada. Gap final entre os lados: 0.23 (bem menor que o gap de 0.78 da
Rodada 1) — convergência real, não forçada: ambos os lados mudaram de posição com evidência nova
entre rodadas (Claude aceitou 6 achados do Codex que não tinha visto; Codex rebaixou 2 critérios
próprios ao perceber inconsistência entre a própria classificação de severidade e a nota dada).

## Nota final por critério (rodada 2/3, estável, ambos os lados)

| # | Critério | Peso | Claude final | Codex final |
|---:|---|---:|---:|---:|
| 1 | Domain Fit & Simplicity | 8% | 9.0 | 9.2 |
| 2 | Reliability & Fault Recovery | 16% | 7.8 | 7.8 |
| 3 | Event & Integration Correctness | 11% | 7.9 | 7.9 |
| 4 | Data Model & Consistency | 13% | 8.9 | 9.3 |
| 5 | Security & Privacy | 13% | 9.0 | 9.2 |
| 6 | Modifiability & Evolvability | 7% | 8.9 | 9.2 |
| 7 | Observability & Operability | 8% | 7.8 | 8.5 |
| 8 | Testability & Delivery Safety | 8% | 9.2 | 9.4 |
| 9 | Cost & Resource Governance | 5% | 8.5 | 9.0 |
| 10 | Performance & Scalability Fitness | 4% | 8.0 | 8.5 |
| 11 | Architecture Governance & Traceability | 7% | 9.2 | 9.4 |

Único critério em que os dois lados chegaram a valor **idêntico** (não coincidência — resultado
direto da Rodada 2 de reconciliação): Reliability (7.8) e Event & Integration (7.9), justamente os
dois de maior peso combinado (27%) e os dois diretamente afetados pelo achado novo desta auditoria.

## Comparação Round 1 → Round 2 por categoria de achado

### A. Achados da Rodada 1 (impedimento externo / CDK-vs-Terraform) — RESOLVIDOS

O impedimento estrutural dominante da Rodada 1 ("nenhuma prova de recuperação real, Camada 3 nunca
executada, bloqueada pela decisão CDK vs Terraform pendente") **deixou de existir como categoria**.
ADR-0009 formalizou Terraform; `AGENTS.md` §7 documenta o pipeline real (CI plan-only, CD apply via
OIDC); dezenas de decisões D-1xx a D-2xx desta janela citam verificação ao vivo contra `dev` como
prática padrão, não exceção (Lambda `Active`/rota confirmada/fila+DLQ presente/EventBridge schedule
`ENABLED`). `terraform test` 23/23 contra AWS real (não fake) confirmado nesta própria sessão.
Isto elevou Testability & Delivery Safety (8.0/8.6→9.2/9.4), Security & Privacy parcialmente
(7.5/8.4→9.0/9.2, IAM negativo GSI3/GSI6 comprovado real em múltiplas waves via
`aws iam simulate-principal-policy`), e Architecture Governance (já alto, mantido/subiu).

### B. Achados "escopo maior" da Rodada 1 — 1 de 2 RESOLVIDO, 1 permanece

- **AppConfig com `resources: ["*"]` sem construto real**: **CORRIGIDO**. `infra/modules/
  feature-flags/main.tf` cria `aws_appconfig_application`/`environment`/`configuration_profile`
  reais; `StartConfigurationSession` escopado ao ARN exato da tripla; só `GetLatestConfiguration`
  permanece `"*"`, com justificativa documentada e tecnicamente correta (a ação opera sobre um
  token de sessão opaco, não um recurso endereçável por ARN — fato da própria AWS, verificado, não
  suposição).
- **EMF/`metrics.ts`/dashboard**: **NÃO CORRIGIDO**. Confirmado por grep nesta sessão: nenhum
  arquivo de métrica customizada (`aws-embedded-metrics`/EMF) nem `aws_cloudwatch_dashboard` existe
  no repositório. Em compensação, alarmes de erro/idade de fila cresceram proporcionalmente ao
  número de workers novos (11+ alarmes dedicados em `reminder`/`document`/`import`/
  `security-audit`-observability, mais os pré-existentes) — mitigação parcial, não substitui visão
  agregada por tenant nem série temporal de métrica de negócio.

## Achados NOVOS desta auditoria (Rodada 2)

### Bloqueante — perda silenciosa de entrega de credencial guest

`src/workers/guest-credential-delivery/deliver.ts:66` reivindica o marcador idempotente
(`markerStore.claim`) **antes** de chamar `emailProvider.send()` (linha 71). Verificado nesta sessão
(não só aceito do Codex): o handler (`guest-credential-delivery-handler.ts:54`) marca `SEND_FAILED`
como falha de item de batch, acionando redrive nativo do DynamoDB Streams Event Source Mapping — mas
o retry chama `deliverGuestCredential` de novo, que chama `claim()` de novo, que já retorna `false`
(reivindicado na tentativa anterior), produzindo `ALREADY_DELIVERED` em vez de reenviar. **Uma falha
de SES entre o claim e o send suprime a entrega da credencial guest permanentemente e
silenciosamente, sem alarme dedicado e sem correção possível via o mecanismo de redrive nativo que
o resto do pipeline assíncrono do projeto usa com sucesso.** O próprio comentário do código (linha
24) documenta a troca consciente ("claiming happens BEFORE the SES call") mas descreve o efeito de
forma equivocada ("unclaimed-but-unsent" — o estado real é "claimed-but-unsent"). Mesmo padrão
`claim→efeito externo` citado como precedente em `document-request-service.ts`'s initial invite —
indica risco de classe, não bug isolado.

**Classificação**: achado real, não hipotético, verificado por leitura direta e rastreamento do
caminho de retry — mas é um caminho lateral do produto (guest upload avulso), não o caminho central
de reminders (já E2E PROVEN). Rebaixa Reliability (16%, maior peso do eixo) e Event & Integration
(11%) de forma material, mas não catastrófica — daí a convergência dos dois lados em 7.8/7.9, não
em valores mais baixos.

**PENDENTE — decisão explícita de Marcelo antes de correção**: o mecanismo correto (state machine
com estado intermediário `SENDING`, ou idempotência pós-envio com política explícita de duplicação
tolerada) é uma mudança de design (Nível 4-5 da escala de risco, muda o contrato de idempotência de
um worker já deployado) — não implementado nesta sessão de auditoria, por instrução explícita da
tarefa. Confirmado por ambos os lados na Rodada 3 que este é o tratamento correto (não forçar
correção durante auditoria).

### Não-bloqueante — fan-out sem cap em onboarding B2B

`src/modules/organization/application/onboarding-state.ts:31`-32 e
`src/modules/organization/application/resolve-active-membership.ts:21` hidratam todas as
Memberships de um usuário via `Promise.all` sem cap explícito nem concorrência limitada — cresce
com o número de organizações do usuário. Risco real mas de baixo blast radius hoje (nenhum usuário
real, poucas Organizations por conta no B2B atual).

### Não-bloqueante — lifecycle incompleto de artefatos de relatório/exportação

`DossierExportRun` (`src/modules/document-archive/domain/dossier-export-run.ts`) e
`ReportSubscriptionRun` (`src/modules/reports/domain/report-subscription-run.ts`) não têm
`purgeAfter`/TTL nem classificação de retenção LGPD explícita — mesma classe de gap que já foi
fechada para outras entidades em D-151 a D-156 (workers de purga LGPD), mas essas duas entidades são
posteriores a essa rodada de trabalho e não foram incluídas.

### Pequena — duplicação de hidratação GSI4

`onboarding-state.ts`/`resolve-active-membership.ts` duplicam parcialmente o mesmo access pattern
de leitura de Membership via GSI4 — oportunidade de consolidação, não bug.

## Achados reafirmados como pendência nomeada (não novos, já registrados no próprio `NEXT_SESSION_PROMPT.md`)

- D-231 (WhatsApp fatia 3/5): infra Terraform escrita/testada localmente, nunca `plan`/`apply` real
  contra `dev` — mudança de shape de env var em módulo já deployado, risco nomeado explicitamente
  pela própria sessão que a produziu.
- `DocumentRequestSeries`/recorrência sem `recipientEmail` em alguns fluxos — já fechado por D-230
  (verificado nesta auditoria como resolvido, não é mais achado aberto — o worker de entrega guest
  hoje suporta ambos os caminhos, avulso e série).

## Por que o ciclo fecha na Rodada 3 (não mais, não menos)

Rodada 3 confirmou explicitamente (Codex, pergunta direta, resposta SIM/SIM com justificativa) que:
(a) nenhum dos 11 critérios tem divergência de FATO remanescente — só houve debate de severidade,
já resolvido na Rodada 2 com justificativa nova de ambos os lados (não média); (b) o achado de
`deliver.ts` deve ser registrado como PENDENTE para decisão/implementação futura de Marcelo, não
corrigido nesta sessão de auditoria. Forçar uma Rodada 4 sem uma dessas duas coisas mudar produziria
retrabalho cosmético — mesmo critério de fechamento já usado na Rodada 1.

## Commits desta sessão

Nenhum código de produção alterado (tarefa de auditoria, por instrução explícita). Apenas
documentação/evidência de revisão salva em `docs/engineering/reviews/full-audit-round2-arquitetura-*`
e atualização de `docs/engineering/decisions-log.md`/`docs/engineering/README.md`/
`NEXT_SESSION_PROMPT.md`.

## Próxima ação recomendada (fora do escopo desta sessão)

1. Decisão de Marcelo sobre o mecanismo de correção de `deliver.ts` (state machine intermediária vs.
   idempotência pós-envio) — nível 4-5, provavelmente justifica passar pelo protocolo completo dado
   que define um padrão que se repete em pelo menos 2 lugares do código (risco de classe).
2. EMF/`metrics.ts`/dashboard operacional — mesmo achado da Rodada 1, ainda não endereçado; considerar
   escopar como trabalho dedicado dado que já sobreviveu a 2 ciclos de auditoria sem correção.
3. Fan-out sem cap em onboarding B2B e lifecycle de `DossierExportRun`/`ReportSubscriptionRun` — nível
   3-4, corrigíveis sem protocolo novo quando alguém retomar essa frente.
4. ADR curto sobre a indireção `workers/`→`runtime/aws/handlers`→`runtime/aws/composition` — pendência
   de documentação da Rodada 1, não reverificada nesta sessão (não impacta nota, mas segue nomeada).

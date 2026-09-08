---
status: draft-round1
owner: claude
authority: audit-evidence (referencia docs/engineering/joint-review-criteria.md; nao redefine pesos)
---

# Full-audit round2 — Eixo Arquitetura — Proposta Claude, Rodada 1

Nota cega. Codex não viu este arquivo antes de dar sua própria nota Rodada 1.

## Método

Releitura direta do código/infra atual (não apenas documentação) contra os 11 critérios de
`docs/engineering/joint-review-criteria.md` §"Eixo: Arquitetura", e verificação item-a-item de cada
achado registrado em `full-audit-round1-arquitetura-summary.md` (2026-08-20) contra o estado real em
2026-09-07. Evidência coletada nesta sessão:

- `npm run check-boundaries` → **0 violações** (630 módulos, 2400 dependências).
- `AWS_PROFILE=claude-dev terraform test` (raiz `infra/`) — em execução no momento de escrever esta
  proposta; resultado real será anexado à Rodada 2/3 quando concluir (rodou >5min, suíte de 23 testes
  reais contra AWS via profile, não fake).
- `npm test` completo — em execução (suíte grande, >120s), resultado real anexado quando concluir.
- Leitura direta: `infra/main.tf`, `infra/modules/feature-flags/main.tf`,
  `infra/modules/*-observability/main.tf`, `src/shared/observability/logger.ts`, `AGENTS.md` §4/§7,
  `docs/architecture/README.md`, `NEXT_SESSION_PROMPT.md` (D-114 a D-231).

## Reverificação dos achados da Rodada 1 (2026-08-20)

| Achado Round 1 | Status real hoje (2026-09-07) |
|---|---|
| GSI3 ponteiro órfão em `cancelStaleOccurrences` | Corrigido em `494f4e5` (Round 1) — sem regressão nova encontrada nesta sessão nos pontos tocados por D-150/D-166 (cancelamento de ocorrência agora canalizado por `cancelOccurrenceUpdate()` conforme design de quarentena D-127, achado positivo: a disciplina de não duplicar a lógica de remoção de ponteiro se manteve). |
| Ausência de alarmes além de DLQ | **Superado amplamente**: `infra/modules/{reminder,document,import,security-audit}-observability/main.tf` somam 11 `aws_cloudwatch_metric_alarm` dedicados + os pré-existentes; `tenant-purge-workflow` e `sqs-worker-queue` têm mais 4. Cobertura de alarme cresceu proporcionalmente ao número de filas/workers novos (30 workers hoje vs. handful em agosto). |
| Bug de bundle no Redactor (`import.meta.url`) | Corrigido em Round 1; import estático confirmado ainda em `src/shared/observability/redactor.ts` nesta leitura — sem regressão. |
| Ausência de orçamento de custo (Cost & Resource Governance) | `infra/modules/cost-budget/` existe e é referenciado em `infra/main.tf`; pendência doc (destinatário de e-mail/tags de alocação) permanece — não verificado nesta sessão se foi endereçada, tratar como não resolvida até prova em contrário. |
| CDK vs Terraform pendente, bloqueando Camada 3 (5 critérios) | **Resolvido por decisão**: ADR-0009 formalizou Terraform, `AGENTS.md` §7 documenta o pipeline real (`ci.yml` plan-only, `cd.yml` apply em push a `main`, OIDC). Camada 3 não é mais um impedimento estrutural — é rotina: dezenas de decisões D-1xx a D-2xx neste período têm "verificado ao vivo contra `dev` via `aws --profile claude-dev`" como prática padrão, não exceção. Isto é a mudança mais importante desde a Rodada 1: o impedimento externo dominante da Rodada 1 (nenhuma prova de recuperação/deploy real) deixou de existir como categoria — quase todo D-number de infra desta janela cita Lambda `Active`/rota confirmada/fila+DLQ presente. |
| AppConfig `resources: ["*"]` sem construto real (Category B) | **Resolvido**: `infra/modules/feature-flags/main.tf` agora existe como construto real (`aws_appconfig_application`/`environment`/`configuration_profile`), com `StartConfigurationSession` escopado ao ARN exato da tripla application/environment/configuration-profile e só `GetLatestConfiguration` em `"*"` — com comentário justificando que essa ação opera sobre um token de sessão opaco, não um recurso endereçável por ARN (fato documentado pela própria AWS, não suposição). |
| EMF/`metrics.ts`/dashboard (Category B) | **Não resolvido, ainda válido**: nenhum arquivo de métricas customizadas (`aws-embedded-metrics`, EMF) nem `aws_cloudwatch_dashboard` existe no repositório hoje (confirmado por grep). Observabilidade operacional continua limitada a: alarmes de erro/idade de fila (bons, cresceram bastante) + `SecureLogger` estruturado + trace X-Ray. Não há visão agregada por tenant nem série temporal de métrica de negócio (backlog de reminders, taxa de sucesso de dispatch, etc.) além do que CloudWatch deriva automaticamente de Lambda/SQS. |
| ADR sobre indireção `workers/`→`runtime/aws/handlers`→`runtime/aws/composition` | Não verificado nesta sessão se foi escrito; layout de módulo em `AGENTS.md` §7 continua descrevendo a mesma indireção sem ADR dedicado — tratar como não resolvido até prova em contrário. |

## Achados NOVOS desde agosto (mudança de escopo real: Multi-User B2B + Document Archive)

1. **Data Model & Consistency — 9 GSIs, crescimento saudável mas sem novo registro formal de capacidade por índice**: `GSI7`/`GSI8`/`GSI9` novos desde Round 1 (busca unificada, `MaintenanceDueIndex`, `GSI_EVIDENCE`). Cada um tem ao menos uma mini-revisão de capacidade nomeada no protocolo (ex. D-046 para GSI3 reuso, D-179 para GSI8) — disciplina mantida, não é achado negativo. Achado real, porém: `GSI4` (`MembershipByUser`) teve um incidente real de autorização faltante já corrigido (D-116, "GSI4 nunca autorizado aos 10 Lambdas reais que o consomem") — isto é exatamente a classe de bug que motivou o peso alto de Reliability/Data Model na Rodada 1, e se repetiu (índice novo, permissão esquecida) apesar da lição já registrada. Não é um achado "aberto" hoje (já corrigido), mas é evidência de que a mitigação estrutural (checklist/fitness function que barre Lambda sem GSI wireado) ainda não existe — `terraform test`/`stack.tftest.hcl` prova isolamento negativo (quem NÃO pode acessar), não prova positivamente que todo consumidor esperado FOI wireado antes do merge. Risco residual real, não hipotético (já aconteceu 2x: D-116 aqui, achado análogo em Round 1).

2. **Event & Integration Correctness — TOCTOU recorrente na entrega assíncrona multi-tenant**: D-113 (B2B-13) e a nota de D-231 documentam pelo menos 2 instâncias reais do mesmo bug de classe (revalidação de `Membership` ausente entre roteamento e entrega assíncrona de notificação) descobertas em auditorias sucessivas (`notification.ts`+`subject.ts`, depois `document-chasing-dispatch`). Padrão real, recorrente, mitigado caso a caso (reaproveitando `DynamoDbNotificationRecipientResolver`) mas sem uma regra estrutural (fitness function/lint) que impeça a próxima ocorrência em um worker futuro ainda não escrito.

3. **Reliability & Fault Recovery — pendência real nomeada, não fechada**: D-231 (WhatsApp fatia 3/5, 2026-09-07) tem infra terraform escrita e testada só localmente (`validate`/`test`), nunca `plan`/`apply` contra `dev` real — mudança de shape de env var (placeholder → Secrets Manager) em módulo já deployado, risco concreto de quebrar a fatia anterior (D-229) se o plan divergir do esperado. Pendência nomeada explicitamente no próprio `NEXT_SESSION_PROMPT.md`, não escondida.

4. **Architecture Governance & Traceability — volume de decisões extremamente alto, rastreabilidade mantida mas cara**: `decisions-log.md` cresceu de D-043 (Round 1) para D-231+ (hoje), todas com nota Claude/Codex e link de evidência — disciplina de governança real e consistente, não perfunctória (li amostras de D-191, D-218, D-225, D-230, todas com números de rodada e notas específicas, não genéricas). O custo dessa disciplina é legibilidade: `NEXT_SESSION_PROMPT.md` (277 linhas, no limite do guardrail de `check-docs`) já compacta narrativa, mas uma nova sessão paga um custo de leitura real e crescente para reconstruir o estado (mitigado por `docs/architecture/README.md` ser o resumo executivo, mas ainda assim extenso).

5. **Domain Fit & Simplicity — escopo do domínio dobrou (Document Archive) sem sinal de over-engineering**: novo subdomínio (DocumentFile/DocumentType/Requirement/DocumentRequest/Series/Dossier/Reports/Metadata configurável/ExternalShareLink/WhatsApp) reaproveita padrões já estabelecidos (outbox, OCC builders, GSI existente antes de criar novo, fencing transacional) de forma consistente — nenhum "fork" por tenant encontrado, nenhuma duplicação de mecanismo genérico percebida na amostra lida. Ponto forte mantido desde Round 1.

## Notas propostas por critério (nota cega, Rodada 1)

| # | Critério | Peso | Nota Claude R1 | Racional resumido |
|---:|---|---:|---:|---|
| 1 | Domain Fit & Simplicity | 8% | 8.8 | Crescimento de domínio grande sem sinal de over-engineering; ainda sem ADR da indireção workers/handlers/composition. |
| 2 | Reliability & Fault Recovery | 16% | 8.3 | Impedimento estrutural da Rodada 1 (Camada 3 bloqueada) removido — verificação ao vivo é rotina agora. Resta pendência nomeada real (D-231 nunca aplicada) e ausência de fitness function que force wiring de GSI/IAM antes do merge (D-116 já se repetiu). |
| 3 | Event & Integration Correctness | 11% | 8.2 | Pipeline assíncrono provado repetidamente em produção real; mas TOCTOU de revalidação de Membership é um padrão recorrente (2 instâncias reais), mitigado ad-hoc, não estruturalmente. |
| 4 | Data Model & Consistency | 13% | 8.6 | 9 GSIs com disciplina de capacidade mantida; achado real de permissão de GSI esquecida (D-116) mostra que a mitigação ainda é reativa. |
| 5 | Security & Privacy | 13% | 8.4 | RBAC/Membership real, TOCTOU corrigidos quando achados, AppConfig agora escopado corretamente. IAM real testado via `aws iam simulate-principal-policy` em várias waves — evidência concreta, não hipotética. |
| 6 | Modifiability & Evolvability | 7% | 8.8 | Padrão de reuso consistente (GSI existente antes de novo, outbox reaproveitado) através de 15+ novas capacidades de produto. |
| 7 | Observability & Operability | 8% | 7.6 | Alarmes cresceram bem; EMF/dashboard/visão por tenant continuam ausentes — mesmo gap da Rodada 1, não fechado. |
| 8 | Testability & Delivery Safety | 8% | 8.7 | `terraform test` real contra AWS, suíte de 2500+ testes, G-V3 disciplinado, CI/CD real com rollback documentado. Maior salto desde Round 1. |
| 9 | Cost & Resource Governance | 5% | 8.0 | Budget existe; pendência de destinatário/tags não confirmada como resolvida. |
| 10 | Performance & Scalability Fitness | 4% | 7.8 | Sem teste de carga real ainda; mini-revisões de capacidade pontuais (D-046, D-179) são boa prática mas não substituem teste de carga. |
| 11 | Architecture Governance & Traceability | 7% | 9.0 | Rastreabilidade excepcionalmente consistente (D-000 a D-231+, cada uma com nota/evidência), único critério que já bateu o gate na Rodada 1 e se manteve. |

Nota ponderada Claude R1: **8.42/10** (cálculo: soma peso×nota / 100).

---
status: draft
owner: Marcelo
authority: informativo (síntese da Fase 3 — ADRs formais só nascem com decisão explícita do Marcelo)
---

# Fase 3 — Domain Model, Impactos e Encerramento

Continuação de `10-phase3-scoring-and-roadmap.md`. Cobre os entregáveis E, F, I-Q do prompt
estratégico.

## E. Domain model — antes/depois

**Antes** (estado real, `01-gap-analysis.md`): `User` (tenant≈userId, MVP) → `ExpirationItem`
(schema fixo, `assigneeUserId?` singular) → `Document` (exige `itemId` já existente) →
`NotificationIntent`/`ReminderOccurrence` (1 destinatário interno, sem digest, sem watcher). Nada
entre tenant e item — nenhum conceito de fornecedor/funcionário/ativo.

**Depois** (proposto, clusters 1-7):
```text
Tenant (User, MVP; Organization futuro — M13)
   └── TrackedSubject (M9) ──tags[]/notes?
          └── RequirementAssignment (M9) ──status: MISSING..SATISFIED
                 ├── linkedItemId? ──────────→ ExpirationItem (existente, +subjectId?)
                 │                                 └── ItemWatch (M9, coleção)
                 ├── DocumentRequest (M10) ───→ token guest (ponteiro tenantless)
                 │       └── DocumentSubmission (M10)
                 └── DocumentChasingOccurrence/Intent (M10) [agregado-irmão do Reminder Engine]

Entitlement/UsageQuota (M9, mínimo) ──expande──→ Plan/Subscription/BillingWebhookInbox (M12)
ImportJob (M11) ──cria em massa──→ TrackedSubject + RequirementAssignment
```
`NotificationIntent`/`ReminderOccurrence`/`Document` (agregados já em produção) **permanecem
exatamente como estão** — nenhum cluster os generaliza ou muta.

## F. Architecture impact

- **1 novo GSI** (GSI7, subject-listing, M9) — edição direta de `infra/modules/dynamo-table`.
  Nenhum GSI novo em nenhum outro cluster: guest token (M10) resolvido via ponteiro tenantless
  (achado real do cluster 2); chasing (M10) reusa GSI3 existente sob condição de mini-revisão de
  capacidade (cluster 4).
- **1ª e 2ª rotas públicas do projeto** (M10 guest upload; M12 billing webhook) — API Gateway
  hoje é 100% JWT; ambas exigem WAF como pré-requisito, não item de M8.
- **3ª exceção tenantless documentada** (ponteiro de guest token, M10) — mesma categoria de
  `IdentityMapping` e GSI3, nunca GSI novo.
- **2 novos agregados-irmãos do Reminder Engine** (M10) — nunca generalização do que já está em
  produção, mesmo princípio já usado em M7.
- **Quase nenhuma mudança no core já verificado em produção**: `ExpirationItem` ganha só
  `subjectId?` opcional (1 campo); `Document`/`NotificationIntent`/`ReminderOccurrence`
  permanecem 100% intocados. `notes?` **não** toca o core — é campo novo em `TrackedSubject` e
  `RequirementAssignment`, os 2 agregados novos do cluster 1 (emenda do cluster 6), nunca no
  código já em produção. Risco de regressão minimizado deliberadamente.

## I. Lista de ADRs candidatos (a formalizar só quando Marcelo decidir avançar para implementação)

1. Introdução de `TrackedSubject` como agregado raiz (nível 6 — novo domínio de risco/entidade
   fundamental).
2. Separação `Requirement`/`RequirementAssignment` de `ExpirationItem` (nível 5).
3. Modelo de guest token e 3ª exceção tenantless (nível 6 — nova superfície de segurança).
4. `DocumentSubmission`/generalização mínima do pipeline M6 (nível 5).
5. Agregados-irmãos do Reminder Engine para chasing, em vez de generalizar o existente (nível 5).
6. Billing por `TrackedSubject` como métrica primária + fronteira com provider externo (nível 6).
7. Sequenciamento Organization/Membership só no gatilho B2B real, não por estágio (nível 5,
   ADR já parcialmente coberta por decisão anterior — `ADR-0002` — esta seria a ADR de
   *execução* do gatilho, não de intenção).
8. Estratégia de import CSV e fronteira de segurança na exportação, não na entrada (nível 5).
9. Rejeição formal de custom fields genérico por padrão (nível 4 — decisão de não construir,
   registrada para não reabrir sem evidência nova).
10. Modelo de audience/escalation fechado + `ItemWatch` como agregado separado (nível 5 — lista
    fechada de audiences, 1 intent por destinatário/canal, assimetria intencional de
    `EXTERNAL_CONTACT`, cluster 5).

## J. Impacto de segurança (consolidado, eixo Segurança/AppSec)

- **Maior superfície nova**: guest upload (M10) — token hasheado com pepper, resposta genérica
  anti-enumeration, `timingSafeEqual`, rate limit token+IP, WAF obrigatório antes de expor.
- **Gate explícito pré-implementação, não resolvido em nenhum cluster**: verificação de política
  IAM de namespace tenantless (`GUESTTOKEN#*`/`IDENTITY#*`) excluída de handlers tenant-facing
  comuns — residual real do cluster 2.
- **Segunda superfície pública**: billing webhook (M12) — precisa de verificação de assinatura do
  provider, idempotência de evento.
- **Formula/CSV injection**: mitigada na fronteira de saída (exportação/relatório), não na
  entrada — decisão deliberada do cluster 7 para evitar falso positivo em dado legítimo.
- **Isolamento multi-tenant**: nenhuma mudança de princípio em nenhum cluster — todo novo
  agregado segue o mesmo padrão resolver-deriva-`tenantId`, nunca aceito do cliente.
- **Maior risco estrutural do roadmap**: migração de Organization/Membership (M13) — chave física
  embutida em PK/GSI/S3/idempotência/outbox, não só atributo (achado real do cluster 3,
  correção pendente de `evolution.md:13` registrada abaixo).

## K. Impacto de persistência (DynamoDB)

| Entidade nova | Chave | GSI novo? |
|---|---|---|
| `TrackedSubject` | `TENANT#t#SUBJECT#s` / `META` | GSI7 (listagem) |
| `RequirementAssignment` | `TENANT#t#SUBJECT#s` / `REQASSIGN#a` | Não (coleção) |
| `DocumentRequest` | `TENANT#t#SUBJECT#s` / `REQASSIGN#a#DOCREQ#d` | Não (coleção) |
| `DocumentSubmission` | `TENANT#t#SUBJECT#s` / `REQASSIGN#a#SUBMISSION#s` | Não (coleção) |
| Guest token pointer | `GUESTTOKEN#<hash>` / `POINTER` | Não (ponteiro tenantless, como `IdentityMapping`) |
| `DocumentChasingOccurrence/Intent` | agregado-irmão, reusa GSI3 | Não (reuso condicionado a mini-revisão de capacidade) |
| `ItemWatch` | `TENANT#t#ITEM#i` / `WATCH#USER#u` | Não (coleção, mesma partição de `Document`) |
| `ImportJob` | novo, DynamoDB (metadata only) | Não |
| Plano de import linha-a-linha | **S3**, não DynamoDB | N/A |
| `Plan`/`Subscription`/`BillingWebhookInbox` | novos, escopo `tenantId` | Não decidido nesta fase |

Regra de governança de `data-model.md` ("nenhum novo access pattern sem revisão explícita")
respeitada em todos os 7 clusters — cada GSI evitado foi substituído por padrão já existente no
código real, nunca assumido.

## L. Impacto de custo

- `ADR-0001` (DynamoDB on-demand) absorve o crescimento de item novo sem mudança de modelo de
  billing de infra.
- Plano linha-a-linha de import em **S3** (não DynamoDB por linha) foi decisão deliberada de
  custo, não só arquitetural (cluster 7).
- GSI7 novo tem custo incremental de storage/throughput — proporcional ao número de
  `TrackedSubject`, não ao volume de eventos (baixo).
- Guest upload/chasing reaproveita 100% a infraestrutura de M6/M3 já provisionada — sem novo
  custo fixo de fila/worker.
- **Billing real (M12) é o primeiro milestone com custo de fornecedor externo** (taxa do
  provider de pagamento) — fora do escopo deste documento, decisão de fornecedor específica.
- `cost-model.md` precisa de atualização quando a implementação real começar — não feito aqui
  (documento normativo, fora do escopo de análise).

## M. Estratégia de teste (consolidada — ver detalhe por milestone em `10-...md`)

Padrão a manter em todos os milestones novos (mesmo já usado em M0-M6): unit (domínio/regras)
+ integration real (DynamoDB/S3/SQS via Testcontainers, `vitest.dynamodb.config.ts`) + contract
(schema novo em `test/contract/`) + cross-tenant negativo (mesmo padrão de
`test/integration/cross-tenant.test.ts`). **Capacidade de teste genuinamente nova exigida**: teste
de segurança de guest token (replay/enumeration/cross-tenant) — não existe hoje porque o conceito
não existe hoje. E2E principal candidato (prompt §44): criar subject → aplicar requisito →
solicitar documento → guest upload → malware clean → extração (M7) → aprovação → item
criado/renovado → reminder agendado — "um dos principais acceptance tests do produto" quando
M9-M11 + M7 estiverem implementados juntos.

## N. Estratégia de migração (consolidada)

- M9-M12: **zero migração de dado real** — todos os campos novos são opcionais/aditivos,
  confirmado com evidência de código em cada cluster (nunca assumido).
- M10: janela de compatibilidade temporária no parser de quarantine key (formato antigo + novo
  `anchor/...`), removida depois que eventos/slots em voo esgotarem.
- **M13 é a única migração real e de alto risco do roadmap**: plano de 3 fases de
  `evolution.md:13` precisa de correção formal antes de qualquer implementação (achado real do
  cluster 3) — o texto atual subestima que `tenantId` está embutido em chaves físicas, GSIs, S3,
  idempotência e eventos, não é só atributo. Correção proposta (não decidida/editada ainda):
  Fase 0 (introduzir Organization/Membership 1:1, sem mudar dado) → Fase 1 dual-path (chaves/
  projeções novas, não só atributo) → Fase 2 backfill (rematerializar itens+GSIs+idempotência+
  outbox em voo+S3+quotas+audit) → Fase 3 cutover (alias de rollback `oldUserTenantId→
  organizationId`).

## O. Atualizações de documentação necessárias (quando a implementação real começar — não feito nesta fase)

- `docs/architecture/requirements.md`: adicionar FRs formais para `TrackedSubject`/
  `RequirementAssignment`/guest upload/billing (hoje só têm FUT-refs genéricos).
- `docs/architecture/data-model.md`: adicionar as 7+ entidades novas, GSI7, e a 3ª exceção
  tenantless (guest token pointer) ao índice de exceções de particionamento.
- `docs/architecture/privacy-lgpd.md`: mapa de dados precisa incluir `DocumentRequest`/
  `DocumentSubmission`/futuro `ExternalContact` (sem 9ª classe nova — decidido no cluster 2).
- `docs/architecture/evolution.md`: correção formal do plano de 3 fases (achado do cluster 3,
  não editado ainda).
- `docs/architecture/cost-model.md`: impacto de billing real quando provider for escolhido.
- `docs/architecture/adr/`: os 9 ADRs candidatos da seção I, quando cada milestone for
  formalmente decidido para implementação.
- `docs/architecture/README.md` e `NEXT_SESSION_PROMPT.md`: já mantidos atualizados ao longo
  desta sessão (checklist do `AGENTS.md` §6 seguida em cada commit desta Fase 2-3).

## P. Perguntas abertas reais (não resolvidas, não resolvíveis sem decisão externa)

1. Qual provider de billing (Stripe ou outro)? Decisão de fornecedor fora do escopo deste
   roadmap.
2. Digest deve ser implementado? Sem evidência de mercado em nenhuma direção — decisão fica para
   quando houver sinal real de notification fatigue com clientes reais.
3. `submitterMessage?` em `DocumentSubmission` (observação livre do convidado) — vale a pequena
   extensão ou fica de fora permanentemente? Achado colateral do cluster 6, não decidido.
4. Correção formal do plano de 3 fases de `evolution.md` — quem revisa e quando, antes de M13
   poder começar?
5. Mini-revisão de capacidade de GSI3 com chasing incluído (cluster 4) — precisa de dado real de
   volume esperado de `DocumentRequest`, que só existe depois que M9/M10 estiverem em produção
   com clientes reais.
6. Verificação de IAM de namespace tenantless (residual do cluster 2) — quem faz essa auditoria
   antes de M10 poder ser implementado com segurança?
7. Schema exato do CSV v1 (colunas obrigatórias/opcionais), formato versionado do
   `ImportRowPlan`, lifecycle/retention dos objetos S3 de import, e política de commit parcial
   vs. "todas as linhas aceitas ou nenhuma" — residuais reais do cluster 7, decisões de
   implementação para quando M11 for priorizado.
8. Quando Organization/RBAC (M13) existir, `OWNER` como audience de notificação e a futura
   noção de papéis internos (`ADMIN`/`MANAGER`) precisam de revisão formal para não virar
   semântica ambígua com o `OWNER` societário/de billing do cluster 3 — residual real do
   cluster 5, não resolvido em nenhuma rodada.

## Q. Capacidades explicitamente rejeitadas ou adiadas por padrão

| Capacidade | Status | Por quê |
|---|---|---|
| Custom fields genérico (`FieldDefinition`/`FieldValue`) | **Rejeitado por padrão** | Risco de complexidade documentado por concorrente real (myCOI); valor já servido por `tags`/`notes`/texto livre; reabertura exige evidência de cliente real, não capacidade técnica |
| `RequirementTemplate`/`RequirementDefinition` completo | **Adiado** | Nenhum access pattern exige a entidade agora; `requirementDefinitionId?` fica como escape hatch |
| Digest | **Questão aberta, não decidida** | Zero evidência de mercado em qualquer direção |
| XLSX import | **Adiado** | Superfície de ataque maior (ZIP/multi-aba/fórmula nativa); CSV entrega o valor principal primeiro |
| E-mail ingestion (`docs+tenant@produto.com`) | **Fora do roadmap desta Fase 3** | Não avaliado em nenhum cluster — prompt já pedia para não priorizar acima de P0 |
| API pública/webhooks para terceiros | **Fora do roadmap desta Fase 3** | Não avaliado — prompt já pedia para não expor prematuramente |
| BPMN/workflow builder para chasing | **Rejeitado explicitamente** | Política declarativa limitada (offsets/audiences/canais) é suficiente; fronteira anti-BPMN mantida em todos os clusters relevantes |
| `MANAGER`/`EXPLICIT_USER` como audience | **Adiado até Organization real** | Pressupõem hierarquia organizacional que não existe (mesmo princípio "evidência antes de mecanismo" aplicado 2x nesta Fase 2b) |
| Billing por assento como métrica primária | **Rejeitado** | Nenhum concorrente pesquisado cobra assim; `TrackedSubject` é o padrão de mercado validado |
| **Premium Multi-Channel Notifications** (WhatsApp, responsáveis com telefone, escalation) | **Registrado como capacidade futura pós-piloto — não priorizado nesta Fase 3, ver subseção Q.1** | Zero evidência de demanda de cliente real ainda (mesmo critério já aplicado a Digest/XLSX acima); depende de billing real (M12, hoje bloqueado por D-052) para ter sentido comercial como tier pago |

### Q.1 — Premium Multi-Channel Notifications (registrado em 2026-08-28, não priorizado)

Capacidade futura registrada a pedido do Marcelo (sessão de 2026-08-28) — **não é decisão de implementação, não é ADR, não altera as Waves 0-6 do `pilot-readiness-program.md` nem antecipa M12 (billing)**. Fica aqui pelo mesmo motivo que as outras linhas da tabela Q: é o registro de "capacidade avaliada e conscientemente adiada", não uma lacuna esquecida.

**O que é**: hoje `ExpirationItem`/`RequirementAssignment` não têm nenhum conceito de "responsável com telefone" — o mais próximo é `ItemWatch` (`07-domain-model-escalation-watchers-digest.md`, usuário interno do tenant, sem telefone) e `EXTERNAL_CONTACT` (só via `DocumentChasingIntent`, snapshot de e-mail, sem telefone, escopado à cobrança de documento, não a lembrete de vencimento) — nenhum dos dois serve para "associar um responsável com telefone a um vencimento/documento/requisito para notificação adicional". A capacidade futura é: modelar esse responsável de forma neutra a canal (nome + telefone, sem assumir que "número de WhatsApp" é uma entidade diferente de "celular" — canal e capacidade de entrega ficam em conceitos separados do dado do responsável), com preferência de canal e consentimento, e oferecer notificação adicional por canal premium quando o vencimento se aproxima.

**Por que isso NÃO é greenfield arquitetural** — já existe base real, não é preciso inventar do zero:
- `NotificationChannelKind` (`src/modules/reminder/domain/reminder-policy.ts`) já é `"EMAIL" | "WHATSAPP"` — o valor `WHATSAPP` existe no type system desde M4, nunca roteado (`SUPPORTED_CHANNELS = ["EMAIL"]` em `src/modules/notification/application/notification-router.ts`, comentário no próprio código: `// WhatsApp is a later submilestone (kill switch AppConfig WHATSAPP)`).
- O kill switch `WHATSAPP` já existe em `infra/modules/feature-flags` (AppConfig `kill-switches`, mesmo mecanismo real usado pelos flags `OCR`/`AI_EXTRACTION` — ver Wave 2/W2-03 desta sessão para evidência real desse mecanismo em produção).
- `ADR-0008-notification-engine-adapters.md` já decidiu o padrão de abstração de provider (fila SQS dedicada por canal + contrato de adapter comum + contract tests) explicitamente para "e-mail, Telegram e WhatsApp" — a "provider abstraction para evitar acoplamento excessivo" que esta capacidade precisaria **já está arquiteturalmente decidida**, só não implementada além de e-mail.
- `capacity-model.md` já modela fan-out de notificação e adoção hipotética por canal incluindo WhatsApp (e Telegram, que não fazia parte do pedido desta sessão mas já está no mesmo lugar do código/docs) desde a Fase 1 — `UNK-CAP-003` já registra que "adoção real de WhatsApp/Telegram por fração de usuários é hipótese de produto, não medição" e que a política de fan-out (todo canal configurado recebe vs. fallback sequencial) não está decidida.

**SMS explicitamente fora de escopo** (decisão do Marcelo nesta mesma sessão, revertendo a formulação inicial do pedido) — a capacidade cobre e-mail (default, já implementado) e WhatsApp (premium, futuro); SMS não entra no roadmap.

**Considerações que a futura implementação precisará endereçar** (registradas agora para não serem esquecidas depois, não desenhadas em detalhe — isso é trabalho de um cluster de domínio completo via protocolo `AGENTS.md` §4 quando o gatilho comercial disparar):
- Modelagem do responsável e do telefone — provavelmente um agregado novo (não reaproveitar `ItemWatch`, que é usuário interno do tenant, nem `EXTERNAL_CONTACT`, que é snapshot de e-mail escopado à cobrança) associável a item/documento/requisito; telefone como dado neutro a canal, preferência de canal como atributo separado.
- Opt-in/consentimento explícito e opt-out — LGPD, base legal distinta de e-mail transacional (mensageria teria custo real por unidade e maior intrusão).
- Minimização de dado (LGPD) — telefone é dado pessoal, mesma disciplina de classificação/retenção já aplicada a e-mail (`privacy-lgpd.md`).
- Validação/normalização de número de telefone (formato internacional, país).
- Isolamento de tenant no novo agregado (mesmo padrão já auditado na Wave 3 desta sessão para os agregados existentes).
- Proteção contra abuso/spam do canal de mensageria (mesma disciplina de rate-limit/quota já aplicada a e-mail/API).
- Custo real por mensagem (WhatsApp Business Platform cobra por conversa/mensagem) — candidato natural a `cost-model.md`/`FinOps` (eixo ainda não formalizado em `joint-review-criteria.md`) quando avaliado de verdade.
- Quotas/limites por plano — só faz sentido quando M12 (billing) sair do bloqueio atual (D-052).
- Retry e status de entrega — **distinção epistêmica obrigatória, nunca colapsada**: `sent`/aceito pelo provider ≠ `delivered` ≠ `read`. Mesma disciplina de Epistemic Integrity já aplicada no planejamento de interface (`docs/frontend/interface-screen-and-state-inventory.md`'s Epistemic Integrity Matrix, `CLEAN`="Verificado (segurança) — conteúdo não conferido" nunca "Aprovado") — se implementado, o rótulo exibido ao usuário nunca pode afirmar "lido" quando o provider só confirmou "aceito"/"entregue".
- Idempotência — mesmo padrão já usado por `NotificationIntent`/`IdempotencyStore` (1 intent por destinatário por canal, nunca `recipientIds[]`, princípio já fixado no cluster 5).
- Observabilidade — mesma disciplina `SecureLogger`/correlation context já aplicada aos canais existentes.
- Integração com o Reminder Pipeline existente (`reminder-delivery-pipeline.md`) — provavelmente mais um `NotificationIntent`/canal, não um pipeline paralelo.
- Provider abstraction — já decidida em ADR-0008, reaproveitar, não redesenhar.
- Fallback entre canais — política não decidida (mesmo `UNK-CAP-003` acima).
- Janela de envio/horário — `quiet hours` já existe para e-mail (`ReminderRule.quietHours`), mensageria provavelmente herda o mesmo mecanismo.
- Timezone — já modelado por `ReminderPolicy.timeZone`, reaproveitar.
- Escalation para outro responsável — mesmo espaço de decisão já registrado como aberto para `MANAGER`/`EXPLICIT_USER` (cluster 5, depende de Organization/RBAC real).

**Hipótese comercial registrada, não decidida**: e-mail como canal básico/default, WhatsApp como diferenciador de plano premium (custo operacional por mensagem, maior percepção de urgência, diferenciação comercial) — nomenclatura de planos ("Basic"/"Premium") é hipótese de produto, não estrutura de billing definida (M12 continua bloqueado por D-052, fornecedor de pagamento).

**Gatilho de reavaliação**: mesmo padrão de `evolution.md` — não é data no calendário, é evidência real (validação inicial do produto + primeiros clientes/pilotos reais pedindo o canal, ou decisão comercial de M12/billing que torne a diferenciação de tier viável). Até lá, zero código/infra desta capacidade — nenhuma mudança nas Waves 0-6 do `pilot-readiness-program.md`, nenhum blocker para o primeiro piloto.

## Revisão adversarial final de coerência do pacote (2026-08-23)

Antes de encerrar, o pacote completo (`01-` a `11-`) passou por uma revisão de coerência via
Codex (MCP, sandbox read-only) — não uma proposta independente, uma auditoria crítica do que já
estava fechado. Nota inicial: **8,2/10**. Achados reais corrigidos:

1. `F` contava "2 novos GSIs" quando só GSI7 existe — corrigido.
2. CSV export estava pontuado no feature score (`10-` seção D) mas sem milestone dono — corrigido,
   incluído explicitamente no escopo de M11.
3. Faltava ADR candidato para o modelo de audience/escalation/`ItemWatch` do cluster 5 —
   adicionado como item 10 da seção I.
4. Grafo de dependências (`10-` seção H) tinha texto contraditório sobre M13 depender ou não de
   M9 — corrigido para "tecnicamente independente, gatilho comercial é a única dependência real".
5. Residuais reais do cluster 7 (schema CSV v1, formato de `ImportRowPlan`, retention S3, política
   de commit parcial) não apareciam na seção P — adicionados.
6. Residual do cluster 5 sobre `OWNER` como audience vs. `OWNER` societário (quando Organization
   existir) não aparecia em P — adicionado.
7. Feature score dava nota 6 de risco/complexidade para Organization/RBAC, contradizendo o
   próprio texto do roadmap ("a mais real e arriscada" migração) — corrigido para 3/3, com nota
   explicando a correção.
8. `F` descrevia `notes?` como se tocasse o core já em produção (`ExpirationItem`/`Document`/
   `NotificationIntent`) — corrigido: `notes?` é campo dos agregados NOVOS (`TrackedSubject`/
   `RequirementAssignment`), nunca do core intocado.

Esta seção fica registrada como evidência de que a síntese final passou por verificação
adversarial, não só por produção direta — mesmo princípio de proveniência já aplicado aos 7
clusters de domínio.

## Encerramento da Fase 3

Todos os entregáveis A-Q do prompt estratégico produzidos (`10-` e `11-`, mais `01-`/`02-` como
base). **Nenhuma implementação de código foi feita ou autorizada.** Próxima decisão é do
Marcelo: quais milestones (M9-M13) priorizar, e quando autorizar o início de implementação de
cada um — mesmo padrão de decisão explícita já usado para M7.

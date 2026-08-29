---
status: draft
owner: Marcelo
authority: informativo (decisão de domínio reconciliada via protocolo AGENTS.md §4; promovida a ADR formal só na Fase 3, junto do roadmap final)
---

> **SUPERSEDED (timing), 2026-08-29, D-085**: a decisão de gating abaixo ("Organization/Membership/RBAC só no gatilho real") foi explicitamente supersedida por decisão direta do Marcelo — ver `decisions-log.md` D-085 e `roadmap-evolution/17-multi-user-b2b-revised-strategy.md`. O modelo de dados e o sequenciamento de billing por `TrackedSubject`/entitlements abaixo permanecem vigentes e não foram alterados — só o gatilho de timing do item 5 do sequenciamento foi substituído por "proceder agora".

# Fase 2b — Modelagem de domínio: Organization/Membership/RBAC + Billing/Entitlements

Terceiro cluster de decisão da Fase 2. Diferente dos dois primeiros, este parte de readiness
formal já existente no código (`ADR-0002`, `evolution.md`), não de conceito genuinamente novo —
a rodada foi mais sobre SEQUENCIAMENTO e correção de um plano já desenhado do que criação do
zero. Decisão nível 5-6 (`change-risk-scale.md`), protocolo Claude↔Codex completo via MCP,
sandbox read-only, 3 rodadas reais, eixos Produto-Multi-tenant + Jurídico + Privacidade.

**Nota final: Claude 9,2 / Codex 9,2 — gate ≥9,0 atingido, sem arredondar.**

## Processo

- **Rodada 1**: convergência forte em billing por `TrackedSubject` (não assento — validado pela
  pesquisa de mercado, `02-market-research.md`), fronteira clara com provider externo (financeiro
  no provider, entitlement/quota local), gatilho real (venda B2B multiusuário) em vez de estágio
  numérico.
- **Rodada 2**: Claude atacou 4 pontos. Achado de processo real: Codex apresentou um bloco como
  citação literal de `evolution.md` sem dar `arquivo:linha` — cobrado por isso (critério
  "Avaliação de Correção, Limitações & Impacto", eixo Governança de IA), confirmou que a citação
  **era** literal (`evolution.md:13`) mas reconheceu a falha de não ter referenciado a fonte.
  Achado técnico mais valioso: Claude confrontou a proposta do Codex de adicionar `ADMIN` à
  matriz de autorização com a própria decisão do cluster 1 (onde Codex concordou em remover
  `ownerUserId`/`assigneeUserId` de `TrackedSubject` por "evidência antes de mecanismo" — não
  modelar papel que ninguém pode receber ainda). Codex concedeu a inconsistência e removeu
  `ADMIN` da proposta. Segundo achado: a pesquisa de mercado mostra guest upload disponível no
  tier GRATUITO em 3 concorrentes (TrustLayer, Certificial, bcs) — Codex desacoplou guest
  upload de billing pago em resposta.
- **Rodada 3**: reconciliação incorporando as 2 concessões + 1 correção pendente registrada
  (não decidida) sobre o texto de `evolution.md:13`. Nota cega final sem ver a nota do Claude.

## Decisão final

### Billing por `TrackedSubject`, não por assento

Métrica comercial primária: `activeTrackedSubjects` — nenhum concorrente pesquisado cobra por
usuário/assento (`02-market-research.md`). Assentos entram só como limite auxiliar de plano.

### Sequenciamento revisado (muda a ordem do prompt estratégico original)

O prompt original propunha "M12 Commercial Accounts" (Organization/Membership/RBAC/Billing/
Entitlements/Quotas) como o último bloco, depois de tudo mais. A decisão final inverte parte
dessa ordem com base em evidência real:

1. `TrackedSubject` + `RequirementAssignment` (cluster 1, já fechado 9,1/9,1).
2. `Entitlement`/`UsageQuota` local mínimo — plano default/free com limite de
   `ACTIVE_TRACKED_SUBJECTS` — **sem depender de provider de billing externo**.
3. Guest upload/magic link (cluster 2, já fechado 9,2/9,2) disponível **já no free tier**,
   protegido pelo entitlement/quota local + WAF/rate-limit (não pelo billing) — consistente com o
   padrão real de mercado (hook de aquisição gratuito, não feature paga).
4. Billing/provider externo (Stripe ou similar) depois, para converter/expandir limites pagos —
   nunca bloqueante para os passos 1-3.
5. `Organization`/`Membership`/RBAC só no gatilho real já registrado em `evolution.md:13`
   ("primeira venda B2B exigindo múltiplos usuários por conta"), nunca por estágio numérico do
   `capacity-model.md`.

### RBAC — sem papel novo antes de existir quem o receba

Matriz atual `OWNER|MEMBER|VIEWER` mantida como está. `ADMIN` **não** entra agora — só quando
`Membership` for implementado de fato (gatilho do item 5), mesmo princípio já aplicado no
cluster 1. Quando isso acontecer, revisar se `ADMIN` (gestão operacional, sem poder de
billing/transferência) se justifica separado de `OWNER` (poder societário/comercial).

### Fronteira `Plan`/`Subscription`/`Entitlement`/`UsageQuota`/`BillingWebhookInbox` vs. provider externo

- **Provider é fonte de verdade financeira**: checkout, payment method, invoice, cobrança,
  impostos, cupons, tentativa de pagamento, dunning, customer portal.
- **Sistema decide entitlement/quota local**: `Plan` (catálogo interno versionado, referencia
  `providerPriceId`), `Subscription` (projeção local do estado do provider — `tenantId`,
  `providerCustomerId`, `providerSubscriptionId`, status, período, cancelamento, trial/grace),
  `Entitlement` (snapshot calculado de features/limites efetivos), `UsageQuota` (contador
  operacional: `ACTIVE_TRACKED_SUBJECTS`, `ACTIVE_REQUIREMENTS`, `GUEST_REQUESTS`,
  `AI_EXTRACTIONS`, `UPLOAD_BYTES`), `BillingWebhookInbox` (idempotência/auditoria dos eventos
  recebidos).
- **Nunca chamar o provider no hot path de autorização** — webhook atualiza projeção local, API
  consulta entitlement local.

### `UsageQuota.ACTIVE_TRACKED_SUBJECTS` sob o MVP atual

Confirmado (não assumido): funciona corretamente sob `tenantId=userId` de hoje, sem dependência
escondida de Organization — `TENANT#<tenantId>#QUOTA` já é o padrão real (`quota.ts`, achado do
cluster de investigação da Fase 1). A mesma semântica "por tenant" migra automaticamente quando
`tenantId` passar a significar `organizationId`, compatível com o critério de saída SCALE-004.

## Correção pendente registrada para a Fase 3 (não decidida/editada nesta rodada)

O texto do plano de 3 fases em `evolution.md:13` ("novos registros gravam `organizationId` além
de `userId`" como dual-write) **subestima que `tenantId` está embutido em chaves físicas, GSIs,
S3, idempotência e eventos** — não é só um atributo adicional. Correção técnica identificada
(a formalizar como revisão de `evolution.md` na Fase 3, não decidida/editada agora):

1. Fase 0 explícita: introduzir `Organization`/`Membership`/`IdentityMapping → activeTenantId`,
   ainda 1:1, sem mudar dado de negócio.
2. Fase 1 dual-path: novos writes precisam produzir representação consultável pelo novo tenant
   boundary (chaves/projeções novas quando necessário), não só um atributo extra.
3. Fase 2 backfill: rematerializar itens **incluindo GSIs, idempotency records, outbox em voo,
   S3 key strategy/document links, quotas e audit references** — não só os itens principais.
4. Fase 3 cutover: resolver contexto por membership/org, congelar writes no modelo antigo,
   validar SCALE-004 ampliado, manter alias `oldUserTenantId → organizationId` para
   rollback/leitura compatível.

Este é um achado real sobre um documento normativo atual (`evolution.md`), não uma decisão
fechada — fica registrado para correção formal quando a Fase 3 (roadmap final + ADRs) revisar
`evolution.md`.

## Próxima ação

Clusters de domínio restantes antes da Fase 3 (roadmap final): automated chasing (reaproveitamento
do Reminder Engine — eixo Operações/SRE + Arquitetura), escalation/watchers/digest (eixo
Arquitetura + Produto), custom fields (eixo Arquitetura, com o aviso de complexidade já
documentado na pesquisa de mercado), CSV import/export (eixo Qualidade de Engenharia +
Segurança). Avaliar com Marcelo se todos merecem rodada dedicada ou se alguns podem ser
decididos com julgamento direto (níveis 1-4) dado o volume já produzido.

# Full-audit round1 — Eixo: Governança de Produto e Serviço Multi-tenant — Claude (nota cega, rodada 1)

Fonte de critérios: `docs/engineering/joint-review-criteria.md` seção "## Eixo: Governança de Produto e Serviço Multi-tenant". Nota cega — não vi a nota do Codex.

| # | Critério | Peso | Nota | Evidência (arquivo:linha) |
|---:|---|---:|---:|---|
| 1 | Lifecycle Automatizado de Tenant | 18% | 3.0 | `docs/architecture/adr/ADR-0002-multi-tenant-readiness.md:9` confirma `tenantId=userId` desde o Day 0 — mas isso é isolamento técnico (chave), não control plane de produto. Não há estados explícitos de onboarding/ativação/convite/mudança de plano/suspensão/offboarding em nenhum módulo (`grep -rn "TenantState\|onboarding\|suspend" src/` sem resultado de máquina de estados). O tenant nasce implicitamente no primeiro login, exatamente como o critério antecipa como lacuna conhecida. |
| 2 | Offboarding, Exportação & Destruição Criptográfica | 16% | 2.5 | `docs/architecture/privacy-lgpd.md:69` confirma explicitamente: "Não implementado ainda (design-only): DataSubjectRequest e qualquer endpoint de confirmação/acesso/correção/exportação/oposição/exclusão". Não há crypto-shredding implementado (`grep -rn "crypto-shred\|KMS.*delete\|GrantsRevoke" src/` sem resultado de implementação real). O design existe (state machine `RECEIVED→VERIFIED→DISCOVERED→HELD/PURGING→COMPLETED`, `privacy-lgpd.md:28`) mas nada disso está em código. |
| 3 | Planos, Entitlements, Quotas & Fairness | 13% | 6.5 | `src/modules/identity/application/quota.ts:44-60` implementa `TenantQuotaService` real: consumo atômico via `ConditionExpression`, tipos `API_REQUEST`/`UPLOAD_BYTES`/`UPLOAD_COUNT`/`AI_CALL`, `killSwitchOverride` para bloqueio de emergência (AppConfig-driven). Isso é entitlement/fairness real e testável, não apenas design. Falta: nenhum plano de billing real (preço/tier) ligado às quotas — os limites existem como primitiva técnica, não como política de produto versionada por plano comercial. |
| 4 | Correção do Serviço de Lembretes & Proteção do Usuário | 15% | 7.5 | Módulo `src/workers/` tem lógica de producer/dispatch/reconciliation com relógio injetado (testável), incluindo reconciliação de DST mencionada em `infra-terraform/modules/reminder-schedule` (payload sem envelope `detail`, tratado corretamente conforme summary de Arquitetura). Reconciliação diária já é propriedade testada (`full-audit-round1-arquitetura-summary.md` cita isso). Falta verificação explícita nesta rodada de opt-out/quiet-hours end-to-end (não лida o código do zero, reaproveitando achado de eixos anteriores) — nota não é 9+ porque não confirmei diretamente aqui detecção/reparo de lembrete duplicado/obsoleto como propriedade testada especificamente para este critério, apenas por inferência de eixos vizinhos. |
| 5 | Transparência, Usabilidade & Acessibilidade | 10% | N/A (proporcional) | O próprio critério (`joint-review-criteria.md:161`) já registra "ainda não se aplica plenamente (sem frontend), mas entra no radar em M4+". Não há frontend no repositório (`grep -rn "frontend\|\.tsx" src/` sem resultado fora de eventuais configs). Nota não seria informativa — tratado como não aplicável ainda, não como nota baixa por omissão. |
| 6 | Administração, Suporte & Operação sob a Ótica do Tenant | 10% | 3.5 | `src/modules/expiration/domain/audit-event.ts` (citado em `privacy-lgpd.md:68`) prova trilha de auditoria real por tenant. Mas não há nenhuma superfície de suporte autorizado (ferramenta interna, endpoint admin com trilha própria) para diagnosticar saúde/uso/config por tenant — `grep -rn "admin\|support-tool" src/` sem resultado de módulo dedicado. A auditoria existe, mas a operação de suporte sobre ela não. |
| 7 | Métricas de Valor, Consumo & Economia Unitária | 10% | 2.5 | Nenhuma métrica de adoção/sucesso de lembrete por tenant, privacy-safe, foi encontrada implementada (`docs/architecture/cost-model.md` trata custo agregado de infraestrutura, não consumo atribuível por tenant de forma exposta ao produto). Germe do futuro eixo FinOps — hoje inexistente como funcionalidade. |
| 8 | Evolução Unificada & Controle de Customização | 8% | 8.0 | O princípio "nenhuma feature cria fork por tenant" está ativamente aplicado: reshard versionado do GSI3/GSI6 é citado como mecanismo governado em `full-audit-round1-seguranca-summary.md` (isolamento por tenant sem exceção por cliente específico), e a arquitetura single-table com `tenantId` universal (ADR-0002) estruturalmente impede customização por fork de schema. Não há evidência de nenhuma variação ad-hoc por tenant em nenhum módulo. |

**Nota ponderada (rodada 1, critério 5 excluído do denominador por não aplicável)**:
Pesos restantes somam 90% (100% − 10% do critério 5); nota ponderada sobre os 8 critérios aplicáveis, normalizada:
(0.18×3.0 + 0.16×2.5 + 0.13×6.5 + 0.15×7.5 + 0.10×3.5 + 0.10×2.5 + 0.08×8.0) / 0.90
= (0.54 + 0.40 + 0.845 + 1.125 + 0.35 + 0.25 + 0.64) / 0.90
= 4.15 / 0.90 = **4.61/10**

## Achados point-fix (nenhum aplicável nesta sessão)

Diferente do eixo Jurídico, nenhum dos gaps deste eixo é corrigível por edição de documento — todos exigem implementação de código real (control plane de tenant, endpoints de DSR/exclusão, ferramenta de suporte, métricas de produto). Classificados abaixo como escopo maior.

## Achados classificados como impedimento externo real ou escopo maior (não corrigíveis nesta sessão)

- **Critério 1 (Lifecycle)**: control plane de tenant com estados explícitos é feature de produto de escopo considerável (M4+), não point-fix — consistente com a lacuna já antecipada no próprio critério.
- **Critério 2 (Offboarding/crypto-shredding)**: mesma classificação do eixo Privacidade (`privacy-lgpd.md:70`) — endpoints de DSR e worker de purge são escopo maior, não duplicar aqui, já rastreado lá.
- **Critério 5 (Transparência/UX)**: não aplicável — não há frontend ainda, proporcional ao estágio (`docs/engineering/principles.md` #1).
- **Critério 6 (Administração/Suporte)**: ferramenta de suporte administrativo é feature de produto nova, escopo maior.
- **Critério 7 (Métricas de valor)**: feature de produto nova (dashboard/telemetria de negócio), escopo maior, germe do eixo FinOps futuro.

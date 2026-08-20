# Full-audit round1 — Eixo: Governança de Produto e Serviço Multi-tenant — Summary

**Status**: concluído, abaixo do gate de 9.0 dos dois lados, com um achado real de concorrência corrigido nesta sessão (comprovado por teste de regressão) e os demais achados classificados honestamente como escopo maior (feature de produto ainda não construída) ou não aplicável ao estágio atual.

## Notas por rodada

| Rodada | Claude | Codex |
|---|---:|---:|
| 1 (critérios 1-2, 4-8; critério 5 tratado como N/A) | 4,61 | 4,17 |
| 2 (só critério 3, após fix de concorrência) | — (não refeito; ver nota) | 7,8 (era 4,5 na rodada 1) |
| **Final (critério 3 atualizado, demais mantidos da rodada 1 do Codex)** | — | **4,65** |

O critério 5 (Transparência/Usabilidade/Acessibilidade, peso 10%) foi tratado como não aplicável por ambos os lados — não há frontend neste estágio, conforme o próprio critério já antecipa (`joint-review-criteria.md:161`) — e excluído do denominador; a nota ponderada final é normalizada sobre os 90% restantes.

## Achado real corrigido nesta sessão: race de lost-update em `TenantQuotaService`

O Codex, na rodada 1, encontrou uma race de concorrência genuína no critério 3 (Planos, Entitlements, Quotas & Fairness): `TenantQuotaService.consume()` (`src/modules/identity/application/quota.ts`) fazia read-modify-write sobre `IdentityStore.update()`, que era um `PutCommand` **incondicional** (`src/modules/identity/persistence/dynamodb-identity-store.ts:49`, antes do fix). Duas requisições concorrentes do mesmo tenant/quotaType podiam ler o mesmo `count`, ambas calcular `count+1`, e a segunda escrita sobrescrevia silenciosamente o incremento da primeira — permitindo que um tenant excedesse sua quota sob concorrência real.

**Correção aplicada**:
- `IdentityStore` (porta) ganhou `updateConditional(item, expected: {count, resetAt})`.
- O adapter real (`dynamodb-identity-store.ts`) implementa com `ConditionExpression: "count = :expectedCount AND resetAt = :expectedResetAt"`, retornando `false` em vez de lançar quando a condição falha.
- O fake de teste (`test/unit/identity/in-memory-store.ts`) replica a mesma semântica condicional.
- `TenantQuotaService.consume()` agora roda um loop de até 20 tentativas: lê estado fresco, checa quota, tenta a escrita condicional; se outra chamada concorrente venceu a escrita, relê e tenta de novo.
- **Teste de regressão novo** (`test/unit/identity/quota.test.ts`): 25 chamadas concorrentes de `consume()` com `limit=10` — antes do fix isso deixava mais de 10 passarem (lost update); depois do fix, exatamente 10 passam e 15 são rejeitadas. Suite completa: 137/137 (era 136/136 antes deste teste), typecheck/lint/check-boundaries limpos.

O Codex verificou a correção de forma independente (rodada 2, escopo restrito ao critério 3) e confirmou a race eliminada, subindo a nota do critério de **4,5 → 7,8**. A nota não chega a 9 porque `window`/`limit`/`windowSeconds` continuam vindos do chamador, sem catálogo comercial versionado de planos/entitlements (`quota.ts:29`, `joint-review-criteria.md:159`) — lacuna de produto, não de concorrência.

## Achados restantes, classificados

| Critério | Nota | Classificação | Motivo |
|---|---:|---|---|
| 1. Lifecycle Automatizado de Tenant | 3,0 | Escopo maior | `tenantId=userId` implícito no primeiro login (ADR-0002); nenhum control plane com estados explícitos de onboarding/ativação/suspensão/offboarding. Feature de produto M4+, já antecipada como lacuna pelo próprio critério. |
| 2. Offboarding, Exportação & Crypto-shredding | 1,0 | Escopo maior | `privacy-lgpd.md:69` já registra explicitamente que `DataSubjectRequest` e os endpoints de exportação/exclusão não estão implementados — mesma lacuna já rastreada no eixo Privacidade, não duplicada aqui como achado novo. |
| 3. Planos, Entitlements, Quotas & Fairness | 7,8 (era 4,5) | Corrigido nesta sessão (concorrência); residual é escopo maior (catálogo de planos) | Ver seção acima. |
| 4. Correção do Serviço de Lembretes | 8,6 | Proporcional — não chega a 9 por escopo (M4+), não por defeito | Pipeline completo até `NotificationIntent` (timezone/quiet-hours/opt-out/DST/reconciliação, todos com evidência real de código); entrega/feedback de provider é M4+. |
| 5. Transparência/Usabilidade/Acessibilidade | N/A | Não aplicável | Sem frontend neste estágio — excluído do denominador, não penalizado. |
| 6. Administração & Suporte | 2,0 | Escopo maior | Auditoria real existe (`audit-event.ts`) mas só para `ExpirationItem`; nenhuma ferramenta/console de suporte administrativo por tenant. |
| 7. Métricas de Valor & Economia Unitária | 3,0 | Escopo maior | `cost-model.md` estima custo agregado; nenhuma métrica de adoção/consumo real implementada por tenant. Germe do futuro eixo FinOps. |
| 8. Evolução Unificada & Controle de Customização | 8,5 | Proporcional — não chega a 9 por ausência de mecanismo formal de variação por plano | `tenantId` universal e `ReminderPolicy`/`TenantQuota` versionados evitam fork de schema; nenhuma customização ad-hoc encontrada em `src/`. |

## Nota ponderada final: 4,65/10 (Codex, critério 3 atualizado pós-fix; demais da rodada 1)

Abaixo do gate de 9.0. Não reaberto para mais rodadas além do fix pontual já aplicado: 5 dos 7 critérios aplicáveis (1, 2, 6, 7, e a parte residual de 3) são escopo de produto maior — features reais ainda não construídas (control plane de tenant, DSR/purge, ferramenta de suporte, métricas de produto, catálogo de planos), consistente com o estágio pré-produção do projeto (M0-M3 concluídos, sem frontend, sem usuário real). Os critérios 4 e 8, ambos com base técnica real e testada, ficam nos 8s — mais perto do gate que os demais, mas ainda limitados por escopo M4+ explícito.

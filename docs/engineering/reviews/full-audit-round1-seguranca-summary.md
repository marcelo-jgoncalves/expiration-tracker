# Full audit round1 — Eixo Segurança da Informação e AppSec — Resumo

Protocolo Claude↔Codex (`AGENTS.md` §4), nota cega, aplicado ao eixo "Segurança da Informação e AppSec" (`docs/engineering/joint-review-criteria.md`, 10 critérios ponderados). Mesmo padrão de rigor dos axes 1-3 (Arquitetura, Qualidade de Engenharia, Engenharia de Contexto): achados reais corrigidos com commits, notas finais honestas mesmo abaixo de 9.0, distinção explícita entre impedimento externo real e escopo maior que correção pontual.

## Rounds

**Round1** (nota cega, sem ver a nota do outro lado):
- Claude: **8.259/10** (`full-audit-round1-seguranca-claude.md`)
- Codex: **6.953/10** (`full-audit-round1-seguranca-codex-output-round1.txt`)

Divergência de ~1.3 pontos, concentrada em: criterio 5 (Validação de Entrada) — Codex encontrou que a borda HTTP `/items*`/`/reminders/policies*` não tinha nenhuma validação Ajv em runtime, só checagem de presença; criterio 9 (Resistência a Abuso/DoS) — `TenantQuotaService` existia desde M1 mas só era consumido por `/test/ping`, nenhuma rota de negócio real tinha quota; criterio 10 — `docs/architecture/threat-model.md` ainda se descrevia como "arquitetura projetada, ainda não implementada" apesar de M0-M3.5 estarem em código real.

**Correção real (commit `e89e255`)**:
1. Schemas Ajv (`schemas/api/{create,update,renew}-item-request.v1.json`, `put-policy-request.v1.json`) registrados em `schema-validator.ts` e validados em `item-handlers.ts`/`policy-handlers.ts` antes de tocar o resolver/store.
2. `TenantQuotaService` (antes só em `/test/ping`) agora consumido em toda rota de `/items*` e `/reminders/policies*` via `consumeApiRequestQuota()`.
3. `threat-model.md` ganhou seção "Status de implementação (atualizado)" reconciliando lacunas fechadas/parciais/pendentes com o código real, sem alegar controles inexistentes.

**Round2** (nota cega, novamente sem ver a nota do outro lado até ambas registradas):
- Claude: **7.895/10** (`full-audit-round1-seguranca-claude-round2.md`)
- Codex: **7.315/10** (`full-audit-round1-seguranca-codex-output-round2.txt`)

Codex confirmou as 3 correções como reais (não cosméticas) — subiu criterio 5 de 5.2→7.6, criterio 9 de 5.0→7.2, criterio 10 de 6.8→7.4 — e manteve os critérios 2, 3, 4, 6, 7 sem alteração por falta de controle novo relevante neles.

**Correção adicional (commit `dc40712`, residual do criterio 5 apontado pelo Codex round2)**: `requireExpectedVersion` aceitava `Number()` de qualquer valor parseável (negativo, fracionário, `Infinity`) como versão OCC "válida"; `handleDashboard` fazia cast direto do `status` do cliente sem validar contra o enum. Ambos corrigidos com validação explícita fail-closed. Não gerou uma 3ª rodada de nota cega formal — é um refinamento pequeno o suficiente (2 funções, mesmo critério já avaliado) para não justificar reabrir o protocolo completo; documentado aqui em vez de inflar artificialmente a nota round2.

152 testes passam em cada rodada; `typecheck`/`lint`/`validate-schemas`/`check-docs` limpos em todos os commits.

## Nota final do eixo (round2, última nota cega registrada por ambos os lados)

**Claude: 7.895/10 — Codex: 7.315/10 — ambos abaixo de 9.0, sem arredondamento.**

Convergência real entre as duas notas (diferença caiu de 1.3 para 0.58 pontos), mas nenhum lado atinge o gate de 9.0. Por `AGENTS.md` §4 isso normalmente reabriria rodada; paramos aqui deliberadamente (mesmo critério usado nos axes 2/3: rodadas adicionais sobre os mesmos 5 critérios não corrigidos — 2, 3, 4, 6, 7 — teriam retorno decrescente sem trabalho de escopo maior, listado abaixo). Este eixo fica registrado como **não fechado (sub-9.0 honesto)**, não como aprovado.

## O que permanece abaixo de 9.0 e por quê

**Escopo maior que correção pontual (não impedimento externo — corrigível em uma sessão futura dedicada, não nesta)**:
- **Criterio 2 (IAM Least-Privilege, 14%, ~6.3-7.2)**: `tableAccessFor().readWriteKeys()/readKeys()` (`infra/lib/scoped-lambda-function.ts:63-84`) são só metadata — o grant real é sempre `Table.grantReadWriteData`/`grantReadData` na tabela inteira (inclui `Scan`). GSI3/GSI6 estão corretamente isolados, mas uma Lambda tenant-facing comprometida ainda pode ler/escrever qualquer entidade na tabela base. IAM não tem primitiva nativa de condição por SK prefix via os grant helpers do CDK usados aqui — resolver isso exige either usar `dynamodb:LeadingKeys`/condition keys manuais por função ou aceitar o risco documentado. Não é uma correção de uma tarde.
- **Criterio 3 (Autenticação/Sessão, 11%, ~7.4)**: comentários no código referenciam um "módulo de sessão BFF" com rotação/reuse-detection de refresh token que não existe em código real hoje — é aspiração documentada, não implementação. Construir esse módulo é trabalho de M4+ (frontend/BFF ainda não existe), não uma correção pontual deste axis.
- **Criterio 4 (Pipeline Assíncrono, 14%, ~7.2)**: `dispatch-outbox-relay-handler.ts` e `reminder-reconciliation-handler.ts` fazem cast direto de payload (stream/scheduler) sem schema Ajv explícito do envelope — só `entityType` é checado. É uma borda interna (dados escritos pelo próprio sistema, não input de cliente externo), o que reduz a severidade real, mas ainda contraria a definição literal do critério. Adicionar schemas para esses 2 handlers é viável mas não foi priorizado nesta sessão frente aos achados de borda HTTP (client-facing, severidade maior).
- **Criterio 7 (Logging Seguro/Detecção, 8%, ~5.4)**: alarmes existem com threshold acionável, mas **não têm ação de notificação** (`infra/lib/reminder-observability.ts:11-15` documenta isso como decisão deliberadamente adiada — nenhum alvo de notificação, SNS/PagerDuty/Slack, foi decidido). Decidir e implementar o alvo de notificação é uma decisão de produto que não cabe a este agente inventar sem o usuário; eventos de autenticação/autorização negada também não geram trilha de segurança dedicada (só viram resposta HTTP).
- **Criterio 6 (~8.3)**: pequena lacuna aceitável — a propriedade de redação é comprovada para o que passa pelo `SecureLogger`, não para o conteúdo bruto que SQS/DLQ armazenam automaticamente. Não é um bug, é uma distinção que falta tornar explícita/testada.

**Impedimento externo real (Camada 3, mesma limitação já registrada nos axes 1/2 desta sessão)**: nenhuma prova de `AccessDenied` real em IAM AWS, redrive de DLQ real, ou execução real do EventBridge Scheduler — não há ambiente AWS disponível nesta sessão para testar isso; `test/infra/stack.test.ts` sintetiza e afirma a stack via `aws-cdk-lib/assertions`, o que prova a intenção do IaC mas não o comportamento real do IAM.

## Achados que eram bugs reais de segurança (não craft de código), tratados com o peso correspondente

1. Borda HTTP `/items*`/`/reminders/policies*` sem validação runtime de contrato — corrigido.
2. Quota zero em toda rota de negócio real (só existia no test route) — corrigido.
3. `expectedVersion`/`status` aceitando valores fora do domínio válido — corrigido.
4. Documentação de threat model afirmando "não implementado" sobre uma arquitetura com M0-M3.5 reais — corrigido (doc drift, não código, mas achado do próprio axis de Segurança via critério 10).

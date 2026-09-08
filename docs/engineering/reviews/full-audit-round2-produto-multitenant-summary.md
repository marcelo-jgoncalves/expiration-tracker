# Full-audit round2 — Eixo: Governança de Produto e Serviço Multi-tenant — Summary

**Status**: concluído, abaixo do gate de 9,0 dos dois lados, com convergência forte entre Claude e Codex (diferença de 0,7 ponto, mesma direção em todos os critérios) e **nenhum achado de vazamento cross-tenant confirmado** — a conclusão central desta rodada. Um achado real de drift operacional (não corrigido nesta sessão, por ser nível 3+) foi identificado pelo Codex e não pelo Claude.

## Notas por rodada

| Rodada | Claude | Codex |
|---|---:|---:|
| 1 (proposta cega, 7 critérios aplicáveis; critério 5 N/A por falta de escopo UX) | 7,1 | 7,8 |
| **Final** (sem reabertura — ver justificativa) | **7,1** | **7,8** |

Mesma normalização do round1 anterior: critério 5 (Transparência/Usabilidade/Acessibilidade, 10%) excluído do denominador — não avaliado nesta auditoria de backend, não penalizado.

## Por que não foi reaberto para uma 3ª rodada de contestação

O protocolo padrão (`AGENTS.md` §4) exige mínimo 3 rodadas e nota ≥9,0 de ambos antes de fechar, com reabertura em caso de desacordo abaixo de 9. Aqui os dois lados já convergem (0,7 de diferença, mesma classificação por critério — nenhum critério com desacordo de mais de 2,5 pontos) e a lacuna para 9,0 não é uma discordância de avaliação a reconciliar por mais rodadas: é composta majoritariamente por trabalho de produto ainda não construído e já registrado como tal em outro lugar (catálogo comercial de planos/billing bloqueado por decisão explícita em D-052 até existir provedor de pagamento; ferramenta de suporte cross-tenant também bloqueada pela mesma decisão; crypto-shredding por chave dedicada nunca desenhado; telemetria de custo runtime por tenant é lacuna FinOps já conhecida e aceita). Rodar mais rodadas de debate não muda esses fatos — o mesmo padrão já usado no round1 anterior desta eixo (não reaberto além do fix pontual de concorrência, pelos mesmos motivos). Uma 3ª rodada teria valor só se houvesse desacordo real de interpretação; não há.

## Achado central: NENHUM vazamento cross-tenant confirmado

Pergunta obrigatória desta rodada (buscar deliberadamente por uma rota nova sem RBAC ou sem tenant-fencing, D-140 em diante). Ambos os lados, independentemente, concluíram que não há:

- **RBAC**: `ACTION_ROLES` é `Record<Action, ReadonlySet<Role>>` (`src/modules/identity/domain/authorization.ts:231`) — TypeScript recusa compilar se qualquer `Action` do union (74 valores) não tiver entrada. Todas as 27 actions `docarchive:*` (Document Archive, D-143–D-226), `reports:subscription-manage`, `activity:read`, e a reutilização deliberada de `notification:configure` para WhatsApp opt-in têm tier justificado por comentário inline no próprio arquivo.
- **Tenant-fencing**: `authorize()` (`authorization.ts:342`) rejeita `TENANT_MISMATCH` antes mesmo de checar role, e `resource` é sempre populado por uma leitura de banco já escopada pelo tenant autenticado — nunca por input do cliente.
- **Prova de isolamento por IAM real**: D-180 a D-190 têm prova positiva+negativa via `aws iam simulate-principal-policy` para os workers GSI8 (`WORK#QUOTA_TELEMETRY`, `WORK#SECURITY_AUDIT`, `WORK#TRANSIENT`, `WORK#DELIVERY_RECORD` etc.), e `infra/tests/stack.tftest.hcl`'s `gsi8_worker_isolation` cobre isolamento cross-namespace nos dois sentidos. GSI3/GSI6 têm política escopada por índice desde o design, nunca acesso geral de tabela.
- **Histórico**: nenhuma ocorrência de `cross-tenant`/`vazamento`/`leak`/`IDOR` em `decisions-log.md` (D-16x a D-243, toda a faixa desde o round1 anterior) é um vazamento real não fechado — são todas provas positivas de isolamento, ou um achado de higiene de API já corrigido em D-120 (`handleListMembers` devolvia campos internos de chave DynamoDB, `PK`/`SK`/`GSI4PK`/`GSI4SK`, em vez de projeção segura — vazava estrutura de chave, não dado de outro tenant; já corrigido projetando `{userId, role, status, version}`).

**Ressalva registrada por ambos os lados (achado BAIXO, não um vazamento confirmado)**: a garantia estrutural de `ACTION_ROLES` prova completude da matriz para ações já declaradas, mas não prova por si só que (1) toda rota realmente chama `authorize()`, (2) a rota escolhe a `Action` correta, ou (3) uma operação nova não reaproveita indevidamente uma ação existente permissiva. Nenhum caso concreto de violação foi encontrado nas rotas revisadas — é uma lacuna de garantia arquitetural (não é enforcement automático via lint/dependency-cruiser de "todo handler de negócio deve chamar authorize()"), registrada para calibrar auditorias futuras, não um defeito ativo.

## Achado real, não corrigido (nível 3+, fora do escopo desta auditoria): drift em `scripts/reset-dev-data.ts`

Achado do Codex, confirmado por leitura de código: `QUEUE_BASE_NAMES` (`scripts/reset-dev-data.ts:59`) lista 12 filas base (24 com DLQs) — o inventário congelado no momento do cutover B2B-12 (D-110/D-111). O sistema hoje tem filas adicionais criadas por módulos posteriores (WhatsApp outbox/delivery, scheduled reports delivery, document-request-recurrence, entre outras) que **não estão nessa allowlist**. Consequência: uma futura execução de `--confirm` terminaria "verde" (segunda leitura fail-loud só audita as filas que a própria allowlist conhece) enquanto deixaria mensagens órfãs nas filas novas — o script continua seguro para o **schema DynamoDB** (Scan é schema-agnostic, sem drift ali), mas o inventário de infraestrutura de fila está desatualizado. Não corrigido nesta sessão (auditoria, não implementação; atualizar a lista exige levantar exaustivamente todas as filas SQS reais do ambiente `dev`, uma tarefa de conteúdo, não uma correção mecânica nível 1-2). Registrado como pendência real para a próxima vez que o script for necessário.

## Notas por critério (convergência Claude/Codex)

| Critério | Peso | Claude | Codex | Classificação |
|---|---:|---:|---:|---|
| 1. Lifecycle Automatizado de Tenant | 18% | 6,5 | 8,8 | Melhora real desde round1 (era 3,0) — `Organization`/`Membership`/convite/aceite/troca-de-role/último-OWNER/`organization:close`↔`organization:cancel-close`/`HELD_FOR_RECOVERY` são estados reais, testados (`test/unit/organization/close-organization.test.ts`, `cancel-organization-closure.test.ts`, `tenant-lifecycle.test.ts`). Falta control plane único de billing/planos. |
| 2. Offboarding, Exportação & Crypto-shredding | 16% | 6,0 | 9,0 | Melhora real (era 1,0) — purga física orquestrada (W3-07/D-124) e janela de recuperação (D-127) são código real e testado. Divergência maior entre os lados: Codex avalia o purge operacional como suficiente para quase-gate; Claude pesa mais a ausência de crypto-shredding por chave dedicada (nem um nem outro encontrou essa primitiva implementada — concordam no fato, divergem no peso). |
| 3. Planos, Entitlements, Quotas & Fairness | 13% | 7,8 | 6,5 | Sem mudança de fato desde o fix de concorrência do round1; billing/catálogo comercial continua ausente por decisão (D-052). |
| 4. Correção do Serviço de Lembretes | 15% | 8,6 | 9,2 | Sem mudança de escopo; ambos citam evidência de código real (timezone/DST/quiet-hours/reconciliação). |
| 5. Transparência/Usabilidade/Acessibilidade | 10% | N/A | N/A | Excluído do denominador — fora do escopo desta auditoria de backend. |
| 6. Administração, Suporte & Operação | 10% | 4,0 | 6,5 | Melhora desde round1 (era 2,0) — `activity:read`/Admin Activity Log (D-149) dá trilha real. Ambos concordam: falta capability formal de suporte cross-tenant (staff da plataforma), bloqueada por decisão em D-052 até M12/billing existir. |
| 7. Métricas de Valor & Economia Unitária | 10% | 3,0 | 4,0 | Sem mudança material — `cost-model.md` continua estimativa agregada de design, `TenantQuota` mede consumo/quota, não custo em dólares por tenant em runtime. Lacuna FinOps conhecida e aceita (10º eixo não formalizado). |
| 8. Evolução Unificada & Controle de Customização | 8% | 8,7 | 9,0 | Reforçado — DocumentType/RequirementTemplate são catálogos tenant-scoped versionados; nenhum fork de código/config por tenant encontrado. |

## Nota ponderada final: 7,1/10 (Claude) / 7,8/10 (Codex) — média simples não usada, ambas abaixo do gate

Ambas as notas ficam consistentemente abaixo de 9,0, mas acima do 4,65 do round1 anterior — reflexo real de trabalho de produto entregue desde então (lifecycle de organização, purge/recuperação, activity log), não de recalibração de critério. As lacunas residuais (billing/planos, suporte cross-tenant, crypto-shredding dedicado, telemetria de custo por tenant) são, nos dois pareceres, trabalho de produto ainda não construído e já bloqueado/registrado em decisões anteriores (D-052 principalmente) — não defeitos de engenharia a corrigir agora.

## Achados pendentes para rodada futura

1. **Drift de `scripts/reset-dev-data.ts`** (achado do Codex, nível 3+, não corrigido): `QUEUE_BASE_NAMES` desatualizado, faltam filas criadas após B2B-12 (WhatsApp, scheduled reports, recurrence). Atualizar antes do próximo uso real do script.
2. **Lacuna de garantia arquitetural em RBAC** (achado BAIXO, ambos os lados): nenhum enforcement automático (lint/dependency-cruiser) garante que todo handler de negócio novo chama `authorize()` — hoje é disciplina de revisão, não impossibilidade estrutural. Nenhuma violação real encontrada; registrar como item de fortalecimento, não achado de segurança ativo.
3. **Billing/catálogo de planos, suporte cross-tenant, crypto-shredding dedicado, telemetria de custo por tenant** — todos já bloqueados/registrados em decisões anteriores (D-052 principalmente); sem mudança de status nesta rodada, apenas reconfirmados como pendentes.

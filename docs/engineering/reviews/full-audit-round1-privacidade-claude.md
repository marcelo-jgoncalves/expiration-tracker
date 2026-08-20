---
status: draft
owner: claude
authority: audit-record
---

# Full-audit round1 — Eixo Privacidade e Governança de Dados — nota cega Claude (R1)

Protocolo `AGENTS.md` §4 aplicado a `docs/engineering/joint-review-criteria.md` ("Eixo: Privacidade e Governança de Dados"). Nota cega registrada ANTES de rodar Codex ou ver seu output.

Evidência revisada: `docs/architecture/privacy-lgpd.md`, `docs/architecture/data-model.md` (§2-3, atributos comuns, GSI6), `src/shared/observability/redactor.ts`, `schemas/sensitive-fields.json`, `src/modules/identity/**` (nenhum endpoint de direitos do titular), `src/modules/expiration/domain/audit-event.ts`, `infra/lib/dynamo-table.ts` / `infra/lib/scoped-lambda-function.ts` (GSI6 restrito a `ReminderReconciliation`/`OutboxSweeperReminderDispatch`, nenhum papel de purge).

Achado estrutural que atravessa vários critérios: `data-model.md:21` declara `retentionClass`/`purgeAfter` como "atributos comuns a toda entidade", mas **nenhuma entidade em `src/` carrega esses campos** (`grep retentionClass|purgeAfter src/` = 0 resultados) e **não existe código de `DataSubjectRequest`** em lugar nenhum do repositório. O design (`privacy-lgpd.md`) está aprovado e detalhado; a implementação real (M0-M3) não tocou nenhuma dessas peças — esperado para o estágio (pré-produção, sem usuários reais), mas a nota deve refletir o estado real do sistema, não a intenção documentada.

## Notas por critério

| # | Critério | Peso | Nota | Evidência |
|---:|---|---:|---:|---|
| 1 | Inventário/Classificação/Ownership/Linhagem | 15% | 7.0 | `privacy-lgpd.md` §1 mapeia entidade→finalidade→base legal; `schemas/sensitive-fields.json` é fonte única para redação. Mas o inventário não referencia código real (nenhum campo `retentionClass` materializado), e não há processo que bloqueie campo/integração nova sem classificação (é convenção documental, não gate automatizado). |
| 2 | Base Legal/Finalidade/Minimização | 16% | 7.5 | Base legal por tratamento documentada (`privacy-lgpd.md` §2); minimização tem código real: `redactor.ts` redige por nome de campo + padrão de valor antes de log/evento/DLQ; `audit-event.ts:73` redige `changes` antes de persistir. Uso secundário/reavaliação não tem mecanismo formal, mas também não há uso secundário implementado ainda. |
| 3 | Direitos do Titular & Portabilidade | 16% | 2.0 | Design robusto (state machine RECEIVED→VERIFIED→DISCOVERED→HELD/PURGING→COMPLETED, `privacy-lgpd.md` §3), mas **zero código**: nenhum endpoint em `src/modules/identity/http` ou em qualquer outro módulo para confirmação/acesso/correção/exportação/oposição/exclusão. Nenhuma entidade `DataSubjectRequest`. |
| 4 | Retenção/Legal Hold/Exclusão Verificável & Backups | 17% | 2.5 | Matriz de 8 classes bem definida (`privacy-lgpd.md` §4). GSI6 existe fisicamente (`infra/lib/dynamo-table.ts:89-93`) mas sua policy de acesso (`scoped-lambda-function.ts:97-104`) restringe leitura exclusivamente a `ReminderReconciliation`/`OutboxSweeperReminderDispatch` — nenhum worker de purge sancionado. Nenhuma entidade carrega `retentionClass`/`purgeAfter`. Nenhum teste prova que dado excluído não ressurge após restore (não pode provar, porque exclusão não existe). |
| 5 | Localização/Transferência Internacional & Subprocessamento | 14% | 6.5 | Lacuna real (região AWS não decidida) documentada explicitamente como bloqueio pré-produção, não drift silencioso (`privacy-lgpd.md` §5) — o critério pede exatamente isso. Inventário de subprocessadores existe em nível de escopo, não versionado com todos os campos prometidos (retenção/exclusão/incidentes por fornecedor) ainda preenchidos. |
| 6 | RIPD/Risco aos Titulares & Privacy by Design | 10% | 4.0 | Doc menciona necessidade de RIPD e parecer jurídico obrigatório antes do lançamento, mas não define critério objetivo de QUANDO elaborar/atualizar um RIPD (o critério pede isso explicitamente) nem um gate de decisão humana registrada para tratamento de alto risco. |
| 7 | Qualidade/Correção & Proveniência dos Dados | 7% | 3.0 | Nenhum mecanismo visível distingue campo inferido por OCR/IA de campo confirmado pelo usuário (`ExtractedField`/`ExtractionRun` mencionados no mapa de dados, mas módulo de extração ainda não implementado em `src/`). Nenhum código de correção/proveniência. |
| 8 | Accountability/Evidência & Monitoramento de Privacidade | 5% | 7.0 | `AuditEvent` é real, append-only, transacional e redigido (`audit-event.ts`) — boa evidência auditável para mutações de `ExpirationItem`. Não cobre ainda aprovações de legal hold, DSRs ou exceções (porque não existem), então evidência é parcial ao escopo hoje implementado. |

## Nota ponderada Claude (R1)

0.15×7.0 + 0.16×7.5 + 0.16×2.0 + 0.17×2.5 + 0.14×6.5 + 0.10×4.0 + 0.07×3.0 + 0.05×7.0
= 1.05 + 1.20 + 0.32 + 0.425 + 0.91 + 0.40 + 0.21 + 0.35
= **4.885/10**

Nota baixa é esperada e proporcional: o eixo mede o sistema real, e a maior parte do peso (criter. 3+4 = 33%) cobre funcionalidade de direitos do titular e retenção/exclusão que simplesmente não foi implementada ainda (M4+ em diante). Isso não é necessariamente um "achado corrigível" nesta sessão — construir DSR endpoints e purge workers reais é escopo maior (feature), não point-fix. Pontos corrigíveis nesta sessão: drift de documentação (data-model.md afirmando atributo comum que não existe em nenhuma entidade), e lacunas de critério objetivo (RIPD trigger) que são custo de doc, não de produto.

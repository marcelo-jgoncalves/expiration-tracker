---
status: draft
owner: claude
authority: audit-proposal
---

# Full-audit round2 — Eixo Privacidade e Governança de Dados — proposta Claude (nota cega, antes do Codex)

Reabertura do eixo conforme a própria recomendação do round1 (`full-audit-round1-privacidade-summary.md`, condição "b": M4+ implementa purge worker real). Desde o fechamento do round1 (2026-08-19), `docs/architecture/decisions-log.md` registra D-179 a D-190 e D-205/D-217/D-225: nove workers de purga reais foram implementados e materializados sobre GSI8 (`core-user-data-purge`, `delivery-record-purge`, `document-purge`, `invitation-purge`, `membership-purge`, `quota-telemetry-purge`, `security-audit-purge`, `transient-purge`, `tenant-purge`), além de `document-file-reconciliation` e `requirement-reindex`. Esta rodada reavalia os 8 critérios de `docs/engineering/joint-review-criteria.md` §"Eixo: Privacidade e Governança de Dados" contra o código real hoje.

## Evidência levantada nesta rodada

1. **Fleet de purga real** (`src/workers/*purge*/purge.ts`, handlers em `src/runtime/aws/handlers/*purge*.ts`, GSI8 marker files `src/shared/*-gsi8.ts`): 9 workers cobrem contas/usuário core, registros de entrega, documentos, convites, memberships, telemetria de quota, security audit, dados transientes e purga de tenant inteiro (D-179 a D-190).

2. **Achado real, NÃO corrigido nesta auditoria (documental) — gap de cobertura em entidades novas**: `DossierExportRun` (`src/modules/document-archive/domain/dossier-export-run.ts`) e `ReportSubscription`/`ReportSubscriptionRun` (`src/modules/reports/domain/report-subscription*.ts`) não têm nenhum campo de TTL/`purgeAfter`/`retentionClass`, e não existe worker `dossier-export-purge` nem `report-subscription-purge` na lista de workers acima. `src/workers/dossier-export/generate.ts` gera PDF **narrativo + XLSX exaustivo** por Subject (D-205/D-217) e sobe ambos para S3 (`READY`) sem qualquer registro de expiração — comparar com `guest-credential-delivery.ts`, que documenta explicitamente `purgeAfterTtl` (DynamoDB TTL, "housekeeping de um segredo abandonado", D-143) e é coberto por `delivery-record-purge`. Um dossiê exaustivo de todos os Requirements de um Subject é dado pessoal denso (potencialmente dados sensíveis dependendo do tipo de documento) e hoje fica em S3 indefinidamente após gerado — nenhum lifecycle rule, nenhum campo de expiração no domínio, nenhum worker.
   - Mesmo padrão em `report-export-store.ts` (comentário próprio do código nota que "um presign de TTL longo é fisicamente inválido", mas isso é sobre o link de acesso, não sobre o objeto S3 subjacente em si — não há evidência de S3 lifecycle policy ou de purge job para os artefatos de relatório gerados).
   - **Severidade: alta** para o critério #4 (Retenção) — é exatamente o tipo de "entidade nova sem retentionClass/purgeAfter" que o round1 já havia sinalizado como padrão de risco, e se repetiu em features implementadas depois do round1 fechar.

3. **Achado real, independente — starvation de purga sob carga (D-170)**: `docs/architecture/decisions-log.md` D-170 documenta, com leitura de código, que 9 dos 10 workers de manutenção/purga usam `Scan` na tabela base com `Limit=100`/`MAX_PAGES=25` **sem `ExclusiveStartKey` persistido entre invocações agendadas** — o Scan reinicia pela mesma ordem física de hash a cada execução. Isso significa que, sob volume que exceda a capacidade de uma janela agendada, candidatos além da página cortada **nunca são alcançados** (não é "pego amanhã", como o comentário do próprio código afirma em pelo menos 2 workers — D-170 chama isso de "factualmente falso como escrito"). Efeito de privacidade: para tenants/volumes grandes, a purga de PII pode não progredir de forma verificável — o compromisso "purge worker existe" não implica "todo registro elegível é de fato purgado dentro do prazo". Isto já está registrado como decisão (D-170), então não é achado novo desta auditoria, mas é diretamente relevante ao critério #4 e deve pesar na nota porque nenhuma correção de código foi feita para o problema em si (é achado documentado, não corrigido).

4. **`SecureLogger`/Redactor seguem íntegros**: `grep -rn "console\.log|console\.error|console\.warn"` fora de `src/shared/observability/logger.ts` não retornou nenhuma ocorrência em `src/` (não-teste) — o único uso de `console.*` no repo é a própria implementação do sink padrão do `SecureLogger` (`logger.ts:50`), que passa todo campo pelo `Redactor` central (`redactor.ts`) antes de logar (`logger.ts:104`). Nenhuma regressão desde o round1.

5. **Guest/terceiros externos**: `guest-credential-delivery.ts` (D-143) e `document-archive-guest-rate-limiter.ts` têm TTL explícito e purga real via `delivery-record-purge`. `ExternalShareLink` (D-225) é design-only (nenhum código tocado, confirmado por ausência total de `ExternalShareLink`/`external-share-link` em `src/`) — portanto não avaliável em código ainda; o próprio design (Rodada 4, `docs/architecture/reviews/external-sharing-scoping/`) já especifica TTL e reconciliação de expiração, o que é positivo para quando for implementado, mas não pontua no código hoje.

## Notas por critério (nota cega, antes de ver o Codex)

| # | Critério | Peso | Round1 (Claude R2) | Round2 Claude | Racional da mudança |
|---:|---|---:|---:|---:|---|
| 1 | Inventário/Classificação/Ownership/Linhagem | 15% | 8.0 | 7.5 | Regressão parcial: entidades novas (DossierExportRun, ReportSubscription) não seguiram a convenção `retentionClass`/`purgeAfter` que `data-model.md` §1 já declarava como design-target — inventário ficou desatualizado em relação ao código novo. |
| 2 | Base Legal/Finalidade/Minimização | 16% | 7.5 | 7.5 | Sem mudança material — minimização de log intacta, sem novo enforcement de classificação. |
| 3 | Direitos do Titular & Portabilidade | 16% | 2.0 | 2.0 | Sem mudança — zero endpoints de DSR ainda; fora de escopo de correção documental. |
| 4 | Retenção/Legal Hold/Exclusão Verificável & Backups | 17% | 2.5 | 4.5 | Melhora real e significativa: 9 workers de purga passaram de design para código deployado desde round1 (era o maior gap do eixo). Não chega mais alto porque (a) achado novo de cobertura incompleta em DossierExportRun/ReportSubscription, dado pessoal denso sem TTL/purge nenhum, e (b) D-170 documenta que o mecanismo de Scan sem cursor persistido não garante progresso de purga sob carga — "purga existe" ainda não é "purga verificável e completa". |
| 5 | Localização/Transferência Internacional & Subprocessamento | 14% | 6.5 | 6.5 | Sem mudança — impedimento externo (região AWS, DPAs, parecer jurídico) continua pendente de decisão de Marcelo/terceiros. |
| 6 | RIPD/Risco aos Titulares & Privacy by Design | 10% | 6.5 | 6.5 | Sem mudança — gatilhos objetivos existem (`privacy-lgpd.md` §6), nenhum disparou de fato ainda. |
| 7 | Qualidade/Correção & Proveniência dos Dados | 7% | 3.0 | 3.0 | Sem mudança — módulo de extração/IA ainda não implementado. |
| 8 | Accountability/Evidência & Monitoramento de Privacidade | 5% | 7.0 | 7.0 | Sem mudança — `AuditEvent` continua real e redigido; ainda não cobre DSR/legal hold inexistentes. |

## Nota ponderada Claude R1 (desta rodada, cega)

0.15×7.5 + 0.16×7.5 + 0.16×2.0 + 0.17×4.5 + 0.14×6.5 + 0.10×6.5 + 0.07×3.0 + 0.05×7.0
= 1.125 + 1.20 + 0.32 + 0.765 + 0.91 + 0.65 + 0.21 + 0.35
= **5.535/10**

Gate (≥9.0, sem arredondar) não atingido. Progresso real de +0.27 vs. round1 fechado (4.885→5.535 na mesma metodologia de ponderação), tracionado quase inteiramente pelo critério #4 (purga real implementada), parcialmente compensado por um achado novo de cobertura incompleta nas entidades mais recentes.

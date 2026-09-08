---
status: final
owner: claude+codex
authority: audit-record
---

# Full-audit round2 — Eixo Privacidade e Governança de Dados — resumo consolidado

Reabertura do eixo (protocolo `AGENTS.md` §4) conforme a recomendação explícita do fechamento round1 (`full-audit-round1-privacidade-summary.md`, condição "b": reabrir quando M4+ implementar purge worker real). Desde o fechamento de round1 (2026-08-19), `docs/architecture/decisions-log.md` registra D-179 a D-190 (nove workers de purga reais sobre GSI8) e D-205/D-217/D-225 (dossier export, report subscriptions, external share link design).

## O que aconteceu nesta rodada

1. Nota cega Claude registrada em `full-audit-round2-privacidade-claude.md`, com evidência real de grep/leitura de código (workers de purga, `dossier-export-run.ts`, `report-subscription*.ts`, `logger.ts`/`redactor.ts`, D-170, D-225).
2. `codex exec` foi invocado em background (`full-audit-round2-privacidade-codex-prompt.txt`) para nota cega independente. **A execução terminou de forma anormal**: o processo produziu um despejo extenso de leitura de arquivos (`decisions-log.md` completo, greps de `requirement-reindex/reindex.ts`), passou por um erro de sintaxe de glob do `rg` no Windows (`src/workers/*purge*: A sintaxe do nome do arquivo... está incorreta`), e finalmente encerrou sem produzir nota nem seção de conclusão, com um erro real do próprio binário do CLI no rodapé: `codex_models_manager::manager: failed to renew cache TTL: missing field 'supports_parallel_tool_calls' at line 93 column 5` — um bug de compatibilidade de versão/cache do `codex-cli 0.147.0` neste ambiente, não um erro de conteúdo da análise. Isto é o mesmo padrão de falha de infraestrutura do CLI já documentado no fechamento de round1 (lá: timeout do model manager; aqui: erro de deserialização do cache de modelos do model manager).
3. Por instrução explícita da sessão orquestradora (não repetir `codex exec` em loop após falha, documentar o bloqueio e prosseguir), a nota cega do Codex **não foi obtida nesta rodada**. Saída bruta preservada em `full-audit-round2-privacidade-codex-output-round1.txt` como evidência do bloqueio, não como avaliação válida.

## Notas por critério (Claude, nota cega, evidência real — ver `full-audit-round2-privacidade-claude.md` para detalhe)

| # | Critério | Peso | Round1 (Claude R2) | Round2 Claude | Situação |
|---:|---|---:|---:|---:|---|
| 1 | Inventário/Classificação/Ownership/Linhagem | 15% | 8.0 | 7.5 | Regressão parcial — entidades novas (`DossierExportRun`, `ReportSubscription`) não seguiram a convenção `retentionClass`/`purgeAfter` já declarada em `data-model.md` §1. |
| 2 | Base Legal/Finalidade/Minimização | 16% | 7.5 | 7.5 | Sem mudança material. |
| 3 | Direitos do Titular & Portabilidade | 16% | 2.0 | 2.0 | Sem mudança — zero endpoints DSR. |
| 4 | Retenção/Legal Hold/Exclusão Verificável & Backups | 17% | 2.5 | 4.5 | Melhora real: 9 workers de purga foram deployados desde round1 (D-179 a D-190). Não sobe mais porque (a) achado novo — `DossierExportRun`/`ReportSubscription` (PDF/XLSX exaustivo por Subject, D-205/D-217) não têm TTL/purgeAfter/retentionClass nem worker de purga dedicado, ficando em S3 indefinidamente; (b) D-170 (já registrado, não corrigido em código) documenta que 9/10 workers usam `Scan` sem `ExclusiveStartKey` persistido entre invocações, o que pode impedir progresso verificável de purga sob volume — "worker existe" ainda não é "todo registro elegível é de fato purgado no prazo". |
| 5 | Localização/Transferência Internacional & Subprocessamento | 14% | 6.5 | 6.5 | Sem mudança — impedimento externo (decisão de região/DPA/parecer jurídico) continua pendente de Marcelo/terceiros. |
| 6 | RIPD/Risco aos Titulares & Privacy by Design | 10% | 6.5 | 6.5 | Sem mudança — gatilhos objetivos existem, nenhum disparou de fato. |
| 7 | Qualidade/Correção & Proveniência dos Dados | 7% | 3.0 | 3.0 | Sem mudança — módulo de extração/IA ainda não implementado. |
| 8 | Accountability/Evidência & Monitoramento de Privacidade | 5% | 7.0 | 7.0 | Sem mudança. |

**Nota ponderada Claude R2 (2026-09-07)**: 0.15×7.5 + 0.16×7.5 + 0.16×2.0 + 0.17×4.5 + 0.14×6.5 + 0.10×6.5 + 0.07×3.0 + 0.05×7.0 = **5.535/10**.

Codex: **não obtido** (falha de infraestrutura do CLI, ver acima). Não é registrada como nota formal nem estimada por simetria desta vez — a rodada anterior já registrou uma estimativa por simetria sem valor de auditoria real; repetir o mesmo substituto não agrega evidência.

**Gate do eixo (`AGENTS.md` §4, ≥9.0 sem arredondar) NÃO atingido.** Progresso real de +0.65 em relação ao fechamento round1 (4.885→5.535 na mesma ponderação), inteiramente tracionado pelo critério #4 (purga real implementada), parcialmente compensado por um achado novo de cobertura incompleta.

## Achados reais desta rodada, por severidade

- **Severidade ALTA (retenção incorreta/indeterminada, achado real, NÃO corrigido nesta auditoria — é achado, não fix)**: `DossierExportRun` (`src/modules/document-archive/domain/dossier-export-run.ts`) e `ReportSubscription`/`ReportSubscriptionRun` (`src/modules/reports/domain/report-subscription*.ts`) não têm campo de TTL/`purgeAfter`/`retentionClass`, e não há worker `dossier-export-purge` nem `report-subscription-purge` na lista completa de workers de purga (`src/workers/*purge*/purge.ts`). `src/workers/dossier-export/generate.ts` produz PDF narrativo + XLSX exaustivo por Subject e sobe ambos a S3 marcando o run `READY`, sem qualquer expiração declarada no domínio nem evidência de S3 lifecycle rule. Comparar com o padrão correto já existente em `guest-credential-delivery.ts` (`purgeAfterTtl`, D-143, coberto por `delivery-record-purge`). Escopo maior de correção (feature de implementação, não documental) — registrado para rodada futura/roadmap.
- **Severidade MÉDIA (achado pré-existente, já documentado em D-170, ainda não corrigido)**: `Scan` sem `ExclusiveStartKey` persistido em 9/10 workers de manutenção/purga pode impedir progresso verificável de purga sob volume alto — risco de retenção indefinida de PII além da capacidade de uma janela de execução agendada. Não é achado novo desta auditoria (D-170 já registrou), mas pesa diretamente no critério #4 porque segue sem correção de código.
- **Sem vazamento de PII em logs confirmado**: `grep -rn "console\.log|console\.error|console\.warn" src/ --include=*.ts` (excluindo testes) só retorna o próprio sink interno de `src/shared/observability/logger.ts:50`, que passa todo campo pelo `Redactor` central (`redactor.ts`) antes de emitir. Nenhuma regressão desde round1.
- **Guests/terceiros externos**: `guest-credential-delivery.ts` (D-143) tem TTL real e purga real (`delivery-record-purge`). `ExternalShareLink` (D-225) é design-only — confirmado por ausência total de código correspondente em `src/` — e o próprio design já especifica TTL/reconciliação, positivo para quando implementado.

## Corrigido vs. pendente

- **Corrigido desde round1**: critério #4 avançou de "nenhuma entidade com purga real" para "9 workers de purga deployados" — a maior lacuna do eixo deixou de ser puramente de design.
- **Pendente (escopo maior de implementação, não corrigível por esta auditoria documental)**: TTL/purge para `DossierExportRun`/`ReportSubscription`; correção do padrão Scan-sem-cursor de D-170; DSR endpoints (#3); decisão de região/DPA (#5); RIPD real acionado (#6); módulo de proveniência IA (#7).
- **Pendente (bloqueio de infraestrutura, não de conteúdo)**: nota cega do Codex para esta rodada — reexecutar `codex exec` numa sessão futura antes de considerar o eixo reavaliado por ambos os lados.

## Recomendação

Fechar o ponto de parada desta rodada. Reabrir quando: (a) `DossierExportRun`/`ReportSubscription` ganharem TTL/purge real, (b) o padrão Scan de D-170 for corrigido, (c) DSR endpoints ou decisão de região acontecerem, ou (d) simplesmente para obter a nota cega do Codex que faltou nesta rodada (não depende de mudança de código, só de reexecução do CLI).

---
status: final
owner: claude+codex
authority: audit-record
---

# Full-audit round2 — Eixo Privacidade e Governança de Dados — resumo consolidado

Reabertura do eixo (protocolo `AGENTS.md` §4) conforme a recomendação explícita do fechamento round1 (`full-audit-round1-privacidade-summary.md`, condição "b": reabrir quando M4+ implementar purge worker real). Desde o fechamento de round1 (2026-08-19, Claude 4,885/Codex 3,82/10), `docs/architecture/decisions-log.md` registra D-179 a D-190 (nove workers de purga reais sobre GSI8) e D-205/D-217/D-225 (dossier export, report subscriptions, external share link design).

## O que aconteceu nesta rodada

1. Nota cega Claude registrada em `full-audit-round2-privacidade-claude.md`, evidência real de grep/leitura de código. Nota ponderada: **5,535/10**.
2. `codex exec` invocado em background (`full-audit-round2-privacidade-codex-prompt.txt`, instrução explícita de não ler a nota do Claude antes de terminar — nota cega real). A transcrição bruta (`full-audit-round2-privacidade-codex-output-round1.txt`) contém, no meio do processo, um erro real de infraestrutura do binário (`codex_models_manager::manager: failed to renew cache TTL: missing field 'supports_parallel_tool_calls'`, bug de compatibilidade do cache de modelos do `codex-cli 0.147.0`) e um erro de sintaxe de glob do `rg` no Windows — nenhum dos dois impediu a conclusão: o processo seguiu rodando em background além da primeira checagem desta sessão (que viu só uma transcrição parcial) e completou nota por critério com evidência própria + veredito final: **5,664/10**, gate não atingido.
3. **Reconciliação factual (achado real desta rodada)**: a maior divergência entre as duas notas cegas foi o critério #4 — Retenção (Claude 4,5 vs. Codex 7,2). Verificado por leitura direta do código (não apenas aceito de um dos dois lados): `src/workers/membership-purge/purge.ts:107-240` e `src/workers/transient-purge/purge.ts` paginam `exclusiveStartKey` via `queryDue()` sobre **GSI8** (não mais `Scan` na tabela base). O cursor não persiste entre invocações agendadas — isso é verdade —, mas GSI8 ordena por elegibilidade/data de purga, então cada invocação nova naturalmente processa primeiro os candidatos mais atrasados (starvation monotonicamente decrescente a cada execução), estruturalmente diferente do Scan por hash que D-170 criticou (starvation arbitrária, sem relação com urgência). **Conclusão da reconciliação: a leitura do Codex está mais correta que a do Claude R2** — a migração para GSI8 (D-179/D-190) já é uma correção estrutural real do problema central de D-170, não apenas "worker existe mas sem garantia de progresso" como a nota Claude original registrou. O ponto residual que sobrevive (nem Claude nem Codex divergem disso) é ausência de cobertura para `DossierExportRun`/`ReportSubscription` — ver achados abaixo.

## Notas por critério — as duas notas cegas lado a lado

| # | Critério | Peso | Round1 fechamento (Claude/Codex) | Claude R2 | Codex R2 | Nota reconciliada |
|---:|---|---:|---:|---:|---:|---:|
| 1 | Inventário/Classificação/Ownership/Linhagem | 15% | 8.0 / 5.0 | 7.5 | 5.5 | 6.5 — divergência real não fechada nesta rodada (Claude pesa a convenção documental de `data-model.md` §1 mais do que Codex; ambos concordam que entidades novas não seguem `retentionClass`/`purgeAfter`) |
| 2 | Base Legal/Finalidade/Minimização | 16% | 7.5 / 6.0 | 7.5 | 7.5 | 7.5 — concordância real |
| 3 | Direitos do Titular & Portabilidade | 16% | 2.0 / 1.0 | 2.0 | 2.0 | 2.0 — concordância real, zero DSR |
| 4 | Retenção/Legal Hold/Exclusão Verificável & Backups | 17% | 2.5 / 2.5 | 4.5 | 7.2 | **7.2 (adota Codex, reconciliação factual confirma GSI8 corrige D-170 estruturalmente — ver acima)**, com ressalva explícita: ainda não cobre `DossierExportRun`/`ReportSubscription` |
| 5 | Localização/Transferência Internacional & Subprocessamento | 14% | 6.5 / 4.5 | 6.5 | 3.0 | 4.5 — divergência real não fechada (Codex pesa mais a ausência de subprocessadores/DPA formalizados; impedimento externo em ambos os casos) |
| 6 | RIPD/Risco aos Titulares & Privacy by Design | 10% | 6.5 / 3.0 | 6.5 | 8.5 | 7.5 — divergência real não fechada (Codex credita mais os 6 gatilhos objetivos de `privacy-lgpd.md` §6 do que Claude) |
| 7 | Qualidade/Correção & Proveniência dos Dados | 7% | 3.0 / 6.0 | 3.0 | 7.5 | 5.0 — divergência real não fechada (Codex encontrou `EXTRACTION_TRANSIENT` já distinguido em `privacy-lgpd.md:56` como proveniência OCR-vs-confirmado; Claude não tinha essa evidência na proposta original) |
| 8 | Accountability/Evidência & Monitoramento de Privacidade | 5% | 7.0 / 3.5 | 7.0 | 6.0 | 6.5 — divergência pequena, sem reconciliação factual necessária |

**Nota ponderada Claude R2**: 5,535/10. **Nota ponderada Codex R2**: 5,664/10. **Nota reconciliada** (usando a coluna final, só o critério #4 tem reconciliação factual completa; os demais permanecem média simples por falta de mais uma rodada de debate real): 0.15×6.5 + 0.16×7.5 + 0.16×2.0 + 0.17×7.2 + 0.14×4.5 + 0.10×7.5 + 0.07×5.0 + 0.05×6.5 = 0.975+1.20+0.32+1.224+0.63+0.75+0.35+0.325 = **5,774/10**.

**Gate do eixo (`AGENTS.md` §4, ≥9.0 sem arredondar) NÃO atingido por nenhuma leitura.** Progresso real em relação ao fechamento round1 (Claude 4,885→5,535; Codex 3,82→5,664; reconciliado ~4,35→5,774), tracionado majoritariamente pelo critério #4 (purga real sobre GSI8, agora confirmado estruturalmente superior ao Scan que D-170 criticava).

## Achados reais desta rodada, por severidade

- **Severidade ALTA (retenção indeterminada, achado real, concordância Claude+Codex, NÃO corrigido nesta auditoria)**: `DossierExportRun` (`src/modules/document-archive/domain/dossier-export-run.ts`) e `ReportSubscription`/`ReportSubscriptionRun` (`src/modules/reports/domain/report-subscription*.ts`) não têm campo de TTL/`purgeAfter`/`retentionClass`, e não há worker `dossier-export-purge` nem `report-subscription-purge` na lista completa de workers de purga (`src/workers/*purge*/purge.ts`). `src/workers/dossier-export/generate.ts` produz PDF narrativo + XLSX exaustivo por Subject e sobe ambos a S3 marcando o run `READY`, sem qualquer expiração declarada no domínio nem evidência de S3 lifecycle rule — comparar com o padrão correto já existente em `guest-credential-delivery.ts` (`purgeAfterTtl`, D-143, coberto por `delivery-record-purge`). Escopo maior de correção (feature de implementação, não documental) — registrado para rodada futura/roadmap.
- **Severidade RESOLVIDA NESTA RODADA (reconciliação, não achado novo)**: o problema de starvation de purga por `Scan` sem cursor persistido (D-170) é estruturalmente mitigado pela migração para consulta ordenada em GSI8 (D-179/D-190) — confirmado por leitura direta do código dos workers. Registrar esta reconciliação em `D-170` (nota de acompanhamento) é recomendado para a próxima sessão que tocar decisions-log.md.
- **Sem vazamento de PII em logs confirmado**: `grep -rn "console\.log|console\.error|console\.warn" src/ --include=*.ts` (excluindo testes) só retorna o sink interno de `src/shared/observability/logger.ts:50`, que passa todo campo pelo `Redactor` central antes de emitir. Nenhuma regressão desde round1, confirmado por ambos os lados.
- **Guests/terceiros externos**: `guest-credential-delivery.ts` (D-143) tem TTL real e purga real (`delivery-record-purge`). `ExternalShareLink` (D-225) é design-only — confirmado por ausência total de código correspondente em `src/` (`rg -n 'ExternalShareLink|external-share' src schemas infra` sem resultado, verificado por ambos os lados) — o próprio design já especifica TTL/reconciliação, positivo para quando implementado.
- **DSR (#3) e proveniência de exclusão pós-restore (#4/#8)**: nenhum registro executável de Data Subject Request, nenhuma evidência consolidada de exclusão cobrindo DynamoDB+S3+backups+provider — achado repetido de round1, sem mudança.

## Corrigido vs. pendente

- **Corrigido desde round1**: critério #4 avançou de "nenhuma entidade com purga real" para "9 workers de purga deployados sobre GSI8, estruturalmente resistentes a starvation" — a maior lacuna do eixo deixou de ser puramente de design.
- **Pendente (escopo maior de implementação, não corrigível por esta auditoria documental)**: TTL/purge para `DossierExportRun`/`ReportSubscription`; DSR endpoints (#3); decisão de região/DPA/subprocessadores (#5); RIPD real acionado (#6); registro executável de exclusão pós-restore (#4/#8).
- **Pendente (processo)**: critérios #1, #5, #6, #7, #8 tiveram divergência real de nota Claude↔Codex não reconciliada por debate (só #4 teve verificação factual completa nesta sessão); uma Rodada 2 real de crítica/tréplica (não só duas notas cegas independentes) resolveria isso, mas o retorno esperado é baixo frente aos 47% de peso combinado (#3+#4+#5) que dependem de trabalho de produto/decisão externa, não de mais rodadas de nota.

## Recomendação

Fechar o ponto de parada desta rodada (mesmo critério de proporcionalidade do fechamento round1, `principles.md` #1). Reabrir quando: (a) `DossierExportRun`/`ReportSubscription` ganharem TTL/purge real, (b) DSR endpoints ou decisão de região/subprocessadores acontecerem, ou (c) RIPD real for acionado e produzido. Registrar a reconciliação de D-170 (starvation resolvida por GSI8) no `decisions-log.md` de arquitetura na próxima sessão que tocar esse arquivo, para não deixar D-170 lido como "problema aberto" fora de contexto.

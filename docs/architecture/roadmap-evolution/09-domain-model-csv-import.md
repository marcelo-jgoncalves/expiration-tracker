---
status: draft
owner: Marcelo
authority: informativo (decisão de domínio reconciliada via protocolo AGENTS.md §4; promovida a ADR formal só na Fase 3, junto do roadmap final)
---

# Fase 2b — Modelagem de domínio: CSV import/export

Sétimo e último cluster de decisão da Fase 2b. Decisão nível 5 (`change-risk-scale.md` — nova
superfície de processamento em massa, segurança de entrada). Protocolo Claude↔Codex completo via
MCP, sandbox read-only, 3 rodadas reais, eixos Qualidade de Engenharia + Segurança.

**Nota final: Claude 9,2 / Codex 9,4 — gate ≥9,0 atingido, sem arredondar.**

## Processo

- **Rodada 1**: convergência forte em CSV primeiro (XLSX depois, não simultâneo), fluxo
  assíncrono padrão reaproveitando `sqs-worker-queue`, preview persistido evitando reparse no
  commit, dedupe por external ID com fallback fraco por nome normalizado, conflito rejeitado por
  padrão.
- **Rodada 2**: Claude atacou 2 pontos. (1) Rejeitar valores começando com `=`/`+`/`-`/`@` no
  import é defensivo demais — o risco de CSV/formula injection só se manifesta na
  **exportação/reabertura em planilha**, não no armazenamento (DynamoDB não interpreta fórmula);
  Codex concedeu e moveu a defesa para a fronteira de saída (import aceita + warning, exportação
  escapa obrigatoriamente). (2) `ImportRowPlan` como item DynamoDB por linha (até 5.000 por job)
  não é consistente com o padrão já usado no projeto (S3 para artefato grande, DynamoDB para
  agregado/transação) nem com `ADR-0001` (custo por item); Codex concedeu e moveu o plano
  linha-a-linha para S3.
- **Rodada 3**: reconciliação incorporando as 2 revisões. Nota cega final sem ver a nota do
  Claude.

## Decisão final

### CSV primeiro, sempre assíncrono

XLSX fica para milestone posterior (ZIP/multi-aba/fórmula nativa aumentam superfície de ataque
sem necessidade agora). Fluxo:
```
POST /imports/csv/reservations (valida quota/tamanho) → presigned upload
→ ImportWorker (parse streaming, valida, detecta duplicado, persiste plano)
→ POST /imports/{jobId}/commit
→ ImportCommitWorker (lê plano já persistido, grava em transações)
```
Sync só para preview muito pequeno (até 128 KiB/100 linhas), nunca para commit. Reaproveita
`infra/modules/sqs-worker-queue` (fila+DLQ+alarme, mesmo padrão do projeto). Limite inicial: 5
MiB / 5.000 linhas por import (ajustável por plano depois, ligado ao cluster 3 de entitlements).

### Segurança — defesa na fronteira de saída, não na entrada

Import **aceita** valores começando com `=`/`+`/`-`/`@` — marca warning `FORMULA_LIKE_VALUE` no
preview, sem bloquear (evita falso positivo em dado legítimo). Import rejeita só estrutura
perigosa real: `NUL`/controles/`\r`/`\n`/tab embutido, bytes inválidos, campo vazio após trim,
campo grande demais (`displayName`/`requirementName` até 160 chars, tag até 40 chars, máx. 20
tags). **Toda exportação/relatório CSV baixável escapa obrigatoriamente** valores de risco
(prefixo apostrophe ou equivalente testado) — requisito testável em qualquer export/relatório
CSV futuro, não só nesta feature. Novos tipos de quota (`IMPORT_COUNT`/`IMPORT_BYTES`/
`IMPORT_ROWS`) via `TenantQuotaService`, separados de `UPLOAD_*` de M6.

### Idempotência e deduplicação

Camada de job: `IdempotencyStore` com `requestHash = tenantId+checksumSha256+mappingVersion+mode`
— retry/duplo clique com mesma chave/hash retorna o mesmo `jobId`. Camada de domínio:
`subjectExternalId`/`requirementExternalId` (coluna recomendada no CSV) como chave forte de
dedupe; fallback fraco por `displayNameNormalized`. Registros de dedup em DynamoDB
(`PK=TENANT#t#IMPORTDEDUP#SUBJECT`, `SK=EXT#<externalId>`, `Put attribute_not_exists`), gravados
na MESMA transação da entidade final (`TrackedSubject`/`RequirementAssignment`, clusters 1).
Linha duplicada com dados divergentes: **rejeitada como conflito por padrão**, nunca update
silencioso — merge/update explícito fica para modo posterior.

### Preview/plano em S3, não DynamoDB por linha

`ImportJob` em DynamoDB (status/totais/`planObjectKey`/`planSha256`/`expiresAt`/`version`) — só o
que exige condição/transação. Plano linha-a-linha (até 5.000 linhas) vive em **S3**
(`tenant/<t>/imports/<jobId>/plan/page-N.jsonl` + manifest), consistente com o padrão já usado
para documentos grandes em M6, alinhado a `ADR-0001` (billing on-demand, custo por item/request).
Commit worker lê o plano do S3, valida `planSha256` contra o `ImportJob`, **nunca reparsa o CSV
original** — preserva a propriedade central de "validar uma vez só".

## Residuais não resolvidos nesta rodada (implementação real)

Schema exato do CSV v1 (colunas obrigatórias/opcionais), formato versionado do `ImportRowPlan`,
lifecycle/retention dos objetos S3 de import, política de commit parcial vs. "todas as linhas
aceitas ou nenhuma" — decisões de implementação, não de arquitetura, ficam para a sessão que
implementar este milestone.

## Fase 2b concluída — todos os 7 clusters fechados

| # | Cluster | Nota |
|---|---|---|
| 1 | `TrackedSubject`+`RequirementAssignment` | 9,1/9,1 |
| 2 | Guest upload/magic link | 9,2/9,2 |
| 3 | Organization/Membership/RBAC + Billing | 9,2/9,2 |
| 4 | Automated document chasing | 9,1/9,2 |
| 5 | Escalation/watchers/digest | 9,2/9,4 |
| 6 | Custom fields (rejeitado/adiado) | 9,1/9,0 |
| 7 | CSV import/export | 9,2/9,4 |

## Próxima ação

Fase 3: síntese final — roadmap milestone-a-milestone (M9+), lista de ADRs candidatos, DAG de
dependências, impacto de segurança/privacidade/persistência/custo consolidado, estratégia de
teste/migração por milestone, perguntas abertas reais, lista de capacidades rejeitadas
(entregáveis A-Q do prompt estratégico). Nenhuma implementação de código começa antes disso e da
decisão explícita do Marcelo.

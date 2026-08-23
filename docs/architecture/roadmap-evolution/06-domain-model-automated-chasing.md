---
status: draft
owner: Marcelo
authority: informativo (decisão de domínio reconciliada via protocolo AGENTS.md §4; promovida a ADR formal só na Fase 3, junto do roadmap final)
---

# Fase 2b — Modelagem de domínio: Automated Document Chasing (reaproveitamento do Reminder Engine)

Quarto cluster de decisão da Fase 2, dependente dos clusters 1-2 (`RequirementAssignment`,
`DocumentRequest`). Decisão nível 5 (`change-risk-scale.md` — muda fronteira de módulo do motor
mais maduro/testado do sistema). Protocolo Claude↔Codex completo via MCP, sandbox read-only, 3
rodadas reais, eixos Arquitetura + Operações/SRE.

**Nota final: Claude 9,1 / Codex 9,2 — gate ≥9,0 atingido, sem arredondar.**

## Processo

- **Rodada 1**: convergência forte em reaproveitar GSI3 (não criar índice/partição paralela),
  política declarativa limitada com presets versionados (fronteira anti-BPMN explícita), 1 intent
  por destinatário por canal (nunca `recipientIds[]`).
- **Rodada 2**: achado mais valioso do cluster. A proposta inicial do Codex generalizava
  `NotificationIntent`/`ReminderOccurrence` (agregados de M3/M3.5/M4, **já implementados,
  deployados e verificados em produção real**) para um `target` union type. Claude confrontou isso
  com o precedente já registrado NESTE projeto: o design de M7 decidiu explicitamente nunca
  estender o `parser-sandbox` de M6 "para não ampliar o blast radius de uma função já verificada em
  produção real" — criou parser novo e isolado em vez de generalizar o existente. Codex reconheceu
  que a mesma lógica se aplicava aqui e revisou para **agregados-irmãos**
  (`DocumentChasingOccurrence`/`DocumentChasingIntent`), eliminando qualquer necessidade de
  migração das linhas já persistidas. Segundo achado real: Codex inicialmente propôs reusar GSI3
  sem citar `slo.md`/`capacity-model.md` — cobrado, leu os documentos e trouxe números reais (1M
  ocorrências/5min no cenário extremo, ~463/min de pico orgânico em Stage 5) para justificar a
  resposta, condicionando a decisão a uma mini-revisão de capacidade antes da implementação.
- **Rodada 3**: reconciliação incorporando a revisão para agregados-irmãos + a condição de
  capacidade. Nota cega final sem ver a nota do Claude.

## Decisão final

### Agregados-irmãos, não generalização dos existentes

`DocumentChasingOccurrence` + `DocumentChasingIntent`, **novos**, implementando interfaces
mínimas compartilhadas para reusar a MECÂNICA operacional (GSI3, claim OCC, outbox, SQS/DLQ,
idempotência, reconciliação) sem alterar o shape persistido de `ReminderOccurrence`/
`NotificationIntent` já em produção real:
```ts
interface SchedulableOccurrence {
  tenantId: string; occurrenceId: string; scheduledAt: string;
  status: "SCHEDULED" | "CLAIMED" | "CANCELLED" | "TRIGGERED";
  version: number; GSI3PK?: string; GSI3SK?: string;
}
interface RoutableNotificationIntent {
  tenantId: string; intentId: string; requestedChannels: NotificationChannel[];
  recipient: RecipientRef; templateId: string; templateVersion: number;
}
```
**Zero migração** das linhas existentes — `ReminderOccurrence`/`NotificationIntent` continuam
exatamente como estão, lidos/escritos como hoje.

### Producer e dispatch

Producer branca por `entityType` ao ler GSI3: `ReminderOccurrence` → fluxo atual inalterado;
`DocumentChasingOccurrence` → fluxo novo; `entityType` desconhecido → **fail-closed + alarme**
(nunca ignorar silenciosamente). Comando de dispatch novo e isolado: `document-chasing.dispatch.v1`
— `reminder.dispatch.v1` existente permanece intocado.

### GSI3 reaproveitado, condicionado a mini-revisão de capacidade (pré-requisito real, não decidido aqui)

Reuso do mesmo GSI3 (scheduler global já existente) confirmado como correto — não criar índice
paralelo. **Condição registrada antes da implementação real**: revisão quantitativa de
`documentRequestsAtivos × triggersPorRequest × concentraçãoPorMinuto` contra os limites já
modelados (`slo.md`: drenagem de 1M ocorrências/5min no cenário extremo; `capacity-model.md`:
Stage 5 orgânico ~133k alertas/dia, pico ~463/min) — especificamente: volume esperado de
`DocumentRequest` ativos por tenant/stage, distribuição de deadline/horário local, pior caso de
import em massa (relevante quando CSV import existir), fan-out médio de intent por ocorrência, e
alarmes de GSI3 segmentados por `entityType`. Sem essa revisão, a regra de isolamento de GSI3
(`AGENTS.md`/`data-model.md`) precisa ser atualizada de "scheduler de `ReminderOccurrence` de
`ExpirationItem`" para "scheduler global de ocorrências agendadas" — mudança de entendimento, não
de mecanismo de proteção (mesmas salvaguardas: só producer/reconciliation leem o índice, projeção
mínima sem PII).

### Destinatário e política

`RecipientRef` (`INTERNAL_USER` | `EXTERNAL_EMAIL_SNAPSHOT`) escopado só ao novo
`DocumentChasingIntent` — não retrofitado no `NotificationIntent` existente. Para chasing v1, o
fornecedor vem direto do snapshot `DocumentRequest.recipientEmail` (decisão já fechada no cluster
2) — sem esperar `ExternalContact` completo.

Política declarativa e limitada, reaproveitando o formato de `ReminderPolicy` (offsets, horário
local, canais, audiences de lista fechada, enabled/disabled, presets versionados como
`document-request-standard-v1` com os níveis T-30/T-14/T-7/T-3+responsável interno/EXPIRED+
responsável+gestor sugeridos no prompt estratégico) — **explicitamente sem** condições
arbitrárias, branches, scripts, aprovação multi-etapa, loops ou SLA por etapa (fronteira
anti-BPMN, citada literalmente do prompt estratégico).

### Template

Extensão do mecanismo de templates já existente (`src/modules/notification/providers/
email-templates.ts`), novo `templateId`/`templateVersion` (`document-request-chasing`, v1) — não
motor de template novo.

## Próxima ação

Clusters restantes antes da Fase 3: escalation/watchers/digest, custom fields, CSV import/export.
Dado o volume já produzido (4 clusters, todos ≥9,0 dos dois lados) e que estes 3 restantes são
extensões de menor novidade sobre decisões já fechadas (não introduzem agregado raiz novo),
avaliar com Marcelo se merecem rodada dedicada de protocolo ou se podem ser decididos por
julgamento direto de engenharia (níveis 3-4 da escala de risco) antes de sintetizar o roadmap
final da Fase 3.

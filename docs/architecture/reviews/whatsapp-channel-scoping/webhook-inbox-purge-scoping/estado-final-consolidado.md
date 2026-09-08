# WebhookInbox WhatsApp — escopo de fencing do purge (D-197 fatia 3/5)

Status: **APPROVED** (protocolo Claude↔Codex completo, 4 rodadas, notas cegas finais 9,2/9,2
convergentes — `AGENTS.md` §4). Achado real durante a implementação da fatia 3/5, não previsto
pelo texto original de D-7/D-10 do design consolidado (`../estado-final-consolidado.md`).

## O problema

`WebhookInbox` de WhatsApp é account-scoped (`PK=WEBHOOK#WHATSAPP#<wabaId>`), ao contrário do de
SES (tenant-scoped desde a criação). O texto original de D-7 ("GSI8 idêntico ao já usado para
WebhookInbox de SES") presumia implicitamente um `tenantId` real sempre disponível — mas uma
linha WhatsApp que nunca correlaciona (`UNMATCHED`, o caso normal para qualquer wamid órfão/
replay/payload não correlacionável) nunca tem um `tenantId` real. `workers/transient-purge/
purge.ts` fenceia todo delete de `WebhookInbox` com um `ConditionCheck` exigindo
`TenantLifecycleRecord(tenantId).status == ACTIVE` NA MESMA transação — sem um tenant real para
preencher esse fence, a linha nunca purgaria, quebrando a retenção de 7 dias (`privacy-lgpd.md`
§4) silenciosamente para todo `WebhookInbox` WhatsApp não correlacionado.

## Decisão final

- `WebhookInbox` ganha um campo novo, **`purgeScope: "TENANT" | "ACCOUNT"`**, imutável, escrito
  uma única vez na criação — NUNCA inferido do pointer GSI8 (discovery-only, eventualmente
  consistente) nem alterado depois (correlacionar um `tenantId` via `biz_opaque_callback_data` é
  metadado de observabilidade, nunca muda o dono real do purge).
  - SES: sempre `"TENANT"` (comportamento inalterado).
  - WhatsApp: sempre `"ACCOUNT"`, permanentemente — correlacionada ou não.
- `shared/transient-purge-gsi8.ts` ganha `accountScopedTransientPurgeGsi8Keys()` ao lado de
  `transientPurgeGsi8Keys()` — MESMO `GSI8PK="WORK#TRANSIENT"` (uma Query só descobre as duas
  famílias), `GSI8SK=<dueAtIso>#ACCOUNT#<accountId>#<entityType>#<sk>` em vez de `#TENANT#`.
  `accountId` reaproveita o campo já existente `providerAccountId` (o `wabaId`) — nunca um
  segundo campo persistido com o mesmo significado.
- `workers/transient-purge/candidate-source.ts`/`dynamodb-candidate-source.ts`: união
  discriminada por `purgeScope` tanto no tipo de discovery (GSI8, nunca fonte de decisão) quanto
  no tipo de purge-candidate (a leitura consistente de `getCandidate()`, sempre a fonte real).
  `UploadSlot` só admite `"TENANT"` hoje — uma combinação inválida lança erro (fail-closed, nunca
  degrada para um delete não-escopado silencioso).
- `workers/transient-purge/purge.ts`: dois ramos de transação.
  - `purgeScope="TENANT"`: inalterado — `ConditionCheck` de tenant ativo + `Delete`, backoff/DLQ
    por tenant em caso de falha do fence.
  - `purgeScope="ACCOUNT"`: `TransactWriteItems` de UM item só (`Delete` condicionado por
    `version`) — sem fence de tenant nenhum, sem caminho de backoff/quarentena por tenant (não
    existe tenant para "ficar ativo depois"). `CancellationReasons[0]` só pode ser o próprio
    `Delete`; qualquer razão que não seja `ConditionalCheckFailed` (conflito, throttling, etc.) é
    relançada, nunca engolida como concorrência — mesma disciplina fail-closed do ramo `TENANT`.
- `schemas/api/webhook-inbox.v1.json`: `purgeScope`/`tenantId`/`accountId` viram uma união real
  (`oneOf`) — `TENANT` exige `tenantId` e proíbe `accountId`, `ACCOUNT` o inverso. Reconciliação
  COMPLETA do drift pré-existente do schema (achado incidental à parte, não introduzido nem
  resolvido por esta fatia — o schema já não batia com o shape real persistido por SES antes
  desta mudança) fica registrada como dívida separada, não bloqueante.

## Transcrição resumida (4 rodadas, `codex exec`, nota cega)

1. **Rodada 1** (Claude 7,5 / Codex 7,8, não aprovado): proposta inicial de dois `GSI8PK`
   trocáveis por pointer — Codex achou 2 bloqueantes: decisão de fencing nunca pode vir de um
   índice eventualmente consistente; correlação não muda o ownership físico da linha.
2. **Rodada 2** (Claude 8,5 / Codex 8,7, não aprovado): adota ownership permanente +
   `purgeScope` imutável na linha-base + mesmo `GSI8PK`. Restam: `CancellationReasons`
   posicional quebrado no ramo de 1 item; schema não representa união real; nomes a
   confirmar.
3. **Rodada 3** (Claude 8,3 / Codex 8,8, não aprovado): fecha união discriminada nos dois tipos
   (discovery+purge-candidate) e remove duplicação de `wabaId`/`accountId`. Resta: o ramo
   `ACCOUNT` ainda engolia qualquer cancelamento como concorrência (sem checar o código real);
   escopo do schema exagerado (alegava reconciliar TODO o drift pré-existente).
4. **Rodada 4** (Claude 9,0 / Codex 9,2, **APROVADO**): ramo `ACCOUNT` fail-closed sobre
   `CancellationReasons` não reconhecido; schema reconcilia só a união de escopo, drift
   pré-existente nomeado como dívida separada (não reaproveitando indevidamente a pendência #4
   de D-197, que é sobre outro achado — o caminho SES `UNMATCHED` que retorna antes de persistir).

Pesquisa externa: **NÃO** (declarado desde a Rodada 1) — decisão de modelagem interna sobre
contratos já existentes deste repositório (GSI8/tenant-fencing), sem padrão externo canônico
aplicável.

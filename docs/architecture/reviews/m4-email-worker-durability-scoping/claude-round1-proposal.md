# M4 Email Delivery Worker — durabilidade real (item 27 do backlog) — Proposta Rodada 1 (Claude)

## Contexto e escopo

Três achados estruturais reais, encontrados pelo Codex durante a revisão adversarial de D-315/D-316
(`docs/architecture/reviews/d315-d316-notification-entitlements-urgency-adversarial-review/`,
2026-09-24) e explicitamente registrados como pendência formal para uma rodada de protocolo
dedicada (`decisions-log.md` D-332, `NEXT_SESSION_PROMPT.md` item 27), nunca corrigidos até agora.
Todos confirmados por leitura direta do código nesta sessão antes de propor qualquer correção:

1. **DEFERRED nunca é realmente reagendado.** `email-delivery-handler.ts:82-97` — quando
   `processEmailDelivery()` retorna `DEFERRED` (quiet hours/`deliverNotBefore` no futuro), o
   handler não reporta falha de batch (a mensagem some da fila, sem retry SQS) e não existe NENHUM
   mecanismo real de reagendamento (`grep` por `SchedulerClient`/`CreateScheduleCommand` em todo
   `src/` não encontra nenhum). O próprio comentário no arquivo já documenta isso honestamente como
   achado não corrigido. Resultado real: um lembrete cujo horário de entrega cai dentro do quiet
   hours do destinatário é perdido PERMANENTE e SILENCIOSAMENTE — nunca é reenviado.
2. **`FAILED_RETRYABLE` é confirmado como sucesso.** `email-delivery-workflow.ts:133-152` retorna
   `{ kind: "SEND_FAILED", nextStatus }` tanto para falha terminal quanto para falha
   ambígua/retryable (ex.: throttling do SES, classificado `CONCLUSIVE_RETRYABLE` pelo adapter). O
   handler (`email-delivery-handler.ts`) só trata explicitamente `DEFERRED` — qualquer outro
   `outcome.kind`, incluindo `SEND_FAILED`, cai no mesmo caminho silencioso (sem push em
   `batchItemFailures`), então a mensagem é removida da fila como se tivesse tido sucesso.
   Confirmado: não existe reconciliador nenhum para `NotificationAttempt` (só existe para
   `Document`/`Membership`/`ReminderOccurrence`/etc. — `grep -rln "NotificationAttempt"
   src/workers` não retorna nenhum worker de reconciliação real). Throttling do SES — condição
   TRANSITÓRIA por natureza — hoje causa perda permanente da notificação.
3. **Falta revalidação de preference/entitlement/policy entre roteamento e envio real.** A única
   revalidação de "stale" que este worker faz é sobre o `ExpirationItem` (status/version,
   `email-delivery-workflow.ts:96-112`) — nunca sobre `NotificationPreferences.emailEnabled` (o
   usuário pode ter revogado consentimento de e-mail entre o roteamento e o envio real, que pode
   ficar pendente por horas/dias dado o achado 1 acima) nem sobre `NotificationEntitlements`. Mesma
   classe de TOCTOU que D-113 (Wave B2B-13) já corrigiu para revogação de `Membership` — aqui nunca
   foi corrigida para preferência de canal.

## Não-escopo desta rodada

- `WhatsApp` (item 26) tem worker análogo (`whatsapp-delivery-workflow.ts`) com a MESMA classe de
  achado 1/2 (`grep` confirma `DEFERRED` idêntico em `whatsapp-delivery-workflow.ts:71-85`) — fora
  de escopo aqui só porque os arquivos desse módulo têm trabalho não commitado de outra sessão em
  paralelo (`git status`). **Mecanismo proposto aqui deve ser desenhado para ser reaproveitável
  por WhatsApp depois, sem generalizar prematuramente** (mesmo princípio que `DocumentChasingOccurrence`
  nunca generalizou `ReminderOccurrence` — agregados-irmãos, não uma abstração comum forçada).
- `SES_CALLBACK`/bounce/complaint handling (fora do escopo dos 3 achados nomeados).

## Mecanismo proposto

Reaproveitar o padrão de reconciliação já usado 6+ vezes neste projeto (`reminder-reconciliation`,
`document-purge`, `upload-slot-reconciliation`, `tenant-purge-sweeper`) — claim/lease sobre GSI6,
nunca inventar mecanismo novo (EventBridge Scheduler one-shot, que o design original de M4 previa
mas nunca foi implementado, é descartado aqui — motivo: um scheduler one-shot por tentativa é um
recurso AWS por mensagem, sem precedente neste projeto para esse volume, enquanto reconciliação via
scan/GSI6 já é o padrão provado e operado para USER_DOCUMENT/Membership/Invitation/etc. desde
D-061/D-127).

### 1. `NotificationAttempt` ganha um ponteiro GSI6 quando fica pendente de reenvio

Dois pontos de escrita passam a gravar `GSI6PK`/`GSI6SK` (mesmo idioma `WORKSTATE#PENDING`/
`WORKSTATE#CLAIMED` já usado por `DocumentPurgeWorker`):

- **DEFERRED** (`processEmailDelivery`, dentro da MESMA leitura que já detecta
  `deliverNotBefore > now`): grava `GSI6PK=WORKSTATE#EMAIL_REDELIVER_PENDING`,
  `GSI6SK=<deliverNotBefore>#<tenantId>#<attemptId>` no attempt, SEM mudar seu `status` (continua
  `PREPARED`) — isso é só um ponteiro de agendamento, não uma transição de estado de negócio.
- **`SEND_FAILED` com `nextStatus === "FAILED_RETRYABLE"`** (`forceUpdateAttemptStatus`, mesma
  transação que já grava o novo status): grava `GSI6PK=WORKSTATE#EMAIL_REDELIVER_PENDING`,
  `GSI6SK=<now + backoff>#<tenantId>#<attemptId>` — backoff exponencial com teto, mesma fórmula já
  usada em `outbox.ts`'s `nextAttemptDelayMs()` (reaproveitada, não uma segunda fórmula). Um
  contador `redeliverAttempts` novo no attempt limita o número de reconciliações (mesmo padrão de
  `purgeAttempts`/`MAX_PURGE_ATTEMPTS` do `DocumentPurgeWorker`) — esgotado o teto, o attempt vira
  `FAILED_TERMINAL` em vez de ficar pendurado para sempre.

`SEND_FAILED` com `nextStatus === "FAILED_TERMINAL"` (falha conclusiva, ex.: endereço inválido)
**nunca** ganha ponteiro — reenviar não mudaria o resultado, mesmo raciocínio de
`CONCLUSIVE_TERMINAL` já aplicado no restante deste arquivo.

### 2. `EmailDeliveryReconciliationWorker` novo (mesmo layout de `document-purge`/`reminder-reconciliation`)

- Candidatos vêm de `GSI6PK=WORKSTATE#EMAIL_REDELIVER_PENDING AND GSI6SK <= now` (fornecidos pelo
  caller, o worker nunca consulta GSI6 diretamente — mesma disciplina de
  `workers/document-purge/purge.ts`).
- Para cada candidato: `TransactWriteItems` condicionado à versão + ao ponteiro ainda
  `WORKSTATE#EMAIL_REDELIVER_PENDING` (fence contra corrida com o handler original) que (a) grava
  `GSI6PK=WORKSTATE#EMAIL_REDELIVER_CLAIMED` (lease curto, mesmo padrão de 15min) e (b) publica um
  novo evento `notification.email-deliver.v1` no outbox transacional (reaproveita
  `SQS_NOTIFICATION_EMAIL_V1`, o destino já existente — nunca uma fila nova).
- Reconciliação de lease travado (mesma lógica de `reconcileExpiredPurgeClaim`): reverte para
  `PENDING` ou marca `STUCK` após N tentativas.
- Agendamento: mesmo `aws_scheduler_schedule` cron dos demais workers de manutenção (candidato
  natural a entrar também no `MaintenanceDueIndex`/GSI8 se o volume justificar — decisão de
  infraestrutura, não de mecanismo, fica para a implementação).

### 3. Revalidação de preferência/entitlement imediatamente antes do envio real

Em `processEmailDelivery()`, no MESMO ponto onde a staleness do `ExpirationItem` já é checada
(`email-delivery-workflow.ts:96`), adicionar uma leitura fresca (fortemente consistente, mesmo
padrão de `deps.store.get(..., true)` já usado ali) de `NotificationPreferences` do destinatário
resolvido — se `emailEnabled === false` no momento do envio real (não no momento do roteamento),
tratar como falha conclusiva terminal (`CONCLUSIVE_TERMINAL`, mesmo caminho de "endereço não
resolvido" já existente) em vez de enviar. Reaproveita o tipo `NotificationPreferences` e o
`getOrCreatePreferences()` já existentes — nenhuma entidade/leitura nova, só um ponto de checagem
a mais antes do `emailProvider.send()`.

## Testes de aceitação (nomeados, sem escrever código nesta rodada)

1. DEFERRED grava o ponteiro GSI6 corretamente e NÃO reporta batch item failure (SQS não reentrega
   — reconciliação é o único caminho de reenvio).
2. `FAILED_RETRYABLE` grava o ponteiro com backoff correto e incrementa `redeliverAttempts`;
   esgotado `MAX_REDELIVER_ATTEMPTS`, vira `FAILED_TERMINAL` sem ponteiro.
3. `FAILED_TERMINAL` nunca ganha ponteiro.
4. Reconciliação claim/lease: candidato duplo-processado (corrida) só publica uma vez (fence de
   versão); lease travado reverte para `PENDING`; `STUCK` após N tentativas.
5. Preferência revogada entre roteamento e envio real → `CONCLUSIVE_TERMINAL`, nenhum e-mail
   enviado, attempt não fica pendurado.
6. `npm test`/`check-boundaries`/`check-docs`/`build:lambdas`/`terraform test` (novo módulo/policy
   GSI6, mesma disciplina de isolamento de índice de `AGENTS.md` §7) verdes.

## Pergunta em aberto para a Rodada 2 (Codex)

O achado 3 (revalidação) também deveria checar `NotificationEntitlements` (não só
`NotificationPreferences`)? O texto original do achado (D-332) menciona os três — mas
`NotificationEntitlements` hoje só controla CRIAÇÃO de novo `NotificationIntent` (cap de uso), não
parece ter uma transição "revogado no meio do caminho" análoga a `emailEnabled=false`. Se o Codex
concordar que não há cenário real de negação de entitlement pós-roteamento, o achado 3 fica restrito
a preferência; se houver, a checagem se estende com o mesmo padrão de leitura fresca.

# M4 Email Delivery Worker — durabilidade real (item 27) — Proposta Rodada 2 (Claude)

Responde aos 7 achados da Rodada 1 (nota 6,8/10, `codex-round1-output.txt`). **Achado 5 (bug
pré-existente de `RECONCILE_UNKNOWN` usando `PutCommand` sem condição) já foi corrigido nesta mesma
sessão, antes desta proposta** (commit real: `RECONCILE_UNKNOWN` agora usa `tryConditionalUpdate`,
retorna `SKIPPED_LOST_LEASE_RACE` em vez de sempre `RECONCILED_UNKNOWN`; teste novo reproduz a corrida
via um store que devolve um snapshot obsoleto, prova falhar contra o código antigo e passar contra o
corrigido). Isso desbloqueia o resto — o Codex já havia dito que nenhum mecanismo novo seria seguro
sem essa correção primeiro.

## Declaração de pesquisa externa (E-014, obrigatória, faltou na Rodada 1)

**SIM PARCIAL.** Dois pontos desta proposta dependem de comportamento documentado de serviços
externos, não de decisão interna:
- [AWS SQS Standard Queue — at-least-once delivery](https://docs.aws.amazon.com/en_gb/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues-at-least-once-delivery.html): confirma que uma mensagem duplicada da MESMA entrega é um comportamento esperado, não uma anomalia — motiva o achado 2 (deadline de backoff tem que ser autoritativo na tabela, nunca confiado só ao `deliverNotBefore` que veio na mensagem).
- [AWS DynamoDB — read consistency model](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html): confirma que uma leitura fortemente consistente não impede uma escrita concorrente entre a leitura e a escrita subsequente — motiva o achado 4 (a checagem de preferência real tem que ser uma condição na PRÓPRIA transação de admissão SUBMITTING, não só uma leitura fresca antes dela).

Já eram as mesmas fontes que o Codex citou na Rodada 1 — declaradas aqui formalmente, não é pesquisa
nova, é a `AGENTS.md` §4/E-014 exigindo a declaração explícita que a Rodada 1 pulou.

## Mecanismo revisado: 1 lease só, reconciliador nunca chama SES, `SUBMITTING` continua o único claim real

Adotada a sugestão explícita do Codex ("dispensar o segundo lease"). O reconciliador nunca envia
e-mail nem assume `SUBMITTING` — sua única responsabilidade é, numa única `TransactWriteItems`
condicionada, mover um candidato elegível de volta para a fila (`SQS_NOTIFICATION_EMAIL_V1`, outbox
já existente, nenhuma fila nova), deixando o consumidor normal (`processEmailDelivery`) ser quem
sempre e exclusivamente reivindica `SUBMITTING` e chama SES — exatamente o comportamento de hoje,
sem um segundo processo competindo pela mesma versão.

### 1. Ponteiro GSI6 + condição simétrica nos dois lados (resolve achado 1)

`NotificationAttempt` ganha 3 campos novos: `redeliverPendingAt?: string` (due-time, também vira
`GSI6SK`), `redeliverAttempts: number` (default 0), `locale: string` (novo, ver achado 6).

- **Reconciliador** (`EmailRedeliverReconciliationWorker`, candidatos de
  `GSI6PK=WORKSTATE#EMAIL_REDELIVER_PENDING AND GSI6SK<=now`, fornecidos pelo caller — leitura de GSI6
  é só descoberta, nunca fonte de verdade): `TransactWriteItems` condicionado a
  `attribute_exists(PK) AND #version=:expectedVersion AND #status IN (:prepared,:failedRetryable) AND GSI6SK=:expectedDueAt`
  (a condição de status IMPEDE reivindicar um attempt já em `SUBMITTING` ou resolvido — corrige
  exatamente o cenário concreto do Codex: se o consumidor normal já reivindicou `SUBMITTING`, a versão
  já bumpou, esta condição falha, o reconciliador não faz nada). Na mesma transação: `REMOVE GSI6PK,
  GSI6SK`, `SET redeliverAttempts = redeliverAttempts + 1`, mais um `Put` no outbox transacional
  (`shared/outbox/outbox.ts`, reaproveitado) reconstruindo o comando `notification.email-deliver.v1`
  **inteiramente a partir do attempt+intent persistidos** (achado 6).
- **Consumidor normal** (`tryFencedSubmittingClaim`, já existe): o `set` que reivindica `SUBMITTING`
  passa a incluir também `REMOVE GSI6PK, GSI6SK` na mesma transação — um attempt que acabou de ser
  reivindicado nunca mais carrega um ponteiro de redelivery pendente, então um reconciliador que rodou
  um instante depois (já vendo a versão nova) simplesmente não encontra o ponteiro/versão esperados e
  não faz nada. As duas transações são condicionadas na MESMA versão — nunca podem as duas ter sucesso
  sobre o mesmo estado, então nunca há uma invalidando a outra.
- Teto: esgotado `MAX_REDELIVER_ATTEMPTS` (valor a decidir na implementação, não nesta rodada), o
  reconciliador marca `FAILED_TERMINAL` com `skippedReason: "MAX_REDELIVER_ATTEMPTS_EXCEEDED"` em vez
  de republicar — nunca um status novo `STUCK` (achado 6, ver abaixo).

### 2. Backoff autoritativo, protegido contra mensagem SQS duplicada (resolve achado 2)

`decideSendAction()` ganha um parâmetro novo, `nextEligibleSendAt?: string` (mesmo campo que
`redeliverPendingAt` no attempt, valor único, reaproveitado — não dois campos), e uma ação nova:
```ts
if (attempt.status === "FAILED_RETRYABLE" && attempt.nextEligibleSendAt && now < attempt.nextEligibleSendAt) {
  return { action: "DEFER_BACKOFF" };
}
```
Checado ANTES do `PREPARED"|"FAILED_RETRYABLE" -> SEND` atual — uma cópia antiga da mensagem SQS
(duplicata, comportamento padrão do SQS Standard, fonte E-014 acima) para um attempt que JÁ está
aguardando backoff bate nesta condição e é deferida de novo (nunca readmitida por confiar só no
`deliverNotBefore` do envelope da mensagem, que pode ser de uma cópia antiga). `redeliverAttempts`
só incrementa dentro da transação do reconciliador (item 1) — nunca em `processEmailDelivery` — então
uma duplicata que bate em `DEFER_BACKOFF` e não faz nada não consome o teto de tentativas real.
Contador de rejeição conclusiva do provedor (`FAILED_RETRYABLE`/`FAILED_TERMINAL`, já existe via
`nextStatusAfterSendAttempt`) continua distinto e não é tocado por esta ação.

### 3. Revalidação de política + recomputação de quiet hours no envio (resolve achado 3)

No mesmo ponto onde a staleness do item já é checada (`email-delivery-workflow.ts:102`), adicionada
uma leitura fresca (`deps.store.get<ReminderPolicy>(policyKey(tenantId, intent.policyId), true)`) e
estendida a condição `isStale` para incluir `!policy || !policy.enabled || policy.version !==
intent.policyVersion` — mesmo caminho `NOT_SENT_STALE`/`applyStaleDeliveryDecision` já existente para
o item, reaproveitado, não duplicado.

**Quiet hours recomputadas no envio**: a leitura fresca de `NotificationPreferences` que o achado 4
já exige (abaixo) devolve `preference.quietHours` — chamado `computeDeliverNotBefore(now,
preference.quietHours)` (`quiet-hours.ts`, já existe, mesma função que o roteamento usa) nesse ponto;
se retornar um timestamp futuro, o attempt é deferido de novo (novo ponteiro GSI6, item 1) em vez de
prosseguir para `SUBMITTING` — resolve o cenário do Codex (retry cai numa nova janela silenciosa
mesmo sem a preferência ter mudado).

### 4. Preferência: leitura direta (nunca `getOrCreatePreferences()`) + condição na própria transação de admissão (resolve achado 4)

**Leitura**: `deps.store.get<NotificationPreferences>(notificationPreferencesKey(tenantId,
recipientUserId), true)` — nunca `getOrCreatePreferences()` (que exige `RequestContext`, autoriza
`notification:configure`, e CRIA a preferência com `emailEnabled:true` se ausente — inadequado para
um caminho assíncrono que só precisa checar, nunca criar). Mesma matriz do roteador
(`notification-router.ts:159`) preservada: `preference?.emailEnabled === undefined` → tratado como o
equivalente de `RETRY` (aqui: `DEFER_BACKOFF` com um `nextEligibleSendAt` curto, nunca cancelamento
definitivo — indisponibilidade técnica não é opt-out); `false` → `CONCLUSIVE_TERMINAL` (opt-out real,
mesmo caminho de "endereço não resolvido" já existente).

**Condição na transação, não só leitura antes dela** (ponto técnico específico do Codex, aceito
integralmente): a leitura fresca sozinha não fecha a corrida (E-014, DynamoDB consistency docs — uma
leitura consistente não impede escrita concorrente entre ler e commitar). A claim de `SUBMITTING`
(`tryFencedSubmittingClaim`) ganha um `ConditionCheck` adicional sobre a MESMA row de
`NotificationPreferences`, mesmo padrão já usado pelo fence de `TenantLifecycleRecord` (W3-07/D-067,
`executeTenantBusinessMutation`): `emailEnabled = :true`. O commit da claim `SUBMITTING` passa a ser a
fronteira de admissão real para preferência também, não só para tenant lifecycle — uma revogação que
aconteça entre a leitura fresca e o commit da claim é pega pela condição, não pela leitura.

### 5. Bug pré-existente — já corrigido (ver topo deste documento)

### 6. Contrato de recuperação/encerramento completo (resolve achado 6)

- **DEFERRED reordenado**: `processEmailDelivery` passa a carregar lookup+attempt ANTES de checar
  `deliverNotBefore` (hoje a checagem acontece primeiro, sem attempt carregado — impossível persistir
  qualquer ponteiro "na mesma leitura" como a Rodada 1 propunha sem existir). Attempt já resolvido
  (`SKIP_RESOLVED`)/já em `SUBMITTING` (`SKIP_IN_PROGRESS`) nunca ganha um ponteiro novo — uma
  duplicata de mensagem para um attempt já concluído é um no-op puro, nunca reagenda algo resolvido.
- **Reconstrução do comando a partir de estado durável, nunca da mensagem SQS original**: `locale`
  (hoje um literal `"pt-BR"` fixo em `buildEmailOutboxRecord`, `notification-router-workflow.ts:523`)
  passa a ser persistido no `NotificationAttempt` na criação (mesmo valor de hoje, sem mudança de
  comportamento) — o reconciliador reconstrói o envelope `notification.email-deliver.v1` inteiramente
  de `attempt`+`intent` (ambos já persistidos, já lidos), nunca presume que a mensagem SQS original
  ainda existe (ela pode já ter sido apagada/redirecionada para DLQ).
- **Sem status `STUCK` novo**: reaproveita `FAILED_TERMINAL` + `skippedReason:
  "MAX_REDELIVER_ATTEMPTS_EXCEEDED"` (mesmo padrão de `skippedReason: "RECIPIENT_NOT_ELIGIBLE"` que
  `report-subscription-delivery/delivery.ts` já usa) — sem migração de enum de status, sem estado
  operacional paralelo. Alarme CloudWatch dedicado (métrica/filtro de log por esse `skippedReason`
  específico) para detecção operacional — não é o objetivo de negócio "perda silenciosa", é
  "abandono com motivo registrado e alarme", exatamente a distinção que o Codex pediu.
- **GSI6 é descoberta, nunca fonte de verdade**: já implícito no desenho acima (toda decisão real é
  condicionada contra a tabela base numa transação, GSI6 só alimenta QUAIS candidatos considerar).

### Entitlement (resposta à pergunta em aberto da Rodada 1)

Aceito o esclarecimento do Codex: a premissa "só controla criação" estava errada
(`notification-entitlements.ts` distingue permissão de canal de quota, e o roteador checa
`email.enabled` depois de criar o intent) — mas nenhum fluxo real de revogação de entitlement
pós-roteamento existe hoje (`monthlyLimit`/`validUntil` declarados não provam um writer real). Adotada
a posição do próprio Codex: **postergar revalidação de entitlement nesta rodada, gatilho concreto
registrado** — reabrir quando um writer real de revogação/downgrade/expiração de entitlement for
introduzido (nenhum existe hoje). Revalidação de política (achado 3, já tem writer real,
`reminder-policy-service.ts:258`) e de preferência (achado 4) permanecem no escopo, sem essa ressalva.

## Testes de aceitação (revisados)

1. Reconciliador com attempt já em `SUBMITTING` (corrida do Codex) → condição falha, nada acontece,
   nenhum `providerMessageId`/status real é sobrescrito.
2. Consumidor reivindicando `SUBMITTING` remove o ponteiro GSI6 na mesma transação — reconciliador
   rodado logo depois não encontra candidato.
3. Mensagem SQS duplicada de um attempt em backoff → `DEFER_BACKOFF`, `redeliverAttempts` não
   incrementa, nenhum e-mail enviado.
4. Política desativada/versão mudada entre roteamento e envio → `NOT_SENT_STALE`, nenhum SES call.
5. Preferência revogada entre leitura fresca e commit da claim `SUBMITTING` (simulado via write
   concorrente entre os dois passos, mesmo padrão do teste novo de `RECONCILE_UNKNOWN`) →
   `ConditionCheck` falha, claim inteira cancelada, nenhum e-mail enviado.
6. Quiet hours mudam entre roteamento e reenvio (preferência atualizada) → recomputado, deferido de
   novo com o novo horário, nunca enviado durante a janela real.
7. `MAX_REDELIVER_ATTEMPTS` esgotado → `FAILED_TERMINAL`/`MAX_REDELIVER_ATTEMPTS_EXCEEDED`, nunca um
   status `STUCK` novo.
8. `npm test`/`check-boundaries`/`check-docs`/`build:lambdas`/`terraform test` (novo GSI6 policy,
   mesma disciplina de isolamento de índice) verdes.

## Pergunta para o Codex

O mecanismo de lease único (reconciliador só republica, nunca assume `SUBMITTING`) fecha o achado 1
por completo? A condição simétrica (reconciliador exige status∈{PREPARED,FAILED_RETRYABLE}+versão;
claim remove o ponteiro na mesma transação) é suficiente, ou falta um caso de borda?

---
status: aprovado (protocolo Claude↔Codex encerrado, Rodada 5, 9,1/9,1 — nenhuma rodada arredondada)
owner: Marcelo
---

# M4 — Worker de entrega de e-mail, durabilidade real — desenho final aprovado

Item 27 do backlog (D-332/D-337). 5 rodadas do protocolo Claude↔Codex até convergência: design
6,8 → 8,3 → 8,6 → 8,8 → **9,1**; régua de pesquisa externa (E-014) 6,0 → 8,5 → **9,1** (fechada na
Rodada 4). Rodadas completas em `claude-round{1..5}-proposal.md`/`claude-round{2..5}-note.md`/
`codex-round{1,5}-output.txt` nesta pasta.

**Já implementado e commitado, antes mesmo da Rodada 1 desta série** (bug pré-existente achado pelo
Codex na revisão original de D-315/D-316 que motivou toda esta investigação): `RECONCILE_UNKNOWN`
em `email-delivery-workflow.ts`/`whatsapp-delivery-workflow.ts` usava `deps.store.update()` — um
`PutCommand` sem condição — corrigido pra usar `tryConditionalUpdate` (OCC), retornando
`SKIPPED_LOST_LEASE_RACE` em vez de sempre `RECONCILED_UNKNOWN`. 2 testes novos provam a corrida
(store com snapshot obsoleto vs. resolução concorrente real), confirmados falhando contra o código
antigo e passando com o fix.

**O restante do mecanismo abaixo NÃO foi implementado ainda** — é desenho aprovado, pronto para uma
sessão de implementação futura.

## 1. Lease único — reconciliador nunca chama SES, `SUBMITTING` é o único claim real

`NotificationAttempt` ganha 3 campos: `nextEligibleSendAt?: string` (deadline único, também usado
como `GSI6SK` do ponteiro de descoberta), `redeliverAttempts: number`, `sendAttempts: number`,
`locale: string` (persistido na criação, hoje um literal fixo `"pt-BR"`, sem mudança de
comportamento).

- **Reconciliador** (`EmailRedeliverReconciliationWorker`, candidatos de
  `GSI6PK=WORKSTATE#EMAIL_REDELIVER_PENDING AND GSI6SK<=now`, GSI6 é só descoberta): numa única
  `TransactWriteItems` condicionada a versão+status ainda elegível (`PREPARED`/`FAILED_RETRYABLE`)+
  `GSI6SK` esperado, remove o ponteiro (`REMOVE GSI6PK, GSI6SK`), incrementa `redeliverAttempts`, e
  publica no outbox transacional já existente (`SQS_NOTIFICATION_EMAIL_V1`) reconstruindo o comando
  inteiramente de `attempt`+`intent` persistidos (nunca da mensagem SQS original, que pode já não
  existir). **Nunca assume `SUBMITTING`, nunca chama SES.**
- **Consumidor normal** (`tryFencedSubmittingClaim`, já existe): a claim de `SUBMITTING` remove o
  ponteiro GSI6 na MESMA transação — as duas transações são condicionadas na mesma versão, nunca
  podem as duas ter sucesso sobre o mesmo estado.
- Esgotado `MAX_REDELIVER_ATTEMPTS`: `FAILED_TERMINAL`/`skippedReason:
  "MAX_REDELIVER_ATTEMPTS_EXCEEDED"` — sem status `STUCK` novo.

## 2. Backoff persistido, cobre os 2 estados elegíveis

```ts
if (attempt.status === "PREPARED" || attempt.status === "FAILED_RETRYABLE") {
  if (attempt.nextEligibleSendAt && now < attempt.nextEligibleSendAt) return { action: "DEFER_BACKOFF" };
  return { action: "SEND" };
}
```
Gravação atômica (status+`nextEligibleSendAt`+ponteiro GSI6, uma transação só) antes do ack SQS.
`nextEligibleSendAt` sobrevive quando o reconciliador remove só o ponteiro (só o GSI6 some).
Comando republicado usa `deliverNotBefore: attempt.nextEligibleSendAt`.

## 3. Dois orçamentos independentes

`sendAttempts` (admissões reais — incrementa 1x, dentro da própria transação de claim, condicionado
`sendAttempts < MAX_SEND_ATTEMPTS` como condição de ADMISSÃO, não checagem reativa) vs.
`redeliverAttempts` (ciclos de republicação do reconciliador). Nunca somados, cada um com seu próprio
teto e `skippedReason`.

## 4. Preferência: leitura direta + condição transacional (nunca `getOrCreatePreferences()`)

Leitura fresca de `NotificationPreferences` preservando a matriz do roteador (ausente→retry/
`DEFER_BACKOFF`, `false`→`CONCLUSIVE_TERMINAL`). A claim de `SUBMITTING` ganha um `ConditionCheck`
(`emailEnabled=true AND version=<lida>`) na MESMA transação — o commit da claim é a fronteira de
admissão real, não a leitura. Preferência fecha inclusive o caso "só quiet hours mudaram" (a versão
muda mesmo sem `emailEnabled` mudar). Quiet hours recomputadas (`computeDeliverNotBefore`) no mesmo
ponto, usando a mesma leitura fresca.

## 5. Política: leitura fresca, sem condição transacional (fronteira de validade explícita)

Estende `isStale`/`NOT_SENT_STALE` (mesmo caminho do item) para incluir política desativada/versão
mudada, usando `applyStaleDeliveryDecision` com a versão FRESCA da política (nunca
`intent.policyVersion`). **Decisão deliberada de não tornar transacional** (ação rara de admin, não
self-service de alta frequência como preferência) — risco residual aceito e declarado sem prometer
limite: envios concorrentes que já leram a política antes de uma mudança podem ser admitidos depois
dela, sem limite temporal ou quantitativo garantido por este mecanismo.

## 6. Classificação exata de cancelamento por índice (attempt=0, preferência=1, fence=2 sempre por último)

```
TenantNotActiveError (já lançado pelo wrapper)                          → tratamento existente
Preferência=ConditionalCheckFailed; demais=None                          → PREFERENCE_CHANGED_RECHECK
Attempt=ConditionalCheckFailed; preferência=CCF ou None; demais=None     → REEVALUATE
Qualquer outra combinação / motivo desconhecido / array malformado       → relançar (erro real)
```
`REEVALUATE`: relê o attempt fresco, roda `decideSendAction` do zero; se ainda elegível, repete o
fluxo de admissão COMPLETO (política+preferência+quiet hours+nova claim) — **1 repetição local**
compartilhada entre os caminhos de reavaliação; esgotada, propaga falha real pro handler SQS
(`batchItemFailure`), nunca ack silencioso de trabalho não resolvido.

## Escopo explicitamente fora desta rodada

- **Entitlement**: revalidação pós-roteamento postergada — nenhum writer real de revogação/downgrade/
  expiração de entitlement existe hoje; gatilho de reabertura registrado (quando esse writer for
  introduzido).
- **WhatsApp** (`whatsapp-delivery-workflow.ts`): mesma classe de achado 1/2 do design original
  (D-332), mecanismo desenhado aqui é reaproveitável depois, sem generalizar prematuramente agora.
- **`SES_CALLBACK`/bounce/complaint handling**: fora do escopo dos achados originais.

## Pesquisa externa (E-014, régua aprovada 9,1/10)

SIM PARCIAL — 2 fatos técnicos (comportamento de fila SQS Standard at-least-once; modelo de
consistência do DynamoDB), fontes primárias oficiais AWS, consultadas 2026-09-29. Checklist de 3
critérios pesados (35%/35%/30%) com âncoras atende/não-atende — ver `claude-round4-proposal.md`
para o texto completo do checklist final.

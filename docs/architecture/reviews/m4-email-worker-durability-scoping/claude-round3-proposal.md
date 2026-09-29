# M4 Email Delivery Worker — durabilidade real (item 27) — Proposta Rodada 3 (Claude)

Responde aos achados da Rodada 2 (8,3/10 design, 6,0/10 régua E-014). **Não reabre** achado 1 (lease
único) nem achado 5 (bug de OCC) — confirmados fechados pelo Codex.

## E-014 completo: checklist pesado com âncoras (faltava na Rodada 2)

**Pesquisa externa considerada: SIM PARCIAL.** Escopo: só os 2 fatos técnicos que fundamentam o
desenho de concorrência (comportamento de fila, modelo de consistência) — o resto da decisão (layout
de GSI6, nomes de campo, formato do outbox) é puramente interno, pesquisa não se aplica.

Fontes, consultadas em 2026-09-29:
- [AWS SQS Standard Queue — at-least-once delivery](https://docs.aws.amazon.com/en_gb/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues-at-least-once-delivery.html) — documentação oficial primária do serviço.
- [AWS DynamoDB — read consistency model](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html) — idem.

**Representatividade**: ambas são a documentação oficial do PRÓPRIO serviço AWS que o mecanismo usa
(não um blog de terceiros nem um produto concorrente) — para um fato de comportamento de infra
(nunca um padrão de produto/UX, onde múltiplas fontes de mercado fariam sentido), a fonte primária do
fornecedor é a representativa correta; não há "viés de nicho" a mitigar aqui.

**Checklist pesado, critérios usados para avaliar esta proposta a partir de agora**:

| # | Critério | Peso | Atende | Não atende |
|---|---|---:|---|---|
| 1 | Nenhuma decisão de admissão (enviar/adiar/encerrar) confia em campo vindo do ENVELOPE da mensagem SQS — toda decisão consulta o `NotificationAttempt` persistido na tabela primeiro | 40% | Todo caminho de `decideSendAction`/claim lê o attempt fresco antes de decidir | Qualquer caminho que usa `deliverNotBefore`/contador do payload da mensagem como decisão final |
| 2 | Toda condição que precisa sobreviver a uma mudança concorrente (preferência, política, versão) é expressa como `ConditionExpression`/`ConditionCheck` na MESMA transação que admite o efeito externo — nunca só uma leitura antes dela | 40% | Claim de `SUBMITTING` carrega `ConditionCheck` de preferência+versão | Decisão de enviar baseada só numa leitura anterior, sem condição no commit |
| 3 | Fonte primária do próprio serviço AWS para fato de comportamento de infraestrutura (não produto/UX) | 20% | Fonte é `docs.aws.amazon.com` do serviço específico | Fonte terciária (blog, fórum, resposta de IA sem link à doc oficial) |

Nota da régua nesta rodada (minha, como autor, antes de ver a nota do Codex): **9,0/10** — os 2
critérios de maior peso já eram exatamente o que a Rodada 2 do design (aprovada pelo Codex nos
achados 1/5) já implementava; o checklist só formaliza o que já estava certo, não muda o desenho.

## 1. Backoff: campo único, cobre PREPARED e FAILED_RETRYABLE, orçamento real separado de republicação

**Nome canônico único: `nextEligibleSendAt`** (elimino `redeliverPendingAt` — mesmo campo serve como
valor do `GSI6SK` do ponteiro E como o deadline que `decideSendAction` consulta).

```ts
// email-delivery.ts
if (attempt.status === "PREPARED" || attempt.status === "FAILED_RETRYABLE") {
  if (attempt.nextEligibleSendAt && nowIso < attempt.nextEligibleSendAt) {
    return { action: "DEFER_BACKOFF" };
  }
  return { action: "SEND" };
}
```
Cobre os dois estados elegíveis (achado real da Rodada 2 — `PREPARED` também usa este campo quando
adiado por quiet hours, `DEFERRED` nunca muda o `status`).

**Orçamento real, separado da contagem de republicação**: `sendAttempts` (novo campo, distinto de
`redeliverAttempts`) incrementa **dentro da própria transação de `tryFencedSubmittingClaim`** — o
único ponto onde uma chamada real ao SES é admitida, nunca no reconciliador. Resolve o cenário exato
do Codex (duplicata chega antes do reconciliador, reivindica `SUBMITTING` direto, SES rejeita, novo
backoff — sem nunca passar pelo reconciliador): esse ciclo AINDA conta corretamente, porque
`sendAttempts` incrementa em toda claim real, não em toda republicação. `redeliverAttempts` continua
existindo com seu próprio teto (detecta um candidato que fica sendo movido de PENDING para a fila sem
nunca ser reivindicado — sintoma operacional distinto de "SES rejeita repetidamente"). Os dois tetos
são checados independentemente: `sendAttempts >= MAX_SEND_ATTEMPTS` (checado logo após uma falha
`FAILED_RETRYABLE`, na mesma transação de `forceUpdateAttemptStatus`) → `FAILED_TERMINAL`/
`skippedReason: "MAX_SEND_ATTEMPTS_EXCEEDED"`, nunca mais um backoff; `redeliverAttempts >=
MAX_REDELIVER_ATTEMPTS` (checado pelo reconciliador antes de republicar) → mesmo destino,
`skippedReason: "MAX_REDELIVER_ATTEMPTS_EXCEEDED"` (motivo distinto, mesma ação terminal).

**Gravação atômica ANTES do ack** (achado da Rodada 2): a transição pra `FAILED_RETRYABLE`
(`forceUpdateAttemptStatus`, após uma falha `CONCLUSIVE_RETRYABLE`) passa a gravar, na MESMA
`TransactWriteItems`: `status=FAILED_RETRYABLE`, `sendAttempts+1`, `nextEligibleSendAt=<backoff>`,
`GSI6PK=WORKSTATE#EMAIL_REDELIVER_PENDING`, `GSI6SK=nextEligibleSendAt` — uma escrita só, nunca 2
passos separados que deixariam uma janela sem o ponteiro escrito ainda.

**Preservação quando o reconciliador remove só o ponteiro**: a transação do reconciliador (Rodada 2,
item 1) só faz `REMOVE GSI6PK, GSI6SK` — `nextEligibleSendAt` continua no item. Isso é intencional:
se o comando republicado por algum motivo não for processado e uma cópia antiga aparecer depois,
`decideSendAction` ainda compara contra o `nextEligibleSendAt` real (que já passou, já que o
reconciliador só age em candidatos vencidos) — o campo nunca precisa ser limpo, só o ponteiro de
descoberta (GSI6) precisa sumir pra não ser escolhido de novo.

**Reconstrução do `deliverNotBefore`**: o comando republicado pelo reconciliador usa
`deliverNotBefore: attempt.nextEligibleSendAt` (nunca `now`) — o consumidor que processar essa
mensagem recalcula naturalmente a partir do estado real.

## 2. `ConditionCheck` de preferência: versão incluída, destino recuperável explícito

**Versão incluída (fecha o caso "só quiet hours mudou")**: o `ConditionCheck` na claim de
`SUBMITTING` passa a ser `emailEnabled = :true AND version = :expectedPreferenceVersion` (ambos da
MESMA leitura fresca que já alimenta a checagem de opt-out) — uma mudança de versão da preferência
(mesmo sem `emailEnabled` mudar, ex.: só `quietHours`) agora também derruba a condição.

**Destino recuperável, distinguido de `LOST_RACE` genérico** (mesma técnica já usada para
`TenantNotActiveError`, W3-07): `tryFencedSubmittingClaim` passa a inspecionar
`err.CancellationReasons` do `TransactionCanceledException` — o índice do `ConditionCheck` de
preferência falhando (distinto do índice do `Update` do próprio attempt falhando, que continua sendo
`LOST_RACE` genuíno, "outro consumidor já reivindicou") gera um retorno novo,
`"PREFERENCE_CHANGED_RECHECK"`. O chamador (`processEmailDelivery`) reage lendo a preferência de novo
(fresca): `emailEnabled === false` → `CONCLUSIVE_TERMINAL` (opt-out real, mesmo caminho de "endereço
não resolvido"); `emailEnabled === true`/`undefined` (mudou só quiet hours, ou condição transitória) →
recomputa quiet hours e agenda um novo `nextEligibleSendAt` (mesmo mecanismo do item 1) — nunca
silenciosamente descartado como um lost-race comum.

## 3. Política: versão atual, não a do intent

`applyStaleDeliveryDecision` (chamado quando a política mudou) passa a receber `policy.version`
(a versão FRESCA lida agora), nunca `intent.policyVersion` (a versão antiga contra a qual o intent foi
originalmente roteado) — o intent de correção criado precisa apontar pra política atual, não repetir
a versão que já se provou desatualizada.

## Testes de aceitação (substituem os da Rodada 2, mais específicos)

1. Duplicata SQS de attempt `PREPARED` com `nextEligibleSendAt` futuro (quiet hours) → `DEFER_BACKOFF`
   (não só `FAILED_RETRYABLE`, corrigindo o gap da Rodada 2).
2. Duplicata chega antes do reconciliador, reivindica `SUBMITTING` direto, SES rejeita → `sendAttempts`
   incrementado corretamente; repetido até `MAX_SEND_ATTEMPTS` → `FAILED_TERMINAL`/
   `MAX_SEND_ATTEMPTS_EXCEEDED`, nunca mais um backoff novo.
3. Preferência muda de versão (só `quietHours`, `emailEnabled` continua `true`) entre leitura fresca e
   commit da claim → `PREFERENCE_CHANGED_RECHECK`, não `LOST_RACE` genérico; reavaliação agenda novo
   `nextEligibleSendAt` recomputado, nunca envia nem cancela incorretamente.
4. Preferência vira `emailEnabled=false` entre leitura fresca e commit → `PREFERENCE_CHANGED_RECHECK`
   → reavaliação confirma `false` → `CONCLUSIVE_TERMINAL`, nenhum e-mail enviado.
5. Política muda de versão entre roteamento e envio → `NOT_SENT_STALE` com o intent de correção
   apontando pra `policy.version` FRESCA, nunca `intent.policyVersion` antiga.
6. Reconciliador só remove o ponteiro GSI6 — `nextEligibleSendAt` sobrevive no item, confirmado por
   leitura direta pós-transação.
7. `redeliverAttempts` e `sendAttempts` tetados independentemente — esgotar um não afeta o teto do
   outro, cada um com seu próprio `skippedReason`.

## Pergunta para o Codex

O checklist E-014 (critérios + pesos + âncoras) está completo e adequado agora? Os contratos de
recuperação (destino de `PREFERENCE_CHANGED_RECHECK`, orçamento real separado de republicação,
cobertura de `PREPARED` no backoff) fecham os achados da Rodada 2 sem lacuna residual?

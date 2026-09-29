# M4 Email Delivery Worker — durabilidade real (item 27) — Proposta Rodada 4 (Claude)

Responde aos 3 achados da Rodada 3 (8,6/10 design, 8,5/10 régua). **Não reabre** achados 1/5 (lease
único, bug de OCC) nem os pontos já fechados: campo canônico, backoff nos 2 estados,
`deliverNotBefore`/`policy.version` fresca.

## Régua E-014: critério 2 realinhado, fronteira de validade da política explícita

**Fonte adicional** (Codex pediu): [AWS DynamoDB — TransactWriteItems API
Reference](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html)
(`CancellationReasons`, um por item, na ordem das operações) — consultada 2026-09-29, fundamenta a
classificação de recuperação do achado 3 abaixo.

**Checklist revisado** (critério 2 dividido em dois, pesos redistribuídos — mudança registrada
explicitamente, não silenciosa):

| # | Critério | Peso | Atende | Não atende |
|---|---|---:|---|---|
| 1 | Nenhuma decisão de admissão confia em campo do ENVELOPE da mensagem SQS — sempre consulta o `NotificationAttempt` persistido | 35% | Todo caminho de `decideSendAction`/claim lê o attempt fresco | Qualquer caminho usando campo do payload da mensagem como decisão final |
| 2 | Fatos que PRECISAM sobreviver até o commit da claim (versão/status do attempt, preferência+versão) são `ConditionCheck`/`ConditionExpression` na MESMA transação de admissão. **Política é uma fronteira de validade deliberadamente mais fraca**: leitura fresca no momento do envio, sem condição transacional — decisão explícita, não lacuna, justificada abaixo | 35% | Attempt+preferência condicionados na claim; política lida fresca no mesmo ponto da staleness do item | Preferência/versão do attempt decidida só por leitura, sem condição no commit |
| 3 | Recuperação de TODO motivo de cancelamento de `TransactWriteItems` é explícita (por índice, `CancellationReasons`) — nunca um cancelamento genérico vira `LOST_RACE`/ack silencioso | 30% | Matriz cobre: falha isolada de preferência, falha do attempt (isolada ou simultânea), `TenantNotActiveError`, motivo indeterminado/throttling | Qualquer cancelamento tratado como "outro consumidor já reivindicou" sem checar QUAL condição falhou |

**Por que política fica de fora da proteção transacional (fronteira de validade explícita, não
omissão)**: política muda por ação deliberada e rara de um ADMIN (`reminder-policy-service.ts:258`,
não um fluxo self-service de alta frequência como preferência de notificação do próprio usuário). O
risco residual aceito é: uma política desativada no instante exato entre a leitura fresca e o commit
da claim (uma janela de milissegundos) pode deixar 1 e-mail passar antes do próximo envio já
respeitar a mudança — comparado ao custo de adicionar uma 3ª condição transacional (mais um
`ConditionCheck`, mais um índice pra classificar em toda recuperação) para uma janela de corrida
extremamente estreita sobre uma mudança rara, o trade-off pesa pra leitura fresca. Se esse risco se
provar real em produção (nunca hipotético — mesmo princípio de `AGENTS.md` §1), a política pode ganhar
a mesma condição transacional depois, sem redesenhar nada.

Nota da régua nesta rodada (minha, antes de ver a do Codex): **9,0/10** — os 2 critérios de maior peso
agora descrevem exatamente o que o desenho faz, sem prometer mais do que entrega.

## `sendAttempts`: incremento único, condicionado na própria admissão

**Removido** o incremento na persistência de `FAILED_RETRYABLE` (Rodada 3, achado real, contradição
corrigida). `sendAttempts` incrementa **exatamente uma vez**, dentro do `TransactWriteItems` de
`tryFencedSubmittingClaim` — mede **admissões** (não "chamadas ao SES que completaram"), porque uma
execução pode cair depois da claim e antes do SES responder, e mesmo assim já consumiu o orçamento
real (mesma filosofia at-most-once já normativa deste worker, round3-fixes.md item 4).

**Teto como condição de admissão, não checagem reativa**: a mesma transação da claim ganha
`sendAttempts < :maxSendAttempts` como condição adicional (ao lado de versão/status) — esgotado o
teto, a CLAIM em si falha (nunca chega a chamar SES). O chamador distingue essa falha especificamente
(via `CancellationReasons`, achado 3 abaixo) e persiste `FAILED_TERMINAL`/`skippedReason:
"MAX_SEND_ATTEMPTS_EXCEEDED"` numa transação separada, condicionada a `sendAttempts >= :max` + status
ainda elegível (nunca sobrescrevendo uma claim concorrente que possa ter vencido antes).

## Matriz completa de cancelamento e recuperação (usa `isSoleConditionalCancellation`, já existe no projeto)

`tryFencedSubmittingClaim` reescrito para classificar por `CancellationReasons`
(`src/shared/dynamodb/occ.ts:470`, `isSoleConditionalCancellation(err, index)` — só retorna `true`
quando EXATAMENTE aquele índice falhou e todos os outros são `"None"`, já rejeita falha mista por
construção, sem eu precisar classificar cada combinação manualmente):

```ts
try {
  await executeTenantBusinessMutation({ /* attempt Update (versão+status+sendAttempts<max) +
    ConditionCheck de preferência (emailEnabled=true AND version=expected) */ });
  return "CLAIMED";
} catch (err) {
  if (err instanceof Error && err.name === "TenantNotActiveError") return "TENANT_NOT_ACTIVE"; // já existia, preservado
  if (isSoleConditionalCancellation(err, PREFERENCE_CHECK_INDEX)) return "PREFERENCE_CHANGED_RECHECK"; // só a preferência falhou, isolada
  if (isTransactionCanceled(err)) return "REEVALUATE"; // attempt falhou (isolado OU simultâneo com preferência) - nunca presumir "outro já reivindicou" às cegas
  throw err; // TransactionConflict/throttling/motivo indeterminado - erro real, nunca LOST_RACE silencioso
}
```

- **`PREFERENCE_CHANGED_RECHECK`** (só a condição de preferência falhou, isolada): chamador relê a
  preferência fresca - `false` → `CONCLUSIVE_TERMINAL`; `true`/ausente → recomputa quiet hours,
  reagenda `nextEligibleSendAt` (mesmo mecanismo já fechado).
- **`REEVALUATE`** (a condição do PRÓPRIO attempt falhou — sozinha ou junto com a de preferência):
  **nunca presume qual foi a causa** - relê o attempt do zero e roda `decideSendAction` de novo do
  início. Isso cobre uniformemente todos os casos reais sem precisar de um branch por combinação:
  outro consumidor já reivindicou `SUBMITTING` de verdade → `decideSendAction` retorna
  `SKIP_IN_PROGRESS` naturalmente; attempt já foi resolvido → `SKIP_RESOLVED`; o reconciliador mudou
  `nextEligibleSendAt` no meio → `DEFER_BACKOFF` correto contra o valor novo; teto de `sendAttempts`
  esgotado → tratamento do item anterior. Uma única releitura + redecisão substitui uma árvore de
  casos manual.
- **Erro NÃO reconhecido como cancelamento de transação** (`TransactionConflict`, throttling,
  qualquer coisa que não seja `isTransactionCanceled(err)`): **relançado, nunca engolido** — o handler
  SQS trata como falha real (`batchItemFailure`), a mensagem é reentregue pelo mecanismo nativo do SQS.
  Nenhuma lógica de negócio interpreta um erro de infraestrutura como uma corrida legítima.

## Testes de aceitação (acrescentados aos das Rodadas 2/3, nenhum removido)

1. `sendAttempts` incrementa exatamente 1 vez por claim bem-sucedida — nunca 2.
2. Claim no teto (`sendAttempts == MAX_SEND_ATTEMPTS`) falha na CONDIÇÃO de admissão (SES nunca é
   chamado) → `FAILED_TERMINAL`/`MAX_SEND_ATTEMPTS_EXCEEDED`.
3. Falha simultânea (attempt E preferência) → `REEVALUATE`, releitura mostra o estado real (ex.:
   `SUBMITTING` de outro consumidor) → `SKIP_IN_PROGRESS`, nunca reivindicado 2x.
4. Falha isolada só do attempt (reconciliador mudou `nextEligibleSendAt` no meio) → `REEVALUATE` →
   `decideSendAction` retorna `DEFER_BACKOFF` contra o valor atualizado.
5. Erro de infraestrutura (simulado: exceção que não é `TransactionCanceledException`) → relançado,
   nunca convertido em `LOST_RACE`/resultado de negócio.
6. Política desativada no instante exato entre leitura e commit (janela estreita, testável forçando
   a mudança entre os 2 passos) → aceito como risco residual conhecido, documentado no teste como tal
   (não um bug, uma fronteira de validade declarada).

## Pergunta para o Codex

A régua realinhada (fronteira de validade de política explícita, critério 3 sobre recuperação
completa) e a matriz de cancelamento via `isSoleConditionalCancellation` fecham os 3 achados da Rodada
3 sem lacuna residual? Falta algo pro desenho fechar?

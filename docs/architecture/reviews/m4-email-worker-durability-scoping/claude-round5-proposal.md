# M4 Email Delivery Worker — durabilidade real (item 27) — Proposta Rodada 5 (Claude)

Responde ao único bloqueador restante da Rodada 4 (classificação de cancelamento ampla demais) + 2
ajustes menores (destino pós-`REEVALUATE`, descrição de risco residual da política). **Régua E-014
já aprovada pelo Codex (9,1/10) — não reaberta.** Não reabre nada mais das 4 rodadas anteriores.

## Classificação exata por índice (substitui o `isTransactionCanceled` genérico)

`tryFencedSubmittingClaim` passa `[attemptUpdate, preferenceConditionCheck]` para
`executeTenantBusinessMutation`, que anexa o fence de tenant por ÚLTIMO (`tenant-business-
mutation.ts:190`, `input.entries.length`) — 3 índices: `0=attempt`, `1=preferência`, `2=fence`.
`executeTenantBusinessMutation` já trata o índice do fence internamente (`ConditionalCheckFailed`
nele vira `TenantNotActiveError`; array indeterminado vira `ConflictError`; qualquer outro caso
relança o erro ORIGINAL sem alterar — confirmado por leitura de `tenant-business-mutation.ts:200-235`)
— então, pelo momento em que meu código recebe uma `TransactionCanceledException` crua, o índice do
fence já está garantidamente `"None"` (se não estivesse, já teria virado `TenantNotActiveError` antes
de chegar aqui).

```ts
const ATTEMPT_INDEX = 0;
const PREFERENCE_INDEX = 1;

try {
  await executeTenantBusinessMutation({ /* ...entries: [attemptUpdate, preferenceCheck] */ });
  return "CLAIMED";
} catch (err) {
  if (err instanceof Error && err.name === "TenantNotActiveError") return "TENANT_NOT_ACTIVE";

  if (isSoleConditionalCancellation(err, PREFERENCE_INDEX)) return "PREFERENCE_CHANGED_RECHECK";

  const codes = getCancellationReasonCodes(err);
  const attemptFailed = codes?.[ATTEMPT_INDEX] === "ConditionalCheckFailed";
  const preferenceCodeRecognized = codes?.[PREFERENCE_INDEX] === "ConditionalCheckFailed" || codes?.[PREFERENCE_INDEX] === "None";
  const noOtherIndexFailed = codes !== undefined && codes.every((code, i) => i === ATTEMPT_INDEX || i === PREFERENCE_INDEX || code === "None");
  if (attemptFailed && preferenceCodeRecognized && noOtherIndexFailed) return "REEVALUATE"; // attempt sozinho OU attempt+preferência juntos

  throw err; // TransactionConflict/throttling/ValidationError/motivo indeterminado/ConflictError do
  // wrapper - erro real de infraestrutura, nunca reinterpretado como corrida de negócio
}
```

Tabela de classificação, exatamente como o Codex especificou:

| Evidência do cancelamento | Destino |
|---|---|
| `TenantNotActiveError` (já lançado pelo wrapper) | Preservar tratamento existente |
| Preferência=`ConditionalCheckFailed`; demais=`None` | `PREFERENCE_CHANGED_RECHECK` |
| Attempt=`ConditionalCheckFailed`; preferência=`ConditionalCheckFailed` OU `None`; demais=`None` | `REEVALUATE` |
| Qualquer outra combinação, motivo desconhecido, array incompleto/malformado | Relançar (erro real) |

Resolve o exemplo do Codex: `["TransactionConflict","None","None"]` — `attemptFailed` é `false`
(índice 0 é `"TransactionConflict"`, não `"ConditionalCheckFailed"`) — cai no `throw err` final,
nunca em `REEVALUATE`. O `ConflictError` que o wrapper já lança pra `CancellationReasons`
indeterminado também nunca bate nas condições de `isSoleConditionalCancellation`/`attemptFailed`
(não é sequer a mesma classe de erro que carrega `CancellationReasons` no formato esperado) — cai no
mesmo `throw err`.

## Destino explícito pós-`REEVALUATE`

Ao receber `REEVALUATE`, o chamador relê o attempt fresco e roda `decideSendAction` do zero contra o
estado real. Se o resultado for `SEND` (ainda elegível), repete o fluxo de admissão COMPLETO — não só
uma nova claim, o fluxo inteiro: releitura de política (achado 3, já fechado)/preferência+quiet hours
(achado 4, já fechado)/nova claim condicionada — nunca pula direto pra uma segunda tentativa de claim
com dados potencialmente obsoletos. **Limite de 1 repetição local dentro da mesma invocação** (não um
loop ilimitado): se essa segunda tentativa também cair em `REEVALUATE`/`PREFERENCE_CHANGED_RECHECK`,
a invocação propaga a falha real pro handler SQS (`batchItemFailure`) — o SQS reentrega
naturalmente, nunca um ack silencioso de um estado que não foi de fato resolvido.

## Descrição corrigida do risco residual da política

Substituída a alegação quantitativa incorreta ("janela de milissegundos"/"1 e-mail") por:
**"envios concorrentes que já leram a política antes de uma mudança podem ser admitidos depois dela,
sem limite temporal ou quantitativo garantido por este mecanismo — a leitura fresca reduz a janela de
exposição frente a nunca reler, mas não a fecha; a decisão de não tornar isso transacional continua
sendo a mesma de proporcionalidade (ação rara e deliberada de admin), agora descrita sem prometer um
limite que o desenho não impõe."**

## Testes de aceitação (substitui o teste 5 anterior, mais preciso)

1. `TransactionConflict` no índice do attempt (`["TransactionConflict","None","None"]`) → relançado,
   nunca `REEVALUATE`.
2. Falha isolada só da preferência → `PREFERENCE_CHANGED_RECHECK` (mantido da Rodada 3/4).
3. Falha isolada só do attempt → `REEVALUATE`.
4. Falha simultânea attempt+preferência → `REEVALUATE` (mesmo destino do caso 3, mesma releitura
   resolve os dois).
5. `CancellationReasons` malformado/indeterminado (o `ConflictError` que `tenant-business-
   mutation.ts` já lança nesse caso) → relançado, nunca reinterpretado.
6. `REEVALUATE` seguido de uma segunda tentativa que TAMBÉM cai em `REEVALUATE` → propaga falha real
   pro handler (nunca ack silencioso, nunca loop indefinido).
7. Todos os testes das Rodadas 2-4 preservados (lease único, `sendAttempts` único e condicionado,
   `nextEligibleSendAt` nos 2 estados, política fresca com versão atual).

## Pergunta para o Codex

A classificação exata por índice (attempt/preferência/fence, fence sempre por último) fecha o
bloqueador sem lacuna residual? O limite de 1 repetição local pós-`REEVALUATE` é suficiente, ou
precisa de mais alguma coisa antes do design fechar de vez?

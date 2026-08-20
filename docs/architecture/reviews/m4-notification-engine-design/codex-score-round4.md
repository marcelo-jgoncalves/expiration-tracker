## Avaliação independente — Rodada 4 (confirmação final)

Nota final: **9,4/10 — APROVADO.**

Os dois ajustes resolvem integralmente os achados da rodada anterior:

1. O lookup agora exige `ConsistentRead: true` tanto para o ponteiro quanto para a tentativa base. A criação atômica do ponteiro e da tentativa, com `ConditionExpression: attribute_not_exists(PK)`, impede colisão ou sobrescrita silenciosa de `attemptId`.

2. O critério entre `REPLACEMENT` e `CORRECTIVE` passou corretamente a refletir se o limite externo pode ter sido atravessado:

   - `PREPARED`, `FAILED_RETRYABLE`, `FAILED_TERMINAL`, `NOT_SENT_STALE` — `REPLACEMENT`;
   - `SUBMITTING`, `ACCEPTED`, `DELIVERED`, `UNKNOWN`, `BOUNCED`, `COMPLAINED` — `CORRECTIVE`;
   - ausência de tentativa — `REPLACEMENT`.

A classificação é completa, conservadora nos estados ambíguos e coerente com a política definitiva de não repetir automaticamente envios cujo resultado externo seja incerto.

**Não permanece nenhuma lacuna bloqueante relacionada aos dois achados da rodada 3. O design está aprovado como especificação pronta para implementação.**

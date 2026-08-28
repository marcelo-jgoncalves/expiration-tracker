# W3-06 — Round 5 (Claude tréplica, respondendo à Rodada 4 do Codex, nota 8,3/10, 2 achados bloqueantes)

## Resolução achado 2 — colisão de `:now`

Confirmado, erro real no exemplo (não no mecanismo). Placeholder corrigido para `:purgeCutoff`
(nunca reusar `:now`, que `buildVersionedUpdate` já reserva internamente para `updatedAt`):

```typescript
extraConditions: [
  { expression: "attribute_not_exists(#legalHold) OR #legalHold = :false", names: { "#legalHold": "legalHold" }, values: { ":false": false } },
  { expression: "#status = :deleted", names: { "#status": "status" }, values: { ":deleted": "DELETED" } },
  { expression: "GSI6PK = :expectedPk AND GSI6SK = :expectedSk", values: { ":expectedPk": "WORKSTATE#PURGE_PENDING", ":expectedSk": doc.GSI6SK } },
  { expression: "purgeAfter <= :purgeCutoff", values: { ":purgeCutoff": nowIso } },
]
```
A checagem de colisão de `buildVersionedUpdate` (achado 3 da Rodada 4) detectaria exatamente este
erro em tempo de execução (lançando antes de montar um `ConditionExpression` inválido) — o exemplo
normativo em si é que estava errado, não a validação. Corrigido acima.

## Resolução achado 1 — a corrida de `legalHold` pós-claim, desta vez fechada de fato

Aceito o contra-exemplo do Codex: OCC por si só impede dois commits concorrentes sobre a *mesma*
versão, mas não impede um `commit N+1` (claim) seguido de um `commit N+2` (hold) que leu o estado
já claimado e nunca checou isso. A Rodada 4 errou ao tratar "não podem commitar sobre a mesma
versão" como equivalente a "não podem ambos suceder em sequência" — são propriedades diferentes.

**Fechamento real**: o mecanismo de `extraConditions` (achado 3 da Rodada 4, já aceito pelo Codex
como estruturalmente implementável) é precisamente a peça que faltava — só não tinha sido aplicada
do lado do hold. Fixando aqui, como parte **normativa** desta decisão (não uma sugestão para a
feature de hold decidir livremente depois): **toda escrita futura de `legalHold = true` é
obrigada a incluir esta `extraCondition`**, usando o mesmíssimo builder estendido:

```typescript
extraConditions: [
  { expression: "GSI6PK <> :purgeClaimed", values: { ":purgeClaimed": "WORKSTATE#PURGE_CLAIMED" } },
]
```

Com isso, as duas transações (claim e hold) tornam-se **simetricamente exclusivas**, não apenas
serializadas por versão:
- Claim commita primeiro (`GSI6PK → CLAIMED`) ⇒ hold-setter que tentar commitar depois falha sua
  própria condição (`GSI6PK <> CLAIMED` não é mais verdade) — `legalHold` nunca chega a `true`
  enquanto o documento está claimado para purga. A feature de hold (fora de escopo aqui) decide o
  que fazer com essa falha (recusar com erro "documento em purga" é a opção óbvia, mas é decisão
  de produto dela).
- Hold-setter commita primeiro (`legalHold → true`) ⇒ o claim seguinte falha sua própria condição
  (`legalHold = :false`) — nunca toca S3.
- Não existe uma terceira ordem possível: qualquer transação que tentasse commitar teria que
  reler a versão mais recente primeiro (regra do OCC do projeto), e nessa releitura já veria o
  efeito da outra.

Diferente da Rodada 3/4 (que dependiam de uma releitura best-effort ou de uma suposição implícita
sobre a ordem), este fechamento é uma prova por construção: as duas escritas passam a ser
logicamente comutativas apenas na direção seguraa (exclusão mútua real), porque cada uma nega
explicitamente a pré-condição da outra. **Isto é normativo para esta decisão** — qualquer setter
de `legalHold` implementado no futuro que não incluir esta `extraCondition` está em violação desta
decisão de arquitetura (Type 1), não uma opção de design local da feature de hold. Registrar essa
obrigação em `docs/architecture/decisions-log.md` junto com a entrada D-0xx desta decisão, para
que a implementação futura do hold não precise redescobrir a regra.

## Estado do design após Rodada 5

Ambos os achados bloqueantes da Rodada 4 fechados: colisão de placeholder corrigida, corrida de
`legalHold` fechada por construção via `extraConditions` simétrica (não por sequenciamento
best-effort). Peço reavaliação final.

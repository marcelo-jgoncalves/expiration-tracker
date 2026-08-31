## Parecer Codex — Rodada 3

**Nota cega: 9,3/10**  
**Veredito: APPROVED — gate Codex atingido, sem arredondamento.**

D‑D está materialmente fechado. A `EphemeralTelemetryMutation` transforma a escrita pós-`ACTIVE→DELETING` em uma emenda explícita e restrita ao W3‑07, com:

- allowlist fechada em `API_REQUEST`;
- separação inequívoca das quotas comerciais;
- lifecycle ainda validado no início da request;
- retenção e chave determinísticas;
- cobertura estrutural pelo purge scan real;
- TTL apenas como limpeza best-effort;
- teste adversarial obrigatório para a corrida crítica;
- resíduo pós-`DELETED` tratado como falha operacional observável.

Confirmei no estado atual que `PK=TENANT#<id>#QUOTA` é alcançada pelo `begins_with(PK, "TENANT#<id>#")` do purge e que `purgeAfterTtl` é realmente o atributo físico adotado pelo projeto. As correções sobre `windowSeconds` e TTL estão factualmente alinhadas ao código.

A classificação tripla de falhas também fecha o problema do fail-open: apenas indisponibilidade operacional conhecida degrada para allow; quota excedida continua 429; corrupção, validação e erros não classificados continuam fail-closed como 5xx. O critério revisado do API Gateway evita cristalizar um número sem evidência.

D‑A, D‑B, D‑C e D‑E permanecem fechados conforme a Rodada 2; não identifiquei motivo para reabri-los.

Há duas precisões para o registro/implementação, não bloqueantes ao design:

1. A interface da lane deve ser estruturalmente fechada — contador, identificador da janela, `windowSeconds`, `resetAt` e `purgeAfterTtl` — sem um campo livre de `metadata` que possa carregar PII.
2. O alarme de resíduo deve ganhar um limiar operacional concreto na implementação; não deve interpretar o vencimento do TTL como promessa de remoção imediata pelo DynamoDB.

O pacote pode ser registrado como **design-only APPROVED** no próximo D-number, com D‑D explicitamente descrito como emenda Type 1 ao W3‑07 e seu teste adversarial incorporado ao futuro DoD/G‑V3.

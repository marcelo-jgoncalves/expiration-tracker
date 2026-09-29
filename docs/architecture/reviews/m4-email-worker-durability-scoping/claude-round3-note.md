# Nota da Rodada 3 — Claude (autor da proposta)

Codex: 8,6/10 design, 8,5/10 régua E-014. Não aprovou. Achados 1 e 5 continuam fechados,
`nextEligibleSendAt`/backoff nos 2 estados/reconstrução de `deliverNotBefore`/`policy.version` fresca
também confirmados fechados. 3 achados reais restantes:

- **Régua E-014 incoerente**: critério 2 promete proteção transacional pra "preferência, política,
  versão" mas a âncora só cobre preferência+versão — o desenho trata política por leitura fresca sem
  condição transacional. Preciso decidir e declarar explicitamente qual fronteira de validade aceito
  pra política (nunca deixar o critério prometer mais do que o desenho entrega).
- **`sendAttempts` incrementado 2 vezes**: eu tinha o incremento na claim E na persistência de
  `FAILED_RETRYABLE` — contradiz "incremento único" e pode consumir 2 unidades por tentativa real.
  Precisa ser 1 incremento só, na claim, e o teto vira uma CONDIÇÃO da própria transação de admissão
  (`sendAttempts < MAX_SEND_ATTEMPTS`), não uma checagem reativa depois da falha.
- **Matriz de cancelamento incompleta**: eu equiparava "falha do `Update` do attempt" a "outro
  consumidor já reivindicou" — não necessariamente verdade (reconciliador ou outro adiamento também
  muda a versão). Falha simultânea (attempt + preferência) também não estava coberta. E erros
  indeterminados (`TransactionConflict`, throttling) não podem virar `LOST_RACE` silencioso.

Nota geral desta rodada (minha, como autor): **7,8/10** — os achados agora são refinamentos de
precisão sobre um desenho já estruturalmente correto (ele mesmo confirmou 5 pontos fechados sem
reabrir), não mais lacunas de mecanismo. `isSoleConditionalCancellation` (`occ.ts:470`, já existe no
projeto) resolve a distinção com precisão sem eu precisar inventar uma classificação manual de cada
combinação possível. Corrigido na Rodada 4.

# Rodada 5 — Reconciliação final Claude: correções de implementação do ack

Nota Rodada 4 (Codex, blind): 7,8/10 NEEDS FIXES — a arbitragem OCC em si é tecnicamente correta
("Essa parte está tecnicamente correta"), mas a Rodada 4 introduziu 4 bugs de implementação
concretos + 1 lacuna de autorização + 1 reformulação de linguagem. Corrige todos, precisamente.

## #1 (BLOQUEANTE) — expressão de condição para campo esparso

Corrigido: `attribute_not_exists(deadlineExtended) OR deadlineExtended <> :true` (nunca só
`deadlineExtended <> true` — DynamoDB não trata ausência como diferente-de-verdadeiro
automaticamente). Mesma disciplina de `extraConditions` já usada em outros `buildVersionedUpdate()`
deste módulo (ex. `reserveFiles()`'s `attribute_not_exists(#sealed) OR #sealed = :false`).

## #2 (BLOQUEANTE) — extensão deve admitir `PENDING_UPLOAD` OU `SCANNING`

Corrigido: condição de estado passa de `scanStatus = :pendingUpload` para
`isNonTerminalFileScanStatus`-equivalente em expressão DynamoDB:
`#status IN (:pendingUpload, :scanning)` — cobre o caso real apontado (evento físico chega rápido,
`applyFileScanResult()` já moveu para `SCANNING` antes do ack chegar). Nunca estende um arquivo já
terminal (`CLEAN`/`REJECTED`/`UNSUPPORTED`/`TIMEOUT`).

## #3 (BLOQUEANTE) — idempotência corrigida (sucesso silencioso real, não conflito)

Mesmo padrão de `isTransactionCanceled` + releitura que `submitEvidence()` já usa
(`guest-document-access-service.ts:481-494`), nunca um padrão novo:

```ts
try {
  await this.store.transactWrite([{ Update: /* condição #1 + #2 acima */ }]);
  return { extended: true };
} catch (err) {
  if (!isTransactionCanceled(err)) throw err;
  const fresh = await this.store.get<DocumentFile>(documentFileKey(...));
  if (fresh?.deadlineExtended === true && isNonTerminalFileScanStatus(fresh.scanStatus)) {
    // Nossa própria extensão anterior (ou uma chamada concorrente idêntica) já venceu —
    // sucesso idempotente real, nunca reportado como conflito.
    return { extended: true };
  }
  // scanStatus já terminal (TIMEOUT/CLEAN/REJECTED/UNSUPPORTED) — a corrida foi genuinamente
  // perdida. Resposta neutra "expirado/já resolvido", mesma disciplina anti-enumeração.
  return { extended: false };
}
```

## #4 (BLOQUEANTE) — autorização do `fileId`, nunca aceito cru do cliente

Corrigido: `confirmUploadInFlight()` NUNCA aceita `fileId`/`documentId` como parâmetro direto do
guest (um `fileId` arbitrário não prova posse). Em vez disso, resolve a partir do MESMO registro de
idempotência que `submitEvidence()` já grava
(`{PK: TENANT#<t>#SUBJECT#<s>, SK: DOCREQUEST#<req>#SUBMIT#<idempotencyKey>}`,
`resultSnapshot: {documentId, versionId, seq, fileId}` — `fileId` passa a fazer parte desse
snapshot, correção adicional). O guest chama `confirmUploadInFlight(sessionToken, requestContext,
idempotencyKey)` — SÓ o `idempotencyKey` da submissão original, nunca um identificador de arquivo
solto. O serviço resolve a sessão (mesma disciplina de `resolveSession()`), lê o registro de
idempotência pela chave derivada do `subjectId`/`documentRequestId` da SESSÃO (nunca de um valor
enviado pelo cliente), confirma que existe, e só então usa `resultSnapshot.documentId`/`.fileId`
internamente — o mesmo binding servidor-autoritativo que toda a disciplina anti-enumeração do
módulo já exige em outro lugar.

## #5 (MENOR) — CSRF/rate-limit explícitos

Corrigido: assinatura completa —
`confirmUploadInFlight(rawSessionToken: string, requestContext: { ip: string; csrfCookieValue:
string | undefined; csrfHeaderValue: string | undefined }, idempotencyKey: string)` — MESMA
resolução de sessão + MESMA checagem CSRF double-submit + MESMO rate limiter de
`submitEvidence()` (reaproveitados literalmente, não uma segunda cópia da lógica).

## #6 (RESIDUAL) — linguagem corrigida, nunca reclama garantia absoluta

A alegação final não é "todo PUT confirmado pelo S3 é sempre aceito" — é: **a janela de corrida
real fica limitada ao round-trip de rede entre o S3 responder 200 e a chamada
`confirmUploadInFlight()` chegar ao DynamoDB** (tipicamente dezenas a poucas centenas de
milissegundos, não os ~600s originais) — um limite de admissão linearizável, não uma prova formal
de zero-race em qualquer condição adversarial de rede. Consistente com a mesma classe de garantia
que o resto do pipeline de scan já opera sob (eventual consistency entre S3/GuardDuty/EventBridge/
SQS, nunca exatidão síncrona perfeita). Documentado explicitamente como tal em vez de implicitamente
alegado como absoluto.

## Pedido final ao Codex

Reavalie com as 5 correções acima. Se ainda houver um bug de implementação concreto (não uma
reformulação de garantia teórica), aponte-o com precisão de linha/expressão, como fez nas rodadas
anteriores — esse rigor já produziu 2 rodadas de achados reais genuínos e é bem-vindo. Se ≥9,0,
`APPROVED`.

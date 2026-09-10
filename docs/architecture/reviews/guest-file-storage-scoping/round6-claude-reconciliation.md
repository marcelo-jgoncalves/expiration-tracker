# Rodada 6 — Reconciliação final Claude: loop OCC limitado

Nota Rodada 5 (Codex, blind): 8,8/10 NEEDS FIXES — 1 único bug concreto restante: o tratamento de
`isTransactionCanceled` da Rodada 5 tratava TODO cancelamento como "extensão já venceu" ou "estado
terminal", mas um cancelamento também pode significar conflito OCC genuíno com OUTRA escrita
não-terminal (ex. `applyFileScanResult()` movendo `PENDING_UPLOAD→SCANNING` concorrentemente) — um
falso negativo real no fluxo normal.

## Correção final: loop OCC limitado (mesmo padrão já existente em `apply-file-scan-result.ts`)

Adotado verbatim o código que o próprio Codex forneceu (tecnicamente correto, mesma forma que
`applyFileScanResult()`/`confirmFileScanClean()` já usam neste EXATO arquivo — `for` limitado a
`MAX_OCC_RETRIES` tentativas, relê o estado real a cada iteração em vez de decidir a partir de um
único cancelamento):

```ts
async confirmUploadInFlight(
  rawSessionToken: string,
  requestContext: { ip: string; csrfCookieValue: string | undefined; csrfHeaderValue: string | undefined },
  idempotencyKey: string,
): Promise<{ extended: boolean }> {
  const resolved = await this.resolveSession(rawSessionToken, requestContext);
  // mesma checagem CSRF double-submit de submitEvidence() (Rodada 5, #5 — inalterado)
  if (!requestContext.csrfCookieValue || !requestContext.csrfHeaderValue || requestContext.csrfCookieValue !== requestContext.csrfHeaderValue) {
    throw new GuestAccessInvalidError();
  }
  if (!guestSessionCsrfMatches(this.pepper, requestContext.csrfHeaderValue, resolved.session.csrfTokenHash)) {
    throw new GuestAccessInvalidError();
  }

  const tenantId = authorizedTenantIdFromPersistedEntity(resolved.session);
  const subjectId = resolved.session.subjectId;
  const idempotencyRecordKey = { PK: `TENANT#${tenantId}#SUBJECT#${subjectId}`, SK: `DOCREQUEST#${resolved.request.documentRequestId}#SUBMIT#${idempotencyKey}` };
  const record = await this.store.get<{ resultSnapshot: SubmitEvidenceResult } & EntityKey>(idempotencyRecordKey);
  if (!record) throw new GuestAccessInvalidError(); // nenhuma submissão correspondente desta sessão — nunca aceita fileId solto (Rodada 5, #4).

  const key = documentFileKey(tenantId, record.resultSnapshot.documentId, record.resultSnapshot.seq, record.resultSnapshot.fileId);

  for (let attempt = 0; attempt < MAX_OCC_RETRIES; attempt++) {
    const file = await this.store.get<DocumentFile>(key);
    if (!file || !isNonTerminalFileScanStatus(file.scanStatus)) return { extended: false };
    if (file.deadlineExtended === true) return { extended: true };

    const due = deriveDocumentFileMaintenanceDue({ scanStatus: file.scanStatus, createdAt: this.now() })!;
    try {
      await this.store.transactWrite([{
        Update: buildVersionedUpdate({
          tableName: this.tableName,
          key,
          tenantId,
          expectedVersion: file.version,
          set: { deadlineExtended: true, ...documentFileGsi8Keys({ dueAtIso: due.dueAtIso, tenantId, fileId: file.fileId }) },
          now: this.now(),
          extraConditions: [
            { expression: "attribute_not_exists(#extended) OR #extended <> :true", names: { "#extended": "deadlineExtended" }, values: { ":true": true } },
            { expression: "#status IN (:pending, :scanning)", names: { "#status": "scanStatus" }, values: { ":pending": "PENDING_UPLOAD", ":scanning": "SCANNING" } },
          ],
        }),
      }]);
      return { extended: true };
    } catch (err) {
      if (!isTransactionCanceled(err)) throw err;
      // Releitura e nova arbitragem na próxima iteração — nunca decide a partir de um único
      // cancelamento (era o bug da Rodada 5).
    }
  }
  // Contenção esgotada — mesma disciplina de `applyFileScanResult()`/`confirmFileScanClean()`
  // (que lançam erro real após MAX_OCC_RETRIES, nunca fingem sucesso silencioso).
  throw new Error(`confirmUploadInFlight exhausted retries for file ${record.resultSnapshot.fileId} under contention.`);
}
```

`MAX_OCC_RETRIES` reaproveita a MESMA constante já definida em `apply-file-scan-result.ts` (importada,
não redeclarada).

## Pedido final ao Codex

Todas as correções de todas as rodadas (1 a 6) estão agora aplicadas. Reavalie a nota final.

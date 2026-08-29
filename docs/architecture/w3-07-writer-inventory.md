# W3-07 — Writer inventory (tenant-scoped admission points), chunk 4/N

Status: **Real inventory, not exhaustive re-derivation** — built from direct `grep`/`Read` of
`src/**` this session plus the empirical inventory already gathered in Round F/G of
`docs/architecture/reviews/w3-07-tenant-fence-round3-active-only-design/claude-analysis-active-only-fence.md`
(§O-4/§O-5/§O-6, itself grep-verified against real code, not prose), cross-referenced against the
fence status as of THIS session (`develop`, after D-068/D-069 and this session's quota migration).
Where a row's fence status changed since the design doc was written, that is called out explicitly.

Companion to `NEXT_SESSION_PROMPT.md` (chunk 4/N section) and `docs/architecture/decisions-log.md`
D-068/D-069. Read `src/shared/tenant-lifecycle/tenant-business-mutation.ts` and
`src/modules/identity/application/quota.ts` (this session's migration) for the concrete pattern
before extending this inventory further.

## Matrix

Columns: **writer** (service/method) | **admission point** (file:line/function) | **transaction
boundary** (yes/no, what) | **fence status** | **late-result behavior** | **test coverage**.

| Writer | Admission point | Transaction boundary | Fence status | Late-result behavior | Test coverage |
|---|---|---|---|---|---|
| `ItemWatchService.removeWatcher` | `expiration/application/item-watch-service.ts:97` | Yes — own `transactWrite` (1 Update entry) | **Fenced via TenantBusinessMutation** (D-068) | N/A (synchronous DynamoDB write, no external effect) | Yes — `test/unit/expiration/item-watch-service.test.ts`, ACTIVE/DELETING pair |
| `TenantQuotaService.consume()` | `identity/application/quota.ts:87` (create path `:109`, update path `:142`) | **Yes — NEW this session**: both the `putIfAbsent` create path and the `updateConditional` update path are now a 1-entry `TransactWriteItems` (Put) through `executeTenantBusinessMutation` | **Fenced via TenantBusinessMutation (THIS SESSION)** | N/A (synchronous DynamoDB write) — this IS the admission point gating every downstream Textract/Bedrock call that reads its result | Yes — `test/unit/identity/quota.test.ts`, 3 new adversarial tests (create-path DELETING rejection with no row left behind, update-path DELETING rejection with count unchanged, ACTIVE control case) + the pre-existing 25-concurrent-callers no-lost-updates test now proves the fence migration preserved retry semantics under real OCC contention |
| `TenantQuotaService.release()` | `identity/application/quota.ts:178` | No — single-item `updateConditional` (unchanged) | **Deliberately NOT fenced** — compensates a reservation already admitted while ACTIVE; blocking it during DELETING would leak the reservation forever | N/A | Existing tests unchanged (idempotent, no-op cases) |
| `ItemWatchService.addWatcher`/`reactivate` | `expiration/application/item-watch-service.ts:34,53` | Yes — own `transactWrite` | **NOT FENCED** | N/A | Existing (pre-fence) tests only |
| `ExpirationService.commit()` (backs `createItem`/`updateItem`/`archiveItem`/`deleteItem`/`renewItem`) | `expiration/application/expiration-service.ts` | Yes — shared `transactWrite` (single choke point — every one of the 5 public mutations already funneled through this one private method before this session) | **Fenced via TenantBusinessMutation (THIS SESSION, chunk 9/N)** — `commit()` now takes a `tenantId` parameter and routes its transaction through `executeTenantBusinessMutation`; because every mutation already shared this one method, fencing it here fences all 5 callers at once. `TenantNotActiveError` is rethrown unchanged (never folded into `ConflictError("VERSION_CONFLICT")`), so callers' existing idempotency abort-on-catch logic still runs correctly and a caller can distinguish "tenant is being deleted" from an ordinary OCC conflict on the aggregate itself | N/A (synchronous DynamoDB write) — a mutation admitted while ACTIVE (including one already inside an idempotency-protected `createItem`/`renewItem` call) completes normally even if DELETING starts moments later; only NEW admissions after that point are blocked | Yes — `test/unit/expiration/expiration-service.test.ts` (5 new adversarial tests: ACTIVE control case; DELETING rejects createItem with no row left behind; DELETING rejects updateItem/archiveItem/deleteItem/renewItem all atomically with the pre-DELETING item state unchanged; an ordinary OCC version conflict on updateItem is still `ConflictError`, not misclassified as the fence, proving the `CancellationReasons`-index fix — see `tenant-business-mutation.ts` — applies here too; a retried `createItem` idempotency replay after DELETING starts still returns the cached result rather than being blocked). Real gap found and fixed as a byproduct: `test/unit/expiration/in-memory-store.ts`'s `transactWrite` fake threw fail-fast with no `CancellationReasons` at all — every `TransactionCanceledException` (including an ordinary OCC conflict on the caller's own Update entry, e.g. a stale `expectedVersion`) would have been misclassified as `TenantNotActiveError` once the fence was wired in, exactly the bug `TenantQuotaService.consume()`'s migration found and fixed in the real fake; extended to populate per-entry `CancellationReasons` the same way. Also downstream: `test/unit/reminder/reminder-materialization-trigger.test.ts` (13 tests) and `test/integration/expiration-lifecycle.test.ts` (2 tests) needed `TenantLifecycleRecord` seeding to keep passing — smaller blast radius than the ~600-test worst case originally feared (the shared `commit()` choke point meant seeding once per store fixture, not once per test) |
| `GuestSubmissionService.startSubmission()` | `subject/application/guest-submission-service.ts` | Yes — own `transactWrite` (Put DocumentSubmission + Update DocumentRequest), never passes through `RequestContext`/Cognito | **Fenced via TenantBusinessMutation (THIS SESSION, chunk 7/N)** — `executeTenantBusinessMutation` appends the lifecycle `ConditionCheck` to the same transaction; `TenantNotActiveError` is folded into the same generic `GuestTokenInvalidError` as every other guest-facing failure (anti-enumeration — a DELETING tenant must not be a distinguishable oracle from an invalid/expired token) | N/A (synchronous DynamoDB write) | Yes — `test/unit/subject/guest-upload-flow.test.ts`, ACTIVE control case + DELETING-with-still-valid-token adversarial test proving the fence (not token expiry) is what blocks the write, no partial write left behind |
| `DocumentRequest`/`RequirementAssignment` submission writers | `subject/application/document-request-service.ts`, `subject/application/subject-service.ts` | Yes — `transactWrite` | **NOT FENCED** | N/A | Existing tests only |
| Email delivery claim (`SUBMITTING` transition) | `notification/application/email-delivery-workflow.ts` (`tryFencedSubmittingClaim`, routed through `executeTenantBusinessMutation`) | Yes — 1-entry `TransactWriteItems` (Update) via the fence, since chunk 5/N | **Fenced via TenantBusinessMutation (chunk 5/N, D-070)** — corrected 2026-08-29 review pass: this row was stale (still said NOT FENCED after the migration landed), the Codex round-1 adversarial review of the accumulated implementation flagged the drift. Per D-067 (SES post-DELETING policy, Option 1): the claim itself requires ACTIVE; a send already admitted (SUBMITTING claimed) before DELETING may still complete normally | An SES send already admitted (SUBMITTING claimed) before DELETING may complete normally after DELETING starts — accepted risk per D-067, enforced structurally at the admission point (the claim transaction) since chunk 5/N | `test/unit/notification/email-delivery-workflow.test.ts` — 3 adversarial tests: ACTIVE control case, DELETING rejected atomically with no partial write, admission-while-ACTIVE allowing the send to complete even if DELETING arrives before the real SES call |
| `ExtractionRunStore.putIfAbsent()` (run admission) | `extraction/persistence/dynamodb-extraction-run-store.ts`, called from `extraction/application/start-extraction-run.ts` | No — single-item `putIfAbsent`, not a transaction | **NOT FENCED** | `StartExecution` is called unconditionally on every retry regardless of fence outcome (idempotent by design via deterministic `runId`) — a retry of an already-admitted run must NOT require a fresh ACTIVE admission (approved design §O-3's "achado novo real sobre retry", never fully resolved) | Existing tests only |
| `start-ocr.ts` Textract admission | `extraction/application/start-ocr.ts` (via `TenantQuotaService.consume(..., AI_CALL, ...TEXTRACT)`) | **Indirectly fenced THIS SESSION** — inherits the quota fence transitively, since `consume()` is now transacted | **Fenced via TenantBusinessMutation (indirect, via quota migration)** | `clientRequestToken` deterministic — Textract API itself is idempotent regardless of fence outcome | `test/unit/extraction/start-ocr.test.ts` (updated this session for the new `TenantQuotaService` constructor signature + lifecycle seeding; no NEW adversarial DELETING test added at this call site specifically — the underlying quota fence IS exercised, but not end-to-end through `startOcr()`) |
| `run-bedrock-extraction.ts` Bedrock admission | `extraction/application/run-bedrock-extraction.ts` (via `TenantQuotaService.consume(..., AI_CALL, ...BEDROCK)`) | **Indirectly fenced THIS SESSION** — same as above | **Fenced via TenantBusinessMutation (indirect, via quota migration)** | No idempotency key for Bedrock itself (confirmed gap, pre-existing, out of W3-07 scope per design doc §D) | `test/unit/extraction/run-bedrock-extraction.test.ts` (updated this session; no end-to-end adversarial test through `runBedrockExtraction()` itself) |
| `completeOcr` / S3 OCR artifact write | `extraction/application/complete-ocr.ts` + `extraction/persistence/s3-ocr-artifact-store.ts` | N/A — S3 `PutObject`, no DynamoDB transaction | **NOT FENCED (by design)** — approved design's explicit position: never gate immediately before `PutObject`; rely on purge + reverification instead | Accepted: an artifact write started while ACTIVE may complete after DELETING; not itself a "business mutation" in the DynamoDB sense | N/A (design decision, not a code gap) |
| `run-extraction-validation.ts` `commitOrDiscard` (`PERSIST_EXTRACTED_FIELDS`/`MARK_PENDING_CONFIRMATION`) | `extraction/application/run-extraction-validation.ts` | Yes — `transactWrite` | **NOT FENCED** — this is the REAL business-mutation admission point for extraction results (not `completeOcr`, which only writes a transient artifact) | N/A | Existing tests only |
| Evidence mutations (`uploadEvidence`/`malwareEvidence`/`SCANNING`) | `document/application/*` (`advance-after-evidence.ts`, `advance-after-submission-evidence.ts`) + 4 workers: `upload-finalizer/finalizer.ts`, `submission-finalizer/finalizer.ts`, `malware-result/result-processor.ts`, `submission-malware-result/result-processor.ts` | Yes — each has its own `transactWrite`, routed through `tryTenantBusinessMutation` since chunk 6/N | **Fenced via TenantBusinessMutation (chunk 6/N, D-070)** — corrected 2026-08-29 review pass: this row was stale (still said NOT FENCED after the migration landed). Round F's finding (evidence mutations ARE themselves `TenantBusinessMutation`-shaped, not just the final `CLEAN` transition) was closed by fencing REJECT and PROMOTE both, not only the terminal state | S3 copy to `clean` bucket happens BEFORE the DynamoDB commit — on a `TENANT_NOT_ACTIVE` rejection specifically, the just-copied object is compensated (deleted) immediately, closing the Round F/G orphan finding for that case. 2026-08-29 Codex round-1 review found this compensation was previously ONLY wired for the `TENANT_NOT_ACTIVE` outcome, not for an ordinary OCC-losing retry or a copy-verification failure — both now ALSO compensate their own copied version (fixed this session, see decisions-log). The residual post-final-purge-scan late-copy race (an admission from before `DELETING` that only writes its S3 object after the purge's authoritative re-scan) remains open, covered by the permanent post-`DELETED` sweeper (future work, not yet implemented) | `test/unit/document/advance-after-evidence.test.ts`, `test/unit/subject/submission-finalizer.test.ts`/`submission-malware-result.test.ts` — ACTIVE/DELETING pairs per admission point + orphan-compensation tests for TENANT_NOT_ACTIVE, OCC conflict, and verification failure |
| Import job admission (`ImportService.reserveImport`) | `import/application/import-service.ts` | Yes — `transactWrite`, routed through `executeTenantBusinessMutation` since chunk 8/N | **Fenced via TenantBusinessMutation (chunk 8/N, D-070)** — corrected 2026-08-29 review pass: this row was stale (still said NOT FENCED after the migration landed; see the S3 presigned upload issuance row below, which already documented the same migration correctly) | N/A | `test/unit/import/import-service.test.ts` — ACTIVE control case + DELETING adversarial test |
| Import parse/commit (`parseImportJob`) | `import/application/import-parse-service.ts`, `import/application/import-commit-service.ts` | Yes — `transactWrite` (commit path) | **NOT FENCED** (parse path indirectly touches quota via `IMPORT_ROWS`/`IMPORT_BYTES`, now transitively fenced) | N/A | Existing tests only (updated this session for quota signature) |
| Reminder producer/dispatch/materialization | `reminder/application/reminder-materializer.ts`, `workers/reminder-producer/*`, `workers/reminder-dispatch/*` | Yes — `transactWrite` | **NOT FENCED** | Scheduled, system-triggered rather than tenant-request-triggered — lower priority per approved design (system-owned cadence, not a new tenant admission in the DSR sense) | Existing tests only |
| Outbox relay (`tryAcquireLease`/`markPublished`) | `shared/outbox/persistence/dynamodb-outbox-relay-store.ts` | No — single-item `UpdateCommand`, outside `occ.ts` builders entirely | **Classified as SYSTEM housekeeping, not a business mutation** — approved design (§O-2/§L) treats this as a candidate for the `SystemMutation` lane's `OUTBOX_BOOKKEEPING` member (reserved, unimplemented — see `system-mutation.ts`) | N/A | Existing tests only |
| BFF session writes | `bff/persistence/dynamodb-session-store.ts` | Yes — own table (`bff-session-table`), separate physical table from the main single-table design | **NOT FENCED — structurally out of reach of the current fence** (the fence's `ConditionCheck` targets `TenantLifecycleRecord` in the MAIN table; a cross-table transaction against `bff-session-table` was never attempted, would require a Global Table or two-phase pattern) | N/A | Existing tests only |
| S3 presigned upload issuance | `document/application/document-service.ts` `reserveUpload()` (600s TTL, confirmed against code), `import/application/import-service.ts` `reserveImport()` (900s TTL = 15*60, confirmed against code), `subject/application/guest-submission-service.ts` `startSubmission()` (600s TTL, confirmed) | **Real DynamoDB writes exist at issuance time on the NEW-reservation path in 2 of the 3 call sites** — `document-service.ts` already had its own `transactWrite` (Document+UploadSlot Put), `import-service.ts` had a bare unfenced `putIfAbsent` (ImportJob Put); `guest-submission-service.ts` covered separately above | **Fenced via TenantBusinessMutation (THIS SESSION, chunk 8/N)**, for `document-service.ts` and `import-service.ts` — deviates from the design doc's original "read-then-check before presign, don't force through a transaction" framing: real code inspection found each of these two already has (or, for import, was trivially convertible to) its own tenant-scoped DynamoDB write immediately before the presign call, so fencing THAT write via `executeTenantBusinessMutation` (same established pattern as every other writer) is strictly more correct than a separate unfenced read-check bolted on right before `presignUpload()` — it closes an actual writer-inventory gap (the Document/UploadSlot/ImportJob creation itself was never fenced) AND blocks new presign issuance as a direct consequence, atomically, with no separate TOCTOU window. Idempotent retries (`COMPLETED_SAME_REQUEST` branch, no new write) are NOT re-fenced and may still re-presign, per the established "admitted while ACTIVE may finish" contract. The **residual TTL-window risk remains accepted and unchanged** for all 3 call sites: a URL issued on the ACQUIRED/new-admission path a moment before the fence would have rejected it is impossible now (same transaction), but a URL already issued before DELETING started remains usable until its TTL regardless — this session does not (and per the design doc, should not) attempt to revoke already-issued capabilities. | A URL issued while ACTIVE remains usable until its TTL even after DELETING starts; the resulting object is quarantined/evidence-only until the (fenced) promotion step admits it | Yes — `test/unit/document/document-service.test.ts` and `test/unit/import/import-service.test.ts`, both with ACTIVE control case + DELETING adversarial test proving the fence blocks the write (and therefore the presign) with no row left behind. `test/unit/import/in-memory-store.ts`'s fake previously silently NO-OPed on `ConditionCheck` entries (a fence added there would have gone completely untested) — extended to evaluate them with the same `CancellationReasons` convention as the other module fakes, same fix `document-service.ts`'s handler test needed for the resolver-bootstrapped tenantId to reach the (separate, in-memory) `DocumentStore`/`ImportStore` fakes. |

## Fence status legend

- **Fenced via TenantBusinessMutation** — the writer's own `TransactWriteItems` call includes the
  `TenantLifecycleRecord.status = ACTIVE` `ConditionCheck`, via `executeTenantBusinessMutation`.
- **Fenced via TenantBusinessMutation (indirect)** — the writer does not build its own fenced
  transaction, but its actual admission gate (`TenantQuotaService.consume()`) is now fenced, so a
  `DELETING` tenant cannot reach the writer's external-effect call in the first place. Not
  equivalent to fencing the writer's own transaction directly — if `consume()` is ever bypassed or
  the quota check removed for a given call site, the indirect protection disappears with it.
- **Fenced via SystemMutation** — none yet; `PURGE_DELETE`/`OUTBOX_BOOKKEEPING` remain reserved,
  unimplemented allowlist members (`src/shared/tenant-lifecycle/system-mutation.ts`).
- **NOT FENCED** — no lifecycle check anywhere in the write path today.
- **NOT FENCED (by design)** — a deliberate, documented architectural decision that this
  particular point should never be fenced directly (S3 issuance, `completeOcr`'s `PutObject`),
  per the approved design's "cancellation, not recovery" + "quiescence via incapacity, not
  absence" model (§F/§J of the design doc).

## What this session changed vs. what remains exactly as D-069 left it

**Migrated this session (chunk 4/N)**: `TenantQuotaService.consume()` — both its create path
(`putIfAbsent` → transacted `Put` with `attribute_not_exists`) and its update path
(`updateConditional` → transacted `Put` with the same count/resetAt equality condition the
production adapter already used, ported through a new `occ.ts` builder, `buildConditionalPut`,
rather than a hand-written `ConditionExpression`). This is the single highest-value target named
by `NEXT_SESSION_PROMPT.md` and Round E of the approved design: it is the actual admission point
gating every real paid Textract (`start-ocr.ts`) and Bedrock (`run-bedrock-extraction.ts`) call,
and (new discovery this session, not previously named) the generic `API_REQUEST` quota check that
runs ahead of `authorize()` on most HTTP handlers — meaning the fence's blast radius on THIS single
writer was already the widest of any candidate migrated so far (8 test files needed
`TenantLifecycleRecord` seeding to keep passing, more than `ItemWatchService.removeWatcher`
touched in D-068).

**A real gap closed as a byproduct**: `executeTenantBusinessMutation` (the `TenantBusinessMutation`
lane) previously could not distinguish "the lifecycle fence failed" from "the caller's own
transaction entry lost an ordinary OCC race" — both collapsed into `TenantNotActiveError` because
the lane never inspected `TransactWriteItems`' `CancellationReasons`. This was a documented gap
since D-068 (`tenant-business-mutation.ts`'s own file header called it out as deferred). It had no
observable effect on `ItemWatchService.removeWatcher` (a single-attempt write with no caller-side
retry loop), but it silently broke `TenantQuotaService.consume()`'s 20-attempt contention retry
loop — every concurrent OCC conflict on the quota row was misclassified as "tenant not active" and
never retried, which a concurrency test (`does not lose updates under concurrent consume()`)
caught immediately (25 concurrent callers all succeeded instead of exactly `limit` — the fence
silently disabled the retry it was supposed to leave alone). Fixed by threading
`CancellationReasons` through: the fence is always the LAST entry in the transaction, so its index
is `input.entries.length`; only a `ConditionalCheckFailed` at that specific index now converts to
`TenantNotActiveError`, any other index's failure re-throws the original error unchanged for the
caller's own OCC handling. The in-memory `IdentityStore` test fake
(`test/unit/identity/in-memory-store.ts`) was extended to populate `CancellationReasons` on every
`TransactionCanceledException` it throws, mirroring real DynamoDB's actual behavior, so this path
is exercised by tests rather than only reasoned about.

**Not migrated this session, explicitly deferred** (unchanged from D-069's list except where
noted): `ExpirationService.commit()` (still the largest blast-radius target, ~600 existing tests),
`GuestSubmissionService`, the email delivery `SUBMITTING` claim (SES — D-067's policy is decided,
the code-level fence at that exact transition is not yet implemented), `ExtractionRunStore.putIfAbsent()`
(attempted analysis this session — see "Why `ExtractionRun` admission was not migrated" below —
found genuinely non-trivial, correctly deferred rather than rushed per this session's explicit
scope guidance), the 4 evidence-mutation workers + their S3-copy-before-commit ordering issue, the
outbox relay's `SystemMutation` classification, BFF session table (structurally out of reach of
the current single-table fence), `PURGE_DELETE`/`OUTBOX_BOOKKEEPING` real implementations.

## Why `ExtractionRun` admission was not migrated this session

The approved design (§O-3, "achado novo real sobre retry") identified a real unresolved
requirement before `ExtractionRunStore.putIfAbsent()` can be safely fenced: `start-extraction-run.ts`
calls `StartExecution` unconditionally on every retry of an already-admitted run (this is CORRECT
existing behavior — Step Functions' own `ExecutionAlreadyExists` idempotency, keyed on the
deterministic `runId`, is what makes retries safe today). A naive fence — requiring a fresh ACTIVE
admission transaction on every `putIfAbsent()` call including retries of an existing run — would
either (a) block a legitimate retry of a run admitted while ACTIVE, once the tenant enters
DELETING, which the approved design's own concurrency contract ("operations already admitted
atomically before the transition may finish") says should be ALLOWED to proceed to `StartExecution`
still, or (b) require distinguishing "this is a fresh admission" from "this is a retry of an
existing admitted row" inside the same fenced transaction, which needs either a version check
against the existing row (only correct if the row already exists — `putIfAbsent` by definition runs
when it doesn't) or a read-before-write that reintroduces the exact TOCTOU gap the fence exists to
close. This is a genuine design question, not a rushed implementation gap — attempting it without
resolving the retry-vs-fresh-admission distinction first would risk exactly the "claim+outcome"
complexity spiral the approved design was chosen specifically to avoid (§B of the design doc). Per
this session's explicit scope guidance ("if you start it, keep it strictly additive... don't
attempt the full cutover"), this was correctly left for a dedicated follow-up rather than a partial,
possibly-incorrect fence.

## Recommended next chunk

In priority order: (1) the email delivery `SUBMITTING` claim (D-067's policy is already decided,
the code change is a single-entry transaction conversion following the exact pattern
`quota.consume()` just established — likely the next-lowest-effort, highest-value target); (2) the
4 evidence-mutation workers plus the `clean`-object-before-commit ordering fix (Round F's specific
finding, has a proposed compensation mechanism already designed via `CancellationReasons`, not yet
implemented); (3) resolve the `ExtractionRun` retry-vs-fresh-admission question as a short design
note before attempting the fence; (4) `ExpirationService.commit()` only after a plan for seeding
~600 existing tests' lifecycle records exists (likely a shared test helper/fixture, not one-by-one
edits as this session did for quota's 8 files).

## `ExpirationService.commit()` migrated (chunk 9/N, this session, D-070 continuation)

Contrary to the ~600-test worst case named above and in every prior session's deferral note, the
actual blast radius was far smaller in practice: `commit()` is a single private method every one
of the 5 public mutations (`createItem`/`updateItem`/`archiveItem`/`deleteItem`/`renewItem`)
already funneled through, so fencing it once fenced all 5 at once, and only 3 test files needed
`TenantLifecycleRecord` seeding to stay green — `test/unit/expiration/expiration-service.test.ts`,
`test/unit/reminder/reminder-materialization-trigger.test.ts` (its `MirroredExpirationStore`
fixture needed seeding through `expirationStore.putIfAbsent()`, not `store.putIfAbsent()` directly
— its override writes to both the mirror AND its own inherited internal map, and only the former
was reachable from the mirror alone), and `test/integration/expiration-lifecycle.test.ts` (same
resolver-bootstrap-vs-separate-store-fake gap already fixed for
`document-handlers.test.ts`/`import-handlers.test.ts` in chunk 8/N — pre-resolve real users to
learn their bootstrapped tenantId, then mirror the record into `expirationStore` directly). A
reusable `activeLifecycleRecord(tenantId)` helper + optional constructor seed array was added to
`test/unit/expiration/in-memory-store.ts`, mirroring the same helper document's in-memory-store.ts
already established, rather than duplicating an async per-file `seedLifecycle()` (the pattern
`item-watch-service.test.ts` used before this session).

**Real gap found and fixed as a byproduct**: `test/unit/expiration/in-memory-store.ts`'s
`transactWrite` fake threw fail-fast with no `CancellationReasons` populated at all (unlike
`test/unit/identity/in-memory-store.ts`, already fixed for this in D-070's quota migration). Once
the fence was wired in, `tenant-business-mutation.ts`'s `!reasons` branch treats an absent
`CancellationReasons` as "the fence is what failed" unconditionally — meaning an ORDINARY OCC
conflict on the caller's own entry (e.g. `updateItem`'s stale `expectedVersion` guard, exercised by
a pre-existing test) would have been silently misclassified as `TenantNotActiveError` instead of
the expected `ConflictError`. Fixed with the same per-entry `CancellationReasons` array this
codebase's other fakes already use; a new adversarial test (`an ordinary OCC version conflict on
updateItem is still reported as ConflictError, not misclassified as TenantNotActiveError`) proves
the fix rather than just reasoning about it.

`ExpirationService.commit()` is no longer NOT FENCED in this inventory — see its updated row above.
1011 backend tests passing (was 1006), typecheck/lint/check-boundaries/check-docs clean, zero
regression.

## Codex round-1 adversarial review of the accumulated implementation (2026-08-29)

First Codex review of everything built across chunks 2/N-9/N (D-068 through D-071) — see
`decisions-log.md`'s entry for this session for the full record. Overall verdict: **5.0/10**
against the same real code this file describes. Real findings fixed this session (see git log,
commits after `97c5652`): bootstrap-identity.ts's `ensureProfile()` TOCTOU (profile creation is
now itself a `TenantBusinessMutation`, not a bare `putIfAbsent` following a stale lifecycle read);
`system-mutation.ts`'s BLOCKED/HELD resume trusting the caller-supplied `blockedFrom` instead of
the record's actual stored value (closed with an `extraCondition` on the stored attribute); the
evidence-worker clean-object compensation only firing on `TENANT_NOT_ACTIVE`, never on an ordinary
OCC-losing retry or a copy-verification failure, against a bucket confirmed versioned by
`infra/modules/document-buckets/main.tf` (both call sites now compensate on every non-committed
outcome); this file's own staleness for the SES/evidence-worker/import-reservation rows (fixed
above).

**Findings NOT fixed this session, deliberately deferred** (real, but lower severity or larger
scope than the session's remaining budget):

- Several writers this file already, accurately, lists as NOT FENCED (`ItemWatchService.addWatcher`/
  `reactivate`, `document-request-service.ts`, `subject-service.ts`, `run-extraction-validation.ts`'s
  `commitOrDiscard`, import parse/commit) were re-flagged by Codex as a "blocking" finding. These are
  NOT new discoveries — they were already known, already-scoped-out-of-this-session pending work,
  visible in this same table before the review. Recorded here as confirmed-still-open, not silently
  dismissed: real gaps, correctly out of scope for a single review-and-fix pass, tracked as the
  ongoing "Recommended next chunk" backlog above.
- The `no-raw-dynamodb-writes-outside-lanes` dependency-cruiser rule (and this file's/`system-mutation.ts`'s
  header comments) overstate what it proves: it blocks a DIRECT `@aws-sdk/lib-dynamodb` import outside
  the allowed directories, but does NOT prove every `store.transactWrite(entries)` call from
  application code is routed through `TenantBusinessMutation`/`SystemMutation` — a store port method
  is generically callable and nothing currently stops an application-layer writer from calling
  `store.transactWrite([...])` directly with its own entries, unfenced. All CURRENT call sites do go
  through the lane (verified by this session's file-by-file review), but the structural guarantee
  claimed in `system-mutation.ts`'s file header ("a business module cannot construct its own
  TransactWriteItems and route around this lane") is stronger than what is actually enforced. Real
  closure requires either narrowing `IdentityStore`/`DocumentStore`/etc.'s public surface (no longer
  exposing a generic `transactWrite` to application code) or an architecture test asserting no
  application-layer file calls `store.transactWrite` directly — deferred, Type 1/architectural,
  larger than a single-session fix.
- `TenantBusinessMutation`'s lane (`tenant-business-mutation.ts`) accepts an arbitrary
  `TransactWriteEntry[]` alongside an independently-supplied `tenantId` with no verification that the
  entries actually belong to that tenant — every real call site today passes the matching tenantId,
  but the lane's own API does not prove it. Deferred — would need tenant-branded builders or an
  entry-inspection step, a larger refactor than this session's budget.
- `advance-after-evidence.ts`'s slot-consumption/quota/idempotency writes still commit outside the
  single fenced transaction in a few call paths (`import-service.ts`'s `idempotency.begin()` before
  the fenced `ImportJob` create, and its two separate quota reservations) — partial-admission risk on
  a mid-sequence failure, not a fence bypass. Deferred, same class of risk `TenantQuotaService.release()`
  already accepts by design for compensating an admitted-while-ACTIVE reservation.
- `tenant-business-mutation.ts`'s `!reasons` branch (absent `CancellationReasons` treated as "the
  fence is what failed") is defensively conservative rather than provably correct for every possible
  adapter behavior — real AWS DynamoDB always populates `CancellationReasons` on
  `TransactionCanceledException` (confirmed against the SDK/API docs during the original design
  review), so this only matters for a hypothetically broken/stripped adapter, but the code does not
  distinguish "indeterminate" from "fence failed" if that ever happens. Deferred as low real-world risk
  given the production adapter's actual behavior.

None of the deferred items are silently dropped — see `decisions-log.md`'s entry for this session
for the same list with the review's severity framing preserved.

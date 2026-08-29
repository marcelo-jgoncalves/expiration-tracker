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
| `ExpirationService.commit()` (backs `createItem`/`updateItem`/`archiveItem`/`renewItem`) | `expiration/application/expiration-service.ts` | Yes — shared `transactWrite` | **NOT FENCED** (D-068's largest deferred item — ~600 existing tests would need lifecycle seeding) | N/A | Existing (pre-fence) tests only |
| `GuestSubmissionService.startSubmission()` | `subject/application/guest-submission-service.ts` | Yes — own `transactWrite`, never passes through `RequestContext`/Cognito | **NOT FENCED** | N/A (synchronous write) but this is a public unauthenticated write surface — highest-value target for a future chunk since it bypasses the normal HTTP resolver entirely | Existing (pre-fence) tests only |
| `DocumentRequest`/`RequirementAssignment` submission writers | `subject/application/document-request-service.ts`, `subject/application/subject-service.ts` | Yes — `transactWrite` | **NOT FENCED** | N/A | Existing tests only |
| Email delivery claim (`SUBMITTING` transition) | `notification/application/email-delivery-workflow.ts:113` (`tryConditionalUpdate` → `buildVersionedUpdate`, single-item conditional Update, NOT a transaction) | No — single-item conditional `Update` | **NOT FENCED** — per D-067 (SES post-DELETING policy, Option 1 chosen: "block at admission, already-admitted sends may resolve"), Round E of the design doc proposed anchoring the fence to exactly this `SUBMITTING` transition, but the code-level migration was never done | An SES send already admitted (SUBMITTING claimed) before DELETING may complete normally after DELETING starts — accepted risk per D-067, not yet enforced structurally at the admission point itself | Existing tests only; no adversarial ACTIVE/DELETING test exists yet |
| `ExtractionRunStore.putIfAbsent()` (run admission) | `extraction/persistence/dynamodb-extraction-run-store.ts`, called from `extraction/application/start-extraction-run.ts` | No — single-item `putIfAbsent`, not a transaction | **NOT FENCED** | `StartExecution` is called unconditionally on every retry regardless of fence outcome (idempotent by design via deterministic `runId`) — a retry of an already-admitted run must NOT require a fresh ACTIVE admission (approved design §O-3's "achado novo real sobre retry", never fully resolved) | Existing tests only |
| `start-ocr.ts` Textract admission | `extraction/application/start-ocr.ts` (via `TenantQuotaService.consume(..., AI_CALL, ...TEXTRACT)`) | **Indirectly fenced THIS SESSION** — inherits the quota fence transitively, since `consume()` is now transacted | **Fenced via TenantBusinessMutation (indirect, via quota migration)** | `clientRequestToken` deterministic — Textract API itself is idempotent regardless of fence outcome | `test/unit/extraction/start-ocr.test.ts` (updated this session for the new `TenantQuotaService` constructor signature + lifecycle seeding; no NEW adversarial DELETING test added at this call site specifically — the underlying quota fence IS exercised, but not end-to-end through `startOcr()`) |
| `run-bedrock-extraction.ts` Bedrock admission | `extraction/application/run-bedrock-extraction.ts` (via `TenantQuotaService.consume(..., AI_CALL, ...BEDROCK)`) | **Indirectly fenced THIS SESSION** — same as above | **Fenced via TenantBusinessMutation (indirect, via quota migration)** | No idempotency key for Bedrock itself (confirmed gap, pre-existing, out of W3-07 scope per design doc §D) | `test/unit/extraction/run-bedrock-extraction.test.ts` (updated this session; no end-to-end adversarial test through `runBedrockExtraction()` itself) |
| `completeOcr` / S3 OCR artifact write | `extraction/application/complete-ocr.ts` + `extraction/persistence/s3-ocr-artifact-store.ts` | N/A — S3 `PutObject`, no DynamoDB transaction | **NOT FENCED (by design)** — approved design's explicit position: never gate immediately before `PutObject`; rely on purge + reverification instead | Accepted: an artifact write started while ACTIVE may complete after DELETING; not itself a "business mutation" in the DynamoDB sense | N/A (design decision, not a code gap) |
| `run-extraction-validation.ts` `commitOrDiscard` (`PERSIST_EXTRACTED_FIELDS`/`MARK_PENDING_CONFIRMATION`) | `extraction/application/run-extraction-validation.ts` | Yes — `transactWrite` | **NOT FENCED** — this is the REAL business-mutation admission point for extraction results (not `completeOcr`, which only writes a transient artifact) | N/A | Existing tests only |
| Evidence mutations (`uploadEvidence`/`malwareEvidence`/`SCANNING`) | `document/application/*` (`advance-after-evidence.ts`, `advance-after-submission-evidence.ts`) + 4 workers: `upload-finalizer/finalizer.ts`, `submission-finalizer/finalizer.ts`, `malware-result/result-processor.ts`, `submission-malware-result/result-processor.ts` | Yes — each has its own `transactWrite` | **NOT FENCED** — Round F of the design doc found these ARE themselves `TenantBusinessMutation`-shaped writers requiring the `ConditionCheck`, not just the final `CLEAN` transition | S3 copy to `clean` bucket happens BEFORE the DynamoDB commit in `advance-after-evidence.ts` — a `DELETING` race between copy and commit can leave an orphaned `clean` S3 object with no `Document` row (Round F finding, compensation via `TransactWriteItems.CancellationReasons` proposed, not implemented) | Existing tests only |
| Import job admission (`ImportService.reserveImport`) | `import/application/import-service.ts` | Yes — `transactWrite` | **NOT FENCED** | N/A | Existing tests only (this session: updated for new `TenantQuotaService` signature + lifecycle seeding, since `reserveImport` also calls `quota.consume()` transitively) |
| Import parse/commit (`parseImportJob`) | `import/application/import-parse-service.ts`, `import/application/import-commit-service.ts` | Yes — `transactWrite` (commit path) | **NOT FENCED** (parse path indirectly touches quota via `IMPORT_ROWS`/`IMPORT_BYTES`, now transitively fenced) | N/A | Existing tests only (updated this session for quota signature) |
| Reminder producer/dispatch/materialization | `reminder/application/reminder-materializer.ts`, `workers/reminder-producer/*`, `workers/reminder-dispatch/*` | Yes — `transactWrite` | **NOT FENCED** | Scheduled, system-triggered rather than tenant-request-triggered — lower priority per approved design (system-owned cadence, not a new tenant admission in the DSR sense) | Existing tests only |
| Outbox relay (`tryAcquireLease`/`markPublished`) | `shared/outbox/persistence/dynamodb-outbox-relay-store.ts` | No — single-item `UpdateCommand`, outside `occ.ts` builders entirely | **Classified as SYSTEM housekeeping, not a business mutation** — approved design (§O-2/§L) treats this as a candidate for the `SystemMutation` lane's `OUTBOX_BOOKKEEPING` member (reserved, unimplemented — see `system-mutation.ts`) | N/A | Existing tests only |
| BFF session writes | `bff/persistence/dynamodb-session-store.ts` | Yes — own table (`bff-session-table`), separate physical table from the main single-table design | **NOT FENCED — structurally out of reach of the current fence** (the fence's `ConditionCheck` targets `TenantLifecycleRecord` in the MAIN table; a cross-table transaction against `bff-session-table` was never attempted, would require a Global Table or two-phase pattern) | N/A | Existing tests only |
| S3 presigned upload issuance | `document/application/document-service.ts` (600s TTL), `import/application/import-service.ts` (900s TTL), `subject/application/guest-submission-service.ts` (600s TTL) | N/A — no DynamoDB write at issuance time, only a signed URL | **NOT FENCED (by design)** — approved design's position: fence the PROMOTION of an upload to business state (the evidence-mutation writers above), not the URL issuance itself; TTL bound (max 900s + margin) is the accepted risk window | A URL issued while ACTIVE remains usable until its TTL even after DELETING starts; the resulting object is quarantined/evidence-only until the (fenced, once implemented) promotion step admits it | N/A (design decision) |

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

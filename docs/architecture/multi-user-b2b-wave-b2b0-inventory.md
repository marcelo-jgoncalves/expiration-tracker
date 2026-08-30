# Multi-User B2B — Wave B2B-0 inventory (Current Truth + Inventory)

Status: **Read-only inventory, complete** — required first step of `roadmap-evolution/17-multi-user-b2b-revised-strategy.md` §105 before any Wave B2B-1 design work or code change. Built from direct `grep`/`Read` of the real repository this session (4 parallel read-only passes covering the dimensions §105 lists), not from re-reading the roadmap document's own claims. Every claim below is verified against real code with `file:line` citations; where the roadmap document's assumption about current state diverged from what the code actually does, that is called out explicitly rather than silently corrected.

Companion to `NEXT_SESSION_PROMPT.md` (Multi-User B2B section) and `roadmap-evolution/17-multi-user-b2b-revised-strategy.md` §125.6 (which explicitly required this inventory instead of an informal estimate).

## 1. `tenantId = userId` in production code

Exactly 3 named points from §125.6 are confirmed, but they are **not homogeneous** — 2 true origins and 1 consumer:

| File:line | Role | Note |
|---|---|---|
| `src/modules/identity/application/bootstrap-identity.ts:166-199` (`TenantBootstrapService.createAll`) | **Origin 1** — `newUserId` assigned directly as `tenantId` for `IdentityMapping`, `TenantLifecycleRecord`, and `UserProfile`, atomically via `executeTenantBusinessMutation`. Direct-API/JWT login path. | Confirmed. |
| `src/modules/bff/application/bff-auth-service.ts:158-172` | **Origin 2** — `newUserId()` generated once, passed as both `userId` and `tenantId` to `identityMappings.findOrCreate(...)`. BFF OIDC callback login path. | Confirmed. See finding 1.1 below — this path is not equivalent to Origin 1. |
| `src/modules/notification/ports/recipient-resolver.ts:3-4,29` (`resolveCandidateUserId`) | **Consumer, not origin** — `candidateUserId = assigneeUserId ?? tenantId`, i.e. falls back to treating the tenant identifier as a user identifier. | Confirmed; already documented in-file as a fallback distinct from the other two. |

Ruled out as false positives: `schemas/events/domain-event-envelope.v1.json` (tenantId/userId are separate envelope fields, no equivalence assumed), `scripts/`, `infra/` — no hits.

### 1.1 Finding — BFF login path lacks the fencing the direct-API path already has (pre-existing, not introduced by this inventory)

`bootstrap-identity.ts`'s Origin 1 creates `IdentityMapping` + `TenantLifecycleRecord` + `UserProfile` atomically in one `TransactWriteItems`. `bff-auth-service.ts`'s Origin 2 does **not** create a `TenantLifecycleRecord` at all, and uses the older sequential `findOrCreate` → `createProfileIfAbsent` (unconditional put, no fencing) — the same shape of gap that `resolve-request-context.ts:56-58` documents in a comment as the "D-063 confirmed bug" already fixed for the direct-API path. This is a **real, pre-existing divergence between the two login flows**, independent of Multi-User B2B. Not fixed here (Wave B2B-0 is read-only); registered as a pending item in `NEXT_SESSION_PROMPT.md` "Gates / bloqueios abertos" for separate follow-up, and flagged for whoever designs Wave B2B-2 (Global Identity Foundation) since it touches the same bootstrap code paths.

### 1.2 Finding — in-code comments overstate homogeneity

`identity-mapping-repository.ts:36-39` and `resolve-request-context.ts:59-61` each contain a comment asserting the `tenantId=userId` equivalence is decided "in that one other place only" — both are stale/inaccurate now that there are 2 real origins, not 1. Narrative-only; no logic bug. Worth correcting when Wave B2B-2 touches these files, not urgent enough for a standalone chunk.

## 2. `IdentityMapping`, BFF session, `RequestContext`

### IdentityMapping

`src/modules/identity/persistence/identity-mapping-repository.ts:11-19`: `PK=IDENTITY#COGNITO#<sub>`, `SK=MAP`, and it embeds `tenantId: string` (line 17) directly alongside `userId: string` on the record — confirms `roadmap-evolution/17` §5 exactly. `findOrCreate(cognitoSub, newUserId, newTenantId)` (line 45) takes tenant and user as separate parameters, but every call site passes the same value for both (both origins above). No other production writers.

### BFF session

`src/modules/bff/domain/session.ts:13-44`: `PK=SESSION#<selectorHash>`, `SK=POINTER`, dedicated table (not the main single-table). **`tenantId: string` is a fixed field set once at session creation** (line 19) — there is no `activeOrganizationId`-style mutable selector and no switch/reselect operation today. This is the strongest confirmation of `roadmap-evolution/17` §11/§45's concern: the session record is genuinely tenant-owned, not "User + selected org." Creation: `bff-auth-service.ts:158-207` (sets `tenantId: mapping.tenantId`, fixed). Revocation (`logoutDevice`/`logoutAll`, lines 471/499) keys off `session.tenantId` + `session.userId`. No refresh-path mutation of `tenantId` found.

### RequestContext

`src/modules/identity/domain/request-context.ts:7-26`: `tenant: { tenantId, membershipId?, roles }` — **`membershipId` is already an optional field in the type**, unpopulated by any current code path (a small head start for Wave B2B-1, not a discrepancy in the doc). Resolver `RequestContextResolver.resolve()` (`resolve-request-context.ts:52-114`): `claims.sub → TenantBootstrapService.bootstrap() → {mapping, profile} → RequestContext`, with `mapping.tenantId` flowing straight through — no independent Organization/Membership lookup exists yet. 26 files consume `.tenant.tenantId` off a resolved `RequestContext` as authoritative for every downstream tenant-scoped read/write and authorization check; this is the fan-out surface Wave B2B-5 (RequestContext Cutover) will touch.

`roadmap-evolution/17` §5/§11/§14 all match current code exactly — no drift found on this dimension.

## 3. Tenant-scoped DynamoDB stores, S3, events/queues, W3-07

### 3.1 Tenant-scoped entities (all keyed `TENANT#<tenantId>#...` via a domain-level key builder)

`User` (`identity/persistence/user-repository.ts:52`, PK `TENANT#${tenantId}#USER#${userId}`; also a `SESSION#<deviceId>` SK at :56), `Document` (`document.ts:74`), `UploadSlot` (`upload-slot.ts:37`), `DocumentPurgeReceipt` (`document-purge-receipt.ts:32`), `ExpirationItem` + GSI1 status (`expiration-item.ts:41,47`), `AuditEvent` (month-sharded, `audit-event.ts:39`), `ItemWatch` (`item-watch.ts:24`, SK embeds `WATCH#USER#${userId}` inside the tenant partition — matches §7), `ExtractionRun`/`ExtractedField` (`extraction-run.ts:35`, `extracted-field.ts:52`), `Quota` (`quota.ts:38`), `ImportJob`/`ImportDedup` (`import-job.ts:69`, `import-dedup.ts:19`), `NotificationIntent` + outbox (`notification-intent.ts:61`, `outbox.ts:75`), `NotificationEntitlements`/`NotificationPreferences` (`notification-entitlements.ts:25`, `notification-preferences.ts:37`), `NotificationAttempt` + lookup (`notification-attempt.ts:77,100`), SES webhook dedup (`ses-callback-workflow.ts:56`), `ReminderOccurrence`/`ReminderPolicy`/`PolicyRef` (`reminder-occurrence.ts:44`, `reminder-policy.ts:51,64`), `TrackedSubject` + GSI7 status (`tracked-subject.ts:36,49`), `RequirementAssignment`/`DocumentRequest`/`DocumentSubmission`/`DocumentChasing` occurrence+intent (nested under `TENANT#..#SUBJECT#<id>`: `requirement-assignment.ts:51`, `document-request.ts:39`, `document-submission.ts:42`, `document-chasing.ts:51,122`), `Entitlement` (`entitlement.ts:34`), tenant `SETTINGS`/rate-limit rows (`document-request-delivery-preference.ts:31`, `initial-invite-rate-limiter.ts:48-50`), `Idempotency` records (`shared/idempotency/idempotency.ts:131`), `TenantLifecycleRecord` (`shared/tenant-lifecycle/tenant-lifecycle-record.ts:59`, PK `TENANT#${tenantId}#LIFECYCLE`).

Tenantless-by-design exceptions confirmed correct: `GuestTokenPointer`, session pointer, login-attempt keys use only a `selectorHash`, no tenant segment (`guest-token.ts:40`, `bff/domain/session.ts:46,77`) — matches §9/§45.

### 3.2 S3 — diverges from `roadmap-evolution/17` §68's blanket assumption

The doc assumes one uniform `tenant/<organizationId>/...` prefix. The real code has **three distinct conventions**:

- Quarantine bucket: `tenant/<tenantId>/item/<itemId>/document/<documentId>/slot/<uploadSlotId>/<random>` (`document/domain/quarantine-key.ts:3,15`).
- Clean bucket: shorter `clean/<tenantId>/<itemId>/<documentId>` (`document/domain/clean-key.ts:2,15`).
- OCR artifacts: `ocr/<tenantId>/...` (referenced in `purge-tenant.ts:39`; source `s3-ocr-artifact-store.ts`).

`purge-tenant.ts:36-129` already documents all three prefixes explicitly and hardens the purge-time prefix-vs-tenantId match (rejects substring/segment-ambiguity attacks). **Wave B2B-1's physical-model design must check its S3 assumptions against this file, not against §68 of the roadmap doc.**

### 3.3 Events/queues

`schemas/events/domain-event-envelope.v1.json` requires `tenantId` AND already has an optional `actor.userId` (`actor.type` enum `USER|SYSTEM`) — this is exactly the `actorUserId`-as-context pattern §50/§84 recommend, **already implemented**, not a gap. `schemas/queues/command-envelope.v1.json` and `reminder-materialization-trigger.v1.json` also declare `tenantId`. The five per-event-type payload schemas and most queue payload schemas carry no `tenantId`/`userId` of their own — they rely on the envelope. No schema anywhere uses `userId` as an implicit tenant identifier.

### 3.4 W3-07 core files

`src/shared/tenant-lifecycle/{tenant-lifecycle-record.ts, tenant-business-mutation.ts, system-mutation.ts}` and `src/workers/tenant-purge/{dynamo-tenant-purge.ts, purge-tenant.ts, session-table-tenant-purge.ts}`. `TenantBusinessMutation` fences every business writer's `TransactWriteItems` with a `ConditionCheck` against `TenantLifecycleRecord.status = ACTIVE`, cross-validated against both `Item.tenantId` and physical `PK`/`TableName`. `SystemMutation` is the purge-lane counterpart. An existing, actively-maintained writer inventory already covers this in full detail: `docs/architecture/w3-07-writer-inventory.md` — Wave B2B-9 (W3-07/Privacy Reconciliation) should extend that document rather than re-deriving it, per `roadmap-evolution/17` §125.4's "mantém/emenda/refaz" table (BFF session ownership is the one row there marked **refaz**, consistent with §2 above).

## 4. Frontend caches

Frontend exists at `frontend/` (Vite + React + `@tanstack/react-query`, `frontend/src/App.tsx:25`). Every `queryKey` found is resource-shaped with **no tenant/org dimension anywhere**:

- `frontend/src/routes/Overview.tsx:32` — `["items", "dashboard", "ACTIVE"]`
- `frontend/src/hooks/useItemsDashboard.ts:8`, `useItem.ts:8`, `useSubjectsDashboard.ts:8`, `useSubject.ts:8`, `useRequirementAssignments.ts:8`, `useDocumentSubmissions.ts:11` — same pattern, resource + params only.
- Invalidations in `useCreateItem.ts:16`, `useRenewItem.ts:19-20`, `useLinkExpirationItem.ts:20`, `useUnlinkExpirationItem.ts:15` match the same tenant-agnostic prefixes.

Searched the whole frontend for cache-clearing on logout/switch: the only `clear()` call found is a form-state clear unrelated to the query cache (`frontend/src/routes/items/CreateItem.tsx:86`). **No `queryClient.clear()`/`removeQueries()`/`resetQueries()` exists anywhere in the frontend today.** This confirms §35/§92's cache-leak concern is real and currently completely unmitigated — every tenant-scoped query key will need a tenant dimension added, and organization switching will need an explicit, currently-nonexistent cache-invalidation strategy. This is not a "nice to have" for Wave B2B-10 — it is a green-field requirement, not a modification of existing behavior.

## 5. Backend test suite — reproducible count (per §125.6)

Exact commands run from repo root:

```
find test -type f \( -iname "*.test.ts" -o -iname "*.spec.ts" \) | wc -l          → 122
grep -rEo "^\s*(it|test)\(" test --include=*.test.ts --include=*.spec.ts | wc -l  → 1092
grep -rEo "\b(it|test)\(" test --include=*.test.ts --include=*.spec.ts | wc -l    → 1092 (unanchored — confirms no undercount)
grep -rEo "^\s*describe\(" test --include=*.test.ts --include=*.spec.ts | wc -l   → 198
```

**122 test files, 1092 test cases, 198 `describe` blocks** — the reproducible number, replacing the informally-cited "~1104" that §125.6 flagged as unverifiable.

`tenantId=userId` literal-assignment fixture pattern:

```
grep -rEn "tenantId\s*[:=]\s*userId|tenantId\s*[:=]\s*.*[uU]serId|userId\s*[:=]\s*.*tenantId" test --include=*.ts | wc -l → 12 matches, 10 files
```

Files: `test/integration/reminder-engine.test.ts`, `test/integration/cross-tenant.test.ts`, `test/unit/bff/bff-handlers.test.ts`, `test/unit/bff/bff-auth-service.test.ts`, `test/unit/document/document-handlers.test.ts`, `test/unit/identity/authorization.test.ts`, `test/unit/identity/resolver.test.ts`, `test/unit/notification/notification-router-workflow.test.ts`, `test/unit/reminder/reconciliation.test.ts`, `test/unit/subject/document-request-initial-invite.test.ts`.

No shared fixture/factory/helper file exists for this pattern (`find test -iname "*helper*" -o -iname "*fixture*" -o -iname "*factory*"` → empty; no `make/create/build*Context/Auth/Tenant/User/Identity` helper functions found in `test/`). **Each of the 10 files constructs its own literal IDs inline — remediation for Wave B2B-2 onward is file-by-file, there is no single choke point to fix.**

**Known gap, not counted, flagged rather than guessed**: the 12/12 figure is a literal-textual-pattern count (direct `tenantId: userId` or the reverse assignment). It does **not** catch cases where both fields are set to the *same string value via two separate literals* (e.g. `tenantId: "u1"` and `userId: "u1"` on different lines) — that would require AST-level analysis, not attempted in this pass. Do not treat this as zero; treat it as unmeasured. Broader context for scale: 86 files reference `tenantId` at all, 34 of those also reference `userId`.

## 6. Summary for Wave B2B-1

Nothing found in this inventory blocks proceeding to Wave B2B-1 (Type 1 design round, Claude↔Codex). Three items the physical-model design round should explicitly account for, beyond what `roadmap-evolution/17` §60 already proposes:

1. S3 has 3 real prefix conventions, not 1 (§3.2 above) — the migration/cutover design (§62-68 of the roadmap doc) needs to address all three, and `purge-tenant.ts` needs to stay in sync with whichever survives.
2. The frontend cache-isolation requirement (§4 above) is green-field, not a modification — there is currently zero tenant awareness in any query key or invalidation path.
3. The BFF login path's missing fencing (§1.1 above) is a pre-existing, unrelated gap surfaced by this inventory — worth a decision on whether to fix it as part of Wave B2B-2 (same bootstrap code) or as a separate, smaller chunk first.

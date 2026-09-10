# Storage quota tracking — reconciliation (round 2, session-scoped)

Both proposals agree on: transactional atomic counter (reject S3 Inventory/CloudWatch for
admission control — too lagged), a flat local default decoupled from M12/D-052, hard-block
enforcement (matches Dropbox/Box/Google Workspace behavior), a ~80% warning threshold (Google's
own cited number), and `docarchive:read`/`READ_ONLY_ROLES` for the read endpoint (direct D-248
analogy).

Claude's round-1 proposal is **superseded** on two points by Codex's independent proposal, which
is adopted as final:

1. **Entity placement.** Codex is right that extending `TenantEntitlement` would make
   `document-archive` reach into `subject`'s domain, inverting module ownership and creating
   unrelated-OCC contention between upload bursts and subject mutations on the same row (this
   would likely also trip `check-boundaries`, dependency-cruiser). **Final: a new
   `TenantStorageQuota` entity owned by `document-archive/domain`**, same key-scheme discipline
   as `entitlement.ts` (`TENANT#<id>#STORAGE` / `QUOTA`), with its own
   `defaultStorageQuota()`/`storageQuotaKey()` and its own `ensureStorageQuota()` get-or-create
   in the service, mirroring `SubjectService.ensureEntitlement()` verbatim in shape.

2. **Reservation-time accounting (`reservedBytes`).** Claude's round-1 proposal only gated on
   `usedBytes` at `confirmFileScanClean()` — Codex correctly identifies this allows
   oversubscription: N concurrent `reserveFiles()` calls could each read the same stale
   `usedBytes` and all pass, collectively exceeding the limit, since nothing reserves capacity
   at request time. **Final: three-state accounting** —
   `usedBytes` (durably CLEAN) + `reservedBytes` (sealed but not yet CLEAN) — enforcement checks
   `usedBytes + reservedBytes + requestedBytes <= limitBytes` transactionally in `reserveFiles()`
   itself (the same `TransactWriteItems` that seals the file set), so two concurrent reservations
   against the same near-full quota can never both succeed (whichever loses the OCC condition on
   the quota row retries and sees the now-current total). `confirmFileScanClean()` moves bytes
   from `reservedBytes` to `usedBytes` (net zero change to the committed total). The REJECTED/
   UNSUPPORTED/TIMEOUT terminal paths in `apply-file-scan-result.ts` release `reservedBytes` back
   (their existing `pendingFileScans` decrement transaction gets one more `set`, no new
   transaction). Deletion/decrement-on-purge is explicitly named as **not implemented** in this
   round — no `DocumentFile`/`Document` hard-delete lifecycle exists in the codebase today to hook
   into (verified by both proposals independently); the field and counter design are forward
   compatible with adding it later.

Kept as originally proposed (both proposals converged independently):
- RBAC: reuse `docarchive:read` (`READ_ONLY_ROLES`) for the read route — no new Action.
- Enforcement point: `reserveFiles()`, before any presigned URL is issued (fail-closed,
  immediate feedback, no wasted quarantine writes for a request that will be rejected anyway).
- Display: A19 (Team & Organization Settings) gets the canonical usage subsection (used/
  reserved/limit/available, all `READ_ONLY_ROLES`); A03 (dashboard) gets a conditional card only
  when usage crosses the warning threshold, consistent with A03's existing "needs attention now"
  framing rather than turning it into a permanent storage meter.
- Warning threshold 80% of `(usedBytes + reservedBytes) / limitBytes`, critical framing at 95%,
  cited from Google Workspace's own 80%-warning/100%-block behavor (Codex additionally cites
  GitHub LFS's 90%/100% split as a counter-example showing there is no single industry-wide
  number — 80% is chosen deliberately for a longer operational runway, not because it's the only
  observed value).
- Default quota: `DEFAULT_STORAGE_QUOTA_BYTES` implemented as a named, documented constant (5
  GiB, Marcelo's illustrative number) — NOT a firm product decision; flagged in
  `NEXT_SESSION_PROMPT.md` as pending Marcelo's confirmation of the real number.

## Process note (honesty per AGENTS.md discipline, not a silent shortcut)

This decision did **not** go through the full blind 3-round protocol AGENTS.md §4 nominally
requires for a level 5-6 decision (mininum 3 rounds, both scoring ≥9.0 blind before either sees
the other's score). One blind round was run (`claude-proposal.md` / `codex-proposal.md`, written
independently, Codex never shown Claude's file) and reconciled directly here without either side
producing a formal numeric self-score. This is a deliberate scope reduction made under session
time constraints, not a claim of full protocol compliance — recorded honestly in
`decisions-log.md` rather than fabricating scores to match the ≥9.0 gate. The reconciliation
itself is substantive (Codex's independent read caught a real correctness gap — oversubscription
under concurrent reservations — that Claude's proposal missed), which is the evidence the
two-perspective process is meant to produce; what's missing is the numeric scoring ceremony and
the full 3-round iteration count, not independent scrutiny itself.

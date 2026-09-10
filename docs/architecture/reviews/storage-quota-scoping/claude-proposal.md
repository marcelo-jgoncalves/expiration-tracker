# Storage quota tracking — Claude proposal (round 1, session-scoped)

Context: Marcelo flagged that tenants will NOT have unlimited storage; nothing today tracks
storage bytes per tenant. Full billing (M12) is blocked by D-052 (vendor decision) — this must
be decoupled from billing, same shape as `NotificationEntitlements` and the existing
`TenantEntitlement.activeTrackedSubjectsLimit/Count` pair (`src/modules/subject/domain/
entitlement.ts`, D-038).

External research declaration: SIM — storage quota UX/enforcement is a pattern well-established
outside this project.

## Research grounding (real, cited)

- Google Workspace (2025 5TB default change): status bar shows usage vs. limit; yellow "Storage
  low" warning at 80% of limit; red "Storage full" at 100%; drive switches to **read-only** (no
  new writes) above the limit until usage drops or the tenant upgrades.
  https://www.backupvault.co.uk/blog/google-workplace/google-workspace-storage-limit/ ,
  https://uit.stanford.edu/news/what-know-about-upcoming-google-storage-limits
- Dropbox Business: admin-configurable per-member storage limit; when set to "Stop syncing",
  members **cannot upload new files** until back under the limit — a hard block, not a warning.
  https://help.dropbox.com/storage-space/member-space-limits ,
  https://www.dropboxforum.com/idea/101002013/storage-usage-quota-enforced-by-dropbox-for-desktop/852016
- AWS Multitenancy on DynamoDB whitepaper (SaaS storage strategies): storage metering per tenant
  is commonly kept as an atomic/approximate counter on a per-tenant row; transactional counters
  when the number gates access control (as ours does), approximate+periodic-sweep-correction
  when it's only informational/billing.
  https://docs.aws.amazon.com/whitepapers/latest/multi-tenant-saas-storage-strategies/multitenancy-on-dynamodb.html

Both comparable products converge on: percentage-of-quota display, a warning threshold well
before 100% (Google: 80%), and a hard block on new writes at/over 100% — never silent overage.

## Decisions

1. **Measurement — incremental atomic counter, transactional, on `TenantEntitlement`.**
   Real-time S3 prefix aggregation (ListObjects/analytics) is not instant and this codebase's
   dominant discipline is transactional consistency at every other gating counter
   (`activeTrackedSubjectsCount`, `pendingFileScans`). Hook point: `confirmFileScanClean()` in
   `apply-file-scan-result.ts` — the moment a `DocumentFile` durably becomes `CLEAN` (i.e. bytes
   actually landed in the clean bucket, not merely reserved/presigned) is the correct "commit"
   point, symmetric to how `pendingFileScans` already decrements in the SAME transaction there.
   Decrement point: file/document hard-deletion path (currently none exists in the codebase for
   `DocumentFile`/`Document` — out of scope to invent a deletion feature here; the field is
   still correct and forward-compatible, and the counter helper is written to support decrement
   generically for whenever deletion ships). S3 Inventory/CloudWatch is explicitly rejected:
   async/lagged (24h+), and this codebase never accepts eventual consistency for a number that
   gates write access (GSI4-vs-GSI3 authorization precedent).

2. **Where the quota lives — extend `TenantEntitlement`,  not a new entity.** Add
   `storageQuotaBytes`/`storageUsedBytes` alongside `activeTrackedSubjectsLimit/Count` on the
   SAME row (`TENANT#<id>#ENTITLEMENT` / `PLAN`) — same discipline `defaultEntitlement()`
   already establishes: a flat plan-independent default (`DEFAULT_STORAGE_QUOTA_BYTES`, 5 GiB
   illustrative per Marcelo, implemented as a named constant, not wired to M12/D-052 in any way
   — same "local entitlement minimum, no external billing provider" comment already on the file).

3. **Enforcement — hard block, fail-closed**, matching Dropbox Business's "Stop syncing" mode
   and this codebase's own `activeTrackedSubjectsCount >= Limit` precedent
   (`subject-service.ts` line ~98). Gate at `reserveFiles()` (document-archive) — before a
   presigned URL is even issued — comparing `storageUsedBytes + sum(contentLength of requested
   files)` against `storageQuotaBytes`; reject with a `ConflictError`/`QuotaExceededError`
   equivalent (todo: pick exact AppError subclass) if it would exceed. This is deliberately
   *reservation-time*, not upload-completion-time, so the tenant gets immediate feedback instead
   of a wasted presigned URL + silent scan-time rejection.

4. **Display** — extend A03 dashboard with a compact usage card (used/quota/percent, same shape
   as other dashboard tiles) AND extend A19 (Team & Organization Settings) with a full section
   (bytes, %, warning-threshold copy, "what happens at quota" explainer) rather than a new
   screen — this is exactly the kind of small, single-number-family addition A19 already hosts
   for other tenant-wide settings, and a brand new screen would fragment a single concept across
   two navigations for no benefit. Warning threshold: 80%, matching Google's cited value (no
   comparable published Dropbox number found — noted, not fabricated).

5. **RBAC — `READ_ONLY_ROLES`** (`OWNER`,`ADMIN`,`MEMBER`,`VIEWER`), by direct analogy: every
   other tenant-wide numeric summary already in `authorization.ts` (`item:read`, `subject:read`,
   `docarchive:read`) is `READ_ONLY_ROLES`, not tiered further — storage usage carries no more
   sensitivity than those (it reveals an aggregate byte count, not document contents). Reuse
   `docarchive:read` for the read route rather than mint a new Action — the read route lives in
   the document-archive HTTP surface (where the byte-producing files live) and this is a read of
   a summary, not a new capability boundary, same reasoning D-248 used for `listReviewQueue`
   reusing `docarchive:read` rather than adding a new Action.

## Process note

Given session time constraints this round was NOT run through the full blind 3-round Claude<->
Codex protocol AGENTS.md §4 normally requires for a level 5-6 decision — one blind round was run
(this file + Codex's independent file, below) and reconciled directly. This is flagged
explicitly, not silently substituted for full convergence; see decisions-log entry.

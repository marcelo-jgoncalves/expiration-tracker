# GTR-01 Supersession Scoping — Round 2 (Claude Proposal, revised)

Addresses all 4 Codex Round 1 findings (7.8/10).

## Fix 1 — `Organization.displayName` blank-string invariant

Confirmed real gap: `create-organization.ts:78` persists `input.displayName` with no
trim/non-empty check; `bff-handlers.ts:197-200` only checks truthiness (`!displayName`), which
passes for `"   "`. `UpdateOrganizationSettingsService` (`update-organization-settings.ts:43-45`)
**already** trims and rejects blank — the inconsistency is real and pre-existing, independent of
GTR-01. Fix (in scope for this change, since GTR-01 now depends on the invariant holding):
add the same `trim()` + `ValidationError` on blank to `CreateOrganizationService` before
persisting, and to the `bff-handlers.ts` request-body check. This closes the "always
present/trustworthy" claim for real rather than by assumption.

## Fix 2 — full removal inventory (superset of Round 1 + Codex's additions)

Code:
- `src/modules/identity/persistence/user-repository.ts` — field + `setRequesterDisplayName`.
- `src/modules/identity/application/profile-service.ts` — whole file (only method was this).
- `src/modules/identity/http/profile-handlers.ts` — whole file (`GET/PUT /profile`).
- `src/runtime/aws/handlers/profile-handler.ts` — whole file (Lambda handler).
- `src/runtime/aws/composition/identity.ts` — remove `ProfileService` wiring.
- `src/modules/identity/domain/authorization.ts` — remove `profile:update` action.
- `src/modules/bff/domain/proxy-allowlist.ts` — remove the 2 `/profile` entries.
- `src/runtime/aws/composition/subject.ts` — `resolveRequesterDisplayName()`: reimplement to
  read `Organization.displayName` by `tenantId` (rename to `resolveOrganizationDisplayName`
  for honesty — no `userId` param anymore).
- `src/workers/document-chasing-dispatch/dispatch.ts` — port renamed
  `resolveOrganizationDisplayName: (input: { tenantId: string }) => Promise<string | undefined>`
  (drop `userId` — Codex correctly flagged the silent-ignore smell).
- `src/modules/subject/application/guest-submission-service.ts` /
  `document-request-service.ts` — same port rename, same signature drop.
- `src/modules/notification/providers/email-templates.ts` — comment update only (source changes).

Infra:
- `infra/modules/api-gateway/main.tf` (`~line 430-462`, ProfileHandler resource block + routes).
- `infra/modules/api-gateway/variables.tf` (`~line 80`, invoke ARN var).
- `infra/modules/api-gateway/tests/api_gateway.tftest.hcl` (`~line 159-177`, `/profile` route assertions — update to assert the routes are GONE, not present).
- `infra/modules/security-audit-observability/tests/security_audit_observability.tftest.hcl` (`~line 18`, `exptrk-test-profile-handler` reference).
- `scripts/build-lambdas.ts:38` — CONFIRMED, `"profile-handler"` literal string in the bundle manifest array, remove it.
- `infra/main.tf` — CONFIRMED, root wiring passes the ProfileHandler Lambda's invoke ARN into the `api-gateway` module; remove the module call's argument and the `aws_lambda_function`/related resource block for `profile-handler`.
- `infra/tests/stack.tftest.hcl` — CONFIRMED, references profile-handler; update/remove the relevant assertion(s).

Tests:
- Delete: `test/unit/identity/profile-service.test.ts`, `test/unit/identity/profile-handlers.test.ts`.
- Rewrite (not delete): `test/unit/subject/guest-upload-flow.test.ts` (assertion at line ~91,
  resolver now returns org name), `test/unit/subject/document-request-initial-invite.test.ts`
  (line ~93, same), `test/unit/identity/resolver.test.ts` (line ~114 comment references
  `ProfileService.readOwnProfile()` — verify no longer accurate, update comment).

## Fix 3 — future personal-name addition stays out of scope, documented as deliberately deferred

Accept Codex's framing: if a future request surfaces "shown as a specific staff member, not the
org," it is a **request-time snapshot** field on `DocumentRequest`/`RequirementAssignment`
(captured once at creation, immutable per-request), never a standing per-user profile setting.
Not built now (no product signal for it) — named explicitly in the decision doc as the shape any
future addition should take, so it isn't re-litigated from scratch later.

## Fix 4 — safety to implement this session

With fixes 1-2 scoped exhaustively (file-by-file, not "the proposal's list plus etc."), this is
now a bounded, mechanical migration: delete 3 files, edit ~10 files (rename port, swap resolver
body, remove wiring/allowlist/action), edit 2 Terraform files + 2 test files, add 1 validation
fix to `create-organization.ts`/`bff-handlers.ts`. No new infrastructure, no new Lambda. Tractable
for direct implementation with full DoD (typecheck/lint/check-boundaries/test/validate-schemas +
`build:lambdas` + `terraform test`, since `infra/` is touched this time — unlike prior GTR-01-adjacent
waves).

## Research declaration (unchanged from Round 1)

`SIM PARCIAL` — stands, not revisited (Codex Round 1 raised no objection to the research
declaration itself, only to the design/removal-plan claims).

## Decision (unchanged: REPLACE)

`Organization.displayName` (now with the blank-string invariant enforced) becomes the sole
guest-facing requester identity. `UserProfile.requesterDisplayName` and everything downstream of
it removed per the inventory above. Future per-person addition, if ever requested, is an
additive request-time snapshot, not a resurrection of this field.

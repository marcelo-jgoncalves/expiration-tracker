# GTR-01 Supersession Scoping — Round 3 (Claude Proposal, final)

Addresses all 5 remaining Codex Round 2 gaps (grade 8.8/10).

## Blank-string invariant — corrected location

Validation moves into `CreateOrganizationService.buildCreateEntries()` itself (trim + throw
`ValidationError` on blank, before entries are constructed) — not just at the `createOrganization()`
public method or handler level. This covers `BffAuthService.createOrganization()`
(`bff-auth-service.ts:631`), which calls the service directly and would otherwise bypass a
handler-only check. `bff-handlers.ts:197-200` additionally trims before calling (defense in
depth at the HTTP boundary, consistent with how every other BFF handler in this codebase
normalizes input before calling the service), but the service itself is the authority.

## Removal inventory — closing the 5 gaps

1. `src/modules/identity/domain/authorization.ts:57` — remove `profile:read` action alongside
   `profile:update` (both existed solely for this feature).
2. `src/modules/identity/domain/authorization.ts:142` — remove/update the stale comment
   referencing `profile:update`.
3. `src/modules/identity/domain/authorization.ts:165` — remove the `profile:read` matrix entry.
4. `test/architecture/security-audit-observability-coverage.test.ts:35` — remove
   `profile-handlers.ts`/`profile_handler` from the architecture coverage inventory.
5. `test/unit/subject/document-chasing-dispatch.test.ts:152` — rename resolver fixture from
   `resolveRequesterDisplayName` to `resolveOrganizationDisplayName`, update its signature to
   `{ tenantId }`.
6. `test/unit/organization/create-organization.test.ts:22` — add mutation-resistant test:
   whitespace-only `displayName` (e.g. `"   "`) throws `ValidationError` via
   `buildCreateEntries()`; a padded valid name (`"  Empresa Alfa  "`) is trimmed before persist —
   named mutation: flip trim to no-op, test must fail.
7. `test/unit/bff/bff-handlers.test.ts` — add HTTP-boundary test: `POST /bff/organizations` with
   whitespace-only `displayName` returns the mapped 400/`ValidationError`.
8. `infra/main.tf:164` (Lambda module call, not a bare `aws_lambda_function` resource — correcting
   the Round 2 proposal's imprecise description) + dependent references at lines 373-374, 861-862,
   902, 921 — remove the module call and all four dependent references (invoke ARN into
   `api-gateway` module, IAM/permissions, build-lambdas manifest wiring — verify each of the 4
   line references individually during implementation, don't assume all 4 are the same kind of
   reference).

Full inventory is now the union of Round 1 + Round 2 + these 8 items — treated as the closing
checklist for implementation, not re-derived from scratch.

## REPLACE decision — final

Unchanged, Codex agrees (Round 2 §3): `Organization.displayName`, with the blank-string
invariant now enforced at the correct boundary, becomes the sole guest-facing requester
identity. `UserProfile.requesterDisplayName` and its full call/infra/test graph removed. Future
per-person attribution, if ever requested, is an immutable request-time snapshot on
`DocumentRequest`/`RequirementAssignment`, never a resurrection of a standing per-user field.

## Implementation

Proceeding to implement this session per the full closing inventory (Round 1 + Round 2 + Round 3
additions), with full DoD: typecheck, lint, check-boundaries, test (including the 2 new tests
above), validate-schemas, build:lambdas, terraform test (infra/ genuinely touched this time).

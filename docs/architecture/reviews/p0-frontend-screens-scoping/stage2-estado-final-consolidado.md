# Stage 2 — Estado Final Consolidado: P0 screen inventory

**Status: CONVERGED. Codex 9.4/10, Claude 9.3/10 (retrospective) — both ≥9.0, no rounding.**

## Process

- Round 1: Claude wrote an independent BLIND proposal (`stage2-round1-claude-proposal.md`, 19 authenticated + 3 guest screens, self-score 8.4/10) grounded in `authorization.ts` and a domain-folder survey, but explicitly did NOT verify whether HTTP routes actually exist for review-queue listing, tenant-wide document listing, or avulso document-request creation — it assumed these were buildable.
- Round 1: Codex wrote an independent BLIND proposal (`stage2-round1-codex-blind-proposal.md`, 23 authenticated (A01-A23) + 2 guest (G01-G02) screens, self-score 9.1/10), via `codex exec` with real repo access (grepped actual HTTP handlers/BFF allowlist, not just domain/RBAC code). **Found 3 real backend/BFF gaps Claude's draft had missed**: no tenant-facing HTTP route for review-queue/document listing (G2), the 7 CSV report endpoints aren't proxied by the BFF (G3), and `docarchive:request-create` (avulso request) has no tenant-facing route despite the Action/service existing (G4) — all three classified as genuine P0 BLOCKERS, not just deferrals.
- Round 2: both proposals reconciled by Codex (`stage2-round2-reconciliation.md`) — adopted Codex's structure as the base (grounded in verified route evidence), folded in Claude's useful additions (Document Type guest-visibility note on A20), explicitly decided guest "link unavailable" stays a state within G01/G02 rather than a separate screen, and tightened the 8 named gaps (G1-G8) against Stage 1's 6-condition DEFERRED rule — 3 reclassified explicitly as BLOCKING (G2/G3/G4), 5 as legitimate non-blocking deferrals (G1/G5/G6/G7/G8). Final self-score 9.4/10.
- Claude read Round 2 in full and agrees retrospectively (9.3/10, no residual disagreement) — third round dispensed by explicit agreement, same pattern as Stage 1 and D-243.

## Final converged screen count

**25 screens: 23 authenticated (A01-A23) + 2 guest (G01-G02).**

Full per-screen specification lives in `stage2-round1-codex-blind-proposal.md` (the structure Round 2 adopted as base) and is restated, self-contained, in the final deliverable `docs/frontend/p0-screen-inventory-plan.md`.

## 3 genuine P0 blockers discovered (not mere "deferred" items — engineering gaps that block a named P0 screen from being buildable end-to-end today)

1. **G2 — no tenant-facing HTTP route for review-queue / document listing / document search.** The GSI and dashboard counter (`awaitingReviewCount`) exist, but no `listReviewQueue`/`listDocuments`/`searchDocuments` endpoint does. Blocks A13 (Review Queue) and the "Documents Collection" concept inside A11/A12's connections.
2. **G3 — the 7 CSV report endpoints are not in the BFF proxy allowlist** (named `Content-Disposition` handling gap in the code itself). Blocks A16 (Reports & Exports) from being usable through the browser.
3. **G4 — `docarchive:request-create` (avulso/non-recurring document request) has no tenant-facing HTTP route**, despite the `Action` and application service existing. Blocks the "solicitação avulsa" control inside A14.

These are recorded in the final plan as named, screen-blocking backend gaps — NOT hidden, NOT worked around by inventing a fake screen, per Stage 1's rubric axis 1 discipline.

## 5 legitimate non-blocking deferrals (satisfy all 6 conditions of Stage 1's DEFERRED rule)

G1 (`system:ping`, no product screen), G5 (WhatsApp opt-in UI — no HTTP route yet, D-246 named gap), G6 (2 dashboard cards with no backing data model — "aguardando cliente"/"renovações abertas"), G7 (`ExternalShareLink`, P1 item, only domain/persistence slice done), G8 (internal operational/worker state — no human-facing Action exists, by design).

## Next

The final deliverable (`docs/frontend/p0-screen-inventory-plan.md`) restates all 25 screens self-contained (per Stage 1 axis 8), the RBAC role model, the 3 blockers, the 5 deferrals, and the full navigation graph — everything Claude Design needs with zero other session context.

# Expiration Tracker — Interaction Prototype

> **This prototype is not production frontend architecture.** It exists to validate flow,
> comprehension, continuity, decisions, feedback, state and recovery across the 17 approved
> Interaction Surfaces (`SURF-001`–`SURF-017`) and the 8 critical journeys (`J-01`–`J-08`). It does
> not decide visual identity, component library, state-management library, routing architecture,
> or BFF client architecture — those are later-phase decisions. See
> `docs/frontend/interface-interaction-prototype.md` for the full rationale, scenario matrices, and
> the Claude↔Codex review record.

## Purpose

Validate that the approved journeys/surfaces/states, when connected into real clickable behavior,
actually let a reviewer traverse `J-01`–`J-08` end to end — including alternate paths, failures,
recovery, re-entry, session interruption, OCC conflicts, `UNKNOWN_OUTCOME`, guest trust, and the
backend blockers (`BLOCKER-A/B/C`, `GTR-01`, `CREATE-IDEMPOTENCY-01`) — without inventing any
capability the backend does not actually support.

## Non-production warning

- No real network calls. All "backend" state lives in an in-memory fake store (`DB` in `app.js`),
  reset on load and on demand (bottom control bar → "Reset prototype state").
- No `Math.random()`/`Date.now()` — a fixed clock (`TODAY = '2026-08-23'`) drives every date
  calculation, so every scenario is exactly reproducible run to run.
- Grayscale/structural only — no brand palette, no final typography, no icon set, no shadows, no
  motion design (same low-fidelity constraints carried over from
  `interface-low-fidelity-wireframes.md`).
- Any experience that is technically `BLOCKED` today (`BLOCKER-A/B/C`, `GTR-01`) is rendered with an
  explicit `[BLOQUEADO: ...]` banner reading `SIMULATED FOR UX VALIDATION — NOT CURRENTLY SUPPORTED
  BY BACKEND` where the distinction matters — never silently presented as working, never resolved
  via defensive copy.

## Install / Run

No build step, no dependencies. Two ways to run:

**Option A — just open the file** (simplest):
```
open prototype/index.html
```
(or double-click it in a file browser). Everything is plain `<script>`/`<link>` tags, no ES modules,
so it works directly from `file://`.

**Option B — a static server** (avoids any browser-specific `file://` quirks):
```
npx serve prototype
# or
python3 -m http.server 8080 --directory prototype
```
then open the printed URL.

## Scenario controls

A yellow-bordered bar is fixed at the bottom of every screen, labeled **🧪 PROTOTYPE SCENARIO
CONTROL — PROTOTYPE-ONLY**. It is never part of the interface being evaluated — it is the
mechanism a reviewer uses to force a deterministic starting state:

1. Pick a **Journey** (`J-01`–`J-08`, or `CROSS` for session/OCC cross-cutting scenarios) from the
   dropdown.
2. Click a **Scenario ID** button (e.g. `PROTO-J02-UNKNOWN`). Hover/focus a button to see its
   one-line description. This seeds the fake backend and navigates to the journey's entry surface.
3. Interact with the surface as a real user would — the scenario button only sets up the starting
   state and any forced outcome flag; you still fill forms, click buttons, and observe feedback.
4. **Reset prototype state** returns everything to the default seed (5 items, 3 subjects, 1 document
   request, 3 guest tokens).
5. **📱 Simulate mobile guest viewport** narrows the layout to ~360px — use it with
   `PROTO-J07-MOBILE`.

The full Scenario ID list and what each one demonstrates is in
`docs/frontend/interface-interaction-prototype.md` §11 (Prototype Scenario IDs) and §9 (Journey ↔
Scenario matrix).

## How to run the mobile guest scenario specifically

1. Journey → `J-07 — Guest Submission`.
2. Click `PROTO-J07-MOBILE`.
3. The mobile viewport toggle is applied automatically by that scenario (you can also toggle it
   manually at any time with the 📱 button).

## Known limitations

- This is a structural/interaction prototype, not a pixel-accurate mock — spacing, color, and
  typography are intentionally minimal and will look identical across every surface.
- "PROTOTYPE-ONLY" buttons appear inside two authenticated surfaces (`SURF-011` Document Request
  Context) to let a reviewer advance a `DocumentRequest` through `OPENED`/`SUBMITTED` without a
  second real actor — these are clearly labeled and are not part of the evaluated interface.
- Editing administrative fields (tags, notes, assignee) on `SURF-003` and creating a new
  Fornecedor/Requirement are stubbed with an announcement ("fora do escopo desta etapa") — they are
  not T0/P0 journeys and were out of scope for this prototype's coverage target.
- Real accessibility testing (screen reader, full keyboard-only pass) was not performed; only
  structural requirements are honored (labels, `aria-live` region for async feedback, focus moved
  to the surface heading after every route change, no color-only status, keyboard-operable
  buttons/links throughout). See §34 of the main document for the full walkthrough.
- The two `BLOCKER-C` branch variants (`SURF-012`) are both demonstrable side by side
  (`PROTO-J06-A` / `PROTO-J06-B`); neither is the product's real behavior — no such route exists in
  the backend today.

## Automated smoke testing (developer note, not required to review the prototype)

This prototype was smoke-tested with a headless Playwright browser during development — every
scenario button across all 8 journeys plus cross-cutting scenarios was clicked and the resulting
surface/H1 and console output were asserted, plus deeper functional walks of full form submissions,
the OCC conflict/recovery loop, the `BLOCKER-A` re-entry-forgets-ephemeral-state property, the
anti-enumeration convergence (three internally distinct guest-token failures render byte-identical
text), and session-expiry/reauthentication return-to-context. Zero console errors. This is not
part of the shipped prototype and no test files are included in this directory — it is recorded
here, and in `docs/frontend/interface-interaction-prototype.md` §39, for auditability.

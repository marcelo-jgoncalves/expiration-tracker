---
name: task-checklist
description: Run the Expiration Tracker task-completion checklist (docs/engineering/task-completion-checklist.md) against the work just done in this session, before marking a task/todo item complete. Use at the end of any task that produced or changed real code, a recorded decision, or a normative document in this repo — not for read-only tasks (research, planning, pure Q&A). Invoke explicitly as /task-checklist, or reach for it proactively whenever you are about to report a task as finished.
---

# Task-completion checklist runner

This project decided (Marcelo, 2026-09-18) to keep this checklist an agent-invoked skill, not a
blocking hook — `docs/engineering/definition-of-done.md` §"O que isso NÃO é" explains why (it stays
proportional: lowers the friction of applying the gate, without forcing automation the project
hasn't yet seen evidence it needs). Running this skill is still something you choose to do, exactly
like reading `definition-of-done.md` directly — this file just makes that fast and consistent.

## What to do

1. Read `docs/engineering/task-completion-checklist.md` in full — it is the actual checklist; this
   skill does not duplicate its content, only drives applying it.
2. Identify the real diff/decision this task produced (`git diff`/`git status`, the artifact
   written, or the decision registered) — never evaluate against the task's original intent, only
   against what was actually produced.
3. Walk the checklist section by section, in order, against that real diff:
   - §0: confirm this is a valid, coherent unit of completion (decompose first if it isn't).
   - §1: classify the risk level, citing the concrete trigger from `change-risk-scale.md`.
   - §2: run the gate commands the classified level requires — actually run them, read the real
     output; never assume green.
   - §3: for each of the 9 axes, mark N/A or evaluated — do not force axes the diff didn't touch,
     do not skip evaluating ones it did.
   - §4: only if this task closes a roadmap/backlog item — confirm end-to-end evidence is cited, not
     just "each slice was green in isolation."
   - §5: write the `DoD:` evidence line in the required format, in the best available location
     (commit message > review artifact > response body).
   - §6: only when concluding a phase/milestone, not every item.
   - §7: confirm the task isn't ending because of an unstated blocker — if the next step needs
     Marcelo's decision, that pending item is named and another independent thread continues.
4. If any required gate is missing, failed, or wasn't actually run: do **not** report the task as
   done. State plainly what's missing and leave the todo item `in_progress`/`pending` with the
   finding recorded — never mark something `completed` "to fix later."
5. Report the result concisely: the risk level, which gates ran (with real outcomes), which axes
   were touched, and the final `DoD:` line. Don't restate the whole checklist back to the user —
   only the parts that were actually evaluated and anything that failed.

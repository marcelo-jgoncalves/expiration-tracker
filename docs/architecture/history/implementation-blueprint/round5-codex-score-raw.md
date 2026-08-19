# Codex — nota cega Rodada 5 (bruta)
codex
## Blind score: 8.9/10 — NOT APPROVED

Rubric applied: **(A) Design Maturity Score**, `requirements.md` §13.1, against the current working-tree snapshot of `implementation-blueprint.md`.

Findings 1–3 are fixed:

1. **Header:** fixed. It now says “em avaliação” and conditions `APPROVED` on both blind scores reaching ≥9.0.
2. **Kill switch:** fixed. §10.3 explicitly skips the check for `EmailDeliveryWorker`; §17.3 limits AppConfig toggles to AI/OCR/WhatsApp; M4 and §26 are consistent.
3. **Concurrency table:** fixed. §26 now contains an explicit initial reserved-concurrency column with concrete Stage 0–2 values and a telemetry-recalibration caveat.

Finding 4 is substantially improved, but **not fully closed in the document as a whole**. §23 makes clear decisions, yet several earlier normative sections still preserve the alternatives those decisions supposedly closed:

- §23.1 chooses BFF definitively, but §4.2 still says “Preferência: sessão BFF [...] **ou**, se o browser usar Cognito diretamente...”.
- §23.1 chooses a dedicated `cognitoSub → userId` mapping item, but §7.3 still permits “índice dedicado **ou** item de mapeamento único”.
- Most importantly, §23.1 decides that Textract/parser/Bedrock are separate Lambdas from day 1, while §3.1 still says the first version may package extraction tasks in one `ExtractionTaskHandler` and separate them only before public production. §26 likewise retains one `ExtractionTaskHandler` row, albeit annotated “2 por tarefa”.

These are real internal contradictions concerning security boundaries and executable decomposition. Under rubric A, a materially relevant ADR is not fully closed when the blueprint’s implementation instructions still authorize the rejected alternative.

Finding 5, by itself, **does not block 9.0**. The blueprint explicitly identifies `UNK-CAP-006`, requires the drainage SLO to be formalized before the M7 load test becomes a gate, and does not silently treat “one of three” as an already validated production target. That is acceptable staging of a known capacity/SLO decision. It would become blocking if implementation or production approval proceeded without selecting the scenario and corresponding SLO.

The core Round-2 technical corrections remain intact; I found no basis to reopen GSI3, outbox durability, cancellation limits, or the prior AWS factual fixes.

The score remains below 9.0 because the newly closed Type 1 decisions have not yet been propagated consistently into the blueprint’s operative sections. Once §3.1, §4.2, §7.3, and §26 are aligned with §23.1, I would consider the previously identified blockers resolved.

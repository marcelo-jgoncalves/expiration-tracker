# D-224 pending decision — should `documentTypeId` become mandatory in the guest submit-evidence HTTP schema? (Round 1 — Claude proposal)

## Question

`schemas/api/docarchive-guest-submit-evidence-request.v1.json` currently has an OPTIONAL free-text `documentType` field (`minLength:1, maxLength:100`, not in `required`). D-184 added conditional validation (`ConditionCheck(DocumentType.status=ACTIVE)` only when the field is explicitly supplied) but deliberately rejected making it mandatory, because at the time no discovery mechanism existed for a guest to learn which `documentTypeId` values are valid for their link. D-224 built that missing prerequisite: `GET /document-archive/guest/document-requests/{token}/document-types` (public, ACTIVE-only, tenant-scoped). D-224 named the mandatory-vs-optional question as the still-open product decision, structurally viable either way now.

Options: (a) make `documentTypeId` mandatory now, remove the old free-text `documentType` fallback; (b) keep fully optional, no change; (c) a staged middle path (grace-period deprecation warning before a future hard cutover).

## E-014 research declaration: SIM PARCIAL

Checked against `docs/engineering/research-protocol.md` before proceeding — this is a nível 5-6 change to a live public HTTP contract, external precedent is relevant.

- **Breaking-change / deprecation-window practice (general API versioning, not guest-upload specific)**: Speakeasy, [Versioning Best Practices in REST API Design](https://www.speakeasy.com/api-design/versioning) (accessed 2026-09-08) — making an optional request field required is a breaking change; recommended path is expand (add field optional, with fallback) then contract (require it) later, i.e. Martin Fowler's Parallel Change pattern (already cited by D-184: [martinfowler.com/bliki/ParallelChange.html](https://martinfowler.com/bliki/ParallelChange.html), accessed 2026-09-02). Aikido, [Avoid breaking API contracts: backward compatibility guide](https://www.aikido.dev/code-quality/rules/how-to-avoid-breaking-public-api-contracts-maintaining-backward-compatibility) (accessed 2026-09-08) — same classification, adding a required field breaks any client that doesn't already send it; recommends a deprecation window (commonly cited as 6-12+ months for public APIs with real external consumers) with `Deprecation`/`Sunset` response headers.
- **Guest/anonymous document-upload-specific precedent (DocuSign, HelloSign/Dropbox Sign, PandaDoc)**: **NOT FOUND within research budget.** Web search for anonymous/guest upload category-required-field API design on these three products returned only generic product-comparison/marketing pages (pricing, feature comparisons), no API reference content on how these products evolved category/document-type fields from optional to required for un-authenticated recipients. Recording this explicitly as a real research limitation rather than fabricating a citation — same discipline D-225 used for the missing Box/Notion/Figma source.

Weight: the general API-versioning guidance (breaking-change classification + expand/contract pattern) is well-established and directly applicable; it is NOT guest-upload-specific, so it informs the *mechanism* (if a staged path is chosen) more than the *product-risk* calculus, which depends on this codebase's actual guest-flow usage — covered below.

## This codebase's actual guest-flow usage pattern (grounds the recommendation)

Confirmed by reading `guest-document-access-service.ts`, `NEXT_SESSION_PROMPT.md`, and the decisions log directly, not assumed:

1. **No live external guest integration exists yet.** `NEXT_SESSION_PROMPT.md` item 8 and the "Pendências reais" list describe this product as still pre-launch/internal (no mention anywhere of a real tenant or guest currently submitting evidence through this route in production). The guest submit-evidence route is fully implemented and tested (D-143 onward) but there is no documented evidence of real external callers depending on the current optional shape today.
2. **The repo's own internal discipline already rejects compat shims/field coexistence when there is no live external consumer to protect** — D-093, applied literally in D-176: "`Document.documentType`→`documentTypeId` renomeado ponta a ponta... sem coexistência de campo, sem shim de compat, per D-093". The guest schema is the one place in this arc that was deliberately left with the old free-text shape, and only because D-175/D-184 found a genuine blocking gap (no discovery mechanism) — not because of live external consumers needing a grace period.
3. **D-224 closed exactly that gap.** The guest can now call the discovery route before submitting. The structural blocker D-184 named no longer exists.
4. Every day this decision stays open, the risk profile gets *worse*, not better: once real guest links go out to real external recipients (subjects/vendors uploading evidence), a later mandatory flip becomes a real breaking change against real traffic, exactly the scenario the external research warns about. Today, the change is free.

## Proposal: (a) — make `documentTypeId` mandatory now, remove `documentType` free-text fallback

Concretely:
- `schemas/api/docarchive-guest-submit-evidence-request.v1.json`: rename `documentType` → `documentTypeId`, move it into `required`, keep the same string constraints (or tighten to match the ULID shape `DocumentType.documentTypeId` actually uses, since it's no longer free text).
- `guest-document-access-service.ts`'s `submitEvidence()`: remove the `documentTypeSupplied` conditional guard and the `?? requirementId` fallback (D-175/D-184's interim guard becomes dead code); the `ConditionCheck(DocumentType.status=ACTIVE)` entry becomes unconditional, same position `[0]`.
- No coexistence period, no deprecation header, no dual-field shim — consistent with D-093/D-176's established precedent for this exact codebase, because there is no live consumer to protect.

## Why not (b) keep optional

Categorization stays permanently best-effort/inconsistent — the entire point of D-173's catalog (tenant-scoped, enforced categorization) is undermined at its only externally-reachable write path. Every other write path (`createDocument()`, D-175) already enforces this; leaving guest permanently exempt is an asymmetry with no remaining technical justification now that discovery exists.

## Why not (c) staged grace period

The staged/deprecation-window pattern research surfaced is a real, well-established practice — but it exists specifically to protect *real existing external callers* from a surprise break. This codebase has none yet for this route. Paying the engineering cost of a temporary warning-then-cutover mechanism (schema still optional, service returns a deprecation signal, then a second future session removes the fallback) defers a decision that is free to make now and only becomes expensive to delay. If Marcelo later confirms real external guest traffic exists on the current optional shape, that would flip this recommendation toward (c) — but nothing found in this session's research of the codebase confirms that.

## Scores I'd propose for this round

E-014 rigor: 8.5/10 (general pattern well-sourced with real URLs+dates; guest-upload-specific precedent honestly reported as not found, which is itself the honest/correct move rather than a gap to hide). Design/decision soundness: 8.5/10 (grounded in real codebase evidence, but I have not yet had Codex independently verify the "no live external consumer" premise, which is the load-bearing fact for the whole recommendation).

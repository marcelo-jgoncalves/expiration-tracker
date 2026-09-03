/**
 * DocumentVersion — D-143 Decision 1 (state machine) + Decision 6 (file lifecycle).
 * `DocumentVersion.state` is the SOLE mutable source of truth (Decision 3) — the append-only
 * `DocumentVersionEvent` log (`document-version-event.ts`) records every transition but never
 * competes with this field for authority.
 *
 * Graph (estado-final-consolidado.md Decision 1):
 *   (none)      -[reserveUpload]->        DRAFT
 *   DRAFT       -[commitUpload]->         RECEIVED
 *   DRAFT       -[abandonUpload]->        WITHDRAWN
 *   RECEIVED    -[claimReview]->          UNDER_REVIEW
 *   RECEIVED | UNDER_REVIEW -[acceptVersion]-> ACCEPTED
 *   RECEIVED | UNDER_REVIEW -[rejectVersion]-> REJECTED
 *   ACCEPTED    -[superseded by another version's acceptVersion]-> SUPERSEDED
 *   UNDER_REVIEW -[claim TTL sweeper]->    RECEIVED
 *
 * REJECTED is a terminal state that is NEVER removable (D-143 Decision 7 — a Rodada 1 proposal
 * that allowed removing REJECTED versions was rejected for directly contradicting J9's
 * "the rejected file stays in history" requirement). Only DRAFT can ever be physically removed
 * (via WITHDRAWN, before it ever became evidence).
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { UnifiedValidityState } from "../../../shared/domain/validity-state.js";
import { deriveValidityStateFromExpiry } from "../../../shared/domain/validity-state.js";

export type DocumentVersionState = "DRAFT" | "RECEIVED" | "UNDER_REVIEW" | "ACCEPTED" | "REJECTED" | "SUPERSEDED" | "WITHDRAWN";

/** Closed taxonomy, `document-domain-functional-specification-v0.1.md` §12. */
export type RejectionReason = "EXPIRED" | "ILLEGIBLE" | "INCORRECT" | "WRONG_SUBJECT" | "OUTDATED_VERSION" | "INCOMPLETE" | "OTHER";

/** Origin taxonomy, spec §13. */
export type DocumentVersionOrigin = "MANUAL_UPLOAD" | "GUEST_UPLOAD" | "REQUEST_RESPONSE" | "IMPORT" | "AUTOMATED_CAPTURE";

export interface DocumentVersion extends EntityKey {
  entityType: "DocumentVersion";
  versionId: string;
  documentId: string;
  tenantId: string;
  seq: number;
  state: DocumentVersionState;
  origin: DocumentVersionOrigin;
  issuedAt?: string;
  validFrom?: string;
  validUntil?: string;
  receivedAt?: string;
  reviewerId?: string;
  decidedAt?: string;
  rejectionReason?: RejectionReason;
  /** Decision 6/Bloqueador 9: two independent counters gate `acceptVersion` — `pendingFileScans=0`
   * alone is NOT sufficient (a version with zero pending and one INFECTED file must never be
   * accepted), both must be zero. */
  pendingFileScans: number;
  infectedFileScans: number;
  /** D-163 §2: set atomically by `reserveFiles()`'s single `TransactWriteItems`, together with
   * `principalFileId`/`totalFiles`/`pendingFileScans` — never by a separate write. Fences two
   * concurrent `reserveFiles()` calls against the same Version: the second one's Update
   * condition (`fileSetSealed` absent or `false`) fails, closing the race a Rodada 1 proposal
   * tried to close with input validation alone (D-163 §2, achado real da Rodada 1). Once
   * `true`, no further file reservation against this Version is possible — the only recovery
   * for a bad file set is rejecting the whole Version and starting a new one (D-143
   * Decision 1/7, never reopening a sealed set). */
  fileSetSealed?: boolean;
  principalFileId?: string;
  totalFiles?: number;
  requestId?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  /** Present only while state IN (RECEIVED, UNDER_REVIEW) — sparse GSI5 review-queue entry
   * (AP5). Removed (not merely blanked) the moment the version leaves either state, so the
   * index only ever contains live review work (AWS DynamoDB sparse-index pattern). */
  GSI5PK?: string;
  GSI5SK?: string;
}

const SEQ_WIDTH = 6;

export function formatVersionSeq(seq: number): string {
  return String(seq).padStart(SEQ_WIDTH, "0");
}

export function documentVersionKey(tenantId: string, documentId: string, seq: number): { PK: string; SK: string } {
  return { PK: `TENANT#${tenantId}#DOCUMENT#${documentId}`, SK: `VERSION#${formatVersionSeq(seq)}` };
}

/** AP5 sparse review-queue index — separate buckets per real state (never a fixed `RECEIVED`
 * literal for both RECEIVED and UNDER_REVIEW, the exact bug the Rodada 2 proposal had). */
export function reviewQueueGsi5Keys(
  tenantId: string,
  state: "RECEIVED" | "UNDER_REVIEW",
  orderingTimestamp: string,
  versionId: string,
): { GSI5PK: string; GSI5SK: string } {
  return {
    GSI5PK: `TENANT#${tenantId}#REVIEWQUEUE#${state}`,
    GSI5SK: `${orderingTimestamp}#VERSION#${versionId}`,
  };
}

/** AP11 — Version lookup by id alone (Decision 5's relink needs to resolve a `versionId` to
 * its owning `documentId` without knowing the Document upfront). */
export function versionLookupGsi5Keys(tenantId: string, versionId: string): { GSI5PK: string; GSI5SK: string } {
  return { GSI5PK: `TENANT#${tenantId}#VERSIONLOOKUP`, GSI5SK: `VERSION#${versionId}` };
}

interface TransitionRule {
  from: readonly DocumentVersionState[];
  to: DocumentVersionState;
}

const TRANSITIONS: readonly TransitionRule[] = [
  { from: ["DRAFT"], to: "RECEIVED" },
  { from: ["DRAFT"], to: "WITHDRAWN" },
  { from: ["RECEIVED"], to: "UNDER_REVIEW" },
  { from: ["UNDER_REVIEW"], to: "RECEIVED" }, // claim TTL sweeper releasing a dead claim
  { from: ["RECEIVED", "UNDER_REVIEW"], to: "ACCEPTED" },
  { from: ["RECEIVED", "UNDER_REVIEW"], to: "REJECTED" },
  { from: ["ACCEPTED"], to: "SUPERSEDED" },
];

export class InvalidDocumentVersionTransitionError extends Error {
  constructor(
    readonly from: DocumentVersionState,
    readonly to: DocumentVersionState,
  ) {
    super(`Cannot transition DocumentVersion from "${from}" to "${to}"`);
    this.name = "InvalidDocumentVersionTransitionError";
  }
}

export function canTransitionDocumentVersion(from: DocumentVersionState, to: DocumentVersionState): boolean {
  return TRANSITIONS.some((rule) => rule.to === to && rule.from.includes(from));
}

/** Throws rather than returning a boolean (implementation-blueprint.md's `authorize()`
 * precedent: callers should not be able to forget to check a boolean result). */
export function assertValidDocumentVersionTransition(from: DocumentVersionState, to: DocumentVersionState): void {
  if (!canTransitionDocumentVersion(from, to)) {
    throw new InvalidDocumentVersionTransitionError(from, to);
  }
}

/** Decision 7: REJECTED is never removable (would contradict J9's "the rejected file stays in
 * history"). Only DRAFT can ever be removed — WITHDRAWN is the terminal state that records a
 * DRAFT was abandoned before it ever became evidence, and only a version that reached
 * WITHDRAWN this way is eligible for physical deletion under retention policy. */
export function isRemovableDocumentVersionState(state: DocumentVersionState): boolean {
  return state === "DRAFT";
}

/** Decision 1's terminal states — no further state transition is possible once reached (a
 * repeated command against one of these is only ever a legitimate idempotent replay, never a
 * fresh mutation). */
export function isTerminalDocumentVersionState(state: DocumentVersionState): boolean {
  return state === "ACCEPTED" || state === "REJECTED" || state === "SUPERSEDED" || state === "WITHDRAWN";
}

/** Decision 6/Bloqueador 9 gate for `acceptVersion` — both counters must be zero. */
export function hasCleanFileScans(version: Pick<DocumentVersion, "pendingFileScans" | "infectedFileScans">): boolean {
  return version.pendingFileScans === 0 && version.infectedFileScans === 0;
}

/**
 * D-194 fatia 1: `UnifiedValidityState` adapter. `DRAFT` is excluded (`undefined`) — it is not a
 * pending review, just an in-progress upload. `RECEIVED`/`UNDER_REVIEW` -> `AGUARDANDO_REVISAO`.
 * `REJECTED`/`WITHDRAWN`/`SUPERSEDED` are terminal-but-not-current -> excluded. `ACCEPTED`
 * delegates to `deriveValidityStateFromExpiry` (PERMANENTE/VALIDO/VENCENDO/VENCIDO, the only
 * state here that can genuinely be expired). Not consumed by any search mode in this phase (no
 * mode searches `Document`/`DocumentVersion` directly) — exists for a future detail-view use per
 * the design doc.
 */
export function deriveDocumentVersionValidityState(version: Pick<DocumentVersion, "state" | "validUntil">, now: Date): UnifiedValidityState | undefined {
  switch (version.state) {
    case "RECEIVED":
    case "UNDER_REVIEW":
      return "AGUARDANDO_REVISAO";
    case "ACCEPTED":
      return deriveValidityStateFromExpiry(version.validUntil, now);
    default:
      return undefined;
  }
}

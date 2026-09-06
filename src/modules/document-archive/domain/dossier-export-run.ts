/**
 * DossierExportRun — D-205 (Roadmap P1 item 16, `docs/architecture/reviews/
 * document-dossier-scoping/estado-final-consolidado.md` decisions 2-4). Co-located in the
 * Subject's own partition (`PK = TENANT#<tenantId>#SUBJECT#<subjectId>`), same convention
 * `requirementKey()` already establishes and the same rationale: a dossier export's lifecycle is
 * owned by the Subject it exports, not by any one Requirement/Document.
 *
 * Preview/confirm two-step flow (decision 4, closing Journey J22's "shows scope before
 * exporting"): `PREVIEW_READY` freezes the SET of `requirementIds` a generation will cover
 * (never re-derived later - a Requirement created/deleted after preview never silently joins or
 * leaves an already-previewed run); `scopeHash` is what `confirm` re-checks against the CALLER's
 * echoed value, so a UI that fetched a preview and then waited (during which the scope could
 * have changed under a NEW preview call) can never confirm a scope it didn't actually see.
 * Field VALUES inside the generated documents are still read fresh at generation time (fatia 2,
 * not built yet) - only the "which Requirements" scope is frozen here.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import { computeFingerprint } from "../../../shared/domain/fingerprint.js";

export type DossierExportRunStatus =
  | "PREVIEW_READY"
  | "CONFIRMED" // scopeHash matched, worker not yet built (fatia 2) - dispatched to SQS_DOSSIER_EXPORT_V1, no consumer wired yet.
  | "GENERATING"
  | "READY"
  | "FAILED"
  | "TOO_LARGE"; // DossierTooLargeError (decision 5) - declared failure, never a silently-truncated artifact.

export interface DossierExportRun extends EntityKey {
  // PK = TENANT#<tenantId>#SUBJECT#<subjectId>, SK = DOSSIER#<runId>
  entityType: "DossierExportRun";
  runId: string;
  subjectId: string;
  tenantId: string;
  status: DossierExportRunStatus;
  /** Frozen at preview time (decision 4) - the worker (fatia 2) iterates exactly this set,
   * re-reading each Requirement fresh, never re-deriving the set itself. */
  requirementIds: readonly string[];
  scopeHash: string;
  createdBy: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  failureReason?: string;
}

export function dossierExportRunKey(tenantId: string, subjectId: string, runId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#SUBJECT#${subjectId}`, SK: `DOSSIER#${runId}` };
}

export const DOSSIER_EXPORT_RUN_SK_PREFIX = "DOSSIER#";

/** `scopeHash` input: `subjectId` (a run confirmed under one Subject can never validate against
 * another) + the requirementId SET, sorted (order-independent - the API response may list them
 * in whatever order the underlying query returned). Deliberately excludes `tenantId` — the
 * caller can only ever read/confirm a run already scoped to their own tenant by its physical
 * key, so including it here would add nothing a cross-tenant key substitution doesn't already
 * fail on structurally. */
export function computeDossierScopeHash(subjectId: string, requirementIds: readonly string[]): string {
  return computeFingerprint({ subjectId, requirementIds: [...requirementIds].sort() });
}

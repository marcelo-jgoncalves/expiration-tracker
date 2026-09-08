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
 * Field VALUES inside the generated documents are still read fresh at generation time (fatia 2)
 * - only the "which Requirements" scope is frozen here.
 *
 * D-205 fatia 2: `GENERATING` is claimed with a lease (`generatingLeaseExpiresAt`), same
 * concept as `NotificationAttempt.leaseExpiresAt`/the outbox relay lease - a redelivered
 * `SQS_DOSSIER_EXPORT_V1` message while generation is still genuinely in flight is a no-op
 * (`SKIP_IN_PROGRESS`); once the lease expires without the run reaching a terminal status, a
 * later invocation is allowed to reclaim it (the crashed invocation's own eventual write, if
 * any, loses the OCC race via `expectedVersion`).
 *
 * D-235 (full-audit-round2 privacy finding E-015): `purgeAfterTtl` set once at preview/creation
 * time, same DynamoDB-native TTL mechanism (no custom purge worker) every other TTL'd entity in
 * this codebase already uses. Retention reuses the SAME 30-day window
 * `aws_s3_bucket_lifecycle_configuration.report_exports` already established (D-215 decision 6,
 * `infra/main.tf`) for the actual dense personal data (the generated PDF/Excel object in S3) -
 * this row is only metadata ABOUT that export (a Subject id, a Requirement id set, a scope hash),
 * so once the S3 object itself is gone there is no reason for the row describing it to outlive
 * it. Never re-set on update - the partial `SET` updates `confirmDossierExport`/the fatia 2
 * worker perform never touch this attribute, so it stays fixed at creation time.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import { computeFingerprint } from "../../../shared/domain/fingerprint.js";

export type DossierExportRunStatus =
  | "PREVIEW_READY"
  | "CONFIRMED" // scopeHash matched, dispatched to SQS_DOSSIER_EXPORT_V1.
  | "GENERATING" // claimed by the fatia 2 worker, generatingLeaseExpiresAt set.
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
  /** Set only while `status === "GENERATING"` - see the file's own header comment. */
  generatingLeaseExpiresAt?: string;
  generatedAt?: string;
  failureReason?: string;
  /** DynamoDB TTL attribute (epoch seconds) — see the file header's D-235 note. Set once at
   * `previewDossierExport` time, 30 days out; never re-set on update. */
  purgeAfterTtl: number;
}

export function dossierExportRunKey(tenantId: string, subjectId: string, runId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#SUBJECT#${subjectId}`, SK: `DOSSIER#${runId}` };
}

export const DOSSIER_EXPORT_RUN_SK_PREFIX = "DOSSIER#";

/** Same 30-day figure as `aws_s3_bucket_lifecycle_configuration.report_exports` (D-215 decision
 * 6, `infra/main.tf`) — see D-235 note above for why this metadata row reuses that number rather
 * than inventing a new retention class. */
export const DOSSIER_EXPORT_RUN_RETENTION_DAYS = 30;

export function computeDossierExportRunPurgeAfterTtl(createdAtIso: string): number {
  return Math.floor(Date.parse(createdAtIso) / 1000) + DOSSIER_EXPORT_RUN_RETENTION_DAYS * 24 * 60 * 60;
}

/** `scopeHash` input: `subjectId` (a run confirmed under one Subject can never validate against
 * another) + the requirementId SET, sorted (order-independent - the API response may list them
 * in whatever order the underlying query returned). Deliberately excludes `tenantId` — the
 * caller can only ever read/confirm a run already scoped to their own tenant by its physical
 * key, so including it here would add nothing a cross-tenant key substitution doesn't already
 * fail on structurally. */
export function computeDossierScopeHash(subjectId: string, requirementIds: readonly string[]): string {
  return computeFingerprint({ subjectId, requirementIds: [...requirementIds].sort() });
}

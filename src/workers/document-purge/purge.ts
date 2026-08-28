/**
 * DocumentPurgeWorker — W3-06 (D-061), pure logic, clock-injected, same layout as
 * reminder-reconciliation/upload-slot-reconciliation. Physically purges `Document` rows
 * (`retentionClass: "USER_DOCUMENT"`) and their real S3 object once `purgeAfter` has passed,
 * and separately purges `DocumentPurgeReceipt` rows once THEIR `purgeAfter` (180 days,
 * DELIVERY_RECORD) has passed. Candidate batches (GSI6 query results) are supplied by the
 * caller, exactly like `reconcileExpiredClaims`/`reconcileDst` in
 * `workers/reminder-reconciliation/reconciliation.ts` — this module never touches GSI6 itself.
 *
 * Mechanism summary (full design + 6-round Claude<->Codex protocol:
 * `docs/architecture/reviews/w3-06-user-document-purge-design/`):
 *  - `Document` candidates go through a claim/lease (`WORKSTATE#PURGE_PENDING` ->
 *    `WORKSTATE#PURGE_CLAIMED`, 15min lease) BEFORE any S3 call, fenced by an OCC-conditioned
 *    `Update` checking version, `legalHold`, `status`, and the exact GSI6 pointer read — the
 *    claim itself is the fence against concurrency/hold/restoration, not a later best-effort
 *    recheck.
 *  - The real S3 object is `doc.cleanObject` (promoted documents) or
 *    `doc.uploadEvidence?.object ?? doc.malwareEvidence?.object` (rejected/unsupported
 *    documents that had real evidence) — NEVER `doc.quarantineObject`, whose `versionId` is
 *    always `""` (see `document-service.ts`/`advance-after-evidence.ts`). A document that never
 *    received any evidence has nothing to delete by version; the quarantine bucket's own
 *    lifecycle rule is the backstop for that case.
 *  - The terminal step is one `TransactWriteItems`: `Delete` the `Document` row (conditioned on
 *    the claimed version + `GSI6PK = WORKSTATE#PURGE_CLAIMED`) + `Put` a `DocumentPurgeReceipt`
 *    (non-sensitive proof of purge, `DELIVERY_RECORD` retention, own GSI6 pointer for
 *    self-purge 180 days later).
 *  - `DocumentPurgeReceipt` candidates have no external side effect to protect, so they are
 *    deleted directly from `PENDING` in a single conditioned transaction — no `CLAIMED` state.
 *  - Lease reconciliation (`WORKSTATE#PURGE_CLAIMED` past its lease) reverts to `PENDING` unless
 *    `purgeAttempts >= 5`, in which case the candidate is moved to a materialized terminal state
 *    (`purgeStatus: "STUCK"`, removed from both GSI6 worklists) instead of being reclaimed
 *    forever — a metric alone is not a durable record of a stuck candidate.
 *  - `legalHold`: no setter exists anywhere in this codebase yet. Any future one MUST include
 *    `attribute_not_exists(GSI6PK) OR GSI6PK <> "WORKSTATE#PURGE_CLAIMED"` in its own
 *    OCC-conditioned write (D-061, normative) — that is what makes hold and purge mutually
 *    exclusive by construction, not this worker's claim condition alone.
 */
import {
  buildVersionedCreate,
  buildVersionedDelete,
  buildVersionedUpdate,
  isTransactionCanceled,
} from "../../shared/dynamodb/occ.js";
import {
  GSI6PK_PURGE_CLAIMED,
  GSI6PK_PURGE_PENDING,
  buildDocumentPurgeClaimGsi6Sk,
  buildDocumentPurgeGsi6Sk,
  buildPurgeReceiptGsi6Sk,
  type DocumentStore,
} from "../../modules/document/ports/document-store.js";
import type { DocumentObjectStore } from "../../modules/document/ports/document-object-store.js";
import type { DocumentObjectReference } from "../../modules/document/domain/document-object-reference.js";
import { documentPurgeReceiptKey, type DocumentPurgeReceipt } from "../../modules/document/domain/document-purge-receipt.js";
import { computeDeliveryRecordPurgeAfter } from "../../modules/document/domain/retention.js";

export const PURGE_LEASE_MS = 15 * 60 * 1000;
export const MAX_PURGE_ATTEMPTS = 5;

export interface DocumentPurgeCandidate {
  entityType: "Document";
  PK: string;
  SK: string;
  tenantId: string;
  documentId: string;
  itemId: string;
  version: number;
  status: string;
  GSI6PK: string;
  GSI6SK: string;
  purgeAfter: string;
  legalHold?: boolean;
  purgeAttempts?: number;
  deletedAt?: string;
  cleanObject?: DocumentObjectReference;
  uploadEvidence?: { object: DocumentObjectReference };
  malwareEvidence?: { object: DocumentObjectReference };
}

export interface ReceiptPurgeCandidate {
  entityType: "DocumentPurgeReceipt";
  PK: string;
  SK: string;
  tenantId: string;
  documentId: string;
  version: number;
  GSI6PK: string;
  GSI6SK: string;
  purgeAfter: string;
}

export type PurgeCandidate = DocumentPurgeCandidate | ReceiptPurgeCandidate;

export interface DocumentPurgeWorkerDeps {
  store: DocumentStore;
  objects: DocumentObjectStore;
  tableName: string;
  now: () => string;
  correlationId?: () => string | undefined;
}

export interface PurgeRunResult {
  documentsPurged: number;
  receiptsPurged: number;
  claimsSkipped: number;
  leasesReverted: number;
  leasesStuck: number;
}

/** Never `doc.quarantineObject` — its `versionId` is always `""` (reserveUpload sets it before
 * the real object exists, see `document-service.ts`/`advance-after-evidence.ts`). */
function pickObjectToDelete(candidate: DocumentPurgeCandidate): DocumentObjectReference | undefined {
  return candidate.cleanObject ?? candidate.uploadEvidence?.object ?? candidate.malwareEvidence?.object;
}

async function claimAndPurgeDocument(deps: DocumentPurgeWorkerDeps, candidate: DocumentPurgeCandidate): Promise<"PURGED" | "SKIPPED"> {
  const claimAt = deps.now();
  const claimExpiresAt = new Date(Date.parse(claimAt) + PURGE_LEASE_MS).toISOString();
  const nextAttempts = (candidate.purgeAttempts ?? 0) + 1;

  try {
    await deps.store.transactWrite([
      {
        Update: buildVersionedUpdate({
          tableName: deps.tableName,
          key: { PK: candidate.PK, SK: candidate.SK },
          tenantId: candidate.tenantId,
          expectedVersion: candidate.version,
          set: {
            GSI6PK: GSI6PK_PURGE_CLAIMED,
            GSI6SK: buildDocumentPurgeClaimGsi6Sk(claimExpiresAt, candidate.tenantId, candidate.documentId),
            purgeAttempts: nextAttempts,
          },
          extraConditions: [
            { expression: "attribute_not_exists(#legalHold) OR #legalHold = :false", names: { "#legalHold": "legalHold" }, values: { ":false": false } },
            { expression: "#status = :deleted", names: { "#status": "status" }, values: { ":deleted": "DELETED" } },
            { expression: "GSI6PK = :expectedPk AND GSI6SK = :expectedSk", values: { ":expectedPk": GSI6PK_PURGE_PENDING, ":expectedSk": candidate.GSI6SK } },
            { expression: "purgeAfter <= :purgeCutoff", values: { ":purgeCutoff": claimAt } },
          ],
        }),
      },
    ]);
  } catch (err) {
    if (isTransactionCanceled(err)) return "SKIPPED";
    throw err;
  }

  const claimedVersion = candidate.version + 1;
  const objectToDelete = pickObjectToDelete(candidate);
  if (objectToDelete) await deps.objects.deleteObjectVersion(objectToDelete);

  const purgedAt = deps.now();
  const receiptPurgeAfter = computeDeliveryRecordPurgeAfter(purgedAt);
  const receipt: DocumentPurgeReceipt = {
    ...documentPurgeReceiptKey(candidate.tenantId, candidate.documentId),
    entityType: "DocumentPurgeReceipt",
    tenantId: candidate.tenantId,
    documentId: candidate.documentId,
    itemId: candidate.itemId,
    retentionClassPurged: "USER_DOCUMENT",
    deletedAtOriginal: candidate.deletedAt ?? candidate.purgeAfter,
    purgedAt,
    correlationId: deps.correlationId?.(),
    retentionClass: "DELIVERY_RECORD",
    purgeAfter: receiptPurgeAfter,
    GSI6PK: GSI6PK_PURGE_PENDING,
    GSI6SK: buildPurgeReceiptGsi6Sk(receiptPurgeAfter, candidate.tenantId, candidate.documentId),
    version: 1,
    createdAt: purgedAt,
    updatedAt: purgedAt,
  };

  await deps.store.transactWrite([
    {
      Delete: buildVersionedDelete({
        tableName: deps.tableName,
        key: { PK: candidate.PK, SK: candidate.SK },
        tenantId: candidate.tenantId,
        expectedVersion: claimedVersion,
        extraConditions: [{ expression: "GSI6PK = :expectedClaimed", values: { ":expectedClaimed": GSI6PK_PURGE_CLAIMED } }],
      }),
    },
    { Put: buildVersionedCreate(deps.tableName, receipt as unknown as Record<string, unknown> & { PK: string; SK: string }) },
  ]);

  return "PURGED";
}

async function purgeReceipt(deps: DocumentPurgeWorkerDeps, candidate: ReceiptPurgeCandidate): Promise<"PURGED" | "SKIPPED"> {
  const now = deps.now();
  try {
    await deps.store.transactWrite([
      {
        Delete: buildVersionedDelete({
          tableName: deps.tableName,
          key: { PK: candidate.PK, SK: candidate.SK },
          tenantId: candidate.tenantId,
          expectedVersion: candidate.version,
          extraConditions: [
            { expression: "GSI6PK = :expectedPk AND GSI6SK = :expectedSk", values: { ":expectedPk": GSI6PK_PURGE_PENDING, ":expectedSk": candidate.GSI6SK } },
            { expression: "purgeAfter <= :purgeCutoff", values: { ":purgeCutoff": now } },
          ],
        }),
      },
    ]);
    return "PURGED";
  } catch (err) {
    if (isTransactionCanceled(err)) return "SKIPPED";
    throw err;
  }
}

/** Second query: `WORKSTATE#PURGE_CLAIMED` with `GSI6SK < now` (lease already expired). */
async function reconcileExpiredPurgeClaim(deps: DocumentPurgeWorkerDeps, candidate: DocumentPurgeCandidate): Promise<"REVERTED" | "STUCK" | "SKIPPED"> {
  const stuck = (candidate.purgeAttempts ?? 0) >= MAX_PURGE_ATTEMPTS;
  try {
    if (stuck) {
      await deps.store.transactWrite([
        {
          Update: buildVersionedUpdate({
            tableName: deps.tableName,
            key: { PK: candidate.PK, SK: candidate.SK },
            tenantId: candidate.tenantId,
            expectedVersion: candidate.version,
            set: { purgeStatus: "STUCK" },
            remove: ["GSI6PK", "GSI6SK"],
            extraConditions: [{ expression: "GSI6PK = :expectedPk AND GSI6SK = :expectedSk", values: { ":expectedPk": GSI6PK_PURGE_CLAIMED, ":expectedSk": candidate.GSI6SK } }],
          }),
        },
      ]);
      return "STUCK";
    }
    await deps.store.transactWrite([
      {
        Update: buildVersionedUpdate({
          tableName: deps.tableName,
          key: { PK: candidate.PK, SK: candidate.SK },
          tenantId: candidate.tenantId,
          expectedVersion: candidate.version,
          set: { GSI6PK: GSI6PK_PURGE_PENDING, GSI6SK: buildDocumentPurgeGsi6Sk(candidate.purgeAfter, candidate.tenantId, candidate.documentId) },
          extraConditions: [{ expression: "GSI6PK = :expectedPk AND GSI6SK = :expectedSk", values: { ":expectedPk": GSI6PK_PURGE_CLAIMED, ":expectedSk": candidate.GSI6SK } }],
        }),
      },
    ]);
    return "REVERTED";
  } catch (err) {
    if (isTransactionCanceled(err)) return "SKIPPED";
    throw err;
  }
}

export async function runPurgeCycle(
  deps: DocumentPurgeWorkerDeps,
  input: { pendingCandidates: PurgeCandidate[]; claimedCandidates: DocumentPurgeCandidate[] },
): Promise<PurgeRunResult> {
  const result: PurgeRunResult = { documentsPurged: 0, receiptsPurged: 0, claimsSkipped: 0, leasesReverted: 0, leasesStuck: 0 };

  for (const candidate of input.pendingCandidates) {
    if (candidate.entityType === "Document") {
      const outcome = await claimAndPurgeDocument(deps, candidate);
      if (outcome === "PURGED") result.documentsPurged += 1;
      else result.claimsSkipped += 1;
    } else {
      const outcome = await purgeReceipt(deps, candidate);
      if (outcome === "PURGED") result.receiptsPurged += 1;
      else result.claimsSkipped += 1;
    }
  }

  for (const candidate of input.claimedCandidates) {
    const outcome = await reconcileExpiredPurgeClaim(deps, candidate);
    if (outcome === "REVERTED") result.leasesReverted += 1;
    else if (outcome === "STUCK") result.leasesStuck += 1;
  }

  return result;
}

/**
 * applyFileScanResult / confirmFileScanClean — D-163 §1/§5, first real slice of DocumentFile's
 * scan-result state machine. Reuses `document/domain/document-state-machine.ts`'s
 * `decideNextAction()` VERBATIM (never forked/redesigned — `DocumentFileScanStatus`'s taxonomy
 * is a structural subset of `DocumentStatus`, see `document-file.ts`'s module doc comment).
 *
 * Split into two functions rather than M6's single `advanceAfterEvidence()`, because unlike
 * M6's Document (whose `quarantineObject.versionId` is a permanent "" placeholder,
 * `document.ts`'s doc comment), a `DocumentFile.quarantineObject.versionId` IS the field the
 * symmetric evidence correlation consolidates into (D-163 §1) - so this function never needs to
 * reach into S3 itself just to decide PROMOTE-vs-not: it returns `READY_TO_PROMOTE` with the
 * `sourceObject` a worker copies from, and does zero writes for that outcome (never claims CLEAN
 * for a copy that hasn't happened, same discipline M6's PROMOTE branch already established).
 * `confirmFileScanClean()` is the confirmation step, called only once that caller's own S3
 * copy+verify has succeeded - mirrors M6's `advanceAfterEvidence()` PROMOTE branch's contract,
 * just as a separate, independently retryable step instead of inlined in the same function.
 *
 * D-193 ("Ingestão física"): every `transactWrite` this file performs is fenced against
 * `TenantLifecycleRecord.status = ACTIVE` via `tryTenantBusinessMutation()` — added explicitly to
 * BOTH functions' own transactional writes (never inherited from a caller), same discipline
 * `advance-after-evidence.ts`/`finalizer.ts`/`result-processor.ts` already apply to M6's
 * equivalent writes (W3-07). Before this, these two functions (with zero real call sites) had
 * never been fenced at all — the design's explicit closing item.
 */
import { buildVersionedCreate, buildVersionedUpdate, isTransactionCanceled, type EntityKey, type TransactWriteEntry } from "../../../shared/dynamodb/occ.js";
import { tryTenantBusinessMutation } from "../../../shared/tenant-lifecycle/tenant-business-mutation.js";
import { decideNextAction } from "../../document/domain/document-state-machine.js";
import type { UploadEvidence } from "../../document/domain/document.js";
import type { DocumentObjectReference } from "../../document/domain/document-object-reference.js";
import type { MalwareEvidence } from "../../document/domain/malware-scan-result.js";
import { documentFileKey, isNonTerminalFileScanStatus, sameObjectVersion, type DocumentFile, type DocumentFileScanStatus } from "../domain/document-file.js";
import { documentVersionEventKey, type DocumentVersionEvent } from "../domain/document-version-event.js";
import { documentVersionKey, type DocumentVersion } from "../domain/document-version.js";
import type { DocumentArchiveStore } from "../ports/document-archive-store.js";
import type { DocumentArchiveIdGenerator } from "./id-generator.js";

export interface ApplyFileScanResultDeps {
  store: DocumentArchiveStore;
  tableName: string;
  ids: DocumentArchiveIdGenerator;
  now?: () => string;
}

export interface ApplyFileScanResultInput {
  tenantId: string;
  documentId: string;
  seq: number;
  fileId: string;
  /** The object reference THIS physical event actually observed (S3 Object Created / GuardDuty
   * finding) - never the stored `DocumentFile.quarantineObject`, per D-163 §1: the first event
   * to arrive consolidates FROM this triple, the second is verified AGAINST what got
   * consolidated, never re-derived from the Version or fabricated. */
  observedObject: DocumentObjectReference;
  uploadEvidence?: UploadEvidence;
  malwareEvidence?: MalwareEvidence;
}

export type ApplyFileScanResultOutcome =
  | { outcome: "AWAITING" }
  | { outcome: "IGNORED_WRONG_VERSION" }
  | { outcome: "IGNORED_STALE" }
  | { outcome: "IGNORED_TENANT_NOT_ACTIVE" }
  | { outcome: "REJECTED"; status: Extract<DocumentFileScanStatus, "REJECTED" | "UNSUPPORTED"> }
  | { outcome: "READY_TO_PROMOTE"; sourceObject: DocumentObjectReference };

const MAX_OCC_RETRIES = 10;

/** Re-reads the file fresh on every attempt - never assumes the caller's in-memory copy is
 * current, since the upload-finalizer and malware-scan events for the SAME file may land
 * concurrently, exactly the corridor `decideNextAction()`'s doc comment describes for M6. */
export async function applyFileScanResult(deps: ApplyFileScanResultDeps, input: ApplyFileScanResultInput): Promise<ApplyFileScanResultOutcome> {
  const now = deps.now ?? (() => new Date().toISOString());
  const key = documentFileKey(input.tenantId, input.documentId, input.seq, input.fileId);

  for (let attempt = 0; attempt < MAX_OCC_RETRIES; attempt++) {
    const file = await deps.store.get<DocumentFile>(key);
    if (!file) return { outcome: "IGNORED_STALE" };

    // Terminal-state idempotency FIRST, before any correlation check: a repeated/late event
    // against a file already at CLEAN/REJECTED/UNSUPPORTED/TIMEOUT is a legitimate replay, never
    // re-evaluated against the consolidated triple (D-163 §1's correlation only ever applies
    // while `scanStatus IN (PENDING_UPLOAD, SCANNING)`).
    if (!isNonTerminalFileScanStatus(file.scanStatus)) return { outcome: "IGNORED_STALE" };

    // D-163 §1 symmetric evidence correlation: `quarantineObject.versionId === ""` means no
    // physical event has consolidated it yet (`reserveFiles()`'s placeholder) - this event IS
    // the first, so it wins unconditionally. Once consolidated, every further event must match
    // that exact triple or is a stale/duplicate/wrong-object event, never re-consolidated.
    const consolidated = file.quarantineObject.versionId !== "";
    if (consolidated && !sameObjectVersion(file.quarantineObject, input.observedObject)) {
      return { outcome: "IGNORED_WRONG_VERSION" };
    }

    const mergedUploadEvidence = input.uploadEvidence ?? file.uploadEvidence;
    const mergedMalwareEvidence = input.malwareEvidence ?? file.malwareEvidence;

    const decision = decideNextAction({
      currentStatus: file.scanStatus,
      uploadValid: mergedUploadEvidence?.valid,
      uploadEvidence: mergedUploadEvidence,
      malwareEvidence: mergedMalwareEvidence,
    });

    const evidenceSet: Record<string, unknown> = {};
    if (input.uploadEvidence) evidenceSet["uploadEvidence"] = input.uploadEvidence;
    if (input.malwareEvidence) evidenceSet["malwareEvidence"] = input.malwareEvidence;
    const quarantineObjectSet = consolidated ? {} : { quarantineObject: input.observedObject };

    if (decision.action === "IGNORE_STALE_EVENT") return { outcome: "IGNORED_STALE" };

    if (decision.action === "AWAIT_MORE_EVIDENCE") {
      const nowTs = now();
      const result = await tryTenantBusinessMutation({
        store: deps.store,
        tableName: deps.tableName,
        tenantId: input.tenantId,
        entries: [
          {
            Update: buildVersionedUpdate({
              tableName: deps.tableName,
              key,
              tenantId: input.tenantId,
              expectedVersion: file.version,
              // SCANNING marks "at least one physical event has landed" independent of
              // decideNextAction's own vocabulary (it only ever returns actions, never this
              // specific status) - a no-op re-SET when the file was already SCANNING.
              set: { scanStatus: "SCANNING", ...quarantineObjectSet, ...evidenceSet },
              now: nowTs,
            }),
          },
        ],
      });
      if (result.ok) return { outcome: "AWAITING" };
      if (result.reason === "OCC_CONFLICT") continue; // concurrent half of evidence landed - retry fresh.
      return { outcome: "IGNORED_TENANT_NOT_ACTIVE" };
    }

    if (decision.action === "PROMOTE") {
      // Never claims CLEAN itself - zero writes here, same discipline M6's PROMOTE branch
      // established (`advance-after-evidence.ts`'s doc comment). The evidence merge that got us
      // here was already persisted by an earlier AWAITING call (PROMOTE is only reachable once
      // BOTH evidences exist, and only one arrives per call) - nothing new to consolidate.
      const sourceObject = consolidated ? file.quarantineObject : input.observedObject;
      return { outcome: "READY_TO_PROMOTE", sourceObject };
    }

    // decision.action === "REJECT": terminal transition - counters + GSI8 removal happen in the
    // SAME transaction as the file's own write (Decision 6/Bloqueador 9: a crash between the two
    // would leave pendingFileScans stuck above zero forever, permanently blocking acceptVersion).
    const version = await deps.store.get<DocumentVersion>(documentVersionKey(input.tenantId, input.documentId, input.seq));
    if (!version) return { outcome: "IGNORED_STALE" }; // Version cannot be removed once files exist - fail closed if this ever changes.

    const infected = mergedMalwareEvidence?.status === "THREATS_FOUND";
    const nowTs = now();
    const entries: TransactWriteEntry[] = [
      {
        Update: buildVersionedUpdate({
          tableName: deps.tableName,
          key,
          tenantId: input.tenantId,
          expectedVersion: file.version,
          set: { scanStatus: decision.status, ...quarantineObjectSet, ...evidenceSet },
          // D-163 §5/§6: any transaction reaching a terminal scanStatus removes the sparse GSI8
          // reconciliation pointer in the same write - never a separate cleanup step.
          remove: ["GSI8PK", "GSI8SK"],
          now: nowTs,
        }),
      },
      {
        Update: buildVersionedUpdate({
          tableName: deps.tableName,
          key: documentVersionKey(input.tenantId, input.documentId, input.seq),
          tenantId: input.tenantId,
          expectedVersion: version.version,
          set: { pendingFileScans: version.pendingFileScans - 1, ...(infected ? { infectedFileScans: version.infectedFileScans + 1 } : {}) },
          now: nowTs,
        }),
      },
    ];
    // D-163 §2 (Rodada 4): FILE_REJECTED_INFECTED is emitted only for the infection-caused
    // REJECTED transition, never for a plain upload-invalid REJECTED or an UNSUPPORTED one - the
    // audit trail exists specifically so "why was this file removed from consideration" is
    // answerable without re-deriving it from malwareEvidence.
    if (infected) {
      entries.push({
        Put: buildVersionedCreate(
          deps.tableName,
          buildFileRejectedEvent(deps, input.tenantId, input.documentId, input.seq, version.versionId, version.state, input.fileId, file.scanStatus, decision.status, nowTs) as unknown as Record<string, unknown> & EntityKey,
        ),
      });
    }
    const result = await tryTenantBusinessMutation({ store: deps.store, tableName: deps.tableName, tenantId: input.tenantId, entries });
    if (result.ok) return { outcome: "REJECTED", status: decision.status };
    if (result.reason === "OCC_CONFLICT") continue;
    return { outcome: "IGNORED_TENANT_NOT_ACTIVE" };
  }

  throw new Error(`applyFileScanResult exhausted retries for file ${input.fileId} under contention.`);
}

export type ConfirmFileScanCleanOutcome = "CONFIRMED" | "IGNORED_STALE" | "IGNORED_TENANT_NOT_ACTIVE";

export interface ConfirmFileScanCleanInput {
  tenantId: string;
  documentId: string;
  seq: number;
  fileId: string;
  cleanObject: DocumentObjectReference;
}

/**
 * confirmFileScanClean - the PROMOTE confirmation step, called only once the caller (a future
 * S3/GuardDuty event worker, out of scope for this slice) has already copied `sourceObject` to
 * `cleanObject` and verified it (size/checksum, same discipline M6's `advanceAfterEvidence()`
 * requires before it will persist CLEAN). Idempotent against a file that already moved off
 * SCANNING/PENDING_UPLOAD by the time this is called (e.g. concurrently rejected) - never
 * resurrects a terminal file back toward CLEAN.
 */
export async function confirmFileScanClean(deps: ApplyFileScanResultDeps, input: ConfirmFileScanCleanInput): Promise<ConfirmFileScanCleanOutcome> {
  const now = deps.now ?? (() => new Date().toISOString());
  const key = documentFileKey(input.tenantId, input.documentId, input.seq, input.fileId);

  for (let attempt = 0; attempt < MAX_OCC_RETRIES; attempt++) {
    const file = await deps.store.get<DocumentFile>(key);
    if (!file) return "IGNORED_STALE";
    if (!isNonTerminalFileScanStatus(file.scanStatus)) return "IGNORED_STALE";

    const version = await deps.store.get<DocumentVersion>(documentVersionKey(input.tenantId, input.documentId, input.seq));
    if (!version) return "IGNORED_STALE";

    const nowTs = now();
    const entries: TransactWriteEntry[] = [
      {
        Update: buildVersionedUpdate({
          tableName: deps.tableName,
          key,
          tenantId: input.tenantId,
          expectedVersion: file.version,
          set: { scanStatus: "CLEAN", cleanObject: input.cleanObject },
          remove: ["GSI8PK", "GSI8SK"],
          now: nowTs,
        }),
      },
      {
        Update: buildVersionedUpdate({
          tableName: deps.tableName,
          key: documentVersionKey(input.tenantId, input.documentId, input.seq),
          tenantId: input.tenantId,
          expectedVersion: version.version,
          set: { pendingFileScans: version.pendingFileScans - 1 },
          now: nowTs,
        }),
      },
    ];
    const result = await tryTenantBusinessMutation({ store: deps.store, tableName: deps.tableName, tenantId: input.tenantId, entries });
    if (result.ok) return "CONFIRMED";
    if (result.reason === "OCC_CONFLICT") continue;
    return "IGNORED_TENANT_NOT_ACTIVE";
  }

  throw new Error(`confirmFileScanClean exhausted retries for file ${input.fileId} under contention.`);
}

export type ApplyFileScanTimeoutOutcome = "TIMED_OUT" | "IGNORED_STALE";

export interface ApplyFileScanTimeoutInput {
  tenantId: string;
  documentId: string;
  seq: number;
  fileId: string;
  /** The exact GSI8 pointer the reconciliation scan observed (D-163 round4 §3) - the
   * transaction below conditions on it verbatim, so a candidate whose deadline changed or
   * that already reached a terminal state between the scan and this write is naturally
   * skipped (ConditionalCheckFailed -> IGNORED_STALE) rather than double-processed. */
  observedGsi8Pointer: { GSI8PK: string; GSI8SK: string };
}

/**
 * applyFileScanTimeout - the reconciliation worker's terminal transition
 * (PENDING_UPLOAD/SCANNING -> TIMEOUT), symmetric to applyFileScanResult's REJECT branch but
 * reached by deadline rather than by a physical S3/GuardDuty event. Deliberately reuses the
 * exact same counter/GSI8-removal mechanism (buildVersionedUpdate, no new pattern) - the only
 * new ingredient is conditioning on the observed GSI8 pointer itself, which a physical-event
 * caller never needs (it always re-reads the file fresh and checks scanStatus, never a stale
 * discovery pointer).
 */
export async function applyFileScanTimeout(deps: ApplyFileScanResultDeps, input: ApplyFileScanTimeoutInput): Promise<ApplyFileScanTimeoutOutcome> {
  const now = deps.now ?? (() => new Date().toISOString());
  const key = documentFileKey(input.tenantId, input.documentId, input.seq, input.fileId);

  for (let attempt = 0; attempt < MAX_OCC_RETRIES; attempt++) {
    const file = await deps.store.get<DocumentFile>(key);
    if (!file) return "IGNORED_STALE";
    if (!isNonTerminalFileScanStatus(file.scanStatus)) return "IGNORED_STALE";

    const version = await deps.store.get<DocumentVersion>(documentVersionKey(input.tenantId, input.documentId, input.seq));
    if (!version) return "IGNORED_STALE"; // Version cannot be removed once files exist - fail closed if this ever changes.

    const nowTs = now();
    const entries: TransactWriteEntry[] = [
      {
        Update: buildVersionedUpdate({
          tableName: deps.tableName,
          key,
          tenantId: input.tenantId,
          expectedVersion: file.version,
          set: { scanStatus: "TIMEOUT" },
          remove: ["GSI8PK", "GSI8SK"],
          // Exact-pointer fence (round4-claude-final.md §3): closes the race where the
          // candidate this scan observed already advanced (new deadline, or terminal) by the
          // time this write lands - never conditioned on `file.version` alone, since a
          // concurrent SCANNING->TIMEOUT-eligible re-write could bump version without changing
          // eligibility in a way the scan already accounted for.
          extraConditions: [
            { expression: "#gsi8pk = :gsi8pk", names: { "#gsi8pk": "GSI8PK" }, values: { ":gsi8pk": input.observedGsi8Pointer.GSI8PK } },
            { expression: "#gsi8sk = :gsi8sk", names: { "#gsi8sk": "GSI8SK" }, values: { ":gsi8sk": input.observedGsi8Pointer.GSI8SK } },
          ],
          now: nowTs,
        }),
      },
      {
        Update: buildVersionedUpdate({
          tableName: deps.tableName,
          key: documentVersionKey(input.tenantId, input.documentId, input.seq),
          tenantId: input.tenantId,
          expectedVersion: version.version,
          set: { pendingFileScans: version.pendingFileScans - 1 },
          now: nowTs,
        }),
      },
    ];
    try {
      await deps.store.transactWrite(entries);
      return "TIMED_OUT";
    } catch (err) {
      if (isTransactionCanceled(err)) return "IGNORED_STALE"; // lost the race - a concurrent event/sweep already claimed this file.
      throw err;
    }
  }

  throw new Error(`applyFileScanTimeout exhausted retries for file ${input.fileId} under contention.`);
}

function buildFileRejectedEvent(
  deps: ApplyFileScanResultDeps,
  tenantId: string,
  documentId: string,
  seq: number,
  versionId: string,
  versionState: DocumentVersionEvent["toState"],
  fileId: string,
  fromFileScanStatus: DocumentFileScanStatus,
  toFileScanStatus: DocumentFileScanStatus,
  occurredAt: string,
): DocumentVersionEvent {
  return {
    ...documentVersionEventKey(tenantId, documentId, seq, deps.ids.newEventId()),
    entityType: "DocumentVersionEvent",
    tenantId,
    documentId,
    versionId,
    type: "FILE_REJECTED_INFECTED",
    // `fromState`/`toState` record the Version's own (unchanged) state as informational context
    // only - the real transition this event carries is fromFileScanStatus/toFileScanStatus
    // below, per document-version-event.ts's doc comment on this event type.
    fromState: versionState,
    toState: versionState,
    fileId,
    fromFileScanStatus,
    toFileScanStatus,
    actor: "SYSTEM",
    occurredAt,
  };
}

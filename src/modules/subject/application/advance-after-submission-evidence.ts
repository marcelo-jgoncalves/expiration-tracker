/**
 * Agregado-irmão de document/application/advance-after-evidence.ts, operando sobre
 * `DocumentSubmission` em vez de `Document`. Reaproveita a MESMA lógica pura de decisão
 * (`decideNextAction`, document-state-machine.ts) — vocabulário de evidência/estado é
 * idêntico e agnóstico a quem iniciou o upload — mas nunca toca o agregado `Document` nem seu
 * store, e replica as mesmas lições de bug real já documentadas em M6 (retry sob OCC
 * concorrente, nunca copiar de `quarantineObject` com versionId vazio, delete best-effort).
 */
import { buildVersionedUpdate } from "../../../shared/dynamodb/occ.js";
import { decideNextAction } from "../../document/domain/document-state-machine.js";
import { sameObjectVersion } from "../../document/domain/document-object-reference.js";
import type { DocumentObjectStore } from "../../document/ports/document-object-store.js";
import { documentSubmissionKey, type DocumentSubmission } from "../domain/document-submission.js";
import type { SubjectStore, TransactWriteEntry } from "../ports/subject-store.js";
import { tryTenantBusinessMutation } from "../../../shared/tenant-lifecycle/tenant-business-mutation.js";

export interface AdvanceAfterSubmissionEvidenceDeps {
  store: SubjectStore;
  objects: DocumentObjectStore;
  tableName: string;
  cleanBucket: string;
}

export type AdvanceSubmissionOutcome = "PROMOTED" | "REJECTED" | "AWAITING" | "IGNORED_STALE" | "IGNORED_WRONG_VERSION" | "IGNORED_TENANT_NOT_ACTIVE";

const MAX_OCC_RETRIES = 10;

export async function advanceAfterSubmissionEvidence(
  deps: AdvanceAfterSubmissionEvidenceDeps,
  input: { tenantId: string; subjectId: string; assignmentId: string; submissionId: string; expectedObject: { bucket: string; key: string; versionId: string } },
): Promise<AdvanceSubmissionOutcome> {
  for (let attempt = 0; attempt < MAX_OCC_RETRIES; attempt++) {
    const key = documentSubmissionKey(input.tenantId, input.subjectId, input.assignmentId, input.submissionId);
    const submission = await deps.store.get<DocumentSubmission>(key);
    if (!submission) return "IGNORED_STALE";

    const knownObject = submission.uploadEvidence?.object ?? submission.malwareEvidence?.object;

    if (knownObject && knownObject.key === input.expectedObject.key && !sameObjectVersion(knownObject, input.expectedObject)) {
      return "IGNORED_WRONG_VERSION";
    }

    const decision = decideNextAction({
      currentStatus: submission.status,
      uploadValid: submission.uploadEvidence?.valid,
      uploadEvidence: submission.uploadEvidence,
      malwareEvidence: submission.malwareEvidence,
    });

    if (decision.action === "IGNORE_STALE_EVENT") return "IGNORED_STALE";
    if (decision.action === "AWAIT_MORE_EVIDENCE") return "AWAITING";

    if (decision.action === "REJECT") {
      // W3-07 (Round F/G finding, same as advance-after-evidence.ts): REJECT is itself a
      // TenantBusinessMutation, not just the final CLEAN promotion.
      const rejectResult = await tryTenantBusinessMutation({
        store: deps.store,
        tableName: deps.tableName,
        tenantId: input.tenantId,
        entries: [{ Update: buildVersionedUpdate({ tableName: deps.tableName, key, tenantId: input.tenantId, expectedVersion: submission.version, set: { status: decision.status } }) }],
      });
      if (rejectResult.ok) return "REJECTED";
      if (rejectResult.reason === "OCC_CONFLICT") continue;
      return "IGNORED_TENANT_NOT_ACTIVE";
    }

    const sourceObject = knownObject ?? submission.quarantineObject;
    const cleanKey = `clean/${submission.tenantId}/${submission.submissionId}`;
    const cleanObject = await deps.objects.copyObject(sourceObject, deps.cleanBucket, cleanKey);
    const verify = await deps.objects.headObject(cleanObject);
    if (!verify || verify.contentLength !== submission.contentLength) {
      // W3-07 review finding (Codex round 1, 2026-08-29), same as advance-after-evidence.ts:
      // `cleanBucket` is versioned - compensate this exact version before surfacing the error,
      // rather than leaving it orphaned on every failed-verification retry.
      try {
        await deps.objects.deleteObjectVersion(cleanObject);
      } catch {
        // Best-effort - same backstop reasoning as the TENANT_NOT_ACTIVE compensation below.
      }
      throw new Error(`Promotion copy verification failed for submission ${submission.submissionId}`);
    }

    const entries: TransactWriteEntry[] = [
      { Update: buildVersionedUpdate({ tableName: deps.tableName, key, tenantId: input.tenantId, expectedVersion: submission.version, set: { status: "CLEAN", cleanObject } }) },
    ];
    // W3-07 (Round F/G finding, same as advance-after-evidence.ts): the copy above already
    // happened before this fenced commit - on TENANT_NOT_ACTIVE specifically, compensate the
    // orphaned clean object right here (immediate compensation; permanent post-DELETED sweeper
    // is the backstop for the residual post-final-scan late-copy race, not attempted this
    // session - see advance-after-evidence.ts's comment for the full reasoning).
    const promoteResult = await tryTenantBusinessMutation({ store: deps.store, tableName: deps.tableName, tenantId: input.tenantId, entries });
    if (!promoteResult.ok) {
      // W3-07 review finding (Codex round 1, 2026-08-29), same as advance-after-evidence.ts:
      // compensate on EVERY non-committed outcome (OCC_CONFLICT too, not just the fence
      // rejection) - the deterministic key + versioned bucket means every losing attempt left
      // its own orphaned version behind even when a later retry went on to succeed.
      try {
        await deps.objects.deleteObjectVersion(cleanObject);
      } catch {
        // Best-effort - see comment above.
      }
      if (promoteResult.reason === "OCC_CONFLICT") continue;
      return "IGNORED_TENANT_NOT_ACTIVE";
    }
    try {
      await deps.objects.deleteObjectVersion(sourceObject);
    } catch {
      // Best-effort - mesma decisão de M6 (advance-after-evidence.ts): lifecycle rule do
      // bucket de quarentena é o backstop.
    }
    return "PROMOTED";
  }

  throw new Error(`advanceAfterSubmissionEvidence exhausted retries for submission ${input.submissionId} under contention.`);
}

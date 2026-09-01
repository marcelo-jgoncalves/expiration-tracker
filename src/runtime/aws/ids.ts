/**
 * Real ID generator (M3.5) - implements every module's ID-generator port
 * (ExpirationIdGenerator, ReminderIdGenerator, identity's IdGenerator, plus the
 * newEventId/correlationId shape workers expect) with ulid, already a project dependency.
 * One instance per Lambda invocation composition root - never shared as a singleton with
 * mutable state, ulid itself is stateless.
 */
import { ulid } from "ulid";
import type { ExpirationIdGenerator } from "../../modules/expiration/application/id-generator.js";
import type { ReminderIdGenerator } from "../../modules/reminder/application/id-generator.js";
import type { IdGenerator as IdentityIdGenerator } from "../../modules/identity/application/resolve-request-context.js";
import type { DocumentIdGenerator } from "../../modules/document/application/id-generator.js";
import type { SubjectIdGenerator } from "../../modules/subject/application/id-generator.js";
import type { ImportIdGenerator } from "../../modules/import/application/id-generator.js";
import type { OrganizationIdGenerator } from "../../modules/organization/application/id-generator.js";
import type { DocumentArchiveIdGenerator } from "../../modules/document-archive/application/id-generator.js";

export class UlidIdGenerator
  implements
    ExpirationIdGenerator,
    ReminderIdGenerator,
    IdentityIdGenerator,
    DocumentIdGenerator,
    SubjectIdGenerator,
    ImportIdGenerator,
    OrganizationIdGenerator,
    DocumentArchiveIdGenerator
{
  newItemId(): string {
    return `item_${ulid()}`;
  }
  newAuditEventId(): string {
    return `audit_${ulid()}`;
  }
  newEventId(): string {
    return `evt_${ulid()}`;
  }
  newPolicyId(): string {
    return `policy_${ulid()}`;
  }
  newTriggerId(): string {
    return `trigger_${ulid()}`;
  }
  newIntentId(): string {
    return `intent_${ulid()}`;
  }
  newAttemptId(): string {
    return `attempt_${ulid()}`;
  }
  newUserId(): string {
    return `user_${ulid()}`;
  }
  newSessionId(): string {
    return `session_${ulid()}`;
  }
  newDocumentId(): string {
    return `doc_${ulid()}`;
  }
  /** D-143 Nucleus 1 (Document Archive domain) - shares `newDocumentId()`/`newEventId()` above
   * (same prefix, structurally satisfies DocumentArchiveIdGenerator too - no meaningful
   * distinction between "a document id" across the two modules), only `newVersionId()` is new. */
  newVersionId(): string {
    return `docver_${ulid()}`;
  }
  newUploadSlotId(): string {
    return `slot_${ulid()}`;
  }
  /** D-143 Nucleus 2, Requirement (D-145). */
  newRequirementId(): string {
    return `req_${ulid()}`;
  }
  newSubjectId(): string {
    return `subject_${ulid()}`;
  }
  newAssignmentId(): string {
    return `assignment_${ulid()}`;
  }
  newSubmissionId(): string {
    return `submission_${ulid()}`;
  }
  newImportJobId(): string {
    return `importjob_${ulid()}`;
  }
  newDeviceId(): string {
    return `device_${ulid()}`;
  }
  newOrganizationId(): string {
    return `org_${ulid()}`;
  }
  newMembershipId(): string {
    return `membership_${ulid()}`;
  }
  newInvitationId(): string {
    return `invitation_${ulid()}`;
  }
}

export function newCorrelationId(): string {
  return `corr_${ulid()}`;
}

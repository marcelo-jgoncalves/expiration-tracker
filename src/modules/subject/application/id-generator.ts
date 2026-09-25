/** ID generation port — mesmo padrão de ExpirationIdGenerator/ReminderIdGenerator. ADR-0016
 * Decision A retired `newAssignmentId`/`newSubmissionId` along with RequirementAssignment/
 * DocumentSubmission — this module now only needs ids for TrackedSubject and its own audit
 * trail. */
export interface SubjectIdGenerator {
  newSubjectId(): string;
  newAuditEventId(): string;
}

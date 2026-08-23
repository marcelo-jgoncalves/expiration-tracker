/** ID generation port — mesmo padrão de ExpirationIdGenerator/ReminderIdGenerator. */
export interface SubjectIdGenerator {
  newSubjectId(): string;
  newAssignmentId(): string;
  newAuditEventId(): string;
  newSubmissionId(): string;
}

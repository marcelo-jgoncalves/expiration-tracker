/** ID generation port — mesmo padrão de SubjectIdGenerator/ReminderIdGenerator. */
export interface ImportIdGenerator {
  newImportJobId(): string;
}

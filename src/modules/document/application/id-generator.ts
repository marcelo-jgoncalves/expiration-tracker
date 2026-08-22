/** ID generation port — same pattern as expiration/identity modules' IdGenerator. */
export interface DocumentIdGenerator {
  newDocumentId(): string;
  newUploadSlotId(): string;
}

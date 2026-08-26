/** Same shape/contract as `src/modules/bff/ports/token-encryptor.ts` (D-054's mandatory-
 * envelope-encryption pattern) — declared locally rather than imported cross-module so
 * `extraction` and `bff` stay independently deployable/testable (dependency-cruiser boundary
 * discipline, AGENTS.md §7); a shared KMS adapter can implement both ports identically once a
 * real `TaskTokenEncryptor` Terraform CMK exists (see NEXT_SESSION_PROMPT.md). */
export interface TaskTokenEncryptor {
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}

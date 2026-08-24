/**
 * Encryption-at-rest port for the Cognito refresh token (D-054: "cripto obrigatória via CMK
 * dedicada nova" - mandatory, not best-effort, unlike RevokeToken at logout). SDK-agnostic so
 * the domain/application layer never imports @aws-sdk/client-kms directly.
 */
export interface TokenEncryptor {
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}

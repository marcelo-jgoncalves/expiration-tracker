/** D-313 (2026-09-21) - presigns a GET against a Document's `cleanObject` triple (never
 * `quarantineObject`, which must never be read directly by a client - same discipline
 * `ExternalShareLinkFileStore`'s own header comment documents for document-archive). Deliberately
 * narrower than `UploadUrlSigner` (that port presigns PUTs against `quarantineObject`, an
 * entirely different bucket/lifecycle) - same "don't share a presigner across upload and
 * download" separation already established for that module. */
import type { DocumentObjectReference } from "../domain/document-object-reference.js";

export interface DocumentDownloadUrlSigner {
  presignDownload(input: { objectRef: DocumentObjectReference; fileName: string; expiresInSeconds: number }): Promise<string>;
}

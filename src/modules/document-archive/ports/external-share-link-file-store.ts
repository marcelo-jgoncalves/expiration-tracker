/** D-225 Decision 5 — presigns a GET against a `DocumentFile.cleanObject` triple for the
 * anonymous visitor route. Deliberately narrower than `UploadUrlSigner` (that port presigns
 * PUTs against `quarantineObject`, an entirely different bucket/lifecycle) — never reused across
 * the two, same "don't share a presigner across upload and download" separation the dossier-export
 * store already keeps for its own bucket. */
import type { DocumentObjectReference } from "../../document/domain/document-object-reference.js";

export interface ExternalShareLinkFileStore {
  presignDownload(input: { objectRef: DocumentObjectReference; fileName: string; expiresInSeconds: number }): Promise<string>;
}

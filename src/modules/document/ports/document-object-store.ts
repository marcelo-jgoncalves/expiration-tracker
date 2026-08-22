/** S3 surface the Document module needs — abstracted so application logic never depends on
 * @aws-sdk/client-s3 directly (same SDK-agnostic port discipline as DocumentStore). */
import type { DocumentObjectReference } from "../domain/document-object-reference.js";

export interface ObjectMetadata {
  contentLength: number;
  mediaType: string;
  checksumSha256?: string;
}

export interface DocumentObjectStore {
  /** HeadObject on the exact bucket/key/versionId - never a bare key. */
  headObject(ref: DocumentObjectReference): Promise<ObjectMetadata | undefined>;
  /** Copies the exact source version to a new key in the destination bucket; returns the new
   * object's own versionId. Never a "move" - the quarantine object is deleted separately, only
   * after the clean copy is confirmed. */
  copyObject(source: DocumentObjectReference, destinationBucket: string, destinationKey: string): Promise<DocumentObjectReference>;
  /** Deletes a specific version - used for quarantine cleanup after confirmed promotion, and
   * for logical-deletion purge. Never deletes "the current version of a key" ambiguously. */
  deleteObjectVersion(ref: DocumentObjectReference): Promise<void>;
}

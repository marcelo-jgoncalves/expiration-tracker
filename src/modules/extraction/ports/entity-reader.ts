/** Generic, single-item DynamoDB read port — same narrow shape as `DocumentReader`
 * (document-reader.ts), reused for the OTHER entities M7 item 8's confirm/reject routes need
 * to read (`ExpirationItem`, `ExtractionRun`) without the extraction module depending on the
 * expiration/document modules' own store port types. Deliberately generic rather than three
 * near-identical single-purpose port files — `DocumentReader` itself is already this exact
 * shape; this file exists so the two OTHER readers have a name that doesn't imply a dependency
 * on the document module. */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export interface EntityReader {
  get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey, consistentRead?: boolean): Promise<T | undefined>;
}

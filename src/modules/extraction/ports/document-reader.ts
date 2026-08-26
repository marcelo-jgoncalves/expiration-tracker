/** Narrow, read-only port into the Document module's storage — same isolation pattern as
 * UploadSlotReconciliationSource (document/ports/document-store.ts): ExtractionStarterWorker
 * needs to read a Document (to confirm CLEAN and read itemId/version) but must never gain any
 * write capability on it, and the extraction module deliberately doesn't depend on the
 * document module's own DocumentStore port type (keeps this module's port surface
 * self-contained). */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export interface DocumentReader {
  get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey, consistentRead?: boolean): Promise<T | undefined>;
}

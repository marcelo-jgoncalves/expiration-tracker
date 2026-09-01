/**
 * DynamoDB surface the activity module needs — one paginated Query-by-PK per audit
 * partition (D-149: no new GSI, direct PK Query, same pattern `expiration/audit-event.ts`
 * already uses in isolation via ExpirationStore.queryByPk, except THIS port returns one
 * real physical page + lastEvaluatedKey per call, same D-136/D-E discipline as
 * ExpirationStore.queryGsi1Page — the k-way merge's cursor correctness depends on knowing
 * exactly which raw fetch batch produced which page, so an internal accumulate-loop here
 * would defeat the whole point.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export interface AuditPartitionPageInput {
  pk: string;
  ascending: boolean;
  limit: number;
  exclusiveStartKey?: EntityKey;
}

export interface AuditPartitionPage<T> {
  items: T[];
  lastEvaluatedKey?: EntityKey;
}

export interface AuditPartitionStore {
  queryPage<T extends EntityKey = Record<string, unknown> & EntityKey>(input: AuditPartitionPageInput): Promise<AuditPartitionPage<T>>;
}

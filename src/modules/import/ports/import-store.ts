/**
 * DynamoDB surface do módulo import — mesmo padrão SDK-agnostic de
 * src/modules/expiration/ports/expiration-store.ts. `queryByPk` reaproveitado para listar
 * imports de um tenant (não há GSI dedicado em v1 — volume esperado é baixo, revisar se
 * necessário).
 */
import type { EntityKey, TransactWriteEntry } from "../../../shared/dynamodb/occ.js";

export type { EntityKey, TransactWriteEntry };
export { isTransactionCanceled } from "../../../shared/dynamodb/occ.js";

export interface ImportStore {
  get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined>;
  putIfAbsent<T extends EntityKey>(item: T): Promise<boolean>;
  update<T extends EntityKey>(item: T): Promise<void>;
  transactWrite(entries: TransactWriteEntry[]): Promise<void>;
  queryByPk<T extends EntityKey = Record<string, unknown> & EntityKey>(pk: string, skPrefix?: string): Promise<T[]>;
}

/**
 * DynamoDB surface do módulo subject — mesmo padrão SDK-agnostic de
 * src/modules/expiration/ports/expiration-store.ts. `transactWrite` porque toda mutação de
 * TrackedSubject/RequirementAssignment que afeta o contador de entitlement precisa comitar
 * agregado + contador + audit numa única TransactWriteItems (nunca separado, ver
 * domain/entitlement.ts).
 */
import type { EntityKey, TransactWriteEntry } from "../../../shared/dynamodb/occ.js";

export type { EntityKey, TransactWriteEntry };
export { TRANSACTION_CANCELED, isTransactionCanceled } from "../../../shared/dynamodb/occ.js";

export interface Gsi7QueryInput {
  gsi7pk: string;
  ascending?: boolean;
  limit?: number;
}

export interface SubjectStore {
  /** Leitura fortemente consistente (mesma exigência de ExpirationStore.get). */
  get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined>;
  putIfAbsent<T extends EntityKey>(item: T): Promise<boolean>;
  /** Unconditional overwrite - only for bookkeeping writes with no concurrent-writer risk (ver `updateConditional` para o caso de contador). */
  update<T extends EntityKey>(item: T): Promise<void>;
  /** PutItem condicionado ao contador ainda bater com `expected` no momento da escrita — mesmo
   * padrão/mesma correção real de `IdentityStore.updateConditional` (bug de produção real: `count`
   * é palavra reservada do DynamoDB, exige `ExpressionAttributeNames`). Usado por
   * `GuestRateLimiter` para evitar lost update sob concorrência. */
  updateConditional<T extends EntityKey>(item: T, expected: { count: number; resetAt: string }): Promise<boolean>;
  transactWrite(entries: TransactWriteEntry[]): Promise<void>;
  /** GSI7 — listagem de subjects por status/tipo/nome (domain/tracked-subject.ts#gsi7Keys). */
  queryGsi7<T extends EntityKey = Record<string, unknown> & EntityKey>(input: Gsi7QueryInput): Promise<T[]>;
  /** Query pela partição do subject com prefixo de SK — lista RequirementAssignment sem GSI
   * novo (coleção sob a partição, mesmo padrão de identity/document já em produção). */
  queryByPk<T extends EntityKey = Record<string, unknown> & EntityKey>(pk: string, skPrefix?: string): Promise<T[]>;
  /** D-192 §4: `BatchGetItem` real (com retry de `UnprocessedKeys`) — usado pela resolução de
   * referência do bulk-import de Document/Requirement para resolver um `Set` de chaves
   * DISTINTAS de uma vez (pointer de externalId numa fase, `TrackedSubject` na outra), nunca um
   * `get()` por linha. Ordem do retorno não é garantida (mesma semântica de `BatchGetItem` real)
   * — chamador deve indexar pela própria chave, nunca assumir a ordem de `keys`. Chave ausente
   * na tabela é simplesmente omitida do array de retorno (nunca `undefined` no meio do array).*/
  batchGet<T extends EntityKey = Record<string, unknown> & EntityKey>(keys: EntityKey[]): Promise<T[]>;
}

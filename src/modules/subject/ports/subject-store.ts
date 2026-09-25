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

/** D-194 Fatia 3 (search/filters): one real physical GSI7 page per call, unlike `queryGsi7`
 * above (which accumulates across pages internally — fine for the bounded `listSubjects`
 * dashboard read, but exactly the D-142 cursor-skip shape `searchSubjects` must avoid so its
 * cursor can resume from the real `LastEvaluatedKey`). Mirrors `ExpirationStore.queryGsi1Page`/
 * `DocumentArchiveStore.queryIndexPage`. */
export interface Gsi7PageInput {
  gsi7pk: string;
  ascending?: boolean;
  limit?: number;
  exclusiveStartKey?: Record<string, unknown>;
}
export interface Gsi7Page<T> {
  items: T[];
  lastEvaluatedKey?: Record<string, unknown>;
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
  /** D-194 Fatia 3 — one physical GSI7 page per call, see `Gsi7PageInput`'s doc comment. */
  queryGsi7Page<T extends EntityKey = Record<string, unknown> & EntityKey>(input: Gsi7PageInput): Promise<Gsi7Page<T>>;
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

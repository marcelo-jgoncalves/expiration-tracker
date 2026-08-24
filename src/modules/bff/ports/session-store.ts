/**
 * SDK-agnostic port for the dedicated BFF session table (D-054 - never the main single-table
 * aggregate). Same shape as src/modules/identity/ports/identity-store.ts so the same fake
 * (test double) style/expectations carry over for anyone reading both modules.
 */
export interface EntityKey {
  PK: string;
  SK: string;
}

export interface SessionStore {
  putIfAbsent<T extends EntityKey>(item: T): Promise<boolean>;
  get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined>;
  update<T extends EntityKey>(item: T): Promise<void>;
  /** Conditional overwrite - used for the refresh lease (fencing token) and for optimistic
   * version bumps on the session record, so two concurrent refreshes never both "win". */
  updateConditional<T extends EntityKey>(item: T, expected: { version: number }): Promise<boolean>;
}

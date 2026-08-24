import type { EntityKey, SessionStore } from "../../../src/modules/bff/ports/session-store.js";

/** In-memory fake of the dedicated BFF session table, same convention as
 * test/unit/identity/in-memory-store.ts's InMemoryIdentityStore. */
export class InMemorySessionStore implements SessionStore {
  private readonly items = new Map<string, Record<string, unknown> & EntityKey>();

  private k(key: EntityKey): string {
    return `${key.PK}#${key.SK}`;
  }

  async putIfAbsent<T extends EntityKey>(item: T): Promise<boolean> {
    const k = this.k(item);
    if (this.items.has(k)) return false;
    this.items.set(k, item as unknown as Record<string, unknown> & EntityKey);
    return true;
  }

  async get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined> {
    return this.items.get(this.k(key)) as T | undefined;
  }

  async update<T extends EntityKey>(item: T): Promise<void> {
    this.items.set(this.k(item), item as unknown as Record<string, unknown> & EntityKey);
  }

  async updateConditional<T extends EntityKey>(item: T, expected: { version: number }): Promise<boolean> {
    const k = this.k(item);
    const stored = this.items.get(k) as (Record<string, unknown> & EntityKey & { version?: number }) | undefined;
    if (!stored || stored["version"] !== expected.version) return false;
    this.items.set(k, item as unknown as Record<string, unknown> & EntityKey);
    return true;
  }

  allItems(): (Record<string, unknown> & EntityKey)[] {
    return [...this.items.values()];
  }
}

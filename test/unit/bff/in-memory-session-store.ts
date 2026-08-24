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

/** Test-only wrapper: runs a one-shot hook right after the FIRST get() resolves, and calls an
 * (idempotent, test-controlled) hook after EVERY successful updateConditional() commit -
 * simulates "another request mutated this record concurrently" at a precise point without
 * needing real timers/IO. The commit hook fires on every commit (not just the first) because
 * callers like BffAuthService.refresh() issue more than one updateConditional in sequence
 * (lease acquire, then final commit) and a test may care about a specific one - it is the
 * test's own responsibility to no-op after it has done its one-shot side effect. */
export class HookableSessionStore implements SessionStore {
  private getFired = false;
  constructor(
    private readonly inner: SessionStore,
    private readonly onFirstGet: () => Promise<void> | void = () => {},
    private readonly onSuccessfulCommit: (item: EntityKey & { version?: number }) => Promise<void> | void = () => {},
  ) {}

  async get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined> {
    const result = await this.inner.get<T>(key);
    if (!this.getFired) {
      this.getFired = true;
      await this.onFirstGet();
    }
    return result;
  }

  putIfAbsent<T extends EntityKey>(item: T): Promise<boolean> {
    return this.inner.putIfAbsent(item);
  }
  update<T extends EntityKey>(item: T): Promise<void> {
    return this.inner.update(item);
  }
  async updateConditional<T extends EntityKey>(item: T, expected: { version: number }): Promise<boolean> {
    const result = await this.inner.updateConditional(item, expected);
    if (result) {
      await this.onSuccessfulCommit(item as unknown as EntityKey & { version?: number });
    }
    return result;
  }
}

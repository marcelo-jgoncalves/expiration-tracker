import type { DynamoDeleteCommandInput, EntityKey } from "../../../src/shared/dynamodb/occ.js";
import type { CoreUserDataPurgeCandidate, CoreUserDataPurgeCandidateSource, CoreUserDataScanPage, TenantLifecycleStatusSource } from "../../../src/workers/core-user-data-purge/candidate-source.js";

/** In-memory fake that evaluates the REAL `ConditionExpression` string `buildVersionedDelete`
 * builds — narrow support for exactly what `purge.ts` emits (`attribute_exists`/`=`, top-level
 * `AND`), same spirit as `document-purge-fakes.ts`'s evaluator, deliberately not shared with it
 * (different port shape, no transactWrite here). */
function evaluateDeleteCondition(input: DynamoDeleteCommandInput, item: Record<string, unknown> | undefined): boolean {
  const names = input.ExpressionAttributeNames ?? {};
  const values = input.ExpressionAttributeValues ?? {};
  const resolveName = (token: string) => (token.startsWith("#") ? (names[token] ?? token) : token);

  const parts = input.ConditionExpression!.split(" AND ").map((p) => {
    const trimmed = p.trim();
    // extraConditions wraps each caller-supplied clause in its own parens (occ.ts) - strip a
    // single outer layer so eqMatch below can see the bare `lhs = rhs` inside.
    return trimmed.startsWith("(") && trimmed.endsWith(")") && !trimmed.startsWith("attribute_") ? trimmed.slice(1, -1) : trimmed;
  });
  return parts.every((atom) => {
    const existsMatch = atom.match(/^attribute_exists\(([^)]+)\)$/);
    if (existsMatch) return item !== undefined && item[resolveName(existsMatch[1]!.trim())] !== undefined;
    const eqMatch = atom.match(/^(\S+)\s*=\s*(\S+)$/);
    if (eqMatch) {
      const [, lhsTok, rhsTok] = eqMatch;
      const lhs = item?.[resolveName(lhsTok!)];
      const rhs = rhsTok!.startsWith(":") ? values[rhsTok!] : rhsTok;
      return lhs === rhs;
    }
    throw new Error(`Unsupported condition atom in fake evaluator: ${atom}`);
  });
}

export class FakeCoreUserDataPurgeCandidateSource implements CoreUserDataPurgeCandidateSource {
  private readonly items = new Map<string, Record<string, unknown> & EntityKey>();
  /** Page size the fake hands back per `scanDeletedCandidates` call — small default so tests
   * can exercise pagination (`lastEvaluatedKey`) without seeding hundreds of rows. */
  pageSize = 1000;
  deleteCallCount = 0;

  seed(item: CoreUserDataPurgeCandidate): void {
    this.items.set(this.k(item), { ...item });
  }

  get(key: EntityKey): (Record<string, unknown> & EntityKey) | undefined {
    return this.items.get(this.k(key));
  }

  allKeys(): string[] {
    return [...this.items.keys()];
  }

  scanDeletedCandidates(exclusiveStartKey?: Record<string, unknown>): Promise<CoreUserDataScanPage> {
    const all = [...this.items.values()].filter(
      (i) => (i["entityType"] === "ExpirationItem" || i["entityType"] === "ReminderPolicy") && i["deletedAt"] !== undefined,
    ) as unknown as CoreUserDataPurgeCandidate[];
    const startIndex = exclusiveStartKey ? all.findIndex((i) => this.k(i) === this.k(exclusiveStartKey as unknown as EntityKey)) + 1 : 0;
    const page = all.slice(startIndex, startIndex + this.pageSize);
    const lastEvaluatedKey = startIndex + this.pageSize < all.length ? { PK: page[page.length - 1]!.PK, SK: page[page.length - 1]!.SK } : undefined;
    return Promise.resolve({ items: page, lastEvaluatedKey });
  }

  deleteCandidate(input: DynamoDeleteCommandInput): Promise<void> {
    this.deleteCallCount += 1;
    const existing = this.items.get(this.k(input.Key));
    if (input.ConditionExpression && !evaluateDeleteCondition(input, existing)) {
      throw { name: "ConditionalCheckFailedException", message: "The conditional request failed" };
    }
    this.items.delete(this.k(input.Key));
    return Promise.resolve();
  }

  private k(key: EntityKey): string {
    return `${key.PK}#${key.SK}`;
  }
}

export class FakeTenantLifecycleStatusSource implements TenantLifecycleStatusSource {
  private readonly statuses = new Map<string, string>();
  callCountByTenant = new Map<string, number>();

  setStatus(tenantId: string, status: string): void {
    this.statuses.set(tenantId, status);
  }

  getStatus(tenantId: string): Promise<string | undefined> {
    this.callCountByTenant.set(tenantId, (this.callCountByTenant.get(tenantId) ?? 0) + 1);
    return Promise.resolve(this.statuses.get(tenantId));
  }
}

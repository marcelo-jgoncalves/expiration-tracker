import type { DynamoDeleteCommandInput, EntityKey } from "../../../src/shared/dynamodb/occ.js";
import type {
  SecurityAuditPurgeCandidate,
  SecurityAuditPurgeCandidateSource,
  SecurityAuditScanPage,
  TenantLifecycleStatusSource,
} from "../../../src/workers/security-audit-purge/candidate-source.js";

const ENTITY_TYPES = new Set(["AuditEvent", "MembershipAuditEvent", "SubjectAuditEvent", "TenantAuditEvent"]);

/** In-memory fake that evaluates the REAL `ConditionExpression` string `buildConditionalDelete`
 * builds — same evaluator shape as the other purge workers' fakes (narrow support for exactly
 * what `purge.ts` emits: `attribute_exists`/`=`, top-level `AND`), deliberately not shared with
 * them (different port shape, no `version`). */
function evaluateDeleteCondition(input: DynamoDeleteCommandInput, item: Record<string, unknown> | undefined): boolean {
  const names = input.ExpressionAttributeNames ?? {};
  const values = input.ExpressionAttributeValues ?? {};
  const resolveName = (token: string) => (token.startsWith("#") ? (names[token] ?? token) : token);

  const parts = input.ConditionExpression!.split(" AND ").map((p) => {
    const trimmed = p.trim();
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

export class FakeSecurityAuditPurgeCandidateSource implements SecurityAuditPurgeCandidateSource {
  private readonly items = new Map<string, Record<string, unknown> & EntityKey>();
  /** Page size the fake hands back per `scanCandidates` call — small default so tests can
   * exercise pagination (`lastEvaluatedKey`) without seeding hundreds of rows. */
  pageSize = 1000;
  deleteCallCount = 0;

  seed(item: SecurityAuditPurgeCandidate): void {
    this.items.set(this.k(item), { ...item });
  }

  get(key: EntityKey): (Record<string, unknown> & EntityKey) | undefined {
    return this.items.get(this.k(key));
  }

  allKeys(): string[] {
    return [...this.items.keys()];
  }

  /** Test-only escape hatch to simulate a row disappearing between scan and delete (e.g. a
   * second concurrent run of this worker winning the race first) — deletes without going
   * through `deleteCandidate`'s condition evaluation. */
  removeDirectly(key: EntityKey): void {
    this.items.delete(this.k(key));
  }

  scanCandidates(exclusiveStartKey?: Record<string, unknown>): Promise<SecurityAuditScanPage> {
    const all = [...this.items.values()].filter(
      (i) => ENTITY_TYPES.has(i["entityType"] as string) && i["occurredAt"] !== undefined,
    ) as unknown as SecurityAuditPurgeCandidate[];
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

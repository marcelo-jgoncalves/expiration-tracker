import { describe, expect, it } from "vitest";
import { mergeAuditPage, computeHasMore, type FetchedAuditItem, type AuditPartition } from "../../../src/modules/activity/domain/merge.js";

function item(occurredAt: string, id: string): FetchedAuditItem {
  return { key: { PK: "pk", SK: `EVT#${occurredAt}#${id}` }, occurredAt, auditEventId: id, raw: { occurredAt, id } };
}

function emptyFetched(): Record<AuditPartition, FetchedAuditItem[]> {
  return { expiration: [], organization: [], subject: [], tenant: [] };
}

describe("mergeAuditPage", () => {
  it("merges 4 partitions into one page sorted descending by occurredAt", () => {
    const fetched = emptyFetched();
    fetched.expiration = [item("2026-09-01T10:00:00.000Z", "e1"), item("2026-09-01T08:00:00.000Z", "e2")];
    fetched.organization = [item("2026-09-01T09:00:00.000Z", "o1")];
    fetched.subject = [item("2026-09-01T07:00:00.000Z", "s1")];
    fetched.tenant = [item("2026-09-01T11:00:00.000Z", "t1")];

    const { page } = mergeAuditPage({ fetched, limit: 10, ascending: false });

    expect(page.map((p) => p.auditEventId)).toEqual(["t1", "e1", "o1", "e2", "s1"]);
  });

  it("respects limit, cutting off mid-merge", () => {
    const fetched = emptyFetched();
    fetched.expiration = [item("2026-09-01T10:00:00.000Z", "e1"), item("2026-09-01T08:00:00.000Z", "e2")];
    fetched.organization = [item("2026-09-01T09:00:00.000Z", "o1")];

    const { page } = mergeAuditPage({ fetched, limit: 2, ascending: false });

    expect(page.map((p) => p.auditEventId)).toEqual(["e1", "o1"]);
  });

  // The load-bearing case (design doc's own scoring history: 5 rounds, 3 failed here). A
  // partition's batch has items that DID NOT all make the page — the cursor for that
  // partition must point at the LAST CONSUMED item, never the raw fetch batch's last item
  // (which was fetched-but-discarded here) — using the discarded one would skip e3/e4/e5
  // forever on the next page.
  it("cursor for a partition stops at the last item that actually made the page, not the fetch batch's tail", () => {
    const fetched = emptyFetched();
    // Partition "expiration" batch of 5, descending, only the newest 2 fit in a limit-3 page
    // once merged against a single competing organization item.
    fetched.expiration = [
      item("2026-09-01T10:00:00.000Z", "e1"),
      item("2026-09-01T09:30:00.000Z", "e2"),
      item("2026-09-01T09:00:00.000Z", "e3"),
      item("2026-09-01T08:30:00.000Z", "e4"),
      item("2026-09-01T08:00:00.000Z", "e5"),
    ];
    fetched.organization = [item("2026-09-01T09:45:00.000Z", "o1")];

    const { page, consumedLast } = mergeAuditPage({ fetched, limit: 3, ascending: false });

    expect(page.map((p) => p.auditEventId)).toEqual(["e1", "o1", "e2"]);
    // MUST be e2's key (last consumed), never e5's (fetch batch tail) nor e3/e4 (never fetched further).
    expect(consumedLast.expiration).toEqual(fetched.expiration[1]!.key);
    expect(consumedLast.organization).toEqual(fetched.organization[0]!.key);
  });

  it("a partition contributing zero items to the page has no entry in consumedLast (cursor must not advance)", () => {
    const fetched = emptyFetched();
    fetched.expiration = [item("2026-09-01T10:00:00.000Z", "e1")];
    fetched.subject = [item("2026-09-01T01:00:00.000Z", "s1")]; // far older, cut off by limit

    const { page, consumedLast } = mergeAuditPage({ fetched, limit: 1, ascending: false });

    expect(page.map((p) => p.auditEventId)).toEqual(["e1"]);
    expect(consumedLast.subject).toBeUndefined();
    expect(consumedLast.expiration).toEqual(fetched.expiration[0]!.key);
  });

  it("ties on occurredAt are broken deterministically by auditEventId", () => {
    const fetched = emptyFetched();
    fetched.expiration = [item("2026-09-01T10:00:00.000Z", "b")];
    fetched.organization = [item("2026-09-01T10:00:00.000Z", "a")];

    const { page } = mergeAuditPage({ fetched, limit: 10, ascending: false });

    // descending: same occurredAt -> higher auditEventId first ("b" > "a")
    expect(page.map((p) => p.auditEventId)).toEqual(["b", "a"]);
  });

  it("ascending mode sorts oldest-first and ties break ascending", () => {
    const fetched = emptyFetched();
    fetched.expiration = [item("2026-09-01T08:00:00.000Z", "e1")];
    fetched.organization = [item("2026-09-01T09:00:00.000Z", "o1")];

    const { page } = mergeAuditPage({ fetched, limit: 10, ascending: true });

    expect(page.map((p) => p.auditEventId)).toEqual(["e1", "o1"]);
  });
});

describe("computeHasMore", () => {
  it("true when a partition has unconsumed fetched items left over", () => {
    const fetched = emptyFetched();
    fetched.expiration = [item("2026-09-01T10:00:00.000Z", "e1"), item("2026-09-01T09:00:00.000Z", "e2")];
    const { page } = mergeAuditPage({ fetched, limit: 1, ascending: false });

    expect(computeHasMore(fetched, page, {})).toBe(true);
  });

  it("true when a partition's underlying query indicated more beyond the fetched batch, even if fully consumed", () => {
    const fetched = emptyFetched();
    fetched.expiration = [item("2026-09-01T10:00:00.000Z", "e1")];
    const { page } = mergeAuditPage({ fetched, limit: 10, ascending: false });

    expect(computeHasMore(fetched, page, { expiration: true })).toBe(true);
  });

  it("false when every partition is fully consumed and none has more beyond the batch", () => {
    const fetched = emptyFetched();
    fetched.expiration = [item("2026-09-01T10:00:00.000Z", "e1")];
    const { page } = mergeAuditPage({ fetched, limit: 10, ascending: false });

    expect(computeHasMore(fetched, page, { expiration: false })).toBe(false);
  });
});

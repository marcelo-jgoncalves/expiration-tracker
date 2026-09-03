import { describe, expect, it } from "vitest";
import { runPagedSearch, SEARCH_MAX_PAGES, SEARCH_PAGE_SIZE } from "../../../src/shared/domain/paged-search.js";

/** Fake single-partition source, 25 items per physical page (mirrors the real GSI page size
 * every store port uses), so these tests exercise the exact "5 native pages of 25 (125
 * evaluated)" cap without touching any real store/service. */
function makeSource(totalItems: number) {
  const items = Array.from({ length: totalItems }, (_, i) => ({ id: i }));
  let pageCalls = 0;
  const fetchPage = async (exclusiveStartKey?: Record<string, unknown>) => {
    pageCalls += 1;
    const start = exclusiveStartKey ? (exclusiveStartKey["cursor"] as number) : 0;
    const page = items.slice(start, start + SEARCH_PAGE_SIZE);
    const nextStart = start + page.length;
    return { items: page, lastEvaluatedKey: nextStart < items.length ? { cursor: nextStart } : undefined };
  };
  return { fetchPage, callCount: () => pageCalls };
}

describe("runPagedSearch (D-194 Fatia 3, shared 5-page/125-item cap)", () => {
  it("returns everything and a natural end (no cursor, scanLimitReached false) when total fits within the cap", async () => {
    const source = makeSource(40); // 2 physical pages, well under the 5-page cap
    const result = await runPagedSearch({ fetchPage: source.fetchPage, matches: () => true });
    expect(result.items).toHaveLength(40);
    expect(result.lastEvaluatedKey).toBeUndefined();
    expect(result.scanLimitReached).toBe(false);
    expect(source.callCount()).toBe(2);
  });

  it("stops at exactly SEARCH_MAX_PAGES pages and signals scanLimitReached with a real resumable cursor when more data exists", async () => {
    const source = makeSource(500); // way more than 5*25=125
    const result = await runPagedSearch({ fetchPage: source.fetchPage, matches: () => true });
    expect(result.items).toHaveLength(SEARCH_MAX_PAGES * SEARCH_PAGE_SIZE);
    expect(source.callCount()).toBe(SEARCH_MAX_PAGES);
    expect(result.scanLimitReached).toBe(true);
    expect(result.lastEvaluatedKey).toEqual({ cursor: SEARCH_MAX_PAGES * SEARCH_PAGE_SIZE });
  });

  it("filters in memory over each page and only counts MATCHED items in the result, not evaluated ones", async () => {
    const source = makeSource(50);
    const result = await runPagedSearch({ fetchPage: source.fetchPage, matches: (item: { id: number }) => item.id % 2 === 0 });
    expect(result.items).toHaveLength(25); // half of 50, evaluated fully (2 pages, under the cap)
    expect(result.scanLimitReached).toBe(false);
  });

  it("resumes from a supplied exclusiveStartKey exactly where the previous call left off - no item skipped or repeated", async () => {
    const source = makeSource(60);
    const first = await runPagedSearch({ fetchPage: source.fetchPage, matches: () => true });
    expect(first.scanLimitReached).toBe(false); // 60 items = 3 pages, under cap
    expect(first.items).toHaveLength(60);

    // Simulate a caller-driven second call starting from a mid-stream cursor (exercised
    // independently of the "natural end" case above, using a fresh source and a hand-built key).
    // 150 items = 6 physical pages of 25 - strictly more than the 5-page cap, so the first call
    // genuinely stops early with more data still available.
    const source2 = makeSource(150);
    const capped = await runPagedSearch({ fetchPage: source2.fetchPage, matches: () => true });
    expect(capped.scanLimitReached).toBe(true);
    const resumed = await runPagedSearch({ exclusiveStartKey: capped.lastEvaluatedKey, fetchPage: source2.fetchPage, matches: () => true });
    expect(resumed.items).toHaveLength(150 - SEARCH_MAX_PAGES * SEARCH_PAGE_SIZE);
    expect(resumed.scanLimitReached).toBe(false);
    // Together, the two pages cover every item exactly once (id 0..149), no skip/dup.
    const allIds = [...capped.items, ...resumed.items].map((i: { id: number }) => i.id).sort((a, b) => a - b);
    expect(allIds).toEqual(Array.from({ length: 150 }, (_, i) => i));
  });
});

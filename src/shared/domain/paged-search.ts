/**
 * Shared "5 native pages of 25 items (125 evaluated), filter in memory" loop for D-194 Fatia 3
 * (`docs/architecture/reviews/search-and-filters-scoping/estado-final-consolidado.md`) —
 * `searchSubjects`/`searchRequirements`/`searchExpirationItems` all follow the exact same shape:
 * fetch one real physical GSI page, filter it in memory, repeat until either the underlying index
 * runs out (`lastEvaluatedKey` absent — a genuine "no more results") or the page cap is hit while
 * more data might still exist (`scanLimitReached: true`, same distinction `exportItems`'s
 * `EXPORT_ITEM_CAP` doc comment draws). Generic, no import from `src/modules/**` (same posture as
 * `validity-state.ts`/`search-cursor.ts`) — each module's service supplies its own `fetchPage`
 * closure bound to its own store/index, and its own `matches` in-memory predicate.
 */

export const SEARCH_MAX_PAGES = 5;
export const SEARCH_PAGE_SIZE = 25;

export interface PagedSearchResult<T> {
  items: T[];
  lastEvaluatedKey?: Record<string, unknown>;
  /** True only when the 5-page cap was hit while the underlying index still had more rows to
   * evaluate (a real `lastEvaluatedKey` on the last page fetched) — never true on a natural
   * end-of-index within budget, so a caller can tell "there might be more, refine your filters or
   * page again" from "this is genuinely everything". */
  scanLimitReached: boolean;
}

export async function runPagedSearch<T>(opts: {
  exclusiveStartKey?: Record<string, unknown>;
  fetchPage: (exclusiveStartKey?: Record<string, unknown>) => Promise<{ items: T[]; lastEvaluatedKey?: Record<string, unknown> }>;
  matches: (item: T) => boolean;
}): Promise<PagedSearchResult<T>> {
  const matched: T[] = [];
  let exclusiveStartKey = opts.exclusiveStartKey;
  let pagesFetched = 0;
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const page = await opts.fetchPage(exclusiveStartKey);
    pagesFetched += 1;
    for (const item of page.items) {
      if (opts.matches(item)) matched.push(item);
    }
    lastEvaluatedKey = page.lastEvaluatedKey;
    exclusiveStartKey = lastEvaluatedKey;
  } while (lastEvaluatedKey && pagesFetched < SEARCH_MAX_PAGES);

  const scanLimitReached = pagesFetched >= SEARCH_MAX_PAGES && lastEvaluatedKey !== undefined;
  return {
    items: matched,
    lastEvaluatedKey: scanLimitReached ? lastEvaluatedKey : undefined,
    scanLimitReached,
  };
}

/**
 * Bounded-parallel `map` - runs `fn` over `items` with at most `concurrency` in flight at
 * once, never `Promise.all`'s all-or-nothing rejection (perf audit D-170: an SQS batch
 * handler needs every item's outcome individually, including failures, to report accurate
 * per-message `batchItemFailures` - one item's rejection must never abort or hide another's
 * result). Each result is returned in the same order as `items`, tagged ok/error so the
 * caller decides retry semantics per item instead of the whole batch failing together.
 */
export type ConcurrencyResult<R> = { ok: true; value: R } | { ok: false; error: unknown };

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<ConcurrencyResult<R>[]> {
  const results: ConcurrencyResult<R>[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        results[index] = { ok: true, value: await fn(items[index] as T, index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

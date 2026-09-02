/**
 * D-170 (perf audit): bounded-parallel batch processing must report EACH item's own
 * success/failure independently - never let one failing item mark a successful sibling as
 * failed (over-reporting -> spurious SQS redelivery of already-processed work) and never
 * let a failure be silently absorbed by `Promise.all`'s all-or-nothing rejection (under-
 * reporting -> a genuinely failed message never gets redriven for retry).
 */
import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "../../../src/shared/concurrency/map-with-concurrency.js";

describe("mapWithConcurrency", () => {
  it("reports one failing item's error without marking successful siblings as failed, and without throwing for the whole batch", async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await mapWithConcurrency(items, 2, async (n) => {
      if (n === 3) throw new Error(`boom-${n}`);
      return n * 10;
    });

    expect(results).toHaveLength(5);
    results.forEach((r, i) => {
      const n = items[i];
      if (n === 3) {
        expect(r.ok).toBe(false);
        if (!r.ok) expect((r.error as Error).message).toBe("boom-3");
      } else {
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.value).toBe(n! * 10);
      }
    });
  });

  it("never has more than `concurrency` callbacks in flight at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 9 }, (_, i) => i);

    await mapWithConcurrency(items, 3, async (n) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return n;
    });

    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1); // proves it's genuinely parallel, not serialized
  });

  it("still runs every item and preserves order when concurrency exceeds item count", async () => {
    const results = await mapWithConcurrency([1, 2, 3], 10, async (n) => n * 2);
    expect(results.map((r) => (r.ok ? r.value : undefined))).toEqual([2, 4, 6]);
  });
});

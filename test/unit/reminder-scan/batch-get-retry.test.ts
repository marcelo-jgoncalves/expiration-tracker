import { describe, expect, it, vi } from "vitest";
import { batchGetAll } from "../../../src/workers/reminder-scan/batch-get-retry.js";

describe("batchGetAll", () => {
  it("retries only UnprocessedKeys and combines every response", async () => {
    const a = { PK: "A", SK: "1" };
    const b = { PK: "B", SK: "1" };
    const getMany = vi.fn()
      .mockResolvedValueOnce({ items: [{ id: "a" }], unprocessedKeys: [b] })
      .mockResolvedValueOnce({ items: [{ id: "b" }], unprocessedKeys: [] });
    const sleeps: number[] = [];
    const result = await batchGetAll({ keys: [a, b], getMany, sleep: async (ms) => void sleeps.push(ms) });
    expect(result).toEqual([{ id: "a" }, { id: "b" }]);
    expect(getMany.mock.calls[1]?.[0]).toEqual([b]);
    expect(sleeps).toEqual([25]);
  });

  it("fails safely instead of treating exhausted keys as absent", async () => {
    const key = { PK: "A", SK: "1" };
    await expect(batchGetAll({
      keys: [key], maxAttempts: 2, sleep: async () => {},
      getMany: async () => ({ items: [], unprocessedKeys: [key] }),
    })).rejects.toThrow(/state is indeterminate/);
  });
});

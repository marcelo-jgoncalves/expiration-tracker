import type { EntityKey } from "../../shared/dynamodb/occ.js";
import { DependencyUnavailableError } from "../../shared/errors/app-error.js";

export async function batchGetAll<T>(input: {
  keys: EntityKey[];
  getMany: (keys: EntityKey[]) => Promise<{ items: T[]; unprocessedKeys: EntityKey[] }>;
  sleep: (ms: number) => Promise<void>;
  maxAttempts?: number;
  onUnprocessed?: (count: number, attempt: number) => void;
}): Promise<T[]> {
  const maxAttempts = input.maxAttempts ?? 4;
  let pending = input.keys;
  const items: T[] = [];
  for (let attempt = 1; attempt <= maxAttempts && pending.length > 0; attempt++) {
    const result = await input.getMany(pending);
    items.push(...result.items);
    pending = result.unprocessedKeys;
    if (pending.length > 0) {
      input.onUnprocessed?.(pending.length, attempt);
      if (attempt < maxAttempts) await input.sleep(25 * 2 ** (attempt - 1));
    }
  }
  if (pending.length > 0) {
    throw new DependencyUnavailableError("BatchGetItem retained unprocessed keys after retry budget; state is indeterminate.", {
      unprocessedKeyCount: pending.length,
      attempts: maxAttempts,
    });
  }
  return items;
}

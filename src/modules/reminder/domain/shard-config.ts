/**
 * Versioned shard configuration - implementation-blueprint.md §9.2 "Reshard versionado":
 * doubling N cannot make occurrences already materialized under the OLD generation
 * invisible. `shardFnVersion` is the generation id; the producer/reconciliation query
 * every ACTIVE generation's partitions during a reshard transition window (§9.6's runbook
 * acceptance criterion), not just the newest one.
 *
 * A "generation" here is simply (shardFnVersion, shardCount) - the shard() function itself
 * (stableHash mod N) never changes, only N does, so a generation is fully described by its
 * shard count. `activeUntil` is set on a generation being retired so the producer knows
 * when it can stop double-querying it (the runbook's "até a janela de materialização
 * antiga expirar, ~7 dias à frente no pior caso").
 */
export interface ShardGeneration {
  shardFnVersion: number;
  shardCount: number;
  /** ISO instant after which this generation no longer needs to be queried (undefined = still active/current). Set when a reshard retires this generation. */
  retireAfter?: string;
}

export interface ShardConfig {
  /** The generation newly materialized occurrences are written under. */
  current: ShardGeneration;
  /** Older generations still holding not-yet-triggered occurrences, queried in parallel by the producer until `retireAfter`. */
  legacy: ShardGeneration[];
}

export const DEFAULT_SHARD_COUNT = 4;

export function defaultShardConfig(): ShardConfig {
  return { current: { shardFnVersion: 1, shardCount: DEFAULT_SHARD_COUNT }, legacy: [] };
}

/** Generations the producer/reconciliation must query "now" (implementation-blueprint.md
 * §9.2/§9.6: reads both old and new shardFnVersion generations during a resharding
 * transition window). Excludes legacy generations whose retireAfter has passed. */
export function activeGenerations(config: ShardConfig, now: string): ShardGeneration[] {
  const stillActiveLegacy = config.legacy.filter((g) => !g.retireAfter || g.retireAfter > now);
  return [config.current, ...stillActiveLegacy];
}

/**
 * Doubles shard count, starting a reshard: the current generation becomes legacy (retired
 * after `retireAfter`, default input by caller - the runbook's ~7 day worst-case
 * materialization-ahead window), and a new current generation is created with double the
 * shard count and the next `shardFnVersion`.
 */
export function reshardDouble(config: ShardConfig, retireAfter: string): ShardConfig {
  return {
    current: { shardFnVersion: config.current.shardFnVersion + 1, shardCount: config.current.shardCount * 2 },
    legacy: [...config.legacy, { ...config.current, retireAfter }],
  };
}

/**
 * SystemMutation lane — W3-07 (D-068), the counterpart to `TenantBusinessMutation`
 * (`tenant-business-mutation.ts`) for privileged system-only operations that must NOT be
 * subject to the ACTIVE-only fence (the fence itself is one of these operations — you cannot
 * gate "move the tenant to DELETING" on "the tenant is still ACTIVE" without the transition
 * becoming unreachable). Approved design's allowlist (`claude-analysis-active-only-fence.md`
 * §O-3 Rodada E, §Q roadmap item 2): "allowlist estreita e nomeada: transição de lifecycle,
 * deletes da purga, bookkeeping do outbox relay já criado por uma TenantBusinessMutation
 * anterior — nunca criação de conteúdo novo de negócio."
 *
 * Structural containment (this is the load-bearing property, not a convention): unlike
 * `executeTenantBusinessMutation`, which takes the caller's own `TransactWriteEntry[]` and
 * only appends a fence to it, `executeSystemMutation` does NOT accept a caller-supplied
 * entries array at all. Its only parameter is a `SystemMutationOperation` — a closed
 * discriminated union naming the exact permitted operation shapes — and this module is the
 * ONLY code that turns an operation into the actual `TransactWriteEntry[]` sent to DynamoDB
 * (via `occ.ts`'s builders). There is no generic "SystemMutation.execute(entries)" escape
 * hatch: a future developer who wants to add a new privileged operation must add a new union
 * member AND a new `buildEntries` case here — a small, reviewable, greppable diff to this one
 * file — not just call something with an arbitrary business-shaped payload from a call site
 * elsewhere. Combined with the `no-raw-dynamodb-writes-outside-lanes` dependency-cruiser rule
 * (`.dependency-cruiser.cjs`), which confines raw `@aws-sdk/lib-dynamodb` write-command access
 * to this file's directory and its siblings, a business module cannot construct its own
 * `TransactWriteItems` and route around this lane's allowlist even if it imported this
 * module's internals directly (it can't reach the SDK to build the entries in the first
 * place).
 *
 * Scope note (W3-07 chunk 3/N): the union below names all 3 kinds from the approved design's
 * allowlist so the type itself is honest about what is EVENTUALLY permitted through this lane,
 * but only `LIFECYCLE_TRANSITION` has a real implementation in this chunk — it is the
 * primitive a future orchestrator (Step Functions/Lambda, not built this session) will call to
 * actually move `TenantLifecycleRecord.status` forward (e.g. `ACTIVE -> DELETING`).
 * `PURGE_DELETE` (the future permanent sweeper reusing the `DocumentPurgeWorker`/D-061 pattern)
 * and `OUTBOX_BOOKKEEPING` (bookkeeping on an outbox row already created by a prior
 * `TenantBusinessMutation`) are reserved allowlist members — calling them today throws
 * `SystemMutationNotImplementedError` rather than silently no-op'ing or falling through to an
 * unvalidated generic path. See NEXT_SESSION_PROMPT.md for what remains.
 */
import {
  buildVersionedUpdate,
  isTransactionCanceled,
  type TransactWriteEntry,
} from "../dynamodb/occ.js";
import {
  assertValidTransition,
  tenantLifecycleKey,
  type TenantLifecycleStatus,
} from "./tenant-lifecycle-record.js";

/** Minimal surface this lane needs from a store — same structural-typing convention as
 * `TenantMutationStore` in `tenant-business-mutation.ts`. */
export interface SystemMutationStore {
  transactWrite(entries: TransactWriteEntry[]): Promise<void>;
}

/**
 * Closed allowlist — the ONLY operation kinds this lane will ever execute. This is a
 * discriminated union checked at the type level (a `SystemMutationOperation` literally cannot
 * be constructed with any `kind` outside these three) AND at runtime (`buildEntries`'s switch
 * is exhaustive over `kind`, so a value that somehow reached this function with an
 * unrecognized kind — e.g. from `JSON.parse`d input crossing a process boundary — falls into
 * the `default` branch below and throws rather than being silently accepted).
 */
export type SystemMutationOperation =
  | {
      kind: "LIFECYCLE_TRANSITION";
      tenantId: string;
      from: TenantLifecycleStatus;
      to: TenantLifecycleStatus;
      expectedVersion: number;
      /** Required when `to` is BLOCKED/HELD (see tenant-lifecycle-record.ts's field docs);
       * ignored otherwise. */
      blockedReason?: string;
      blockedFrom?: TenantLifecycleStatus;
    }
  | { kind: "PURGE_DELETE" }
  | { kind: "OUTBOX_BOOKKEEPING" };

export interface SystemMutationInput {
  store: SystemMutationStore;
  tableName: string;
  operation: SystemMutationOperation;
  now?: () => string;
}

/** Thrown for an allowlisted-by-design-but-not-yet-implemented operation kind (`PURGE_DELETE`,
 * `OUTBOX_BOOKKEEPING` in this chunk) — deliberately distinct from a bug: this is the lane
 * correctly refusing to guess at a shape nobody has specified and wired a real call site for
 * yet, not a fallback that would accept whatever was passed. */
export class SystemMutationNotImplementedError extends Error {
  constructor(kind: string) {
    super(`SystemMutation kind "${kind}" is allowlisted by design but not implemented yet in this chunk.`);
    this.name = "SystemMutationNotImplementedError";
  }
}

/** Thrown when the underlying TransactWriteItems is canceled — e.g. the lifecycle record was
 * not at `expectedVersion`/`from` when the transition was attempted (a concurrent transition
 * won the race) or the record does not exist. Never the raw SDK
 * `TransactionCanceledException` — callers get a typed, lane-specific error instead. */
export class SystemMutationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SystemMutationConflictError";
  }
}

function buildEntries(op: SystemMutationOperation, tableName: string, now: string): TransactWriteEntry[] {
  switch (op.kind) {
    case "LIFECYCLE_TRANSITION": {
      // assertValidTransition throws InvalidTenantLifecycleTransitionError BEFORE anything is
      // sent to DynamoDB — the state-machine legality check (tenant-lifecycle-record.ts) is
      // enforced here in-process, not just by the OCC condition below (which only protects
      // against a stale read of `from`, it has no notion of which transitions are legal).
      assertValidTransition(op.from, op.to, op.blockedFrom);

      const key = tenantLifecycleKey(op.tenantId);
      const set: Record<string, unknown> = { status: op.to };
      const remove: string[] = [];
      if (op.to === "BLOCKED" || op.to === "HELD") {
        set["blockedReason"] = op.blockedReason ?? "UNSPECIFIED";
        set["blockedFrom"] = op.from;
      } else {
        // Leaving BLOCKED/HELD (remediation resume) or any normal forward move: clear any
        // stale blocked-state bookkeeping rather than leaving it to rot on the record.
        remove.push("blockedReason", "blockedFrom");
      }

      return [
        {
          Update: buildVersionedUpdate({
            tableName,
            key,
            tenantId: op.tenantId,
            expectedVersion: op.expectedVersion,
            set,
            remove,
            now,
            extraConditions: [
              {
                // Re-asserts the CURRENT status is still exactly `from` at commit time, on top
                // of the version check buildVersionedUpdate already does — belt-and-suspenders
                // against a concurrent transition that happened to reuse the same version
                // number is impossible under OCC, but this also gives a semantically clearer
                // failure ("status drifted") distinct from a bare version mismatch if the two
                // ever diverge (e.g. a future direct-write bug elsewhere).
                expression: "#lifecycleStatus = :expectedStatus",
                names: { "#lifecycleStatus": "status" },
                values: { ":expectedStatus": op.from },
              },
            ],
          }),
        },
      ];
    }
    case "PURGE_DELETE":
    case "OUTBOX_BOOKKEEPING":
      throw new SystemMutationNotImplementedError(op.kind);
    default: {
      // Exhaustiveness guard: TypeScript proves this branch unreachable for any value typed as
      // SystemMutationOperation. If it IS reached at runtime (a value that bypassed the type
      // system, e.g. deserialized from an external source), fail loudly rather than silently
      // falling through.
      const unexpected: never = op;
      throw new SystemMutationNotImplementedError(String((unexpected as { kind?: unknown }).kind));
    }
  }
}

/** Commits the TransactWriteEntry[] this lane itself built for `input.operation` — never the
 * caller's own entries. See file header for why this shape (not "accept an entries array") is
 * the structural half of the fence. */
export async function executeSystemMutation(input: SystemMutationInput): Promise<void> {
  const now = input.now ? input.now() : new Date().toISOString();
  const entries = buildEntries(input.operation, input.tableName, now);
  try {
    await input.store.transactWrite(entries);
  } catch (err) {
    if (isTransactionCanceled(err)) {
      throw new SystemMutationConflictError(
        `SystemMutation "${input.operation.kind}" rejected: precondition failed (stale version or unexpected current lifecycle status).`,
      );
    }
    throw err;
  }
}

/**
 * The one real call site this chunk wires end-to-end: transition
 * `TenantLifecycleRecord.status` via the SystemMutation lane, OCC-fenced on the record's
 * current version and validated through `assertValidTransition`. This is the primitive a
 * future orchestrator (Step Functions state, or a Lambda invoked by one) calls to actually
 * drive `ACTIVE -> DELETING -> QUIESCING -> PURGING -> VERIFIED -> DELETED` (and the
 * BLOCKED/HELD side-transitions) for real — this session does not build that orchestrator,
 * only this primitive (see NEXT_SESSION_PROMPT.md).
 */
export async function transitionTenantLifecycle(input: {
  store: SystemMutationStore;
  tableName: string;
  tenantId: string;
  from: TenantLifecycleStatus;
  to: TenantLifecycleStatus;
  expectedVersion: number;
  blockedReason?: string;
  blockedFrom?: TenantLifecycleStatus;
  now?: () => string;
}): Promise<void> {
  await executeSystemMutation({
    store: input.store,
    tableName: input.tableName,
    now: input.now,
    operation: {
      kind: "LIFECYCLE_TRANSITION",
      tenantId: input.tenantId,
      from: input.from,
      to: input.to,
      expectedVersion: input.expectedVersion,
      blockedReason: input.blockedReason,
      blockedFrom: input.blockedFrom,
    },
  });
}

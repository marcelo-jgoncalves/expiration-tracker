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
 * to this file's directory and its siblings, a business module cannot import the SDK directly
 * and build its own `TransactWriteCommand` to route around this lane's allowlist.
 *
 * KNOWN LIMIT (W3-07 review finding, Codex round 1, 2026-08-29 — do not overstate this beyond
 * what it actually proves): the dependency-cruiser rule only blocks a DIRECT SDK import. It does
 * NOT prove that every store port's `transactWrite(entries: TransactWriteEntry[])` method —
 * itself already past the SDK boundary, inside a `persistence/` adapter — is unreachable from
 * application code with an arbitrary, unfenced `entries` array; a store port method is a normal
 * generically-callable method, not itself contained by this file's allowlist. Every CURRENT call
 * site in this codebase does route through `TenantBusinessMutation`/`SystemMutation` (verified by
 * file-by-file review the same session this note was added), but that is a property of this
 * codebase's current call sites, not a structural guarantee this file or the dependency-cruiser
 * rule enforces on its own — a future writer could call `store.transactWrite([...])` directly and
 * nothing here would catch it. Closing that gap for real needs either narrowing the store ports'
 * public surface (no generic `transactWrite` exposed to application code) or an architecture test
 * asserting no application-layer file (any module's application directory, or a worker under
 * src/workers/) calls `.transactWrite(` at all outside this lane's own two files — deferred as a
 * larger, Type 1 structural change, not fixed in the same session this note was added (see
 * `w3-07-writer-inventory.md`'s review section and `decisions-log.md` for the full record).
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
  | {
      /** W3-07 purge pipeline (this session): physically removes ONE tenant-owned row from the
       * main table. Deliberately NOT a bare `BatchWriteCommand` — every purge delete is routed
       * through this lane so it gets the same structural containment every other write in this
       * codebase gets (see file header), and so the safety condition below is enforced in
       * exactly one place rather than trusted to every future purge call site.
       *
       * Idempotent by construction: the ConditionExpression this builds is
       * `attribute_not_exists(PK) OR begins_with(PK, "TENANT#<tenantId>#")` — deleting an
       * already-purged (or never-existed) key is a clean no-op, never a
       * `ConditionalCheckFailedException`, so re-running a purge after an interruption never
       * errors on rows it already removed. The `begins_with` half is a defense-in-depth guard,
       * not the primary safety mechanism (the caller — `dynamo-tenant-purge.ts` — is what
       * actually scopes candidates to one tenant); it exists so a caller bug that hands this
       * lane the wrong tenant's key fails loudly (`SystemMutationConflictError`) instead of
       * silently deleting another tenant's row.
       *
       * Deliberately no `expectedVersion`/OCC condition (unlike every other write in this
       * codebase, which routes through `buildVersionedUpdate`/`buildVersionedDelete`): a purge
       * targets a row that is (by the time PURGING is reached) no longer being mutated by any
       * fenced business writer, and re-checking a version the caller may not have freshly read
       * (a Scan page can be stale by the time this lane runs) would turn ordinary purge retries
       * into false conflicts. */
      kind: "PURGE_DELETE";
      tenantId: string;
      key: { PK: string; SK: string };
    }
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
      const extraConditions: Array<{ expression: string; names?: Record<string, string>; values?: Record<string, unknown> }> = [
        {
          // Re-asserts the CURRENT status is still exactly `from` at commit time, on top
          // of the version check buildVersionedUpdate already does — belt-and-suspenders
          // against a concurrent transition that happened to reuse the same version
          // number is impossible under OCC, but this also gives a semantically clearer
          // failure ("status drifted") distinct from a bare version mismatch if the two
          // ever diverge (e.g. a future direct-write bug elsewhere).
          expression: "#lifecycleStatus = :lifecycleStatus",
          names: { "#lifecycleStatus": "status" },
          values: { ":lifecycleStatus": op.from },
        },
      ];
      if (op.to === "BLOCKED" || op.to === "HELD") {
        set["blockedReason"] = op.blockedReason ?? "UNSPECIFIED";
        set["blockedFrom"] = op.from;
      } else {
        // Leaving BLOCKED/HELD (remediation resume) or any normal forward move: clear any
        // stale blocked-state bookkeeping rather than leaving it to rot on the record.
        remove.push("blockedReason", "blockedFrom");
        if (op.from === "BLOCKED" || op.from === "HELD") {
          // W3-07 review finding (Codex round 1, 2026-08-29): `canTransition`/`assertValidTransition`
          // only validate the CALLER-SUPPLIED `op.blockedFrom` against `op.to` in-process - they
          // never check it against the value actually stored on the record. Without this extra
          // condition, a caller (bug or forged input) could resume a record genuinely blocked
          // from DELETING straight to VERIFIED by simply passing `blockedFrom: "VERIFIED"`,
          // skipping QUIESCING/PURGING entirely - the in-process check would pass (VERIFIED IS
          // op.blockedFrom, by construction), and the OCC condition above only re-asserts
          // `status = BLOCKED/HELD`, never the stored `blockedFrom` attribute. Requiring the
          // STORED `blockedFrom` to match `op.to` atomically closes that gap: a resume can only
          // ever land back on the exact state the record was actually blocked from.
          extraConditions.push({
            expression: "#lifecycleBlockedFrom = :lifecycleBlockedFrom",
            names: { "#lifecycleBlockedFrom": "blockedFrom" },
            values: { ":lifecycleBlockedFrom": op.to },
          });
        }
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
            extraConditions,
          }),
        },
      ];
    }
    case "PURGE_DELETE": {
      // W3-07 review finding (Codex round on the purge pipeline, B3, 2026-08-29): the caller-side
      // exclusion in dynamo-tenant-purge.ts (an optional `entityType` check) is NOT bulletproof —
      // a legacy/malformed row missing `entityType`, or a future rename of the discriminator,
      // would slip past it. The permanent anti-reprovisioning tombstone
      // (`TenantLifecycleRecord`, key `TENANT#<id>#LIFECYCLE`/`LIFECYCLE` — see
      // `tenant-lifecycle-record.ts`'s `tenantLifecycleKey`) MUST NEVER be deletable through this
      // lane, full stop — enforced here, at the one privileged deletion lane itself, on the
      // CANONICAL PHYSICAL KEY (not caller-supplied metadata), so no caller bug or malformed scan
      // row can ever route a delete of this specific key through PURGE_DELETE.
      if (op.key.SK === "LIFECYCLE" && op.key.PK === tenantLifecycleKey(op.tenantId).PK) {
        throw new SystemMutationConflictError(
          "SystemMutation \"PURGE_DELETE\" rejected: refusing to delete the TenantLifecycleRecord tombstone through the purge lane.",
        );
      }
      // Same rationale, for `IdentityMapping` (key `IDENTITY#cognitoSub#<sub>`/`MAP` — see
      // `identity-mapping-repository.ts`). `IdentityMapping` is tenantless since B2B-5/D-095 (no
      // `tenantId` attribute, so the widened ConditionExpression below would not match it on that
      // clause), but the guard stays as a second layer independent of any attribute the row does
      // or does not declare — it rejects by canonical PHYSICAL KEY shape alone, so a future
      // regression (e.g. `IdentityMapping` regaining a `tenantId`/`organizationId`-shaped
      // attribute) cannot silently reopen this lane for it.
      if (op.key.PK.startsWith("IDENTITY#")) {
        throw new SystemMutationConflictError(
          "SystemMutation \"PURGE_DELETE\" rejected: refusing to delete an IdentityMapping row through the purge lane.",
        );
      }
      const prefix = `TENANT#${op.tenantId}#`;
      return [
        {
          Delete: {
            TableName: tableName,
            Key: op.key,
            // W3-07 review finding (Codex round on the purge pipeline, B1, 2026-08-29): the
            // scan feeding this lane (tenant-purge-scan.ts) now also returns real tenant-owned
            // rows whose PK is NOT `TENANT#<id>#...` (GuestTokenPointer/TextractJob, both of
            // which declare `tenantId` as a plain attribute — see those domain files) — the
            // `begins_with(PK, ...)` half alone would reject every one of them as a safety-
            // condition failure, permanently blocking convergence for any tenant that has such a
            // row. Accepting `tenantId = :purgeTenantId` as an alternative match preserves the
            // same isolation property (the CURRENT item's own stored tenantId must match, not a
            // caller-supplied claim) while covering both physical key conventions in this
            // codebase.
            //
            // Wave B2B-9 (D-104, 2026-08-30): a third clause, `organizationId = :purgeTenantId`,
            // mirrors the same fix in `tenant-purge-scan.ts` for `InvitationTokenPointer`, the
            // one real writer that declares `organizationId` instead of `tenantId` — without this
            // clause the scan would find the row (via the mirrored fix) but this delete would
            // reject it as a safety-condition failure, blocking convergence the same way the
            // original B1 gap did for GuestTokenPointer/TextractJob.
            ConditionExpression:
              "attribute_not_exists(PK) OR begins_with(PK, :purgeTenantPrefix) OR tenantId = :purgeTenantId OR organizationId = :purgeTenantId",
            ExpressionAttributeValues: { ":purgeTenantPrefix": prefix, ":purgeTenantId": op.tenantId },
          },
        },
      ];
    }
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

/**
 * W3-07 purge pipeline: physically deletes ONE tenant-owned row via the `PURGE_DELETE`
 * SystemMutation. See that union member's doc comment for why this is idempotent and what the
 * `begins_with` safety condition actually protects against. Callers (`dynamo-tenant-purge.ts`)
 * invoke this once per candidate row found by a tenant-scoped scan; `SystemMutationConflictError`
 * here means the caller handed this lane a key that does not belong to `tenantId` — a caller bug,
 * never an expected/retryable outcome.
 */
export async function purgeTenantItem(input: {
  store: SystemMutationStore;
  tableName: string;
  tenantId: string;
  key: { PK: string; SK: string };
  now?: () => string;
}): Promise<void> {
  await executeSystemMutation({
    store: input.store,
    tableName: input.tableName,
    now: input.now,
    operation: { kind: "PURGE_DELETE", tenantId: input.tenantId, key: input.key },
  });
}

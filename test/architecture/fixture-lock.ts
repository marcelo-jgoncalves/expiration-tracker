/**
 * Cross-process exclusive lock for the architecture tests that plant real fixture files under
 * `src/`/`test/` and shell out to `tsc`/`dependency-cruiser` against the whole tree
 * (`system-mutation-allowlist.test.ts`, `tenant-fence-boundary.test.ts`).
 *
 * Root cause of the intermittent race these two files hit (full-audit-round2, E-023, "PENDENTE":
 * `tsc`'s own `include` in `tsconfig.json` is `["src", "infra", "test", "scripts"]` - a SINGLE
 * `tsc -p tsconfig.json --noEmit` invocation compiles the ENTIRE tree in one pass, so it is
 * exposed to whatever fixture files any OTHER process happens to have on disk at that moment.
 * `vitest.config.ts`'s `fileParallelism: false` only serializes files within ONE vitest process -
 * it does nothing to protect against a genuinely separate process (a different terminal, a
 * different agent/session, a different CI job) running the other architecture test file's
 * fixture-write/tool-run/cleanup cycle at the same wall-clock moment. This project routinely runs
 * multiple concurrent Claude/Codex sessions and forks against this same working directory
 * (see `AGENTS.md` §1/§4), which is exactly the condition that would produce this symptom.
 *
 * The lock file itself lives under the OS temp dir, deliberately OUTSIDE the repo (which is
 * mounted via WSL2's DrvFs under `/mnt/c/...` in this project's real dev environment - a
 * filesystem with weaker atomicity/latency guarantees than a native Linux filesystem) so the lock
 * primitive's own reliability never depends on the same mount that made the original race
 * possible. `mkdirSync` is used as the acquire primitive (atomic create-or-fail, no dependency on
 * `O_EXCL` semantics of a specific fs driver for a plain file).
 */
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LOCK_DIR = join(tmpdir(), "expiration-tracker-architecture-fixture.lock");
// Longer than the slowest single tool invocation in either test file (tsc: 60s timeout per test,
// depcruise: 30s timeout per test) plus real margin - a lock older than this almost certainly
// means its owning process crashed/was killed without reaching the `finally` release below,
// never a legitimately still-running test.
const STALE_LOCK_MS = 5 * 60_000;
const POLL_INTERVAL_MS = 250;
const ACQUIRE_TIMEOUT_MS = 10 * 60_000;

function tryAcquire(): boolean {
  try {
    mkdirSync(LOCK_DIR);
    writeFileSync(join(LOCK_DIR, "owner.txt"), `pid:${process.pid} file:${process.env["VITEST_POOL_ID"] ?? "unknown"}`);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
}

function breakIfStale(): void {
  if (!existsSync(LOCK_DIR)) return;
  const ageMs = Date.now() - statSync(LOCK_DIR).mtimeMs;
  if (ageMs > STALE_LOCK_MS) {
    rmSync(LOCK_DIR, { recursive: true, force: true });
  }
}

/** Blocks (polling) until this process holds the exclusive lock, then returns a release function.
 * Every architecture test file that plants real fixtures under `src/`/`test/` and shells out to a
 * whole-tree tool MUST acquire this in `beforeAll` and release it in `afterAll`, wrapping its
 * entire fixture-write/tool-run/cleanup lifecycle - not just one individual test - so no other
 * process (including a completely separate `npm test`/`vitest` invocation) can ever have its own
 * fixtures on disk while this file's tool invocation is scanning the tree. */
export async function acquireFixtureLock(): Promise<() => void> {
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;
  for (;;) {
    if (tryAcquire()) {
      return () => {
        rmSync(LOCK_DIR, { recursive: true, force: true });
      };
    }
    breakIfStale();
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out after ${ACQUIRE_TIMEOUT_MS}ms waiting for the architecture-fixture lock (${LOCK_DIR}). ` +
          "Another process may be genuinely stuck holding it (check for a leftover lock dir and a real hung tsc/depcruise process) rather than just running long.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

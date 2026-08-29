/**
 * Architecture test — W3-07 D-076 (item 2 of the D-075/D-072 pending list): proves the
 * `SystemMutationOperation` allowlist (`src/shared/tenant-lifecycle/system-mutation.ts`) is
 * actually closed at compile time, not just closed by convention/documentation.
 *
 * Same pattern as `tenant-fence-boundary.test.ts`: plants a real BYPASS-ATTEMPT fixture file on
 * disk under `test/architecture/` (not `src/` - see the FIXTURE_DIR comment below for why),
 * runs the real `tsc -p tsconfig.json --noEmit` (the exact command
 * `npm run typecheck` runs, which CI also runs on every PR), asserts the bypass attempt actually
 * fails to compile, and removes the fixture in `finally`/`afterEach` (plus a `beforeAll` sweep
 * against a prior interrupted run) so no bypass file is ever left behind. This intentionally does
 * NOT just add another `@ts-expect-error` line to an existing test file — that proves the
 * author's own understanding of the type, not that the union is closed against a caller reaching
 * for a NEW `kind` from outside this module the same way a real future contributor would (import
 * the type, try to build an operation with it).
 *
 * Complements (does not replace) `test/unit/system-mutation.test.ts`'s two existing proofs: a
 * `@ts-expect-error` line showing an out-of-union literal is a compile error in that file, and a
 * runtime test showing a value that bypassed the type system entirely (e.g. `as unknown as
 * SystemMutationOperation`, simulating deserialized external input) is rejected by
 * `buildEntries`'s exhaustiveness guard. This file adds the third leg: an INDEPENDENT fixture
 * file, compiled by the real project-wide `tsc`, proves the union's closure is a property of the
 * type itself, not an artifact of how one particular test file happens to use it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SystemMutationOperation } from "../../src/shared/tenant-lifecycle/system-mutation.js";

/**
 * Codex round 3 (D-076 re-review) BLOCKING finding: the fixture-based bypass tests below only
 * prove that ONE hard-coded sentinel kind ("DELETE_EVERYTHING_FOR_THIS_TENANT") is currently
 * absent from the union - they do not prove the union is closed against a future contributor
 * adding a genuinely new, unpredicted kind. This independently-maintained allowlist plus the
 * bidirectional `extends` check below closes that gap for real: `ApprovedSystemMutationKind` is
 * declared HERE, outside `system-mutation.ts`, deliberately NOT derived from
 * `SystemMutationOperation` itself - so it cannot silently track a future addition/removal to
 * that union. If a future contributor adds a new `kind` member to `SystemMutationOperation`
 * without updating this list (or vice versa), one of the two assertions below fails to compile,
 * turning `npm run typecheck` red - the same enforcement mechanism CI already runs on every PR.
 */
type ApprovedSystemMutationKind = "LIFECYCLE_TRANSITION" | "PURGE_DELETE" | "OUTBOX_BOOKKEEPING";
type AssertUnionIsSubsetOfApproved = SystemMutationOperation["kind"] extends ApprovedSystemMutationKind
  ? true
  : ["FAIL: SystemMutationOperation has a kind NOT in the independently-maintained ApprovedSystemMutationKind allowlist - update system-mutation-allowlist.test.ts"];
type AssertApprovedIsSubsetOfUnion = ApprovedSystemMutationKind extends SystemMutationOperation["kind"]
  ? true
  : ["FAIL: ApprovedSystemMutationKind lists a kind SystemMutationOperation no longer has - the allowlist has drifted stale"];
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- compile-time-only proof, never read at runtime.
const _assertUnionClosed: AssertUnionIsSubsetOfApproved = true;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- compile-time-only proof, never read at runtime.
const _assertAllowlistCurrent: AssertApprovedIsSubsetOfUnion = true;

const REPO_ROOT = join(__dirname, "..", "..");
// Fixtures live under test/, not src/ - dependency-cruiser's check-boundaries only scans `src`
// (see tenant-fence-boundary.test.ts), so a fixture under src/ would race that test's own
// bypass-fixture writes when both architecture test files run concurrently (vitest runs test
// files in parallel by default). tsc still compiles this directory either way (tsconfig.json
// includes "test"), so the compile-time proof is unaffected by the relocation.
const FIXTURE_DIR = join(REPO_ROOT, "test", "architecture", "__system_mutation_allowlist_test_fixtures__");

function writeFixture(relativePath: string, contents: string): void {
  const full = join(FIXTURE_DIR, relativePath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, contents, "utf8");
}

function cleanFixtures(): void {
  if (existsSync(FIXTURE_DIR)) {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  }
}

/** Runs the exact same CLI invocation as `npm run typecheck`, returning { failed, output }
 * instead of throwing - tsc exits non-zero on any type error, which execFileSync would
 * otherwise turn into a thrown error we'd have to unwrap every time. */
function runTypecheck(): { failed: boolean; output: string } {
  try {
    const output = execFileSync("node", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json", "--noEmit"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { failed: false, output };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { failed: true, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("architecture: SystemMutationOperation allowlist is closed at compile time", () => {
  it("Codex round 3 fix: the bidirectional type assertions above (AssertUnionIsSubsetOfApproved / AssertApprovedIsSubsetOfUnion) compiled successfully, proving SystemMutationOperation's kind union is EXACTLY {LIFECYCLE_TRANSITION, PURGE_DELETE, OUTBOX_BOOKKEEPING} - neither more nor fewer - against an allowlist maintained independently of the implementation module. This test file existing and passing typecheck IS the proof; this assertion is a documentation anchor, not additional verification", () => {
    expect(true).toBe(true);
  });

  beforeAll(() => {
    cleanFixtures(); // safety net in case a prior interrupted run left a fixture behind
  });
  afterEach(() => {
    cleanFixtures();
  });

  it(
    "baseline: the real src tree (fixture removed) typechecks cleanly",
    () => {
      const { failed, output } = runTypecheck();
      expect(failed, `unexpected pre-existing typecheck failure:\n${output}`).toBe(false);
    },
    60_000,
  );

  it(
    "BYPASS ATTEMPT: a fixture file outside system-mutation.ts constructing a SystemMutationOperation with an out-of-union kind fails to compile",
    () => {
      writeFixture(
        "bypass-new-kind.ts",
        [
          '// Deliberate bypass attempt: a hypothetical future contributor tries to add a new',
          '// privileged operation kind WITHOUT going through system-mutation.ts\'s own union.',
          'import type { SystemMutationOperation } from "../../../src/shared/tenant-lifecycle/system-mutation.js";',
          '',
          'export function attemptedBypass(): SystemMutationOperation {',
          '  return { kind: "DELETE_EVERYTHING_FOR_THIS_TENANT" };',
          '}',
        ].join("\n"),
      );

      const { failed, output } = runTypecheck();
      expect(failed, "expected the bypass fixture to fail typecheck, but tsc reported success").toBe(true);
      expect(output).toContain("bypass-new-kind.ts");
    },
    60_000,
  );

  it(
    "BYPASS ATTEMPT 2: a fixture file constructing a well-typed LIFECYCLE_TRANSITION operation but also smuggling an extra business-shaped field (e.g. its own entries[]) as a FRESH object literal fails to compile via TypeScript's excess-property check. NOTE (Codex round 3 correction): this is weaker than \"exact object shapes\" - the excess-property check only fires on a fresh literal; assigning the SAME payload through an intermediate `const` variable is NOT rejected by the type system. This does not currently matter for safety because buildEntries() ignores any extra property and always constructs its own entries array from the operation's own named fields - but the test description must not overclaim what TypeScript itself proves here",
    () => {
      writeFixture(
        "bypass-extra-field.ts",
        [
          '// Deliberate bypass attempt: a legitimate-looking LIFECYCLE_TRANSITION operation with',
          '// an extra field trying to smuggle a caller-supplied entries array alongside it.',
          'import type { SystemMutationOperation } from "../../../src/shared/tenant-lifecycle/system-mutation.js";',
          '',
          'export function attemptedBypass(): SystemMutationOperation {',
          '  return {',
          '    kind: "LIFECYCLE_TRANSITION",',
          '    tenantId: "t",',
          '    from: "ACTIVE",',
          '    to: "DELETING",',
          '    expectedVersion: 1,',
          '    entries: [{ Put: { TableName: "MainTable", Item: { PK: "x", SK: "y" }, ConditionExpression: "" } }],',
          '  };',
          '}',
        ].join("\n"),
      );

      const { failed, output } = runTypecheck();
      expect(failed, "expected the excess-property bypass fixture to fail typecheck, but tsc reported success").toBe(true);
      expect(output).toContain("bypass-extra-field.ts");
    },
    60_000,
  );

  it(
    "control: a fixture file constructing every real allowlisted kind (LIFECYCLE_TRANSITION, PURGE_DELETE, OUTBOX_BOOKKEEPING) typechecks cleanly - proves the two bypass failures above are about the union's closure, not a false positive from the fixture harness itself",
    () => {
      writeFixture(
        "control-real-kinds.ts",
        [
          'import type { SystemMutationOperation } from "../../../src/shared/tenant-lifecycle/system-mutation.js";',
          '',
          'export const realOperations: SystemMutationOperation[] = [',
          '  { kind: "LIFECYCLE_TRANSITION", tenantId: "t", from: "ACTIVE", to: "DELETING", expectedVersion: 1 },',
          '  { kind: "PURGE_DELETE" },',
          '  { kind: "OUTBOX_BOOKKEEPING" },',
          '];',
        ].join("\n"),
      );

      const { failed, output } = runTypecheck();
      expect(failed, `unexpected typecheck failure on a fixture using only real allowlisted kinds:\n${output}`).toBe(false);
    },
    60_000,
  );
});

/**
 * Architecture test — W3-07 (D-068), §Q roadmap item 3: proves the structural half of the
 * tenant deletion fence actually works, not just that it exists as config.
 *
 * `.dependency-cruiser.cjs`'s `no-raw-dynamodb-writes-outside-lanes` rule is the real
 * enforcement mechanism (also wired into `npm run check-boundaries`, which CI runs on every
 * PR). This file writes deliberate BYPASS-ATTEMPT fixture files into real locations under
 * `src/` (dependency-cruiser resolves the actual module graph on disk, so a fixture has to
 * really exist there to be cruised), runs the real `depcruise` CLI against the whole `src`
 * tree with the real config, asserts each bypass is actually caught, and removes the fixture
 * in a `finally` so no bypass file is ever left behind (including on test failure/interrupt —
 * a `beforeAll`/`afterEach` pair also sweeps the fixture directory as a second safety net).
 *
 * This intentionally does NOT re-implement or mock dependency-cruiser's resolution logic —
 * that would only prove the test's own understanding of the rule, not that the rule catches a
 * real bypass when run the same way CI runs it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..");
const FIXTURE_DIR_NAME = "__tenant_fence_boundary_test_fixtures__";
// Two distinct fixture roots so bypass attempts can be planted both under src/modules/** and
// directly under src/shared/** (proving the rule fences both, per its "from" pattern).
const MODULES_FIXTURE_ROOT = join(REPO_ROOT, "src", "modules", "expiration", "application", FIXTURE_DIR_NAME);
const SHARED_FIXTURE_ROOT = join(REPO_ROOT, "src", "shared", FIXTURE_DIR_NAME);
const ALL_FIXTURE_ROOTS = [MODULES_FIXTURE_ROOT, SHARED_FIXTURE_ROOT];

function writeFixtureAt(root: string, relativePath: string, contents: string): void {
  const full = join(root, relativePath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, contents, "utf8");
}

/** Runs the exact same CLI invocation as `npm run check-boundaries`, scoped to `src`, and
 * returns { violated, output } instead of throwing - depcruise exits non-zero on a violation,
 * which execFileSync would otherwise turn into a thrown error we'd have to unwrap every time. */
function runDependencyCruiser(): { violated: boolean; output: string } {
  try {
    const output = execFileSync(
      "node",
      ["node_modules/dependency-cruiser/bin/dependency-cruise.mjs", "src", "--config", ".dependency-cruiser.cjs", "--output-type", "err-long"],
      { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { violated: false, output };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { violated: true, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

function cleanFixtures(): void {
  for (const root of ALL_FIXTURE_ROOTS) {
    if (existsSync(root)) {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

describe("architecture: tenant fence structural boundary (no-raw-dynamodb-writes-outside-lanes)", () => {
  beforeAll(() => {
    cleanFixtures(); // safety net in case a prior interrupted run left fixtures behind
  });
  afterEach(() => {
    cleanFixtures();
  });

  it("baseline: the real src tree (fixtures removed) has zero violations of this rule", () => {
    const { violated, output } = runDependencyCruiser();
    expect(violated, `unexpected pre-existing violation(s):\n${output}`).toBe(false);
  }, 30_000);

  it("BYPASS ATTEMPT 1: a fake application-layer module constructing `new PutCommand(...)` directly on a tenant item is caught", () => {
    writeFixtureAt(
      MODULES_FIXTURE_ROOT,
      "bypass-put/direct-put.ts",
      [
        "// Deliberate bypass attempt: writes a tenant-scoped item without going through",
        "// TenantBusinessMutation/SystemMutation or any store port method.",
        'import { PutCommand } from "@aws-sdk/lib-dynamodb";',
        "export function bypassPut() {",
        '  return new PutCommand({ TableName: "MainTable", Item: { PK: "TENANT#evil-tenant#ITEM#i1", SK: "META" } });',
        "}",
      ].join("\n"),
    );

    const { violated, output } = runDependencyCruiser();
    expect(violated).toBe(true);
    expect(output).toContain("no-raw-dynamodb-writes-outside-lanes");
    expect(output).toContain("bypass-put/direct-put.ts");
  }, 30_000);

  it("BYPASS ATTEMPT 2: a fake module calling `new TransactWriteCommand(...)` without routing through the lifecycle ConditionCheck is caught", () => {
    writeFixtureAt(
      MODULES_FIXTURE_ROOT,
      "bypass-transact/direct-transact.ts",
      [
        "// Deliberate bypass attempt: builds and (would) submit its own TransactWriteItems,",
        "// skipping executeTenantBusinessMutation entirely - so no lifecycle ConditionCheck",
        "// is ever appended. The boundary this rule enforces is LOCATION-based (raw commands",
        "// confined to persistence/lane files), which is exactly what makes this unreachable",
        "// from here regardless of whether the payload happens to include a ConditionCheck.",
        'import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";',
        "export function bypassTransact() {",
        "  return new TransactWriteCommand({",
        "    TransactItems: [",
        '      { Put: { TableName: "MainTable", Item: { PK: "TENANT#evil-tenant#ITEM#i2", SK: "META" } } },',
        "    ],",
        "  });",
        "}",
      ].join("\n"),
    );

    const { violated, output } = runDependencyCruiser();
    expect(violated).toBe(true);
    expect(output).toContain("no-raw-dynamodb-writes-outside-lanes");
    expect(output).toContain("bypass-transact/direct-transact.ts");
  }, 30_000);

  it("BYPASS ATTEMPT 3: a fake shared/-level module (outside dynamodb/ and outbox/persistence/) reaching for BatchWriteCommand is caught", () => {
    writeFixtureAt(
      SHARED_FIXTURE_ROOT,
      "bypass-batch.ts",
      [
        "// Deliberate bypass attempt from a shared/ location that is neither shared/dynamodb/",
        "// nor shared/outbox/persistence/ - proves the rule also fences shared/, not just modules/.",
        'import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";',
        "export function bypassBatch() {",
        '  return new BatchWriteCommand({ RequestItems: {} });',
        "}",
      ].join("\n"),
    );

    const { violated, output } = runDependencyCruiser();
    expect(violated).toBe(true);
    expect(output).toContain("no-raw-dynamodb-writes-outside-lanes");
  }, 30_000);

  it("control: the real ItemWatchService (which DOES route through executeTenantBusinessMutation) produces zero violations of this rule", () => {
    // Sanity check against false positives: a legitimate lane call site must never trip this
    // rule just because it lives under src/modules/**/application/.
    const { violated, output } = runDependencyCruiser();
    expect(violated, `unexpected violation on clean tree:\n${output}`).toBe(false);
  }, 30_000);
});

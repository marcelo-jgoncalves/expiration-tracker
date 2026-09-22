import { defineConfig } from "vitest/config";

// Per-folder test.include/fileParallelism now lives in vitest.workspace.ts (D-076's
// serialization requirement is real but was scoped to all 274 files instead of just the 7
// under test/architecture/** that need it - found 2026-09-21). Coverage stays here: it is a
// root-level (not per-project) concern that Vitest merges across every workspace project.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/shared/**/*.ts", "src/modules/**/*.ts"],
      // Measured 2026-09-21 (E-023): statements 86.55%, branches 84.84%, functions 86.9%,
      // lines 86.55%. Thresholds set ~1.5-2pts below that measurement - a guard-rail against
      // real regression without breaking CI on normal day-to-day fluctuation.
      thresholds: {
        statements: 85,
        branches: 83,
        functions: 85,
        lines: 85,
      },
    },
  },
});

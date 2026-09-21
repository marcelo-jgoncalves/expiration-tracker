import { defineWorkspace } from "vitest/config";

// D-076 needed serialization only for test/architecture/** (shells out to the real tsc/
// dependency-cruiser CLIs against the whole tree and shares fixture files - two such files
// running concurrently race each other's writes). Splitting into two projects lets the other
// 260+ unit/contract/integration files run with Vitest's normal multi-worker parallelism
// instead of being forced serial by that one folder's requirement (found 2026-09-21: root
// vitest.config.ts had `fileParallelism: false` applied globally).
export default defineWorkspace([
  {
    test: {
      name: "parallel",
      environment: "node",
      testTimeout: 15_000,
      include: ["test/unit/**/*.test.ts", "test/contract/**/*.test.ts", "test/integration/**/*.test.ts"],
    },
  },
  {
    test: {
      name: "architecture",
      environment: "node",
      testTimeout: 15_000,
      include: ["test/architecture/**/*.test.ts"],
      fileParallelism: false,
    },
  },
]);

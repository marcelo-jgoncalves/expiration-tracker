import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 15_000,
    // Architecture tests (test/architecture/**) plant/remove real fixture files under src/ and
    // shell out to the real tsc/dependency-cruiser CLIs against the whole tree - two such test
    // files running concurrently race each other's writes (D-076: adding a second architecture
    // test file surfaced this real gap - vitest runs test files in parallel by default, and one
    // file's fixture cleanup mid-run could make the other's whole-tree scan see a file
    // disappear). Serializing file execution is the correct fix (these are few, slow-by-design
    // integration-style tests, not a hot path where parallelism matters) rather than trying to
    // make the fixtures "more isolated" - they are deliberately full-tree, real-tool checks.
    fileParallelism: false,
    include: [
      "test/unit/**/*.test.ts",
      "test/contract/**/*.test.ts",
      "test/integration/**/*.test.ts",
      "test/architecture/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/shared/**/*.ts", "src/modules/**/*.ts"],
    },
  },
});

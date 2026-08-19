import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // CDK synth (test/infra) can take ~10s on cold module resolution - Vitest 4's default
    // 5000ms is tighter than v1's and was flaky here. 15s gives headroom without masking a
    // genuinely hung test.
    testTimeout: 15_000,
    include: [
      "test/unit/**/*.test.ts",
      "test/contract/**/*.test.ts",
      "test/integration/**/*.test.ts",
      "test/infra/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/shared/**/*.ts", "src/modules/**/*.ts"],
    },
  },
});

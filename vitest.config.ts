import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 15_000,
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

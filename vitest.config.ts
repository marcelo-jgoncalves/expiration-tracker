import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
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

import { defineConfig } from "vitest/config";

/** Camada 2 (docs/architecture/m3.5-runtime-design.md): DynamoDB Local via Testcontainers.
 * Deliberately separate from vitest.config.ts's default include - requires Docker, heavier
 * (container startup), and not part of the fast `npm test` gate every PR runs. */
export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 180_000,
    include: ["test/integration-dynamodb/**/*.test.ts"],
  },
});

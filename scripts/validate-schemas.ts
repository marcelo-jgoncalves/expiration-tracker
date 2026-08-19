/**
 * CLI: loads every schema under schemas/ and fails if any is malformed / has unresolved
 * $refs. Run via `npm run validate-schemas`; wired into CI (see .github/workflows/ci.yml).
 */
import { SchemaRegistry } from "../src/shared/contracts/schema-validator.js";

try {
  // eslint-disable-next-line no-new -- constructing eagerly loads+compiles all schemas.
  new SchemaRegistry();
  // eslint-disable-next-line no-console -- CLI script, not a Lambda handler.
  console.log("All schemas under schemas/ loaded successfully.");
} catch (err) {
  // eslint-disable-next-line no-console -- CLI script.
  console.error("Schema validation failed:", err);
  process.exit(1);
}

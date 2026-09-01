// Lint conventions per implementation-blueprint.md #14.1: "Todos os handlers usam
// SecureLogger. Chamadas diretas a console.* falham no lint." src/shared/observability
// is the only place allowed to touch console.* (it's the sink the logger writes to).
//
// Flat config (ESLint 10 removed .eslintrc support) - equivalent of the old .eslintrc.cjs,
// same rules/overrides/ignores, translated to eslint.config.js semantics (ESLint migration
// guide: https://eslint.org/docs/latest/use/configure/migration-guide).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    // prototype/ is plain browser JS (window/document/location globals), deliberately isolated
    // from production code (see prototype/README.md) — it is not part of this Node/TS ruleset.
    // frontend/ is a separate npm project (own package.json/lockfile/eslint.config.js, its own
    // CI job) — its plugins live in frontend/node_modules, unreachable from this root install.
    // infra/modules/spa-hosting/spa-routing.js is CloudFront Function runtime JS (ADR-0011) -
    // its `handler` export is invoked by the CloudFront runtime itself, never imported by any
    // TS module here, so no-unused-vars flags it incorrectly; it has its own unit test coverage
    // (test/unit/infra/spa-routing.test.ts) instead of lint coverage.
    ignores: ["dist/", "cdk.out/", "coverage/", "node_modules/", "prototype/", "frontend/", "infra/modules/spa-hosting/spa-routing.js", ".claude/"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      "no-console": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["src/shared/observability/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["test/**/*.ts", "**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["scripts/**/*.ts", "scripts/**/*.mjs"],
    rules: {
      "no-console": "off",
    },
  },
  {
    // Architecture boundary, IDE-speed layer only (Engineering Maturity Review G10,
    // 2026-08-19). IMPORTANT: no-restricted-imports matches the literal import-specifier
    // TEXT, not the resolved module graph - it cannot see a transitive re-export (domain
    // file A imports domain file B, which imports application/), and this codebase's
    // relative imports (e.g. "../ports/foo.js") often don't even literally contain
    // "modules/" for the cross-module patterns below to match. The AUTHORITATIVE boundary
    // check is `npm run check-boundaries` (.dependency-cruiser.cjs, wired into CI) - it
    // resolves the real graph. This ESLint rule stays only for fast in-editor feedback on
    // the direct-import case; do not treat it as sufficient on its own.
    files: ["src/modules/*/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["**/infra/**"], message: "domain/ must not depend on infra/ (architecture boundary)." },
            { group: ["aws-sdk", "@aws-sdk/*"], message: "domain/ must be AWS-SDK-agnostic (architecture boundary)." },
            { group: ["**/modules/*/application/**", "**/modules/*/ports/**", "**/modules/*/http/**", "**/modules/*/persistence/**"], message: "domain/ must not import another module's application/ports/http/persistence layers (architecture boundary)." },
          ],
        },
      ],
    },
  },
  {
    // W3-07 (D-068) tenant fence structural boundary, IDE-speed layer only - same caveat as
    // the domain/ rule above applies: this is text-matching on the import specifier, not the
    // resolved module graph, so it cannot see a transitive re-export. The AUTHORITATIVE
    // enforcement is `npm run check-boundaries`'s `no-raw-dynamodb-writes-outside-lanes` rule
    // (.dependency-cruiser.cjs), proven against real bypass fixtures by
    // test/architecture/tenant-fence-boundary.test.ts. This ESLint rule is defense-in-depth
    // fast feedback only, never the load-bearing guarantee.
    files: ["src/modules/*/{domain,application,ports,http}/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@aws-sdk/lib-dynamodb"],
              message:
                "Raw DynamoDB write commands (PutCommand/UpdateCommand/DeleteCommand/TransactWriteCommand/BatchWriteCommand) may only be imported by a module's own persistence/ adapter. Route tenant-scoped mutations through TenantBusinessMutation/SystemMutation (src/shared/tenant-lifecycle/) instead (W3-07 fence, architecture boundary).",
            },
          ],
        },
      ],
    },
  },
);

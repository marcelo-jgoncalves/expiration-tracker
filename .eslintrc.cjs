/**
 * Lint conventions per implementation-blueprint.md #14.1: "Todos os handlers usam
 * SecureLogger. Chamadas diretas a console.* falham no lint." src/shared/observability
 * is the only place allowed to touch console.* (it's the sink the logger writes to).
 */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
  ],
  env: {
    node: true,
    es2022: true,
  },
  // prototype/ is plain browser JS (window/document/location globals), deliberately isolated
  // from production code (see prototype/README.md) — it is not part of this Node/TS ruleset.
  // frontend/ is a separate npm project (own package.json/lockfile/.eslintrc.cjs, its own CI
  // job) — its plugins live in frontend/node_modules, unreachable from this root install.
  ignorePatterns: ["dist/", "cdk.out/", "coverage/", "node_modules/", "prototype/", "frontend/"],
  rules: {
    "no-console": "error",
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    "@typescript-eslint/no-explicit-any": "warn",
  },
  overrides: [
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
      files: ["scripts/**/*.ts"],
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
  ],
};

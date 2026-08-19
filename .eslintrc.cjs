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
  ignorePatterns: ["dist/", "cdk.out/", "coverage/", "node_modules/"],
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
      // Architecture boundary enforcement (Engineering Maturity Review G10, 2026-08-19):
      // domain/ layers must stay SDK-agnostic and must not reach into infra/ or sibling
      // modules' internals. Previously true only by convention (verified by grep, not by
      // CI) - this makes the boundary a real, automated, required check.
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

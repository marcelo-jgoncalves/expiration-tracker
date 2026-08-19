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
  ],
};

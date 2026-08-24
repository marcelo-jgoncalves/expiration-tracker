/**
 * jsx-a11y is enforced at error level, not warn - Frontend Production Foundation mission
 * §49-50: "primitives básicos precisam nascer corretos", accessibility is not a later pass.
 */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  plugins: ["@typescript-eslint", "react-hooks", "jsx-a11y"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:jsx-a11y/recommended",
  ],
  env: {
    browser: true,
    es2022: true,
  },
  ignorePatterns: ["dist/", "coverage/", "node_modules/", "playwright-report/", "test-results/"],
  settings: {
    "jsx-a11y": { polymorphicPropName: "as" },
  },
  rules: {
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    "@typescript-eslint/no-explicit-any": "warn",
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "error",
    // No ARIA is better than bad ARIA (interface-quality-standard.md §7) - flag redundant
    // roles that duplicate an element's own implicit semantics.
    "jsx-a11y/no-redundant-roles": "error",
  },
  overrides: [
    {
      files: ["test/**/*.ts", "test/**/*.tsx", "**/*.test.ts", "**/*.test.tsx"],
      env: { node: true },
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
      },
    },
    {
      files: ["vite.config.ts", "playwright.config.ts"],
      env: { node: true },
    },
  ],
};

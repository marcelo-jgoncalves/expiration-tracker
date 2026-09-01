/**
 * jsx-a11y is enforced at error level, not warn - Frontend Production Foundation mission
 * §49-50: "primitives básicos precisam nascer corretos", accessibility is not a later pass.
 *
 * D-157 (2026-09-01): stays on the classic eslintrc format (ESLint 8, not 10) - blocked by
 * eslint-plugin-jsx-a11y not yet supporting ESLint 10 upstream (peer caps at ^9). Because the
 * root project migrated to flat config (../eslint.config.js), frontend/package.json's lint
 * script now passes `--config .eslintrc.cjs` explicitly - ESLint 8.57's flat-config
 * auto-detection otherwise walks up past this directory and picks up the root's
 * eslint.config.js instead (real CI failure this session, `ERR_MODULE_NOT_FOUND: @eslint/js`,
 * a root-only devDependency), silently ignoring this file entirely.
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

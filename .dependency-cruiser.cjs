/**
 * Real dependency-graph boundary enforcement — Engineering Maturity Review red team finding
 * (2026-08-19, checkpoint-12-redteam): the ESLint `no-restricted-imports` rule in
 * .eslintrc.cjs only catches a DIRECT forbidden import; it cannot see a transitive path
 * (e.g. domain/a.ts -> domain/bridge.ts -> application/service.ts), dynamic import(), or a
 * barrel file re-exporting a forbidden layer. dependency-cruiser resolves the actual module
 * graph (including transitively), so it closes that gap instead of just restating it.
 *
 * This is deliberately narrow — three rules, matching exactly the three boundaries already
 * enforced (imperfectly) by ESLint. Not a general-purpose architecture linter; adding more
 * rules here should require the same justification as any other engineering decision
 * (docs/engineering/decisions-log.md), not accumulate by default.
 */
module.exports = {
  forbidden: [
    {
      name: "domain-must-not-reach-infra",
      severity: "error",
      comment: "src/modules/*/domain/** must not depend on infra/, directly or transitively.",
      from: { path: "^src/modules/[^/]+/domain/" },
      to: { path: "^infra/" },
    },
    {
      name: "domain-must-not-reach-aws-sdk",
      severity: "error",
      comment: "src/modules/*/domain/** must stay AWS-SDK-agnostic, directly or transitively.",
      from: { path: "^src/modules/[^/]+/domain/" },
      to: { path: "^(aws-sdk|@aws-sdk/)" },
    },
    {
      name: "domain-must-not-reach-application-layers",
      severity: "error",
      comment:
        "src/modules/*/domain/** must not depend on ANY module's application/ports/http/persistence layers - not a sibling module's, and not even its own (domain is the innermost layer; application depends on domain, never the reverse). Matches .eslintrc.cjs's no-restricted-imports pattern exactly (that rule's glob is also module-name-agnostic) - direct or transitive.",
      from: { path: "^src/modules/[^/]+/domain/" },
      to: { path: "^src/modules/[^/]+/(application|ports|http|persistence)/" },
    },
    {
      name: "shared-must-not-reach-modules",
      severity: "error",
      comment:
        "src/shared/** is the lower-level layer every module's domain ultimately depends on (transitively) - it must never depend back on src/modules/**, or the dependency graph inverts. Added when security-audit.ts (src/shared/observability/) was tempted to import AuthorizationDeniedError's closed union types from modules/identity/domain/authorization.ts for a stricter signature - decoupled instead (reason/action typed as string there; callers already hold the closed-union value). This rule prevents that specific mistake from being reintroduced silently.",
      from: { path: "^src/shared/" },
      to: { path: "^src/modules/" },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};

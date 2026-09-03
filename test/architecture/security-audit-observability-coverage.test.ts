/**
 * Architecture test — logging engineering review finding (Codex round 1, 2026-08-29): proves
 * every real call site of auditAuthorizationDenied/auditGlobalIndexAccess(Denied) has its owning
 * Lambda module actually wired into security_audit_observability's http_function_names/
 * global_index_function_names in infra/main.tf. The module-local Terraform test
 * (infra/modules/security-audit-observability/tests/) uses its own synthetic fixture and cannot
 * catch a root-wiring omission — this is exactly the gap that let documents_handler/
 * subjects_handler/imports_handler (auditAuthorizationDenied) and document_purge_handler/
 * upload_slot_reconciliation_handler (auditGlobalIndexAccess) go unwired for real sessions
 * before this test existed.
 *
 * Text-based (grep on real files), not a Terraform-aware parser — the assertion is deliberately
 * simple (the exact substring `module.<name>.function_name` appears in main.tf's function-name
 * list) so a future contributor who adds a new call site gets a clear, actionable failure
 * ("add module.<name>.function_name to http_function_names/global_index_function_names in
 * infra/main.tf"), not a parser error.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..");

/** Every real http-handlers file that calls auditAuthorizationDenied, mapped to the Lambda
 * module name that wires it (src/runtime/aws/handlers/*.ts's imports — verified by hand,
 * 2026-08-29). A new http-handlers file added without also updating this map is exactly the
 * class of bug this test exists to catch — the two `it`s below fail loudly in that case. */
const AUTHORIZATION_DENIED_CALL_SITES: Array<{ file: string; lambdaModule: string }> = [
  { file: "src/modules/document/http/document-handlers.ts", lambdaModule: "documents_handler" },
  { file: "src/modules/extraction/http/extraction-handlers.ts", lambdaModule: "documents_handler" },
  { file: "src/modules/expiration/http/item-handlers.ts", lambdaModule: "items_handler" },
  { file: "src/modules/expiration/http/item-watch-handlers.ts", lambdaModule: "items_handler" },
  { file: "src/modules/reminder/http/policy-handlers.ts", lambdaModule: "reminders_handler" },
  { file: "src/modules/notification/http/preferences-handlers.ts", lambdaModule: "notifications_handler" },
  { file: "src/modules/identity/http/test-route-handler.ts", lambdaModule: "test_ping_handler" },
  { file: "src/modules/import/http/import-handlers.ts", lambdaModule: "imports_handler" },
  { file: "src/modules/subject/http/subject-handlers.ts", lambdaModule: "subjects_handler" },
  { file: "src/modules/organization/http/membership-handlers.ts", lambdaModule: "memberships_handler" },
];

/** Every real persistence/store file that calls auditGlobalIndexAccess/
 * auditGlobalIndexAccessDenied, mapped to the Lambda module that owns it. Mirrors
 * GlobalIndexComponent's closed union in security-audit.ts — the third `it` below proves every
 * member of that union has an entry here too, so the union itself can't silently drift ahead of
 * this map. */
const GLOBAL_INDEX_ACCESS_CALL_SITES: Array<{ file: string; component: string; lambdaModule: string }> = [
  { file: "src/modules/reminder/persistence/dynamodb-reminder-producer-store.ts", component: "reminder-producer", lambdaModule: "reminder_producer" },
  { file: "src/modules/reminder/persistence/dynamodb-reconciliation-candidate-source.ts", component: "reminder-reconciliation", lambdaModule: "reminder_reconciliation" },
  { file: "src/shared/outbox/persistence/dynamodb-outbox-relay-store.ts", component: "outbox-sweeper-reminder-dispatch", lambdaModule: "outbox_sweeper" },
  { file: "src/modules/document/persistence/dynamodb-document-candidate-source.ts", component: "upload-slot-reconciliation", lambdaModule: "upload_slot_reconciliation_handler" },
  { file: "src/workers/document-purge/dynamodb-document-purge-candidate-source.ts", component: "document-purge", lambdaModule: "document_purge_handler" },
  { file: "src/workers/membership-purge/dynamodb-candidate-source.ts", component: "membership-purge", lambdaModule: "membership_purge_handler" },
  { file: "src/workers/invitation-purge/dynamodb-candidate-source.ts", component: "invitation-purge", lambdaModule: "invitation_purge_handler" },
  { file: "src/workers/document-file-reconciliation/dynamodb-candidate-source.ts", component: "document-file-reconciliation", lambdaModule: "document_file_reconciliation_handler" },
  { file: "src/workers/requirement-reindex/dynamodb-candidate-source.ts", component: "requirement-reindex", lambdaModule: "requirement_reindex_handler" },
  { file: "src/workers/quota-telemetry-purge/dynamodb-candidate-source.ts", component: "quota-telemetry-purge", lambdaModule: "quota_telemetry_purge_handler" },
  { file: "src/workers/security-audit-purge/dynamodb-candidate-source.ts", component: "security-audit-purge", lambdaModule: "security_audit_purge_handler" },
  { file: "src/workers/transient-purge/dynamodb-candidate-source.ts", component: "transient-purge", lambdaModule: "transient_purge_handler" },
  { file: "src/workers/delivery-record-purge/dynamodb-candidate-source.ts", component: "delivery-record-purge", lambdaModule: "delivery_record_purge_handler" },
];

function read(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

/**
 * Codex round 2 finding (2026-08-29): a plain `mainTf.toContain("module.<name>.function_name")`
 * against the WHOLE file is too weak — that exact substring also appears in unrelated wiring
 * (API Gateway routes, IAM policies, etc.), so removing an entry from
 * `security_audit_observability`'s own lists while it still appears elsewhere in the file would
 * NOT be caught. This extracts only the `http_function_names = [...]`/
 * `global_index_function_names = [...]` block bodies from the `module "security_audit_observability"`
 * block specifically, so the assertion below can only pass if the reference is inside the right
 * list.
 */
function extractFunctionNameList(mainTf: string, listName: "http_function_names" | "global_index_function_names"): string {
  const moduleStart = mainTf.indexOf('module "security_audit_observability" {');
  if (moduleStart === -1) throw new Error('module "security_audit_observability" not found in infra/main.tf — has it been renamed?');
  // Top-level blocks always start at column 0 once `terraform fmt` has run (verified by this
  // repo's own `terraform fmt -check` in CI) — the next such line after this block's start is
  // that block's own closing "}", giving a safe (if slightly generous) upper bound to search
  // within without needing a real HCL parser.
  const afterModuleStart = mainTf.slice(moduleStart + 1);
  const nextTopLevelBraceOffset = afterModuleStart.search(/\n\}/);
  const moduleBody = nextTopLevelBraceOffset === -1 ? afterModuleStart : afterModuleStart.slice(0, nextTopLevelBraceOffset);
  const listMatch = moduleBody.match(new RegExp(`${listName}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
  if (!listMatch) throw new Error(`${listName} = [...] not found inside module "security_audit_observability" — has its shape changed?`);
  return listMatch[1] ?? "";
}

describe("security-audit-observability wiring coverage", () => {
  const mainTf = read("infra/main.tf");
  const httpFunctionNamesList = extractFunctionNameList(mainTf, "http_function_names");
  const globalIndexFunctionNamesList = extractFunctionNameList(mainTf, "global_index_function_names");

  it("every real auditAuthorizationDenied call site's owning Lambda is listed in http_function_names", () => {
    for (const { file, lambdaModule } of AUTHORIZATION_DENIED_CALL_SITES) {
      expect(read(file), `${file} no longer calls auditAuthorizationDenied — update AUTHORIZATION_DENIED_CALL_SITES`).toContain("auditAuthorizationDenied");
      expect(
        httpFunctionNamesList,
        `module.${lambdaModule}.function_name missing from security_audit_observability's http_function_names in infra/main.tf`,
      ).toContain(`module.${lambdaModule}.function_name`);
    }
  });

  it("every real GlobalIndexComponent call site's owning Lambda is listed in global_index_function_names", () => {
    for (const { file, component, lambdaModule } of GLOBAL_INDEX_ACCESS_CALL_SITES) {
      expect(read(file), `${file} no longer emits component "${component}" — update GLOBAL_INDEX_ACCESS_CALL_SITES`).toContain(`"${component}"`);
      expect(
        globalIndexFunctionNamesList,
        `module.${lambdaModule}.function_name missing from security_audit_observability's global_index_function_names in infra/main.tf`,
      ).toContain(`module.${lambdaModule}.function_name`);
    }
  });

  it("GlobalIndexComponent's closed union in security-audit.ts has no member missing from the call-site map above", () => {
    const securityAudit = read("src/shared/observability/security-audit.ts");
    const unionMatch = securityAudit.match(/export type GlobalIndexComponent =([\s\S]*?);/);
    expect(unionMatch, "GlobalIndexComponent union not found — security-audit.ts shape changed, update this test").not.toBeNull();
    const unionBody = unionMatch?.[1] ?? "";
    const unionMembers = [...unionBody.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1] ?? "");
    expect(unionMembers.length).toBeGreaterThan(0);
    const mappedComponents = new Set(GLOBAL_INDEX_ACCESS_CALL_SITES.map((c) => c.component));
    for (const member of unionMembers) {
      expect(mappedComponents.has(member), `GlobalIndexComponent member "${member}" has no entry in GLOBAL_INDEX_ACCESS_CALL_SITES above`).toBe(true);
    }
  });
});

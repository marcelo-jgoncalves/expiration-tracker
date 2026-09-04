/**
 * ReportsService — Roadmap P0.7 (`docs/project/roadmap-competitivo-2026-09-01.md` §P0.7,
 * "Relatórios, Exportação e Audit Trail"), fatias 1-2. 7 CSV reports, all deriving from data
 * already indexed for D-194 Fatia 3 (search/filters) and P0.6 (dashboard) — no new GSI, no new
 * physical Query pattern.
 *
 * Follows `DashboardService`'s already-`APPROVED` cross-module composition precedent verbatim
 * (`src/modules/dashboard/application/dashboard-service.ts`): depends on BOTH modules' store
 * PORTS directly (`Pick<DocumentArchiveStore,...>`/`Pick<ExpirationStore,...>`), never on
 * `DocumentArchiveService`/`ExpirationService`'s application classes — same "own `authorize()` +
 * own `runPagedSearch` calls against the shared GSI1 `REQSTATUS#`/`ITEMSTATUS#` namespaces" shape
 * that precedent already established, extended here from counts to full row projections for CSV.
 *
 * Same proportionality trade-off `DashboardService`'s own doc comment already accepted (AGENTS.md
 * §1: no real users/production yet, no launch pressure): each report runs one `runPagedSearch`
 * call per relevant status (5 native pages / 125 evaluated items each, `paged-search.ts`) rather
 * than looping beyond that budget the way `exportItems()`'s dedicated 2.000-item cap does —
 * `truncated: true` is surfaced whenever ANY sub-query hit its page cap, so a report never
 * silently underclaims completeness (same "approximate" contract `DashboardSummary` already
 * established).
 *
 * RBAC tier: `item:export`/`docarchive:requirement-export` (ADMIN_ROLES) — a CSV report reading
 * every member's rows across the whole tenant has the same disclosure-asymmetry profile
 * `item:export`'s own doc comment in `authorization.ts` already gives for D-123/D-126's bulk
 * export, not the READ_ONLY_ROLES tier `item:read`/`docarchive:requirement-read` use for a single
 * caller-scoped search page.
 *
 * "Solicitações pendentes" (a DocumentRequest-backlog report) is explicitly OUT OF SCOPE here —
 * real gap left pending (two distinct `DocumentRequest` entities coexist today, neither has a
 * tenant-wide GSI by status), registered in the commit introducing this file, not built here.
 */
import { authorize } from "../../identity/domain/authorization.js";
import type { RequestContext } from "../../identity/domain/request-context.js";
import { runPagedSearch, SEARCH_PAGE_SIZE } from "../../../shared/domain/paged-search.js";
import type { UnifiedValidityState } from "../../../shared/domain/validity-state.js";
import type { Requirement, RequirementStatus } from "../../document-archive/domain/requirement.js";
import { trackedSubjectKeyForFence } from "../../document-archive/domain/requirement-template.js";
import { deriveExpirationItemValidityState, type ExpirationItem, type ExpirationItemStatus } from "../../expiration/domain/expiration-item.js";
import type { DocumentArchiveStore } from "../../document-archive/ports/document-archive-store.js";
import type { ExpirationStore } from "../../expiration/ports/expiration-store.js";
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export interface ReportsServiceDeps {
  documentStore: Pick<DocumentArchiveStore, "queryIndexPage" | "batchGet">;
  itemStore: Pick<ExpirationStore, "queryGsi1Page">;
  now?: () => Date;
}

export interface RequirementReportRow {
  requirement: Requirement;
  subjectDisplayName?: string;
}

export interface ReportPage<T> {
  rows: T[];
  /** True when any underlying sub-query hit the 5-page/125-item cap while more rows might
   * still exist — the report is then a LOWER BOUND, never an overstatement (same contract
   * `DashboardSummary.approximate`/`PagedSearchResult.scanLimitReached` already establish). */
  truncated: boolean;
}

const REQUIREMENT_ALL_STATUSES: RequirementStatus[] = ["MISSING", "PENDING", "SATISFIED", "NOT_SATISFIED", "NOT_APPLICABLE"];
// Same "actively tracked" set exportItems() already uses (D-123/D-126, round-3 Achado #4) -
// DELETED is deliberately never queried here either: a soft-deleted item is not "actively
// tracked" and has no business responsible-party report to run against it.
const EXPIRATION_ITEM_ACTIVE_STATUSES: ExpirationItemStatus[] = ["ACTIVE", "ARCHIVED", "RENEWED"];

export class ReportsService {
  private readonly documentStore: Pick<DocumentArchiveStore, "queryIndexPage" | "batchGet">;
  private readonly itemStore: Pick<ExpirationStore, "queryGsi1Page">;
  private readonly now: () => Date;

  constructor(deps: ReportsServiceDeps) {
    this.documentStore = deps.documentStore;
    this.itemStore = deps.itemStore;
    this.now = deps.now ?? (() => new Date());
  }

  private searchItemsByStatus(tenantId: string, status: ExpirationItemStatus, matches: (item: ExpirationItem) => boolean) {
    return runPagedSearch<ExpirationItem>({
      fetchPage: (exclusiveStartKey) =>
        this.itemStore.queryGsi1Page<ExpirationItem>({ gsi1pk: `TENANT#${tenantId}#ITEMSTATUS#${status}`, ascending: true, limit: SEARCH_PAGE_SIZE, exclusiveStartKey }),
      matches,
    });
  }

  private searchRequirementsByStatus(tenantId: string, status: RequirementStatus, matches: (r: Requirement) => boolean) {
    return runPagedSearch<Requirement>({
      fetchPage: (exclusiveStartKey) =>
        this.documentStore.queryIndexPage<Requirement>({ indexName: "GSI1", partitionKeyValue: `TENANT#${tenantId}#REQSTATUS#${status}`, limit: SEARCH_PAGE_SIZE, exclusiveStartKey }),
      matches,
    });
  }

  /** D-194 Fatia 3's `searchRequirements()` own `subjectDisplayName` enrichment step, verbatim
   * (never reimplemented) — at most 125 evaluated Requirements per underlying status query here
   * too, so `batchGet`'s 100-key chunking is never exceeded per call. */
  private async enrichSubjectDisplayNames(tenantId: string, requirements: Requirement[]): Promise<RequirementReportRow[]> {
    const subjectIds = [...new Set(requirements.map((r) => r.subjectId))];
    const subjectRows =
      subjectIds.length > 0
        ? await this.documentStore.batchGet<EntityKey & { displayName?: string }>(subjectIds.map((subjectId) => trackedSubjectKeyForFence(tenantId, subjectId)))
        : [];
    const displayNameBySubjectId = new Map<string, string>();
    subjectRows.forEach((row, i) => {
      const pk = (row as unknown as EntityKey).PK;
      const subjectId = subjectIds.find((id) => trackedSubjectKeyForFence(tenantId, id).PK === pk) ?? subjectIds[i];
      if (subjectId !== undefined && row.displayName !== undefined) displayNameBySubjectId.set(subjectId, row.displayName);
    });
    return requirements.map((requirement) => ({ requirement, subjectDisplayName: displayNameBySubjectId.get(requirement.subjectId) }));
  }

  private async expirationItemsByValidity(tenantId: string, validityState: UnifiedValidityState): Promise<ReportPage<ExpirationItem>> {
    const now = this.now();
    const result = await this.searchItemsByStatus(tenantId, "ACTIVE", (item) => deriveExpirationItemValidityState(item, now) === validityState);
    return { rows: result.items, truncated: result.scanLimitReached };
  }

  /** GET /reports/expired-items — ExpirationItem, UnifiedValidityState VENCIDO (ACTIVE status
   * only — the ExpirationItem validity adapter never maps VENCIDO outside ACTIVE, per
   * `estado-final-consolidado.md`'s table). */
  async getExpiredItems(ctx: RequestContext): Promise<ReportPage<ExpirationItem>> {
    authorize({ context: ctx, action: "item:export", resource: { tenantId: ctx.tenant.tenantId } });
    return this.expirationItemsByValidity(ctx.tenant.tenantId, "VENCIDO");
  }

  /** GET /reports/expiring-soon-items — same as above, VENCENDO. */
  async getExpiringSoonItems(ctx: RequestContext): Promise<ReportPage<ExpirationItem>> {
    authorize({ context: ctx, action: "item:export", resource: { tenantId: ctx.tenant.tenantId } });
    return this.expirationItemsByValidity(ctx.tenant.tenantId, "VENCENDO");
  }

  /** GET /reports/missing-requirements — Requirement.status === "MISSING". */
  async getMissingRequirements(ctx: RequestContext): Promise<ReportPage<RequirementReportRow>> {
    authorize({ context: ctx, action: "docarchive:requirement-export", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    const result = await this.searchRequirementsByStatus(tenantId, "MISSING", () => true);
    const rows = await this.enrichSubjectDisplayNames(tenantId, result.items);
    return { rows, truncated: result.scanLimitReached };
  }

  /** GET /reports/renewed-items — ExpirationItem.status === "RENEWED", `renewedFromId` carries
   * the renewal-history link (roadmap P0.7's "renovações" report: already-completed renewals,
   * distinct from the open-renewal-workflow gap already registered in P0.6). */
  async getRenewedItems(ctx: RequestContext): Promise<ReportPage<ExpirationItem>> {
    authorize({ context: ctx, action: "item:export", resource: { tenantId: ctx.tenant.tenantId } });
    const result = await this.searchItemsByStatus(ctx.tenant.tenantId, "RENEWED", () => true);
    return { rows: result.items, truncated: result.scanLimitReached };
  }

  /** GET /reports/requirements-by-subject — every Requirement across every status, subject-
   * enriched, subjectId-sorted (native partition-of-truth, `getSubjectCompliance`'s doc comment
   * precedent). */
  async getRequirementsBySubject(ctx: RequestContext): Promise<ReportPage<RequirementReportRow>> {
    authorize({ context: ctx, action: "docarchive:requirement-export", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    let truncated = false;
    const all: Requirement[] = [];
    for (const status of REQUIREMENT_ALL_STATUSES) {
      const result = await this.searchRequirementsByStatus(tenantId, status, () => true);
      all.push(...result.items);
      truncated = truncated || result.scanLimitReached;
    }
    all.sort((a, b) => a.subjectId.localeCompare(b.subjectId));
    const rows = await this.enrichSubjectDisplayNames(tenantId, all);
    return { rows, truncated };
  }

  /** GET /reports/requirements-by-assignee — every Requirement with `assigneeUserId` SET
   * (D-194 Fatia 2), across every status — excludes unassigned Requirements entirely, never a
   * placeholder row for them. */
  async getRequirementsByAssignee(ctx: RequestContext): Promise<ReportPage<RequirementReportRow>> {
    authorize({ context: ctx, action: "docarchive:requirement-export", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    let truncated = false;
    const all: Requirement[] = [];
    for (const status of REQUIREMENT_ALL_STATUSES) {
      const result = await this.searchRequirementsByStatus(tenantId, status, (r) => Boolean(r.assigneeUserId));
      all.push(...result.items);
      truncated = truncated || result.scanLimitReached;
    }
    const rows = await this.enrichSubjectDisplayNames(tenantId, all);
    return { rows, truncated };
  }

  /** GET /reports/expiration-items-by-assignee — every ExpirationItem with `assigneeUserId`
   * SET (D-122/D-125), across the same "actively tracked" status set `exportItems()` uses. */
  async getExpirationItemsByAssignee(ctx: RequestContext): Promise<ReportPage<ExpirationItem>> {
    authorize({ context: ctx, action: "item:export", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    let truncated = false;
    const all: ExpirationItem[] = [];
    for (const status of EXPIRATION_ITEM_ACTIVE_STATUSES) {
      const result = await this.searchItemsByStatus(tenantId, status, (item) => Boolean(item.assigneeUserId));
      all.push(...result.items);
      truncated = truncated || result.scanLimitReached;
    }
    return { rows: all, truncated };
  }
}

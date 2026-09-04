/**
 * DashboardService — Roadmap P0.6 (`docs/project/roadmap-competitivo-2026-09-01.md` §P0.6,
 * "Dashboard operacional/compliance básico"), fatia 1. Tenant-wide aggregate counters composed
 * from the SAME two GSI1 namespaces `document-archive` and `expiration` already expose for
 * status-filtered listing (`REQSTATUS#`/`ITEMSTATUS#`, D-143/data-model.md §3) — no new index,
 * no new physical Query pattern, just a new composition reading both existing store ports.
 *
 * Every counter reuses D-194 Fatia 3's `runPagedSearch` (5 native pages of 25 items, 125
 * evaluated) rather than a dedicated `Select: COUNT` DynamoDB mechanism — a documented
 * proportionality choice (AGENTS.md §1: no real users/production yet; "dashboard operacional
 * básico" does not need exact big-tenant counts on day one) that reuses an already-reviewed
 * pattern instead of adding new DynamoDB port surface for a first cut. `approximate: true` is
 * surfaced whenever ANY sub-count hit the page cap, so a caller can tell "this is a lower bound"
 * from "this is exact" — never silently understates.
 *
 * "Aguardando cliente" and "renovações abertas" (2 of the roadmap's 6 example counters) are
 * DELIBERATELY absent here — no status in either data model covers those concepts today (a
 * genuine product gap, registered pending Marcelo's decision, not built in this slice).
 */
import { authorize } from "../../identity/domain/authorization.js";
import type { RequestContext } from "../../identity/domain/request-context.js";
import { runPagedSearch, SEARCH_PAGE_SIZE, type PagedSearchResult } from "../../../shared/domain/paged-search.js";
import { deriveRequirementValidityState, type Requirement, type RequirementStatus } from "../../document-archive/domain/requirement.js";
import { deriveExpirationItemValidityState, type ExpirationItem } from "../../expiration/domain/expiration-item.js";
import type { DocumentArchiveStore } from "../../document-archive/ports/document-archive-store.js";
import type { ExpirationStore } from "../../expiration/ports/expiration-store.js";

export interface DashboardSummary {
  /** Requirement.NOT_SATISFIED + ExpirationItem.ACTIVE with dueDate already past (UnifiedValidityState.VENCIDO). */
  overdueCount: number;
  /** Requirement.SATISFIED nearing evidenceValidUntil + ExpirationItem.ACTIVE nearing dueDate (both UnifiedValidityState.VENCENDO, same 7-day window). */
  expiringSoonCount: number;
  /** Requirement.PENDING with evidence still mid-flow (UnifiedValidityState.AGUARDANDO_REVISAO). */
  awaitingReviewCount: number;
  /** Requirement.MISSING (no evidence linked at all). */
  missingRequirementsCount: number;
  /** True when any underlying sub-count hit the 5-page/125-item cap — the counters above are
   * then a LOWER BOUND, never an overstatement (only items actually evaluated are counted). */
  approximate: boolean;
}

export interface DashboardServiceDeps {
  documentStore: Pick<DocumentArchiveStore, "queryIndexPage">;
  itemStore: Pick<ExpirationStore, "queryGsi1Page">;
  now?: () => Date;
}

export class DashboardService {
  private readonly documentStore: Pick<DocumentArchiveStore, "queryIndexPage">;
  private readonly itemStore: Pick<ExpirationStore, "queryGsi1Page">;
  private readonly now: () => Date;

  constructor(deps: DashboardServiceDeps) {
    this.documentStore = deps.documentStore;
    this.itemStore = deps.itemStore;
    this.now = deps.now ?? (() => new Date());
  }

  private fetchRequirementsByStatus(tenantId: string, status: RequirementStatus): Promise<PagedSearchResult<Requirement>> {
    return runPagedSearch<Requirement>({
      fetchPage: (exclusiveStartKey) =>
        this.documentStore.queryIndexPage<Requirement>({
          indexName: "GSI1",
          partitionKeyValue: `TENANT#${tenantId}#REQSTATUS#${status}`,
          limit: SEARCH_PAGE_SIZE,
          exclusiveStartKey,
        }),
      matches: () => true,
    });
  }

  private fetchActiveItems(tenantId: string): Promise<PagedSearchResult<ExpirationItem>> {
    return runPagedSearch<ExpirationItem>({
      fetchPage: (exclusiveStartKey) =>
        this.itemStore.queryGsi1Page<ExpirationItem>({
          gsi1pk: `TENANT#${tenantId}#ITEMSTATUS#ACTIVE`,
          ascending: true,
          limit: SEARCH_PAGE_SIZE,
          exclusiveStartKey,
        }),
      matches: () => true,
    });
  }

  async getSummary(ctx: RequestContext): Promise<DashboardSummary> {
    // Reads across both Requirement and ExpirationItem — same read-only RBAC gate each
    // module's own listing already enforces, checked here explicitly rather than trusting a
    // single action to cover both entity types.
    authorize({ context: ctx, action: "docarchive:requirement-read", resource: { tenantId: ctx.tenant.tenantId } });
    authorize({ context: ctx, action: "item:read", resource: { tenantId: ctx.tenant.tenantId } });

    const tenantId = ctx.tenant.tenantId;
    const now = this.now();

    const [notSatisfied, missing, pending, satisfied, activeItems] = await Promise.all([
      this.fetchRequirementsByStatus(tenantId, "NOT_SATISFIED"),
      this.fetchRequirementsByStatus(tenantId, "MISSING"),
      this.fetchRequirementsByStatus(tenantId, "PENDING"),
      this.fetchRequirementsByStatus(tenantId, "SATISFIED"),
      this.fetchActiveItems(tenantId),
    ]);

    const awaitingReviewCount = pending.items.filter((r) => deriveRequirementValidityState(r, now) === "AGUARDANDO_REVISAO").length;
    const requirementsExpiringSoon = satisfied.items.filter((r) => deriveRequirementValidityState(r, now) === "VENCENDO").length;

    let itemsOverdue = 0;
    let itemsExpiringSoon = 0;
    for (const item of activeItems.items) {
      const state = deriveExpirationItemValidityState(item, now);
      if (state === "VENCIDO") itemsOverdue += 1;
      else if (state === "VENCENDO") itemsExpiringSoon += 1;
    }

    return {
      overdueCount: notSatisfied.items.length + itemsOverdue,
      expiringSoonCount: requirementsExpiringSoon + itemsExpiringSoon,
      awaitingReviewCount,
      missingRequirementsCount: missing.items.length,
      approximate: [notSatisfied, missing, pending, satisfied, activeItems].some((r) => r.scanLimitReached),
    };
  }
}

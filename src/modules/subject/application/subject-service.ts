/**
 * SubjectService — 03-domain-model-tracked-subject-requirement.md (D-036) +
 * 05-domain-model-organization-billing.md (D-038, Entitlement mínimo). Mesmo padrão de
 * ExpirationService: toda mutação (1) autoriza via authorize(), nunca reimplementado aqui,
 * (2) lê o agregado fortemente consistente, (3) constrói a escrita via
 * shared/dynamodb/occ.ts, (4) comita agregado + audit (+ contador de entitlement quando a
 * mutação muda o número de subjects ACTIVE) em uma única TransactWriteItems.
 */
import type { RequestContext } from "../../identity/domain/request-context.js";
import { authorize } from "../../identity/domain/authorization.js";
import { ConflictError, NotFoundError, QuotaExceededError, SubjectExternalIdConflictError, ValidationError } from "../../../shared/errors/app-error.js";
import { runPagedSearch, SEARCH_PAGE_SIZE } from "../../../shared/domain/paged-search.js";
import { buildVersionedCreate, buildVersionedUpdate, getCancellationReasonCodes } from "../../../shared/dynamodb/occ.js";
import {
  subjectKey,
  gsi7Keys,
  normalizeDisplayName,
  subjectExternalIdPointerKey,
  type TrackedSubject,
  type TrackedSubjectStatus,
  type TrackedSubjectType,
  type CreateSubjectInput,
  type UpdateSubjectInput,
  type SubjectExternalIdPointer,
} from "../domain/tracked-subject.js";
import { entitlementKey, defaultEntitlement, type TenantEntitlement } from "../domain/entitlement.js";
import { buildSubjectAuditEvent, appendSubjectAuditToTransaction, type SubjectAuditAction } from "../domain/audit-event.js";
import { isTransactionCanceled, type SubjectStore, type TransactWriteEntry } from "../ports/subject-store.js";
import type { SubjectIdGenerator } from "./id-generator.js";

export interface SubjectServiceDeps {
  store: SubjectStore;
  tableName: string;
  ids: SubjectIdGenerator;
  now?: () => string;
}

export interface SubjectListQuery {
  status: TrackedSubjectStatus;
  ascending?: boolean;
  limit?: number;
}

/**
 * D-194 Fatia 3 (`docs/architecture/reviews/search-and-filters-scoping/estado-final-
 * consolidado.md`) — `status` is REQUIRED and singular (no server-side composition of multiple
 * statuses). `type` narrows both the physical scan (still one GSI7 partition, filtered in memory)
 * AND the name-matching semantics: `namePrefix` is a PREFIX match against `displayNameNormalized`
 * when `type` is given (GSI7SK's real physical order groups by type-then-name, so "prefix" is a
 * meaningful concept once type is fixed), or a SUBSTRING match when `type` is absent (no
 * type-scoped physical ordering to reason a prefix against). `tag` is exact membership in
 * `TrackedSubject.tags`. `exclusiveStartKey` is the raw decoded cursor key, never the opaque
 * string — the HTTP handler owns encode/decode via `shared/domain/search-cursor.ts`.
 */
export interface SubjectSearchQuery {
  status: TrackedSubjectStatus;
  type?: TrackedSubjectType;
  namePrefix?: string;
  tag?: string;
  exclusiveStartKey?: Record<string, unknown>;
}

export interface SubjectSearchHit {
  kind: "SUBJECT";
  subject: TrackedSubject;
}

export interface SubjectSearchPage {
  items: SubjectSearchHit[];
  lastEvaluatedKey?: Record<string, unknown>;
  scanLimitReached: boolean;
}

/** Mesmo limite de tentativas sob contenção já usado por TenantQuotaService
 * (identity/application/quota.ts) — mesma classe de corrida (read-check-conditionalWrite),
 * aqui unindo o contador de entitlement e a escrita do agregado numa transação só. */
const MAX_CONTENTION_RETRIES = 20;

export class SubjectService {
  private readonly store: SubjectStore;
  private readonly tableName: string;
  private readonly ids: SubjectIdGenerator;
  private readonly now: () => string;

  constructor(deps: SubjectServiceDeps) {
    this.store = deps.store;
    this.tableName = deps.tableName;
    this.ids = deps.ids;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async createSubject(ctx: RequestContext, input: CreateSubjectInput): Promise<TrackedSubject> {
    authorize({ context: ctx, action: "subject:create", resource: { tenantId: ctx.tenant.tenantId } });

    for (let attempt = 0; attempt < MAX_CONTENTION_RETRIES; attempt++) {
      const entitlement = await this.ensureEntitlement(ctx.tenant.tenantId);
      if (entitlement.activeTrackedSubjectsCount >= entitlement.activeTrackedSubjectsLimit) {
        throw new QuotaExceededError("Active tracked subject limit reached for this plan.", {
          tenantId: ctx.tenant.tenantId,
          planId: entitlement.planId,
          limit: entitlement.activeTrackedSubjectsLimit,
        });
      }

      const subjectId = this.ids.newSubjectId();
      const now = this.now();
      const displayNameNormalized = normalizeDisplayName(input.displayName);
      const subject: TrackedSubject = {
        ...subjectKey(ctx.tenant.tenantId, subjectId),
        entityType: "TrackedSubject",
        subjectId,
        tenantId: ctx.tenant.tenantId,
        type: input.type,
        displayName: input.displayName,
        displayNameNormalized,
        notes: input.notes,
        externalId: input.externalId,
        tags: input.tags ?? [],
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
        version: 1,
        ...gsi7Keys(ctx.tenant.tenantId, "ACTIVE", input.type, displayNameNormalized, subjectId),
      };

      const entries: TransactWriteEntry[] = [
        {
          Update: buildVersionedUpdate({
            tableName: this.tableName,
            key: entitlementKey(ctx.tenant.tenantId),
            tenantId: ctx.tenant.tenantId,
            expectedVersion: entitlement.version,
            set: { activeTrackedSubjectsCount: entitlement.activeTrackedSubjectsCount + 1 },
          }),
        },
        { Put: buildVersionedCreate(this.tableName, subject as unknown as Record<string, unknown> & { PK: string; SK: string }) },
      ];
      // Index of the pointer's Put entry, if present - needed below to distinguish an
      // externalId collision (SubjectExternalIdConflictError, no retry) from an ordinary
      // contention race on the entitlement counter or a colliding fresh ULID (retry with
      // fresh state), per D-192 §2.
      let pointerEntryIndex: number | undefined;
      if (input.externalId !== undefined) {
        const pointer: SubjectExternalIdPointer = {
          ...subjectExternalIdPointerKey(ctx.tenant.tenantId, input.externalId),
          entityType: "SubjectExternalIdPointer",
          tenantId: ctx.tenant.tenantId,
          externalId: input.externalId,
          subjectId,
          createdAt: now,
          updatedAt: now,
          version: 1,
        };
        pointerEntryIndex = entries.length;
        entries.push({ Put: buildVersionedCreate(this.tableName, pointer as unknown as Record<string, unknown> & { PK: string; SK: string }) });
      }
      this.appendAudit(entries, ctx, {
        resourceType: "TrackedSubject",
        resourceId: subjectId,
        subjectId,
        action: "CREATE",
        previousVersion: undefined,
        newVersion: 1,
        changes: { after: subject },
      });

      try {
        await this.store.transactWrite(entries);
        return subject;
      } catch (err) {
        if (isTransactionCanceled(err)) {
          if (pointerEntryIndex !== undefined) {
            const codes = getCancellationReasonCodes(err);
            if (codes?.[pointerEntryIndex] === "ConditionalCheckFailed") {
              throw new SubjectExternalIdConflictError("A TrackedSubject with this externalId already exists.", {
                tenantId: ctx.tenant.tenantId,
                externalId: input.externalId,
              });
            }
          }
          continue; // corrida no contador ou no ID novo - repete com estado fresco
        }
        throw err;
      }
    }

    throw new ConflictError("Could not create subject under contention.", { tenantId: ctx.tenant.tenantId });
  }

  /** D-192 §4 lookup path the later Document/Requirement import slices resolve
   * `subjectRefKind="EXTERNAL_ID"` through: pointer Get -> subjectId -> Get TrackedSubject.
   * Returns `undefined` (never throws) when no such externalId is claimed in this tenant -
   * callers decide what "not found" means for them (e.g. a 404 vs. a per-row import rejection). */
  async getSubjectByExternalId(ctx: RequestContext, externalId: string): Promise<TrackedSubject | undefined> {
    authorize({ context: ctx, action: "subject:read", resource: { tenantId: ctx.tenant.tenantId } });
    const pointer = await this.store.get<SubjectExternalIdPointer>(subjectExternalIdPointerKey(ctx.tenant.tenantId, externalId));
    if (!pointer) return undefined;
    return this.store.get<TrackedSubject>(subjectKey(ctx.tenant.tenantId, pointer.subjectId));
  }

  async getSubject(ctx: RequestContext, subjectId: string): Promise<TrackedSubject> {
    const subject = await this.readActiveSubject(ctx.tenant.tenantId, subjectId);
    authorize({ context: ctx, action: "subject:read", resource: { tenantId: subject.tenantId } });
    return subject;
  }

  async updateSubject(ctx: RequestContext, subjectId: string, input: UpdateSubjectInput, expectedVersion: number): Promise<TrackedSubject> {
    const subject = await this.readActiveSubject(ctx.tenant.tenantId, subjectId);
    authorize({ context: ctx, action: "subject:update", resource: { tenantId: subject.tenantId } });

    const set: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    if (input.displayName !== undefined) {
      set["displayName"] = input.displayName;
      set["displayNameNormalized"] = normalizeDisplayName(input.displayName);
      before["displayName"] = subject.displayName;
      after["displayName"] = input.displayName;
    }
    if (input.notes !== undefined) {
      set["notes"] = input.notes;
      before["notes"] = subject.notes;
      after["notes"] = input.notes;
    }
    if (input.tags !== undefined) {
      set["tags"] = input.tags;
      before["tags"] = subject.tags;
      after["tags"] = input.tags;
    }
    const nextDisplayNameNormalized = (set["displayNameNormalized"] as string | undefined) ?? subject.displayNameNormalized;
    const gsi7 = gsi7Keys(subject.tenantId, subject.status, subject.type, nextDisplayNameNormalized, subjectId);
    set["GSI7PK"] = gsi7.GSI7PK;
    set["GSI7SK"] = gsi7.GSI7SK;

    const entries: TransactWriteEntry[] = [
      {
        Update: buildVersionedUpdate({
          tableName: this.tableName,
          key: subjectKey(subject.tenantId, subjectId),
          tenantId: subject.tenantId,
          expectedVersion,
          set,
        }),
      },
    ];
    this.appendAudit(entries, ctx, {
      resourceType: "TrackedSubject",
      resourceId: subjectId,
      subjectId,
      action: "UPDATE",
      previousVersion: expectedVersion,
      newVersion: expectedVersion + 1,
      changes: { before, after },
    });
    await this.commit(entries);
    return { ...subject, ...(set as Partial<TrackedSubject>), version: expectedVersion + 1, updatedAt: this.now() };
  }

  /** ACTIVE -> ARCHIVED. Libera 1 slot de entitlement (mesma transação, nunca "release" separado). */
  async archiveSubject(ctx: RequestContext, subjectId: string, expectedVersion: number): Promise<void> {
    const subject = await this.readActiveSubject(ctx.tenant.tenantId, subjectId);
    authorize({ context: ctx, action: "subject:update", resource: { tenantId: subject.tenantId } });
    await this.transitionStatus(ctx, subject, expectedVersion, "ARCHIVED", "ARCHIVE", { releaseEntitlement: subject.status === "ACTIVE" });
  }

  async deleteSubject(ctx: RequestContext, subjectId: string, expectedVersion: number): Promise<void> {
    const subject = await this.readActiveSubject(ctx.tenant.tenantId, subjectId);
    authorize({ context: ctx, action: "subject:delete", resource: { tenantId: subject.tenantId } });
    await this.transitionStatus(ctx, subject, expectedVersion, "DELETED", "DELETE", {
      releaseEntitlement: subject.status === "ACTIVE",
      extraSet: { deletedAt: this.now() },
    });
  }

  /** Listagem via GSI7 (03-domain-model-...md) — eventualmente consistente, nunca usada para autorização/pré-mutação. */
  async listSubjects(ctx: RequestContext, query: SubjectListQuery): Promise<TrackedSubject[]> {
    authorize({ context: ctx, action: "subject:read", resource: { tenantId: ctx.tenant.tenantId } });
    return this.store.queryGsi7<TrackedSubject>({
      gsi7pk: `TENANT#${ctx.tenant.tenantId}#SUBJECTSTATUS#${query.status}`,
      ascending: query.ascending ?? true,
      limit: query.limit,
    });
  }

  /**
   * D-194 Fatia 3 — single `Query` on GSI7 (already tenant-facing, never a new index), one
   * physical page of `SEARCH_PAGE_SIZE` per fetch, filtered in memory over the page already
   * read, capped at `SEARCH_MAX_PAGES` (`shared/domain/paged-search.ts`). Eventually consistent
   * — same posture as `listSubjects`, never used for authorization/pre-mutation decisions.
   */
  async searchSubjects(ctx: RequestContext, query: SubjectSearchQuery): Promise<SubjectSearchPage> {
    authorize({ context: ctx, action: "subject:read", resource: { tenantId: ctx.tenant.tenantId } });
    if (!query.status) throw new ValidationError("status is required for searchSubjects.");

    const normalizedPrefix = query.namePrefix !== undefined ? normalizeDisplayName(query.namePrefix) : undefined;
    const result = await runPagedSearch<TrackedSubject>({
      exclusiveStartKey: query.exclusiveStartKey,
      fetchPage: (exclusiveStartKey) =>
        this.store.queryGsi7Page<TrackedSubject>({
          gsi7pk: `TENANT#${ctx.tenant.tenantId}#SUBJECTSTATUS#${query.status}`,
          ascending: true,
          limit: SEARCH_PAGE_SIZE,
          exclusiveStartKey,
        }),
      matches: (subject) => {
        if (query.type !== undefined && subject.type !== query.type) return false;
        if (normalizedPrefix !== undefined) {
          const matchesName =
            query.type !== undefined
              ? subject.displayNameNormalized.startsWith(normalizedPrefix)
              : subject.displayNameNormalized.includes(normalizedPrefix);
          if (!matchesName) return false;
        }
        if (query.tag !== undefined && !subject.tags.includes(query.tag)) return false;
        return true;
      },
    });

    return {
      items: result.items.map((subject) => ({ kind: "SUBJECT" as const, subject })),
      lastEvaluatedKey: result.lastEvaluatedKey,
      scanLimitReached: result.scanLimitReached,
    };
  }

  private async transitionStatus(
    ctx: RequestContext,
    subject: TrackedSubject,
    expectedVersion: number,
    status: TrackedSubjectStatus,
    action: SubjectAuditAction,
    opts: { releaseEntitlement: boolean; extraSet?: Record<string, unknown> },
  ): Promise<void> {
    const set: Record<string, unknown> = {
      status,
      ...gsi7Keys(subject.tenantId, status, subject.type, subject.displayNameNormalized, subject.subjectId),
      ...(opts.extraSet ?? {}),
    };
    const entries: TransactWriteEntry[] = [
      {
        Update: buildVersionedUpdate({
          tableName: this.tableName,
          key: subjectKey(subject.tenantId, subject.subjectId),
          tenantId: subject.tenantId,
          expectedVersion,
          set,
        }),
      },
    ];

    if (opts.releaseEntitlement) {
      const entitlement = await this.ensureEntitlement(subject.tenantId);
      entries.push({
        Update: buildVersionedUpdate({
          tableName: this.tableName,
          key: entitlementKey(subject.tenantId),
          tenantId: subject.tenantId,
          expectedVersion: entitlement.version,
          set: { activeTrackedSubjectsCount: Math.max(0, entitlement.activeTrackedSubjectsCount - 1) },
        }),
      });
    }

    this.appendAudit(entries, ctx, {
      resourceType: "TrackedSubject",
      resourceId: subject.subjectId,
      subjectId: subject.subjectId,
      action,
      previousVersion: expectedVersion,
      newVersion: expectedVersion + 1,
      changes: { before: { status: subject.status }, after: { status } },
    });
    await this.commit(entries);
  }

  private appendAudit(
    entries: TransactWriteEntry[],
    ctx: RequestContext,
    input: {
      resourceType: "TrackedSubject";
      resourceId: string;
      subjectId: string;
      action: SubjectAuditAction;
      previousVersion: number | undefined;
      newVersion: number;
      changes: Record<string, unknown>;
    },
  ): void {
    const event = buildSubjectAuditEvent({
      auditEventId: this.ids.newAuditEventId(),
      tenantId: ctx.tenant.tenantId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      subjectId: input.subjectId,
      action: input.action,
      actor: { type: "USER", userId: ctx.principal.userId },
      previousVersion: input.previousVersion,
      newVersion: input.newVersion,
      changes: input.changes,
      occurredAt: this.now(),
      correlationId: ctx.correlationId,
    });
    appendSubjectAuditToTransaction(entries, this.tableName, event);
  }

  /** Get-or-create do plano default (mesmo padrão de auto-provisionamento de TenantQuotaService). */
  private async ensureEntitlement(tenantId: string): Promise<TenantEntitlement> {
    const key = entitlementKey(tenantId);
    const existing = await this.store.get<TenantEntitlement>(key);
    if (existing) return existing;
    const created = defaultEntitlement(tenantId, this.now());
    const wrote = await this.store.putIfAbsent(created);
    if (wrote) return created;
    // Perdeu a corrida de criação - outra chamada concorrente já criou; relê o estado real.
    const fresh = await this.store.get<TenantEntitlement>(key);
    if (!fresh) throw new ConflictError("Entitlement record vanished after creation race.", { tenantId });
    return fresh;
  }

  private async readActiveSubject(tenantId: string, subjectId: string): Promise<TrackedSubject> {
    const subject = await this.store.get<TrackedSubject>(subjectKey(tenantId, subjectId));
    if (!subject || subject.status === "DELETED") {
      throw new NotFoundError("TrackedSubject not found.", { subjectId });
    }
    return subject;
  }

  private async commit(entries: TransactWriteEntry[]): Promise<void> {
    try {
      await this.store.transactWrite(entries);
    } catch (err) {
      if (isTransactionCanceled(err)) {
        throw new ConflictError("VERSION_CONFLICT", { cause: "transaction condition failed" });
      }
      throw err;
    }
  }
}

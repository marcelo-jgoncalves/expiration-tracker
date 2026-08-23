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
import { ConflictError, NotFoundError, QuotaExceededError } from "../../../shared/errors/app-error.js";
import { buildVersionedCreate, buildVersionedUpdate } from "../../../shared/dynamodb/occ.js";
import {
  subjectKey,
  gsi7Keys,
  normalizeDisplayName,
  type TrackedSubject,
  type TrackedSubjectStatus,
  type CreateSubjectInput,
  type UpdateSubjectInput,
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
        if (isTransactionCanceled(err)) continue; // corrida no contador ou no ID novo - repete com estado fresco
        throw err;
      }
    }

    throw new ConflictError("Could not create subject under contention.", { tenantId: ctx.tenant.tenantId });
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

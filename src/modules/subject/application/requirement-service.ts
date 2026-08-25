/**
 * RequirementService — 03-domain-model-tracked-subject-requirement.md (D-036). Escopo real
 * de M9 (sem DocumentRequest/guest upload ainda, isso é M10): o único ciclo de vida
 * implementado é MISSING <-> SATISFIED, via link/unlink manual de um ExpirationItem já
 * existente pelo próprio usuário do tenant. REQUESTED/SUBMITTED/UNDER_REVIEW/REJECTED
 * existem no enum de domínio (compatibilidade de schema futura) mas nenhuma transição para
 * esses estados é exercida por este serviço.
 */
import type { RequestContext } from "../../identity/domain/request-context.js";
import { authorize } from "../../identity/domain/authorization.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import { buildVersionedCreate, buildVersionedUpdate } from "../../../shared/dynamodb/occ.js";
import { subjectKey, type TrackedSubject } from "../domain/tracked-subject.js";
import {
  requirementAssignmentKey,
  REQUIREMENT_ASSIGNMENT_SK_PREFIX,
  type RequirementAssignment,
  type AssignRequirementInput,
  type UpdateRequirementAssignmentInput,
} from "../domain/requirement-assignment.js";
import { documentSubmissionKey, type DocumentSubmission } from "../domain/document-submission.js";
import { buildSubjectAuditEvent, appendSubjectAuditToTransaction, type SubjectAuditAction } from "../domain/audit-event.js";
import { isTransactionCanceled, type SubjectStore, type TransactWriteEntry } from "../ports/subject-store.js";
import type { SubjectIdGenerator } from "./id-generator.js";
import type { ExpirationItemLookup } from "../ports/expiration-item-lookup.js";

export interface RequirementServiceDeps {
  store: SubjectStore;
  tableName: string;
  ids: SubjectIdGenerator;
  itemLookup: ExpirationItemLookup;
  now?: () => string;
}

export class RequirementService {
  private readonly store: SubjectStore;
  private readonly tableName: string;
  private readonly ids: SubjectIdGenerator;
  private readonly itemLookup: ExpirationItemLookup;
  private readonly now: () => string;

  constructor(deps: RequirementServiceDeps) {
    this.store = deps.store;
    this.tableName = deps.tableName;
    this.ids = deps.ids;
    this.itemLookup = deps.itemLookup;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async assignRequirement(ctx: RequestContext, subjectId: string, input: AssignRequirementInput): Promise<RequirementAssignment> {
    const subject = await this.readActiveSubject(ctx.tenant.tenantId, subjectId);
    authorize({ context: ctx, action: "requirement:assign", resource: { tenantId: subject.tenantId } });

    const assignmentId = this.ids.newAssignmentId();
    const now = this.now();
    const assignment: RequirementAssignment = {
      ...requirementAssignmentKey(subject.tenantId, subjectId, assignmentId),
      entityType: "RequirementAssignment",
      assignmentId,
      subjectId,
      tenantId: subject.tenantId,
      requirementName: input.requirementName,
      requirementDefinitionId: input.requirementDefinitionId,
      notes: input.notes,
      status: "MISSING",
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    const entries: TransactWriteEntry[] = [
      { Put: buildVersionedCreate(this.tableName, assignment as unknown as Record<string, unknown> & { PK: string; SK: string }) },
    ];
    this.appendAudit(entries, ctx, {
      resourceType: "RequirementAssignment",
      resourceId: assignmentId,
      subjectId,
      action: "ASSIGN_REQUIREMENT",
      previousVersion: undefined,
      newVersion: 1,
      changes: { after: assignment },
    });
    await this.commit(entries);
    return assignment;
  }

  async getRequirementAssignment(ctx: RequestContext, subjectId: string, assignmentId: string): Promise<RequirementAssignment> {
    const assignment = await this.readActiveAssignment(ctx.tenant.tenantId, subjectId, assignmentId);
    authorize({ context: ctx, action: "requirement:read", resource: { tenantId: assignment.tenantId } });
    return assignment;
  }

  /** Query pela partição do subject (SK begins_with REQASSIGN#) — sem GSI novo. */
  async listRequirementAssignments(ctx: RequestContext, subjectId: string): Promise<RequirementAssignment[]> {
    const subject = await this.readActiveSubject(ctx.tenant.tenantId, subjectId);
    authorize({ context: ctx, action: "requirement:read", resource: { tenantId: subject.tenantId } });
    const rows = await this.store.queryByPk<RequirementAssignment>(subjectKey(subject.tenantId, subjectId).PK, REQUIREMENT_ASSIGNMENT_SK_PREFIX);
    return rows.filter((row) => !row.deletedAt);
  }

  async updateRequirementAssignment(
    ctx: RequestContext,
    subjectId: string,
    assignmentId: string,
    input: UpdateRequirementAssignmentInput,
    expectedVersion: number,
  ): Promise<RequirementAssignment> {
    const assignment = await this.readActiveAssignment(ctx.tenant.tenantId, subjectId, assignmentId);
    authorize({ context: ctx, action: "requirement:update", resource: { tenantId: assignment.tenantId } });

    const set: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    if (input.requirementName !== undefined) {
      set["requirementName"] = input.requirementName;
      before["requirementName"] = assignment.requirementName;
      after["requirementName"] = input.requirementName;
    }
    if (input.notes !== undefined) {
      set["notes"] = input.notes;
      before["notes"] = assignment.notes;
      after["notes"] = input.notes;
    }

    const entries: TransactWriteEntry[] = [
      {
        Update: buildVersionedUpdate({
          tableName: this.tableName,
          key: requirementAssignmentKey(assignment.tenantId, subjectId, assignmentId),
          tenantId: assignment.tenantId,
          expectedVersion,
          set,
        }),
      },
    ];
    this.appendAudit(entries, ctx, {
      resourceType: "RequirementAssignment",
      resourceId: assignmentId,
      subjectId,
      action: "UPDATE",
      previousVersion: expectedVersion,
      newVersion: expectedVersion + 1,
      changes: { before, after },
    });
    await this.commit(entries);
    return { ...assignment, ...(set as Partial<RequirementAssignment>), version: expectedVersion + 1, updatedAt: this.now() };
  }

  /** MISSING -> SATISFIED, vinculando um ExpirationItem já existente (confirmado via
   * ExpirationItemLookup - nunca aceito só pelo itemId informado no request). */
  async linkExpirationItem(ctx: RequestContext, subjectId: string, assignmentId: string, itemId: string, expectedVersion: number): Promise<RequirementAssignment> {
    const assignment = await this.readActiveAssignment(ctx.tenant.tenantId, subjectId, assignmentId);
    authorize({ context: ctx, action: "requirement:review", resource: { tenantId: assignment.tenantId } });

    const exists = await this.itemLookup.itemExists(assignment.tenantId, itemId);
    if (!exists) {
      throw new ValidationError("Referenced item does not exist for this tenant.", { itemId });
    }

    const now = this.now();
    const set = { status: "SATISFIED" as const, linkedItemId: itemId, satisfiedAt: now };
    const entries: TransactWriteEntry[] = [
      {
        Update: buildVersionedUpdate({
          tableName: this.tableName,
          key: requirementAssignmentKey(assignment.tenantId, subjectId, assignmentId),
          tenantId: assignment.tenantId,
          expectedVersion,
          set,
        }),
      },
    ];
    this.appendAudit(entries, ctx, {
      resourceType: "RequirementAssignment",
      resourceId: assignmentId,
      subjectId,
      action: "LINK_ITEM",
      previousVersion: expectedVersion,
      newVersion: expectedVersion + 1,
      changes: { before: { status: assignment.status, linkedItemId: assignment.linkedItemId }, after: set },
    });
    await this.commit(entries);
    return { ...assignment, ...set, version: expectedVersion + 1, updatedAt: now };
  }

  /** SATISFIED -> MISSING, desfazendo o vínculo (ex. item foi excluído/renovado incorretamente). */
  async unlinkExpirationItem(ctx: RequestContext, subjectId: string, assignmentId: string, expectedVersion: number): Promise<RequirementAssignment> {
    const assignment = await this.readActiveAssignment(ctx.tenant.tenantId, subjectId, assignmentId);
    authorize({ context: ctx, action: "requirement:review", resource: { tenantId: assignment.tenantId } });

    const set = { status: "MISSING" as const };
    const entries: TransactWriteEntry[] = [
      {
        Update: buildVersionedUpdate({
          tableName: this.tableName,
          key: requirementAssignmentKey(assignment.tenantId, subjectId, assignmentId),
          tenantId: assignment.tenantId,
          expectedVersion,
          set,
          remove: ["linkedItemId", "satisfiedAt"],
        }),
      },
    ];
    this.appendAudit(entries, ctx, {
      resourceType: "RequirementAssignment",
      resourceId: assignmentId,
      subjectId,
      action: "UNLINK_ITEM",
      previousVersion: expectedVersion,
      newVersion: expectedVersion + 1,
      changes: { before: { status: assignment.status, linkedItemId: assignment.linkedItemId }, after: set },
    });
    await this.commit(entries);
    return { ...assignment, ...set, linkedItemId: undefined, satisfiedAt: undefined, version: expectedVersion + 1, updatedAt: this.now() };
  }

  /** BLOCKER-A (segunda metade): DocumentSubmission é agregado-irmão de Document (M6),
   * ancorado no RequirementAssignment, não no ExpirationItem — mesma leitura por partição
   * sem GSI novo (data-model.md, `document-submission.ts` linha 42), reusando
   * `requirement:read` já que a submissão é evidência do próprio assignment, sem action
   * dedicada reservada de antemão (diferente de `document:read`, que já existia na matriz). */
  async getDocumentSubmission(ctx: RequestContext, subjectId: string, assignmentId: string, submissionId: string): Promise<DocumentSubmission> {
    const assignment = await this.readActiveAssignment(ctx.tenant.tenantId, subjectId, assignmentId);
    authorize({ context: ctx, action: "requirement:read", resource: { tenantId: assignment.tenantId } });
    const submission = await this.store.get<DocumentSubmission>(documentSubmissionKey(assignment.tenantId, subjectId, assignmentId, submissionId));
    if (!submission || submission.deletedAt) {
      throw new NotFoundError("DocumentSubmission not found.", { subjectId, assignmentId, submissionId });
    }
    return submission;
  }

  /** Query pela partição do subject (SK begins_with REQASSIGN#assignmentId#SUBMISSION#) —
   * sem GSI novo, mesmo padrão de listRequirementAssignments. */
  async listDocumentSubmissions(ctx: RequestContext, subjectId: string, assignmentId: string): Promise<DocumentSubmission[]> {
    const assignment = await this.readActiveAssignment(ctx.tenant.tenantId, subjectId, assignmentId);
    authorize({ context: ctx, action: "requirement:read", resource: { tenantId: assignment.tenantId } });
    const rows = await this.store.queryByPk<DocumentSubmission>(
      subjectKey(assignment.tenantId, subjectId).PK,
      `${REQUIREMENT_ASSIGNMENT_SK_PREFIX}${assignmentId}#SUBMISSION#`,
    );
    return rows.filter((row) => !row.deletedAt);
  }

  async deleteRequirementAssignment(ctx: RequestContext, subjectId: string, assignmentId: string, expectedVersion: number): Promise<void> {
    const assignment = await this.readActiveAssignment(ctx.tenant.tenantId, subjectId, assignmentId);
    authorize({ context: ctx, action: "requirement:delete", resource: { tenantId: assignment.tenantId } });

    const now = this.now();
    const entries: TransactWriteEntry[] = [
      {
        Update: buildVersionedUpdate({
          tableName: this.tableName,
          key: requirementAssignmentKey(assignment.tenantId, subjectId, assignmentId),
          tenantId: assignment.tenantId,
          expectedVersion,
          set: { deletedAt: now },
        }),
      },
    ];
    this.appendAudit(entries, ctx, {
      resourceType: "RequirementAssignment",
      resourceId: assignmentId,
      subjectId,
      action: "DELETE_REQUIREMENT",
      previousVersion: expectedVersion,
      newVersion: expectedVersion + 1,
      changes: { before: { deletedAt: assignment.deletedAt }, after: { deletedAt: now } },
    });
    await this.commit(entries);
  }

  private appendAudit(
    entries: TransactWriteEntry[],
    ctx: RequestContext,
    input: {
      resourceType: "RequirementAssignment";
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

  private async readActiveSubject(tenantId: string, subjectId: string): Promise<TrackedSubject> {
    const subject = await this.store.get<TrackedSubject>(subjectKey(tenantId, subjectId));
    if (!subject || subject.status === "DELETED") {
      throw new NotFoundError("TrackedSubject not found.", { subjectId });
    }
    return subject;
  }

  private async readActiveAssignment(tenantId: string, subjectId: string, assignmentId: string): Promise<RequirementAssignment> {
    const assignment = await this.store.get<RequirementAssignment>(requirementAssignmentKey(tenantId, subjectId, assignmentId));
    if (!assignment || assignment.deletedAt) {
      throw new NotFoundError("RequirementAssignment not found.", { subjectId, assignmentId });
    }
    return assignment;
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

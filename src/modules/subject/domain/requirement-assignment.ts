/**
 * RequirementAssignment — 03-domain-model-tracked-subject-requirement.md (D-036). Agregado
 * próprio, coleção sob a partição do subject (`TENANT#t#SUBJECT#s`/`REQASSIGN#a`) — mesmo
 * padrão de coleção JÁ usado em produção por identity (`TENANT#t#USER#u`/`SESSION#<deviceId>`)
 * e por document/M6 (`TENANT#t#ITEM#i`/`DOC#d`), não convenção nova.
 *
 * `RequirementDefinition`/`RequirementTemplate` ficam deferidos por completo (nenhum access
 * pattern os exige ainda) — `requirementDefinitionId?` é só escape hatch para promoção futura.
 *
 * VALID/EXPIRING/EXPIRED NUNCA são persistidos aqui — são estados de apresentação derivados
 * do ExpirationItem linkado (condição de aprovação do Codex no cluster 1, registrada no
 * documento de decisão). Este módulo só modela o estado operacional MISSING..SATISFIED.
 * REQUESTED/SUBMITTED/UNDER_REVIEW/REJECTED existem no enum para compatibilidade de schema
 * futura (cluster 2 — DocumentRequest/guest upload, M10), mas nenhuma transição para esses
 * estados é implementada em M9: o único caminho de mutação de status aqui é
 * MISSING <-> SATISFIED, via link/unlink manual de um ExpirationItem já existente.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export type RequirementAssignmentStatus =
  | "MISSING"
  | "REQUESTED"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "REJECTED"
  | "SATISFIED";

export interface RequirementAssignment extends EntityKey {
  entityType: "RequirementAssignment";
  assignmentId: string;
  subjectId: string;
  tenantId: string;
  requirementName: string;
  requirementDefinitionId?: string;
  notes?: string;
  status: RequirementAssignmentStatus;
  linkedItemId?: string;
  linkedDocumentId?: string;
  lastSubmissionId?: string;
  requestedAt?: string;
  submittedAt?: string;
  reviewedAt?: string;
  satisfiedAt?: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function requirementAssignmentKey(tenantId: string, subjectId: string, assignmentId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#SUBJECT#${subjectId}`, SK: `REQASSIGN#${assignmentId}` };
}

/** Prefixo de SK para listar todos os requisitos de um subject via Query(PK, begins_with(SK, ...)) — sem GSI novo. */
export const REQUIREMENT_ASSIGNMENT_SK_PREFIX = "REQASSIGN#";

export interface AssignRequirementInput {
  requirementName: string;
  requirementDefinitionId?: string;
  notes?: string;
}

export interface UpdateRequirementAssignmentInput {
  requirementName?: string;
  notes?: string;
}

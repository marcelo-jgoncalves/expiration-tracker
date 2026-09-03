/**
 * TrackedSubject — docs/architecture/roadmap-evolution/03-domain-model-tracked-subject-requirement.md
 * (D-036, protocolo Claude↔Codex 9,1/9,1). Agregado raiz próprio, tenant-owned, mesmo padrão
 * de chave de ExpirationItem (`TENANT#t#ITEM#i`/`META`): `TENANT#t#SUBJECT#s`/`META`.
 *
 * Sem `ownerUserId`/`assigneeUserId` (correção registrada em D-194 Fatia 2,
 * `docs/architecture/reviews/search-and-filters-scoping/estado-final-consolidado.md`): a premissa
 * original acima ("modelar responsável antes de existir um segundo usuário real") está
 * desatualizada desde D-086/D-122 — um segundo usuário real já existe (Organization/Membership),
 * e "responsável" já é um conceito modelado no sistema, só que em duas outras entidades:
 * `ExpirationItem.assigneeUserId` (D-122/D-125) e, desde D-194 Fatia 2,
 * `document-archive/domain/requirement.ts`'s `Requirement.assigneeUserId`. TrackedSubject
 * permanece deliberadamente sem o campo — não porque o mecanismo ainda careça de evidência, mas
 * porque D-194 tratou "quem carrega o responsável" (Document, evidência, vs. Requirement,
 * obrigação acionável, vs. TrackedSubject, o próprio sujeito rastreado) como uma decisão de
 * engenharia dentro da autoridade já delegada por D-122, e nenhuma das 5 rodadas do debate
 * encontrou motivo de produto para estender esse campo a TrackedSubject nesta fase (ver "Escopo
 * explicitamente fora desta decisão" no documento acima).
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import { normalizeDisplayName } from "../../../shared/text/normalize-display-name.js";

export { normalizeDisplayName };

export type TrackedSubjectType = "COMPANY" | "VENDOR" | "CLIENT" | "EMPLOYEE" | "ASSET" | "LOCATION" | "CUSTOM";
export type TrackedSubjectStatus = "ACTIVE" | "ARCHIVED" | "DELETED";

export interface TrackedSubject extends EntityKey {
  SK: "META";
  entityType: "TrackedSubject";
  subjectId: string;
  tenantId: string;
  type: TrackedSubjectType;
  displayName: string;
  displayNameNormalized: string;
  /** Emenda registrada em 08-domain-model-custom-fields.md: observação não indexada, não
   * pesquisável, tenant-only (nunca editável pelo convidado do futuro fluxo de guest upload). */
  notes?: string;
  /** D-192 §2 (bulk-import-documents-requirements-scoping/estado-final-consolidado.md) — a
   * caller-supplied durable identifier from the tenant's source-of-record system (e.g. an
   * external CRM/vendor-management id). Optional (not every Subject needs one), create-only
   * (`updateSubject()` deliberately does not gain this capability in this slice — no rename
   * path, mirrors DocumentType's identity-vs-displayName split but simpler: no rename at all).
   * Uniqueness enforced tenant-wide via `SubjectExternalIdPointer`, same mechanism as
   * `DocumentTypeNamePointer`/`RequirementNamePointer` (D-173/D-191). */
  externalId?: string;
  tags: string[];
  status: TrackedSubjectStatus;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  GSI7PK: string;
  GSI7SK: string;
}

export function subjectKey(tenantId: string, subjectId: string): { PK: string; SK: "META" } {
  return { PK: `TENANT#${tenantId}#SUBJECT#${subjectId}`, SK: "META" };
}

/** GSI7 — listagem de subjects por status/tipo/nome (03-domain-model-...md, cluster 1,
 * rodada 2: escopo único, não misturado com nenhum outro access pattern). */
export function gsi7Keys(
  tenantId: string,
  status: TrackedSubjectStatus,
  type: TrackedSubjectType,
  displayNameNormalized: string,
  subjectId: string,
): { GSI7PK: string; GSI7SK: string } {
  return {
    GSI7PK: `TENANT#${tenantId}#SUBJECTSTATUS#${status}`,
    GSI7SK: `TYPE#${type}#NAME#${displayNameNormalized}#SUBJECT#${subjectId}`,
  };
}

/** Dedupe/lookup pointer for `TrackedSubject.externalId` — D-192 §2. One pointer row per
 * (tenant, externalId), created transactionally alongside the TrackedSubject it names so two
 * concurrent creators can never both claim the same externalId. Never deleted/repointed in
 * this slice (create-only, no rename path) — unlike `DocumentTypeNamePointer`, there is no
 * `renameSubject...` counterpart to keep in sync. */
export interface SubjectExternalIdPointer extends EntityKey {
  SK: "POINTER";
  entityType: "SubjectExternalIdPointer";
  tenantId: string;
  externalId: string;
  subjectId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function subjectExternalIdPointerKey(tenantId: string, externalId: string): { PK: string; SK: "POINTER" } {
  return { PK: `TENANT#${tenantId}#SUBJECTEXTID#${externalId}`, SK: "POINTER" };
}

export interface CreateSubjectInput {
  type: TrackedSubjectType;
  displayName: string;
  notes?: string;
  tags?: string[];
  /** Create-only — see `TrackedSubject.externalId` doc comment. */
  externalId?: string;
}

export interface UpdateSubjectInput {
  displayName?: string;
  notes?: string;
  tags?: string[];
}

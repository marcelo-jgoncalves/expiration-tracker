/**
 * DocumentRequestDeliveryPreference — ADR-0016 Decision B: migrated from the retired
 * `subject` module's M9/M10-cluster-4 slice (`RequirementAssignment`/`DocumentRequestService`,
 * removed by ADR-0016 Decision A) to `document-archive`, the module that now owns A14's
 * `DocumentRequest`. Same tenant-wide key (`TENANT#<tenantId>#SETTINGS`/
 * `DOCUMENT_REQUEST_DELIVERY`), same shape, same `tenant:configure-document-request-delivery`
 * (OWNER_ROLES) gate on GET/PUT — only the owning module changed, never the contract.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { AuthorizedTenantId } from "../../identity/domain/authorization.js";

export type DocumentRequestDeliveryMode = "MANUAL" | "EMAIL";

/** Override per call to `createDocumentRequest` (D-049 rodada 2/3 precedent, carried over from
 * the retired module: bulk creation/import, own communication channel, e-mail not yet
 * validated — register before notifying). `DEFAULT` (or an absent field) uses the tenant
 * preference. */
export type InitialInviteDeliveryOverride = "DEFAULT" | DocumentRequestDeliveryMode;

export interface DocumentRequestDeliveryPreference extends EntityKey {
  SK: "DOCUMENT_REQUEST_DELIVERY";
  entityType: "DocumentRequestDeliveryPreference";
  tenantId: string;
  initialInviteDeliveryDefault: DocumentRequestDeliveryMode;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function documentRequestDeliveryPreferenceKey(tenantId: AuthorizedTenantId): { PK: string; SK: "DOCUMENT_REQUEST_DELIVERY" } {
  return { PK: `TENANT#${tenantId}#SETTINGS`, SK: "DOCUMENT_REQUEST_DELIVERY" };
}

/** Resolves the effective delivery mode: an explicit override (anything but `DEFAULT`) wins;
 * otherwise the tenant preference; otherwise (never configured) `MANUAL` — never implicit
 * automation without an explicit choice at some level. */
export function resolveInitialInviteDeliveryMode(input: { override?: InitialInviteDeliveryOverride; tenantDefault?: DocumentRequestDeliveryMode }): DocumentRequestDeliveryMode {
  if (input.override && input.override !== "DEFAULT") return input.override;
  return input.tenantDefault ?? "MANUAL";
}

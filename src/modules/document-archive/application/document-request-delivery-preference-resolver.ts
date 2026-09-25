/**
 * ADR-0016 Decision B: the ONE internal resolver `createDocumentRequest`
 * (`document-archive-service.ts`) and materialization (`document-request-recurrence-service.ts`'s
 * `materializeAttempt` AND `document-request-recurrence` worker) all read A22's tenant default
 * through — never exposed by its own HTTP route, never gated to
 * `tenant:configure-document-request-delivery` (OWNER_ROLES), only scoped to the tenant already
 * authorized in the caller's own action.
 */
import type { DocumentArchiveStore } from "../ports/document-archive-store.js";
import type { AuthorizedTenantId } from "../../identity/domain/authorization.js";
import { documentRequestDeliveryPreferenceKey, type DocumentRequestDeliveryMode, type DocumentRequestDeliveryPreference } from "../domain/document-request-delivery-preference.js";

export async function resolveTenantInitialInviteDeliveryDefault(store: DocumentArchiveStore, tenantId: AuthorizedTenantId): Promise<DocumentRequestDeliveryMode> {
  const preference = await store.get<DocumentRequestDeliveryPreference>(documentRequestDeliveryPreferenceKey(tenantId));
  return preference?.initialInviteDeliveryDefault ?? "MANUAL";
}

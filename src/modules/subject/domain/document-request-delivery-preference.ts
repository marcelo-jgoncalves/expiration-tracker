/**
 * DocumentRequestDeliveryPreference — M10 cluster 4 (D-049). Política de TENANT (não por
 * subject/assignment) para automatizar o e-mail de convite inicial de guest upload, hoje
 * manual. Entidade deliberadamente estreita (nome específico, não um hub genérico de
 * "configurações de comunicação" — achado real do protocolo Claude↔Codex, rodada 3: evita
 * generalização antes de necessidade real). Alterável só via
 * `tenant:configure-document-request-delivery` (`ADMIN_ROLES`) — nunca por quem só cria
 * requests individuais.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export type DocumentRequestDeliveryMode = "MANUAL" | "EMAIL";

/** Override por chamada em `createDocumentRequest` (D-049 rodada 2/3: casos reais de uso —
 * criação em lote/importação, canal próprio de comunicação, e-mail ainda não validado,
 * registrar antes de avisar). `DEFAULT` (ou campo ausente) usa a preferência do tenant. */
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

export function documentRequestDeliveryPreferenceKey(tenantId: string): { PK: string; SK: "DOCUMENT_REQUEST_DELIVERY" } {
  return { PK: `TENANT#${tenantId}#SETTINGS`, SK: "DOCUMENT_REQUEST_DELIVERY" };
}

/** Resolve o modo efetivo de entrega: override explícito (quando não `DEFAULT`) vence;
 * senão, a preferência do tenant; senão (nenhuma configurada ainda), `MANUAL` - nunca
 * comportamento implícito de automação sem uma escolha explícita em algum nível (D-049). */
export function resolveInitialInviteDeliveryMode(input: { override?: InitialInviteDeliveryOverride; tenantDefault?: DocumentRequestDeliveryMode }): DocumentRequestDeliveryMode {
  if (input.override && input.override !== "DEFAULT") return input.override;
  return input.tenantDefault ?? "MANUAL";
}

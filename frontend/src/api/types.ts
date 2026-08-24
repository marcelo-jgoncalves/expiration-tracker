/**
 * Typed contracts - the domain-relevant subset of what the backend actually returns
 * (src/modules/expiration/domain/expiration-item.ts's ExpirationItem), never the full
 * persisted record. The real API response also carries internal storage fields (PK, SK,
 * GSI1PK, GSI1SK) that exist for DynamoDB's benefit, not the UI's - TypeScript's structural
 * typing means the extra fields are harmless to receive and simply never referenced here,
 * rather than requiring a backend response-shape change this foundation stage doesn't need.
 */

export type ExpirationItemStatus = "ACTIVE" | "ARCHIVED" | "RENEWED" | "DELETED";

export interface ExpirationItem {
  itemId: string;
  tenantId: string;
  name: string;
  category: string;
  description?: string;
  dueDate: string;
  issueDate?: string;
  periodicity?: string;
  issuer?: string;
  number?: string;
  assigneeUserId?: string;
  tags: string[];
  priority?: string;
  status: ExpirationItemStatus;
  renewedFromId?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CreateItemInput {
  name: string;
  category: string;
  description?: string;
  dueDate: string;
  issueDate?: string;
  periodicity?: string;
  issuer?: string;
  number?: string;
  assigneeUserId?: string;
  tags?: string[];
  priority?: string;
}

export interface DashboardQuery {
  status: ExpirationItemStatus;
  ascending?: boolean;
  limit?: number;
}

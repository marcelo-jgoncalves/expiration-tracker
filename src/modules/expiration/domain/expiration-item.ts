/**
 * ExpirationItem — data-model.md §2 (`TENANT#t#ITEM#i` / `META`) and §3 (GSI1 dashboard
 * key shape). status ACTIVE/ARCHIVED/RENEWED/DELETED per data-model.md; `renewedFromId`
 * links a renewed item's successor back to its source (implementation-blueprint.md §8:
 * renewal creates a new item/version in the lineage rather than mutating dueDate in
 * place on the same aggregate - the source item transitions to RENEWED and a new
 * ACTIVE item is created with `renewedFromId` pointing at the source).
 */
import type { EntityKey } from "../ports/expiration-store.js";

export type ExpirationItemStatus = "ACTIVE" | "ARCHIVED" | "RENEWED" | "DELETED";

export interface ExpirationItem extends EntityKey {
  SK: "META";
  entityType: "ExpirationItem";
  itemId: string;
  tenantId: string;
  name: string;
  category: string;
  categoryNormalized: string;
  description?: string;
  dueDate: string; // ISO-8601 date-time
  issueDate?: string;
  periodicity?: string;
  issuer?: string;
  number?: string;
  assigneeUserId?: string;
  tags: string[];
  priority?: string;
  status: ExpirationItemStatus;
  renewedFromId?: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  GSI1PK: string;
  GSI1SK: string;
}

export function itemKey(tenantId: string, itemId: string): { PK: string; SK: "META" } {
  return { PK: `TENANT#${tenantId}#ITEM#${itemId}`, SK: "META" };
}

/** GSI1 - vencimentos/dashboard: PK=TENANT#t#ITEMSTATUS#<status>, SK=DUE#<dueDate>#ITEM#i (data-model.md §3). No shard: MVP volume doesn't justify it (data-model.md "Governança do single-table"). */
export function gsi1Keys(tenantId: string, status: ExpirationItemStatus, dueDate: string, itemId: string): { GSI1PK: string; GSI1SK: string } {
  return {
    GSI1PK: `TENANT#${tenantId}#ITEMSTATUS#${status}`,
    GSI1SK: `DUE#${dueDate}#ITEM#${itemId}`,
  };
}

/** Unicode combining-diacritical-marks block (U+0300-U+036F), left behind by NFD decomposition (e.g. "é" -> "e" + U+0301). Built from code points rather than a literal character class to avoid any ambiguity from non-ASCII source bytes. */
const DIACRITICS_PATTERN = new RegExp(`[\\u0300-\\u036f]`, "g");

/** Lowercase, accent/extra-space-stripped normalization (data-model.md "Category — normalização mínima"). */
export function normalizeCategory(category: string): string {
  return category
    .normalize("NFD")
    .replace(DIACRITICS_PATTERN, "") // strip combining diacritics left by NFD decomposition
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
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

/** Fields an authenticated caller may change via updateItem. Never includes status/version/renewedFromId - those are controlled by dedicated operations (archiveItem/deleteItem/renewItem, the OCC builder). */
export interface UpdateItemInput {
  name?: string;
  category?: string;
  description?: string;
  dueDate?: string;
  issueDate?: string;
  periodicity?: string;
  issuer?: string;
  number?: string;
  assigneeUserId?: string;
  tags?: string[];
  priority?: string;
}

export interface RenewItemInput {
  newDueDate: string;
  /** Idempotency cycle discriminator (data-model.md §4: "tenantId|sourceItemId|sourceVersion|cycle"). Defaults to newDueDate when omitted. */
  cycle?: string;
}

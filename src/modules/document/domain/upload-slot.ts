/**
 * UploadSlot — data-model.md line 41: PK=`TENANT#t#UPLOAD`, SK=`SLOT#<id>`. Tracks the
 * reserved-but-not-yet-confirmed upload capacity consumed by reserveUpload(), independent of
 * the Document record itself (a slot can expire/be released without ever producing a usable
 * document). M6 design §2.1/2.2.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { DocumentRetentionClass } from "./retention.js";

export type UploadSlotStatus = "RESERVED" | "CONSUMED" | "EXPIRED" | "RELEASED";

export interface UploadSlot extends EntityKey {
  entityType: "UploadSlot";
  tenantId: string;
  uploadSlotId: string;
  documentId: string;
  itemId: string;
  status: UploadSlotStatus;
  quarantineKey: string;
  reservedAt: string;
  expiresAt: string;
  retentionClass: Extract<DocumentRetentionClass, "TRANSIENT">;
  purgeAfter: string;
  version: number;
  updatedAt: string;
}

export function uploadSlotKey(tenantId: string, uploadSlotId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#UPLOAD`, SK: `SLOT#${uploadSlotId}` };
}

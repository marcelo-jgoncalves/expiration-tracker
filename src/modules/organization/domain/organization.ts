/**
 * Organization — Multi-User B2B Wave B2B-3 (docs/architecture/multi-user-b2b-physical-model.md
 * §4, `APPROVED` D-086 via protocolo Claude↔Codex). Tenant boundary permanente:
 * `tenantId = organizationId` a partir do cutover (Wave B2B-5) — até lá, coexiste com o
 * `tenantId=userId` legado (Wave B2B-2, D-087/D-088), sem substituí-lo ainda. Mesma partição
 * do agregado raiz `Membership` (domain/membership.ts) — uma única `Query` em
 * `PK=TENANT#<organizationId>#ORG#<organizationId>` retorna a org + todos os membros.
 *
 * `ownerCount` é a contagem de `Membership` `ACTIVE` com `role=OWNER` — nunca calculado por
 * varredura, sempre mantido transacionalmente na mesma `TransactWriteItems` que qualquer
 * mudança de Membership que o afete (§8 do physical model; seed em `CreateOrganization`,
 * Wave B2B-3.3; decremento em mudanças de role/status fica para Wave B2B-7/B2B-8, quando
 * existir um writer real de Membership além da criação — ver nota de escopo em
 * docs/architecture/multi-user-b2b-wave-tracker.md B2B-3).
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export interface Organization extends EntityKey {
  SK: "META";
  entityType: "Organization";
  organizationId: string;
  displayName: string;
  timezone: string;
  defaultQuietHours?: { start: string; end: string };
  ownerCount: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function organizationKey(organizationId: string): { PK: string; SK: "META" } {
  return { PK: `TENANT#${organizationId}#ORG#${organizationId}`, SK: "META" };
}

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
import type { AuthorizedTenantId } from "../../identity/domain/authorization.js";

export interface Organization extends EntityKey {
  SK: "META";
  entityType: "Organization";
  organizationId: string;
  displayName: string;
  timezone: string;
  defaultQuietHours?: { start: string; end: string };
  /** Sessão 2026-09-20 (Marcelo): horário padrão que a UI propõe ao criar um trigger de
   * `ReminderPolicy` novo, sorteado uma vez no onboarding (`pickDefaultReminderLocalTime`) em
   * vez do "09:00" fixo anterior — nunca aplicado retroativamente a triggers já existentes.
   * Ausente em organizações criadas antes desta feature (nunca fica com backfill). */
  defaultReminderLocalTime?: string;
  ownerCount: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function organizationKey(organizationId: AuthorizedTenantId): { PK: string; SK: "META" } {
  return { PK: `TENANT#${organizationId}#ORG#${organizationId}`, SK: "META" };
}

/** Horas cheias/meias BRT entre 10:00 e 17:00 (nunca minuto quebrado) — o único conjunto de onde
 * `pickDefaultReminderLocalTime` sorteia, e o mesmo conjunto que a UI oferece para o cliente
 * reconfigurar depois (`Settings.tsx`). */
export const REMINDER_LOCAL_TIME_CANDIDATES: readonly string[] = Array.from({ length: 15 }, (_, i) => {
  const totalMinutes = 10 * 60 + i * 30;
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
});

export function pickDefaultReminderLocalTime(random: () => number = Math.random): string {
  const index = Math.floor(random() * REMINDER_LOCAL_TIME_CANDIDATES.length);
  return REMINDER_LOCAL_TIME_CANDIDATES[Math.min(index, REMINDER_LOCAL_TIME_CANDIDATES.length - 1)] as string;
}

const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidLocalTime(value: string): boolean {
  return LOCAL_TIME_PATTERN.test(value);
}

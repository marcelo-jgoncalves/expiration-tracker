/**
 * DocumentChasingOccurrence + DocumentChasingIntent — M10 cluster 4 (D-039/D-046/D-048).
 * Agregados-irmãos de `ReminderOccurrence`/`NotificationIntent` (M3/M4, já em produção real)
 * — NUNCA generalizam esses agregados (mesmo princípio já aplicado ao `parser-sandbox` isolado
 * de M7): implementam interfaces mínimas compartilhadas só para reusar a MECÂNICA operacional
 * (GSI3 scheduler, claim OCC, outbox, reconciliação), sem alterar o shape persistido do que já
 * está verificado em produção.
 *
 * Coleção sob a MESMA partição do `DocumentRequest` (`TENANT#t#SUBJECT#s`), nunca uma partição
 * própria — mesmo padrão de `ReminderOccurrence` co-localizado sob o item.
 *
 * GSI3: reaproveita o MESMO índice/shards do scheduler de reminders (D-046, mini-revisão de
 * capacidade fechada — pico orgânico combinado ~220× abaixo do SLO de drenagem de pico extremo).
 * O discriminador entre os dois tipos vive na FORMA da GSI3SK (`...#CHASING#...` vs.
 * `...#OCCURRENCE#...`, ver `chasingGsi3SkPattern`/`gsi3-parse.ts`), nunca num atributo separado
 * — uma linha de GSI3 só carrega PK/SK do índice mais as chaves base da tabela (projeção
 * KEYS_ONLY), então o discriminador precisa estar na própria SK para o producer decidir o
 * caminho ANTES do get fortemente consistente.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import { stableHash } from "../../reminder/domain/reminder-occurrence.js";

export type DocumentChasingTier = "T7" | "T3" | "EXPIRED";
export type DocumentChasingOccurrenceStatus = "SCHEDULED" | "CLAIMED" | "CANCELLED" | "TRIGGERED";

export interface DocumentChasingOccurrence extends EntityKey {
  entityType: "DocumentChasingOccurrence";
  occurrenceId: string;
  tenantId: string;
  subjectId: string;
  assignmentId: string;
  documentRequestId: string;
  tier: DocumentChasingTier;
  scheduledAt: string; // UTC ISO-8601 instant
  documentRequestVersion: number; // versão esperada do DocumentRequest no momento da materialização — mesma checagem de staleness que itemVersion faz para reminders
  shard: string;
  shardFnVersion: number;
  status: DocumentChasingOccurrenceStatus;
  claimedAt?: string;
  claimExpiresAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  GSI3PK?: string; // presente só enquanto status === SCHEDULED (ou CLAIMED) — removido em TRIGGERED/CANCELLED, mesmo invariante de ReminderOccurrence
  GSI3SK?: string;
  GSI6PK?: string; // WORKSTATE#CLAIMED (constante compartilhada com reminders) enquanto CLAIMED
  GSI6SK?: string;
}

export function documentChasingOccurrenceKey(tenantId: string, subjectId: string, assignmentId: string, documentRequestId: string, scheduledAt: string, occurrenceId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#SUBJECT#${subjectId}`, SK: `REQASSIGN#${assignmentId}#DOCREQ#${documentRequestId}#CHASING#${scheduledAt}#${occurrenceId}` };
}

function minuteBucket(scheduledAtUtcIso: string): string {
  const d = new Date(scheduledAtUtcIso);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

/** Mesma fórmula de shard/minuto de `reminder-occurrence.ts#gsi3Keys` (reaproveita `stableHash`,
 * nunca reimplementa) — só a forma da GSI3SK muda (`CHASING#` em vez de `OCCURRENCE#`), o
 * discriminador real que o producer usa para rotear cada linha lida do GSI3. */
export function chasingGsi3Keys(input: { tenantId: string; occurrenceId: string; scheduledAt: string; shardCount: number }): { GSI3PK: string; GSI3SK: string; shard: string } {
  const shardNum = stableHash(input.occurrenceId) % input.shardCount;
  const shard = String(shardNum).padStart(2, "0");
  return {
    GSI3PK: `DUE#${minuteBucket(input.scheduledAt)}#${shard}`,
    GSI3SK: `TENANT#${input.tenantId}#CHASING#${input.occurrenceId}`,
    shard,
  };
}

const CHASING_GSI3SK_PATTERN = /^TENANT#(.+)#CHASING#(.+)$/;

/** Discriminador real usado pelo producer (`src/workers/reminder-producer/producer.ts`) para
 * decidir, ANTES de qualquer I/O, se uma linha do GSI3 é chasing, reminder, ou nenhum dos dois
 * (fail-closed + alarme, D-039). Nunca lança — parse estrutural puro. */
export function parseChasingGsi3Sk(gsi3sk: string): { tenantId: string; occurrenceId: string } | undefined {
  const match = CHASING_GSI3SK_PATTERN.exec(gsi3sk);
  if (!match) return undefined;
  return { tenantId: match[1] as string, occurrenceId: match[2] as string };
}

/** WORKSTATE#CLAIMED é a MESMA constante global de `reconciliation-candidate-source.ts` —
 * reconciliação de claim-expiry já lê esse workstate para qualquer entityType (D-048/D-046: só
 * o tipo TypeScript de `reconcileExpiredClaims` precisa alargar, o mecanismo é idêntico). */
export function buildChasingClaimGsi6Sk(claimExpiresAt: string, tenantId: string, occurrenceId: string): string {
  return `${claimExpiresAt}#TENANT#${tenantId}#CHASING#${occurrenceId}`;
}

export type DocumentChasingRecipientRef =
  | { kind: "EXTERNAL_EMAIL_SNAPSHOT"; email: string }
  | { kind: "INTERNAL_USER"; userId: string };

export type DocumentChasingIntentStatus = "PENDING" | "SENT" | "FAILED";

/** Agregado-irmão de `NotificationIntent` (D-039: "RecipientRef... escopado só ao novo
 * DocumentChasingIntent — não retrofitado no NotificationIntent existente"). Single-channel
 * (e-mail) em v1 — sem fan-out multi-canal, sem lease/retry (o próprio próximo tier de chasing
 * é o mecanismo de retry natural do produto). */
export interface DocumentChasingIntent extends EntityKey {
  entityType: "DocumentChasingIntent";
  intentId: string;
  tenantId: string;
  subjectId: string;
  assignmentId: string;
  documentRequestId: string;
  occurrenceId: string;
  tier: DocumentChasingTier;
  recipient: DocumentChasingRecipientRef;
  templateId: string;
  templateVersion: number;
  status: DocumentChasingIntentStatus;
  sentAt?: string;
  failureReason?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function documentChasingIntentKey(tenantId: string, subjectId: string, assignmentId: string, documentRequestId: string, intentId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#SUBJECT#${subjectId}`, SK: `REQASSIGN#${assignmentId}#DOCREQ#${documentRequestId}#CHASINGINTENT#${intentId}` };
}

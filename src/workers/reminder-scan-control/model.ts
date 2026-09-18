import type { SqsCommandEnvelope } from "../../shared/contracts/events.js";
import type { EntityKey, TransactWriteEntry } from "../../shared/dynamodb/occ.js";

export const CONTROL_BACKEND = "DEDICATED_V1" as const;
export interface ScanRef { shardFnVersion: number; shardId: number; minuteISO: string }
export interface ScanContinuationV2 extends SqsCommandEnvelope<{
  controlBackend: typeof CONTROL_BACKEND;
  shardFnVersion: number;
  shardId: number;
  minuteISO: string;
  observedNow: string;
  ownerToken: string;
  leaseVersion: number;
  lastEvaluatedKey?: string;
  rolloutEpoch: number;
}> { commandType: "reminder.scan-continuation.v2" }

export interface ScanLeaseV2 extends EntityKey, Record<string, unknown> {
  entityType: "REMINDER_SCAN_LEASE";
  status: "IN_PROGRESS" | "COMPLETED";
  ownerToken: string;
  version: number;
  rolloutEpoch: number;
  observedNow: string;
  leaseUntil: string;
  lastEvaluatedKey?: string;
  pagesProcessed: number;
  candidatesPublished: number;
  createdAt: string;
  updatedAt: string;
  purgeAfterTtl: number;
  GSI1PK?: "LEASE#IN_PROGRESS";
  GSI1SK?: string;
}

export interface ScanOutboxV2 extends EntityKey, Record<string, unknown> {
  entityType: "REMINDER_SCAN_CONTINUATION_OUTBOX";
  eventId: string;
  destination: "SQS_REMINDER_SCAN_CONTINUATION_V2";
  status: "PENDING" | "PUBLISHED";
  payload: ScanContinuationV2;
  attemptCount: number;
  nextAttemptAt: string;
  createdAt: string;
  updatedAt: string;
  purgeAfterTtl: number;
  GSI1PK?: "OUTBOX#PENDING";
  GSI1SK?: string;
}

export function scanChainId(ref: ScanRef): string {
  if (!Number.isInteger(ref.shardFnVersion) || ref.shardFnVersion < 1 || !Number.isInteger(ref.shardId) || ref.shardId < 0 || new Date(ref.minuteISO).toISOString() !== ref.minuteISO) throw new Error("Invalid scan chain reference");
  return `v${ref.shardFnVersion}#s${ref.shardId}#m${ref.minuteISO}`;
}
export function scanLeaseKey(ref: ScanRef): EntityKey { return { PK: `SCAN#${scanChainId(ref)}`, SK: "LEASE" }; }
export function parseScanLeasePk(pk: string): ScanRef {
  const match = /^SCAN#v(\d+)#s(\d+)#m(.+)$/.exec(pk);
  if (!match) throw new Error(`Malformed scan lease PK: ${pk}`);
  const ref = { shardFnVersion: Number(match[1]), shardId: Number(match[2]), minuteISO: match[3]! };
  scanChainId(ref);
  return ref;
}

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ttl = (iso: string) => Math.floor((Date.parse(iso) + TTL_MS) / 1000);
const leaseGsi = (until: string, ref: ScanRef) => `${until}#${scanChainId(ref)}`;
const outboxGsi = (next: string, eventId: string) => `${next}#${eventId}`;

export interface ControlTransitionDeps {
  tableName: string; now: () => string; newEventId: () => string; correlationId: () => string; rolloutEpoch: number;
}
function command(deps: ControlTransitionDeps, ref: ScanRef, observedNow: string, ownerToken: string, leaseVersion: number, cursor?: string): ScanContinuationV2 {
  const eventId = deps.newEventId();
  return { messageVersion: 1, messageId: eventId, commandType: "reminder.scan-continuation.v2", createdAt: deps.now(), correlationId: deps.correlationId(), tenantId: "SYSTEM", deduplicationKey: `${scanChainId(ref)}|${ownerToken}|${leaseVersion}`, data: { controlBackend: CONTROL_BACKEND, ...ref, observedNow, ownerToken, leaseVersion, lastEvaluatedKey: cursor, rolloutEpoch: deps.rolloutEpoch } };
}
function outbox(deps: ControlTransitionDeps, ref: ScanRef, cmd: ScanContinuationV2, version: number): ScanOutboxV2 {
  const now = deps.now();
  return { PK: scanLeaseKey(ref).PK, SK: `OUTBOX#${version}`, entityType: "REMINDER_SCAN_CONTINUATION_OUTBOX", eventId: cmd.messageId, destination: "SQS_REMINDER_SCAN_CONTINUATION_V2", status: "PENDING", payload: cmd, attemptCount: 0, nextAttemptAt: now, createdAt: now, updatedAt: now, purgeAfterTtl: ttl(now), GSI1PK: "OUTBOX#PENDING", GSI1SK: outboxGsi(now, cmd.messageId) };
}

export function acquireControlChain(deps: ControlTransitionDeps, ref: ScanRef, observedNow: string, ownerToken: string, leaseDurationMs: number): TransactWriteEntry[] {
  const now = deps.now(); const until = new Date(Date.parse(now) + leaseDurationMs).toISOString(); const key = scanLeaseKey(ref);
  const lease: ScanLeaseV2 = { ...key, entityType: "REMINDER_SCAN_LEASE", status: "IN_PROGRESS", ownerToken, version: 1, rolloutEpoch: deps.rolloutEpoch, observedNow, leaseUntil: until, pagesProcessed: 0, candidatesPublished: 0, createdAt: now, updatedAt: now, purgeAfterTtl: ttl(until), GSI1PK: "LEASE#IN_PROGRESS", GSI1SK: leaseGsi(until, ref) };
  const cmd = command(deps, ref, observedNow, ownerToken, 1);
  return [{ Put: { TableName: deps.tableName, Item: lease, ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } }, { Put: { TableName: deps.tableName, Item: outbox(deps, ref, cmd, 1), ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } }];
}

export function reclaimControlChain(deps: ControlTransitionDeps, lease: ScanLeaseV2, ref: ScanRef, observedNow: string, ownerToken: string, leaseDurationMs: number): TransactWriteEntry[] {
  const now=deps.now(); const until=new Date(Date.parse(now)+leaseDurationMs).toISOString(); const nextVersion=lease.version+1;
  const update:TransactWriteEntry={Update:{TableName:deps.tableName,Key:scanLeaseKey(ref),UpdateExpression:"SET #owner=:owner, #version=:nextVersion, rolloutEpoch=:epoch, observedNow=:observed, leaseUntil=:until, pagesProcessed=:zero, candidatesPublished=:zero, updatedAt=:now, GSI1PK=:gpk, GSI1SK=:gsk REMOVE lastEvaluatedKey",ConditionExpression:"#status=:inProgress AND #version=:version AND leaseUntil < :now",ExpressionAttributeNames:{"#owner":"ownerToken","#version":"version","#status":"status"},ExpressionAttributeValues:{":owner":ownerToken,":nextVersion":nextVersion,":epoch":deps.rolloutEpoch,":observed":observedNow,":until":until,":zero":0,":now":now,":gpk":"LEASE#IN_PROGRESS",":gsk":leaseGsi(until,ref),":inProgress":"IN_PROGRESS",":version":lease.version}}};
  const cmd=command(deps,ref,observedNow,ownerToken,nextVersion);
  return [update,{Put:{TableName:deps.tableName,Item:outbox(deps,ref,cmd,nextVersion),ConditionExpression:"attribute_not_exists(PK) AND attribute_not_exists(SK)"}}];
}

export function checkpointControlChain(deps: ControlTransitionDeps, lease: ScanLeaseV2, ref: ScanRef, startedCursor: string | undefined, nextCursor: string | undefined, published: number, leaseDurationMs: number): TransactWriteEntry[] {
  const now = deps.now(); const nextVersion = lease.version + 1; const complete = nextCursor === undefined;
  const names: Record<string,string> = { "#status":"status", "#owner":"ownerToken", "#version":"version", "#until":"leaseUntil", "#updated":"updatedAt", "#pages":"pagesProcessed", "#candidates":"candidatesPublished", "#gsk":"GSI1SK", "#cursor":"lastEvaluatedKey" };
  const values: Record<string,unknown> = { ":in":"IN_PROGRESS", ":owner":lease.ownerToken, ":version":lease.version, ":now":now, ":one":1, ":published":published };
  const position = startedCursor === undefined ? "attribute_not_exists(#cursor)" : "#cursor = :started"; if (startedCursor !== undefined) values[":started"] = startedCursor;
  let update = "SET #version = #version + :one, #updated = :now, #pages = #pages + :one, #candidates = #candidates + :published";
  if (complete) { names["#gpk"] = "GSI1PK"; values[":complete"] = "COMPLETED"; update += ", #status = :complete REMOVE #cursor, #gpk, #gsk"; }
  else { const until = new Date(Date.parse(now) + leaseDurationMs).toISOString(); values[":cursor"] = nextCursor; values[":untilNew"] = until; values[":gskNew"] = leaseGsi(until, ref); update += ", #cursor = :cursor, #until = :untilNew, #gsk = :gskNew"; }
  const tx: TransactWriteEntry[] = [{ Update: { TableName: deps.tableName, Key: scanLeaseKey(ref), UpdateExpression: update, ConditionExpression: "#status = :in AND #owner = :owner AND #version = :version AND #until >= :now AND " + position, ExpressionAttributeNames: names, ExpressionAttributeValues: values } }];
  if (!complete) { const cmd = command(deps, ref, lease.observedNow, lease.ownerToken, nextVersion, nextCursor); tx.push({ Put: { TableName: deps.tableName, Item: outbox(deps, ref, cmd, nextVersion), ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } }); }
  return tx;
}

/**
 * DocumentRequestCredentialIssuanceService — D-226 (`guest-credential-issuance-scoping/
 * estado-final-consolidado.md`, decision central, closes D-222 Achado 1). Consumer of
 * `SQS_DOCUMENT_REQUEST_CREDENTIAL_ISSUANCE_V1`, running on the GUEST Lambda
 * (`document-archive-guest-handler`, the only one holding the D-146 pepper) — the producer
 * Lambda (`document-archive-handler`) deliberately never imports this file.
 *
 * The message payload is a MINIMAL wake-up hint (`{tenantId, subjectId, documentRequestId,
 * issuanceGeneration}`) — this service always re-reads the authoritative `DocumentRequest`
 * fresh rather than trusting anything else the message might carry, exactly as the design
 * requires (a stale/replayed message must never be able to smuggle a business fact past a
 * fresh re-read).
 *
 * Idempotency + fencing (design decision central, item 3): ONE `TransactWriteItems` of 4
 * entries — `IdempotencyRecord` Put (`attribute_not_exists(PK)`), `RequestAccessCredential`
 * Put (main table, same shape `GuestDocumentAccessService.issueCredential` already writes),
 * `DocumentRequest` Update (fenced on `issuanceGeneration`/`status`/`version`/the request's own
 * `activeCredentialSelectorHash` as read moments earlier — TOCTOU-safe), and a `Put` into the
 * DEDICATED `guest-credential-delivery` table (never the main table — see that domain file's
 * header comment for why). `TransactionCanceledException` is inspected via
 * `CancellationReasons` (index-positional, per `getCancellationReasonCodes`'s own contract) to
 * tell a SAFE replay (idempotency record already exists, OR the DocumentRequest fence failed
 * because a newer generation/ineligible status already moved on) from any OTHER cancellation
 * cause, which propagates rather than being swallowed into a generic ACK.
 */
import {
  buildVersionedCreate,
  buildVersionedUpdate,
  getCancellationReasonCodes,
  isTransactionCanceled,
  type EntityKey,
  type TransactWriteEntry,
} from "../../../shared/dynamodb/occ.js";
import {
  epochSecondsFromIso,
  hmacRequestAccessCrypto,
  issueRequestAccessCredential,
  requestAccessCredentialKey,
  type RequestAccessCredential,
} from "../domain/request-access-credential.js";
import { documentRequestKey, type DocumentRequest } from "../domain/document-request.js";
import { guestCredentialDeliveryKey, type GuestCredentialDeliveryRecord } from "../domain/guest-credential-delivery.js";
import type { DocumentArchiveStore } from "../ports/document-archive-store.js";
import { authorizedTenantIdFromPersistedEntity } from "../../identity/domain/authorization.js";

/** Design decision central item 4: PROVISIONAL engineering default (not 30 days) — pending
 * product/security confirmation (D-226 pendency 2, `estado-final-consolidado.md`). Applies only
 * when `DocumentRequest.deadline` is absent — the deadline itself, when present, always wins
 * (Decision 4 of D-143: "TTL = prazo do Request de negócio"). */
export const DEFAULT_CREDENTIAL_TTL_DAYS = 7;

export function addDaysIso(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 24 * 60 * 60 * 1000).toISOString();
}

export interface DocumentRequestCredentialIssuanceMessage {
  tenantId: string;
  subjectId: string;
  documentRequestId: string;
  issuanceGeneration: number;
}

export type CredentialIssuanceOutcome =
  | { kind: "ISSUED" }
  | { kind: "SKIPPED_ALREADY_ISSUED" }
  | { kind: "SKIPPED_STALE_GENERATION" }
  | { kind: "SKIPPED_NOT_ELIGIBLE" }
  | { kind: "SKIPPED_MISSING_REQUEST" };

export interface DocumentRequestCredentialIssuanceServiceDeps {
  store: DocumentArchiveStore;
  tableName: string;
  deliveryTableName: string;
  pepper: string;
  now?: () => string;
}

export class DocumentRequestCredentialIssuanceService {
  private readonly store: DocumentArchiveStore;
  private readonly tableName: string;
  private readonly deliveryTableName: string;
  private readonly pepper: string;
  private readonly now: () => string;

  constructor(deps: DocumentRequestCredentialIssuanceServiceDeps) {
    this.store = deps.store;
    this.tableName = deps.tableName;
    this.deliveryTableName = deps.deliveryTableName;
    this.pepper = deps.pepper;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async handle(message: DocumentRequestCredentialIssuanceMessage): Promise<CredentialIssuanceOutcome> {
    // `message.tenantId` is an SQS payload field, not itself a repository read — but the ONLY
    // producer of this queue (`buildDocumentRequestCreatedOutboxEntry`) writes it in the SAME
    // TransactWriteItems that persists the `DocumentRequest` row, sourced from that row's own
    // `tenantId`, never from client input. `authorizedTenantIdFromPersistedEntity` is used here
    // as the trust-boundary constructor for this one-hop-removed-but-still-server-authored value;
    // the `request` re-read immediately below (never the message alone) is what this handler
    // actually acts on for every subsequent write.
    const tenantId = authorizedTenantIdFromPersistedEntity(message);
    const request = await this.store.get<DocumentRequest>(documentRequestKey(tenantId, message.subjectId, message.documentRequestId));
    // Genuinely missing DocumentRequest should never happen (the outbox entry is written in the
    // SAME transaction that creates it) — treated as a safe no-op rather than a retryable
    // failure, since retrying can never make a nonexistent row appear.
    if (!request) return { kind: "SKIPPED_MISSING_REQUEST" };

    // Superseded by a later reissuance (Achado 3/rejectVersion bumps issuanceGeneration) — this
    // message is for a generation that is no longer the active one, safe no-op.
    if (request.issuanceGeneration !== message.issuanceGeneration) return { kind: "SKIPPED_STALE_GENERATION" };
    // REQUESTED/OPENED are the only statuses design decision central item 3 names as eligible
    // (both are live states, per `isDocumentRequestLive` — no separate liveness check needed).
    if (request.status !== "REQUESTED" && request.status !== "OPENED") return { kind: "SKIPPED_NOT_ELIGIBLE" };

    const now = this.now();
    const expiresAt = request.deadline ?? addDaysIso(request.createdAt, DEFAULT_CREDENTIAL_TTL_DAYS);
    // Decision central item 4: "recusa emitir se já vencido" — a deadline that has already
    // passed by the time this async consumer runs must never mint a credential.
    if (expiresAt < now) return { kind: "SKIPPED_NOT_ELIGIBLE" };

    const issued = issueRequestAccessCredential(this.pepper, hmacRequestAccessCrypto);
    const credential: RequestAccessCredential = {
      ...requestAccessCredentialKey(issued.selectorHash),
      entityType: "RequestAccessCredential",
      selectorHash: issued.selectorHash,
      secretHash: issued.secretHash,
      tenantId: request.tenantId,
      subjectId: request.subjectId,
      requirementId: request.requirementId,
      documentRequestId: request.documentRequestId,
      tokenVersion: 1,
      expiresAt,
      purgeAfterTtl: epochSecondsFromIso(expiresAt),
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    const idempotencyKey = { PK: `TENANT#${request.tenantId}#SUBJECT#${request.subjectId}`, SK: `GUESTISSUANCE#${request.documentRequestId}#${message.issuanceGeneration}` };
    const idempotencyRecord = {
      ...idempotencyKey,
      entityType: "IdempotencyRecord" as const,
      tenantId: request.tenantId,
      payloadHash: `guestIssuance:${request.documentRequestId}:${message.issuanceGeneration}`,
      createdAt: now,
    };

    const delivery: GuestCredentialDeliveryRecord = {
      ...guestCredentialDeliveryKey(request.documentRequestId, message.issuanceGeneration),
      entityType: "GuestCredentialDelivery",
      tenantId: request.tenantId,
      subjectId: request.subjectId,
      documentRequestId: request.documentRequestId,
      requirementId: request.requirementId,
      issuanceGeneration: message.issuanceGeneration,
      token: issued.token,
      selectorHash: issued.selectorHash,
      expiresAt,
      purgeAfterTtl: epochSecondsFromIso(expiresAt),
      createdAt: now,
    };

    // Index positions matter — getCancellationReasonCodes below is read positionally.
    const entries: TransactWriteEntry[] = [
      /* 0 */ { Put: buildVersionedCreate(this.tableName, idempotencyRecord as unknown as Record<string, unknown> & EntityKey) },
      /* 1 */ { Put: buildVersionedCreate(this.tableName, credential as unknown as Record<string, unknown> & EntityKey) },
      /* 2 */ {
        Update: buildVersionedUpdate({
          tableName: this.tableName,
          key: documentRequestKey(authorizedTenantIdFromPersistedEntity(request), request.subjectId, request.documentRequestId),
          tenantId: request.tenantId,
          expectedVersion: request.version,
          set: { activeCredentialSelectorHash: issued.selectorHash },
          now,
          extraConditions: [
            { expression: "#issGen = :expectedGen", names: { "#issGen": "issuanceGeneration" }, values: { ":expectedGen": message.issuanceGeneration } },
            { expression: "#status IN (:requested, :opened)", names: { "#status": "status" }, values: { ":requested": "REQUESTED", ":opened": "OPENED" } },
            {
              expression: "attribute_not_exists(#activeSel) OR #activeSel = :expectedPointer",
              names: { "#activeSel": "activeCredentialSelectorHash" },
              // When absent at read-time, the OR's first branch (attribute_not_exists) is what
              // must pass — :expectedPointer's value is irrelevant then, same "sentinel value
              // never valid on the real attribute" pattern this codebase already establishes
              // elsewhere (e.g. buildRequestAccessCredential's dummy-hash anti-timing path).
              // `hmacRequestAccessCrypto` output is always 64 lowercase hex chars, so this
              // literal can never collide with a real selectorHash.
              values: { ":expectedPointer": request.activeCredentialSelectorHash ?? "no-active-credential-sentinel" },
            },
          ],
        }),
      },
      /* 3 */ {
        Put: {
          TableName: this.deliveryTableName,
          Item: delivery as unknown as Record<string, unknown>,
          ConditionExpression: "attribute_not_exists(PK)",
        },
      },
    ];

    try {
      await this.store.transactWrite(entries);
    } catch (err) {
      if (isTransactionCanceled(err)) {
        const codes = getCancellationReasonCodes(err);
        // Index 0: idempotency record already exists — this exact (documentRequestId,
        // issuanceGeneration) pair was already processed by an earlier delivery of this SQS
        // message (at-least-once). Safe, deliberate no-op, never a retryable failure.
        if (codes?.[0] === "ConditionalCheckFailed") return { kind: "SKIPPED_ALREADY_ISSUED" };
        // Index 2: the freshness fence on DocumentRequest failed — generation/status/pointer
        // moved between our read and this transaction (a concurrent reissuance or submission).
        // Safe no-op — a newer message for the CURRENT generation will follow, or none is
        // needed because the request is no longer eligible.
        if (codes?.[2] === "ConditionalCheckFailed") return { kind: "SKIPPED_STALE_GENERATION" };
        // Any other index (1: astronomically unlikely selector collision; 3: delivery-table
        // collision, which should never happen since the selector is freshly random every
        // attempt) is NOT a safe replay — propagate so the caller/DLQ sees a real failure
        // rather than a silently swallowed one.
        throw err;
      }
      throw err;
    }

    return { kind: "ISSUED" };
  }
}

/** Real DynamoDB adapter for `ExtractedFieldStore` (M7 item 7) — the first real writer of
 * `ExtractedField` rows. `commitRunOutcome` is a single `TransactWriteItems`: one
 * `attribute_not_exists` Put per field row (first-time create, `buildVersionedCreate`), one
 * versioned Update on the parent `ExtractionRun` (`buildVersionedUpdate`), and one
 * `ConditionCheck` re-asserting the `Document` row is still at the version the caller read
 * moments earlier (`buildVersionConditionCheck`) — the TOCTOU close for the concurrent-discard
 * race (design §3). All three succeed or none do. */
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import { buildVersionedCreate, buildVersionedUpdate, buildVersionConditionCheck, isTransactionCanceled } from "../../../shared/dynamodb/occ.js";
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import { mapDynamoError } from "../../../shared/dynamodb/sdk-errors.js";
import { appendToTransaction } from "../../../shared/outbox/outbox.js";
import type { TransactWriteEntry } from "../../../shared/dynamodb/occ.js";
import type { DomainEvent } from "../../../shared/contracts/events.js";
import type {
  CommitRunOutcomeInput,
  CommitRunOutcomeResult,
  ConfirmFieldInput,
  ConfirmFieldForDocumentArchiveInput,
  ExtractedFieldStore,
  FieldTransitionResult,
  RejectFieldInput,
  RejectFieldForDocumentArchiveInput,
} from "../ports/extracted-field-store.js";
import type { ExtractedField } from "../domain/extracted-field.js";

export class DynamoDbExtractedFieldStore implements ExtractedFieldStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async commitRunOutcome(input: CommitRunOutcomeInput): Promise<CommitRunOutcomeResult> {
    const fieldPuts = input.fields.map((field) => ({ Put: buildVersionedCreate(this.tableName, field as unknown as Record<string, unknown> & { PK: string; SK: string }) }));

    const runUpdate = {
      Update: buildVersionedUpdate({
        tableName: this.tableName,
        key: input.runKey,
        tenantId: input.runTenantId,
        expectedVersion: input.runExpectedVersion,
        set: { status: input.runStatus, completedAt: input.completedAt },
      }),
    };

    const documentGuard = buildVersionConditionCheck({
      tableName: this.tableName,
      key: input.documentKey,
      expectedVersion: input.documentExpectedVersion,
    });

    // W2-01-DECISION: when the run auto-confirmed a field that maps to an `ExpirationItem`
    // attribute, that item write joins THIS transaction — never a follow-up write — so the
    // auto-confirm outcome is as atomic as the manual `confirmField` one.
    const itemUpdate = input.itemUpdate
      ? [
          {
            Update: buildVersionedUpdate({
              tableName: this.tableName,
              key: input.itemUpdate.key,
              tenantId: input.itemUpdate.tenantId,
              expectedVersion: input.itemUpdate.expectedVersion,
              set: input.itemUpdate.set,
              now: input.completedAt,
            }),
          },
        ]
      : [];

    // D-193 item 4/9: the `document-archive` auto-confirm counterpart of `itemUpdate` above —
    // `DocumentVersion` Update (unconditional once present) + conditional `Outbox` Put (only
    // when `effect.kind === "SET"`), same shape `confirmFieldForDocumentArchive` uses.
    const documentVersionUpdate = input.documentVersionUpdate
      ? [
          {
            Update: buildVersionedUpdate({
              tableName: this.tableName,
              key: input.documentVersionUpdate.key,
              tenantId: input.documentVersionUpdate.tenantId,
              expectedVersion: input.documentVersionUpdate.expectedVersion,
              set: input.documentVersionUpdate.effect.kind === "SET" ? { validUntil: input.documentVersionUpdate.effect.validUntil } : {},
              now: input.completedAt,
            }),
          },
        ]
      : [];

    const outboxPut: unknown[] = [];
    if (input.documentVersionUpdate && input.documentVersionUpdate.effect.kind === "SET") {
      const dvu = input.documentVersionUpdate;
      const event: DomainEvent<{ documentId: string; validUntil: string }> = {
        specVersion: "1.0",
        eventId: randomUUID(),
        eventType: "DocumentVersionValidUntilChanged",
        source: "extraction.commitRunOutcome",
        occurredAt: input.completedAt,
        correlationId: dvu.correlationId,
        tenantId: dvu.tenantId,
        actor: { type: "SYSTEM" },
        aggregate: { type: "DocumentVersion", id: `${dvu.key.PK}#${dvu.key.SK}`, version: dvu.expectedVersion + 1 },
        data: { documentId: dvu.documentId, validUntil: dvu.effect.kind === "SET" ? dvu.effect.validUntil : "" },
      };
      const tx: TransactWriteEntry[] = [];
      appendToTransaction(tx, this.tableName, event, "SQS_REQUIREMENT_EVIDENCE_REFRESH_V1");
      outboxPut.push(...tx);
    }

    const transactItems = [...fieldPuts, runUpdate, documentGuard, ...itemUpdate, ...documentVersionUpdate, ...outboxPut] as unknown as TransactWriteCommandInput["TransactItems"];

    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: transactItems }));
      return "COMMITTED";
    } catch (err) {
      // A cancellation here can only come from one of: a field row already existing (should
      // never happen - runId makes each field's SK unique per run, so this would indicate a
      // genuine retry-after-partial-commit bug, not a real race), the run's own version having
      // moved (nothing else in the system updates ExtractionRun.status before this handler
      // runs), the Document guard (the actual race this method exists to detect), or the
      // optional `ExpirationItem`/`DocumentVersion` update's own version having moved. Rather
      // than parsing per-item cancellation reasons (fragile across SDK versions), any
      // cancellation here is treated uniformly as DOCUMENT_DISCARDED - the safe, conservative
      // reading is "something about the world this commit assumed is no longer true", and the
      // caller's fallback (mark the run DISCARDED, persist zero fields) is safe even in the
      // (extremely unlikely) case the true cause was one of the other two conditions.
      if (isTransactionCanceled(err)) return "DOCUMENT_DISCARDED";
      throw mapDynamoError(err, "ExtractedFieldStore.commitRunOutcome");
    }
  }

  async get(key: EntityKey): Promise<ExtractedField | undefined> {
    try {
      const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: key }));
      return result.Item as ExtractedField | undefined;
    } catch (err) {
      throw mapDynamoError(err, "ExtractedFieldStore.get");
    }
  }

  async confirmField(input: ConfirmFieldInput): Promise<FieldTransitionResult> {
    const fieldUpdate = {
      Update: buildVersionedUpdate({
        tableName: this.tableName,
        key: input.fieldKey,
        tenantId: input.fieldTenantId,
        expectedVersion: input.fieldExpectedVersion,
        set: { state: "CONFIRMED", confirmedValue: input.confirmedValue, confirmedBy: input.confirmedBy, confirmedAt: input.now },
        now: input.now,
      }),
    };

    const runGuard = buildVersionConditionCheck({ tableName: this.tableName, key: input.runKey, expectedVersion: input.runExpectedVersion });
    const documentGuard = buildVersionConditionCheck({ tableName: this.tableName, key: input.documentKey, expectedVersion: input.documentExpectedVersion });

    const itemEntry = input.itemUpdate
      ? {
          Update: buildVersionedUpdate({
            tableName: this.tableName,
            key: input.itemKey,
            tenantId: input.itemTenantId,
            expectedVersion: input.itemExpectedVersion,
            set: input.itemUpdate,
            now: input.now,
          }),
        }
      : buildVersionConditionCheck({ tableName: this.tableName, key: input.itemKey, expectedVersion: input.itemExpectedVersion });

    const transactItems = [fieldUpdate, runGuard, documentGuard, itemEntry] as unknown as TransactWriteCommandInput["TransactItems"];

    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: transactItems }));
      return "COMMITTED";
    } catch (err) {
      if (isTransactionCanceled(err)) return "VERSION_CONFLICT";
      throw mapDynamoError(err, "ExtractedFieldStore.confirmField");
    }
  }

  async rejectField(input: RejectFieldInput): Promise<FieldTransitionResult> {
    const set: Record<string, unknown> = { state: "REJECTED" };
    if (input.correctionReason !== undefined) set["correctionReason"] = input.correctionReason;

    const fieldUpdate = {
      Update: buildVersionedUpdate({
        tableName: this.tableName,
        key: input.fieldKey,
        tenantId: input.fieldTenantId,
        expectedVersion: input.fieldExpectedVersion,
        set,
        now: input.now,
      }),
    };

    const runGuard = buildVersionConditionCheck({ tableName: this.tableName, key: input.runKey, expectedVersion: input.runExpectedVersion });
    const documentGuard = buildVersionConditionCheck({ tableName: this.tableName, key: input.documentKey, expectedVersion: input.documentExpectedVersion });

    const transactItems = [fieldUpdate, runGuard, documentGuard] as unknown as TransactWriteCommandInput["TransactItems"];

    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: transactItems }));
      return "COMMITTED";
    } catch (err) {
      if (isTransactionCanceled(err)) return "VERSION_CONFLICT";
      throw mapDynamoError(err, "ExtractedFieldStore.rejectField");
    }
  }

  /** D-193 item 4/9: `document-archive`'s confirm transaction — 3 aggregates / 4 actions, fixed
   * cardinality. The `DocumentVersion` Update always runs (even on a `NO_CHANGE` plan, it still
   * bumps `version`/`updatedAt`); the `Outbox` Put is the ONE conditional action, appended only
   * when `input.effect.kind === "SET"`. */
  async confirmFieldForDocumentArchive(input: ConfirmFieldForDocumentArchiveInput): Promise<FieldTransitionResult> {
    const fieldUpdate = {
      Update: buildVersionedUpdate({
        tableName: this.tableName,
        key: input.fieldKey,
        tenantId: input.fieldTenantId,
        expectedVersion: input.fieldExpectedVersion,
        set: { state: "CONFIRMED", confirmedValue: input.confirmedValue, confirmedBy: input.confirmedBy, confirmedAt: input.now },
        now: input.now,
      }),
    };

    const runGuard = buildVersionConditionCheck({ tableName: this.tableName, key: input.runKey, expectedVersion: input.runExpectedVersion });

    const versionSet: Record<string, unknown> = input.effect.kind === "SET" ? { validUntil: input.effect.validUntil } : {};
    const versionUpdate = {
      Update: buildVersionedUpdate({
        tableName: this.tableName,
        key: input.documentVersionKey,
        tenantId: input.documentVersionTenantId,
        expectedVersion: input.documentVersionExpectedVersion,
        set: versionSet,
        now: input.now,
      }),
    };

    const transactItems: unknown[] = [fieldUpdate, runGuard, versionUpdate];

    // The ONE conditional action — only when validUntil actually changed. `Requirement` is
    // deliberately never part of this transaction (async convergence, item 5/9): the outbox row
    // is just a "wake up" for a worker that always re-reads DocumentVersion+Requirement fresh.
    if (input.effect.kind === "SET") {
      const event: DomainEvent<{ documentId: string; validUntil: string }> = {
        specVersion: "1.0",
        eventId: randomUUID(),
        eventType: "DocumentVersionValidUntilChanged",
        source: "extraction.confirmFieldForDocumentArchive",
        occurredAt: input.now,
        correlationId: input.correlationId,
        tenantId: input.tenantId,
        actor: { type: "SYSTEM" },
        aggregate: { type: "DocumentVersion", id: `${input.documentVersionKey.PK}#${input.documentVersionKey.SK}`, version: input.documentVersionExpectedVersion + 1 },
        data: { documentId: input.documentId, validUntil: input.effect.validUntil },
      };
      const tx: TransactWriteEntry[] = [];
      appendToTransaction(tx, this.tableName, event, "SQS_REQUIREMENT_EVIDENCE_REFRESH_V1");
      transactItems.push(...tx);
    }

    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: transactItems as unknown as TransactWriteCommandInput["TransactItems"] }));
      return "COMMITTED";
    } catch (err) {
      if (isTransactionCanceled(err)) return "VERSION_CONFLICT";
      throw mapDynamoError(err, "ExtractedFieldStore.confirmFieldForDocumentArchive");
    }
  }

  /** D-193 item 4/9: `document-archive`'s reject transaction — 2 aggregates / 2 actions.
   * `DocumentVersion` is never referenced at all — not even a `ConditionCheck`. */
  async rejectFieldForDocumentArchive(input: RejectFieldForDocumentArchiveInput): Promise<FieldTransitionResult> {
    const set: Record<string, unknown> = { state: "REJECTED" };
    if (input.correctionReason !== undefined) set["correctionReason"] = input.correctionReason;

    const fieldUpdate = {
      Update: buildVersionedUpdate({
        tableName: this.tableName,
        key: input.fieldKey,
        tenantId: input.fieldTenantId,
        expectedVersion: input.fieldExpectedVersion,
        set,
        now: input.now,
      }),
    };

    const runGuard = buildVersionConditionCheck({ tableName: this.tableName, key: input.runKey, expectedVersion: input.runExpectedVersion });

    const transactItems = [fieldUpdate, runGuard] as unknown as TransactWriteCommandInput["TransactItems"];

    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: transactItems }));
      return "COMMITTED";
    } catch (err) {
      if (isTransactionCanceled(err)) return "VERSION_CONFLICT";
      throw mapDynamoError(err, "ExtractedFieldStore.rejectFieldForDocumentArchive");
    }
  }
}

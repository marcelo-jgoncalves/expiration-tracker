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
import { buildVersionedCreate, buildVersionedUpdate, buildVersionConditionCheck, isTransactionCanceled } from "../../../shared/dynamodb/occ.js";
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import { mapDynamoError } from "../../../shared/dynamodb/sdk-errors.js";
import type {
  CommitRunOutcomeInput,
  CommitRunOutcomeResult,
  ConfirmFieldInput,
  ExtractedFieldStore,
  FieldTransitionResult,
  RejectFieldInput,
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

    const transactItems = [...fieldPuts, runUpdate, documentGuard] as unknown as TransactWriteCommandInput["TransactItems"];

    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: transactItems }));
      return "COMMITTED";
    } catch (err) {
      // A cancellation here can only come from one of: a field row already existing (should
      // never happen - runId makes each field's SK unique per run, so this would indicate a
      // genuine retry-after-partial-commit bug, not a real race), the run's own version having
      // moved (nothing else in the system updates ExtractionRun.status before this handler
      // runs), or the Document guard (the actual race this method exists to detect). Rather
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
        set: { state: "CONFIRMED", confirmedValue: input.confirmedValue },
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
}

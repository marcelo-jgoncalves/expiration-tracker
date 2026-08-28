/**
 * Adapter-level shape test for `commitRunOutcome`'s auto-confirm `ExpirationItem` leg
 * (W2-01-DECISION). Narrow on purpose: it asserts the transaction the adapter BUILDS, which is
 * exactly what the application-level in-memory fakes cannot see — the class of gap that let the
 * malformed-`Key` confirm/reject bug reach a real table in 2026-08-27.
 */
import { describe, expect, it } from "vitest";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDbExtractedFieldStore } from "../../../src/modules/extraction/persistence/dynamodb-extracted-field-store.js";
import type { CommitRunOutcomeInput } from "../../../src/modules/extraction/ports/extracted-field-store.js";
import type { ExtractedField } from "../../../src/modules/extraction/domain/extracted-field.js";
import { extractedFieldKey } from "../../../src/modules/extraction/domain/extracted-field.js";
import { extractionRunKey } from "../../../src/modules/extraction/domain/extraction-run.js";
import { documentKey } from "../../../src/modules/document/domain/document.js";
import { itemKey, gsi1Keys } from "../../../src/modules/expiration/domain/expiration-item.js";
import { PIPELINE_VERSION_V1 } from "../../../src/modules/extraction/domain/field-schema.js";

interface CapturedTransactItem {
  Put?: { Item: Record<string, unknown>; ConditionExpression: string };
  Update?: { Key: { PK: string; SK: string }; UpdateExpression: string; ConditionExpression: string; ExpressionAttributeValues: Record<string, unknown> };
  ConditionCheck?: { Key: { PK: string; SK: string } };
}

function makeClient() {
  const sent: CapturedTransactItem[][] = [];
  const client = {
    async send(command: { input: { TransactItems: CapturedTransactItem[] } }) {
      sent.push(command.input.TransactItems);
      return {};
    },
  } as unknown as DynamoDBDocumentClient;
  return { client, sent };
}

const field: ExtractedField = {
  ...extractedFieldKey("t1", "doc1", "expirationDate", "run1"),
  entityType: "ExtractedField",
  tenantId: "t1",
  documentId: "doc1",
  runId: "run1",
  fieldName: "expirationDate",
  valueType: "DATE",
  candidateValue: "2027-03-31",
  confidence: 0.95,
  sources: ["DETERMINISTIC_PARSER", "BEDROCK"],
  agreement: "MATCH",
  state: "CONFIRMED",
  confirmedValue: "2027-03-31",
  documentVersion: 3,
  pipelineVersion: PIPELINE_VERSION_V1,
  version: 1,
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
};

function baseInput(overrides: Partial<CommitRunOutcomeInput> = {}): CommitRunOutcomeInput {
  return {
    fields: [field],
    runKey: extractionRunKey("t1", "doc1", "run1"),
    runTenantId: "t1",
    runExpectedVersion: 1,
    runStatus: "COMPLETED",
    completedAt: "2026-08-26T00:00:00.000Z",
    documentKey: documentKey("t1", "item1", "doc1"),
    documentExpectedVersion: 3,
    ...overrides,
  };
}

describe("DynamoDbExtractedFieldStore.commitRunOutcome", () => {
  it("emits field Put + run Update + document ConditionCheck only, when there is no item update", async () => {
    const { client, sent } = makeClient();
    const result = await new DynamoDbExtractedFieldStore(client, "T").commitRunOutcome(baseInput());

    expect(result).toBe("COMMITTED");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(3);
    expect(sent[0]?.some((entry) => entry.Update?.Key.PK === itemKey("t1", "item1").PK)).toBe(false);
  });

  it("adds the ExpirationItem versioned Update to the SAME transaction when itemUpdate is supplied (W2-01-DECISION)", async () => {
    const { client, sent } = makeClient();
    const result = await new DynamoDbExtractedFieldStore(client, "T").commitRunOutcome(
      baseInput({
        itemUpdate: {
          key: itemKey("t1", "item1"),
          tenantId: "t1",
          expectedVersion: 7,
          set: { dueDate: "2027-03-31", ...gsi1Keys("t1", "ACTIVE", "2027-03-31", "item1") },
        },
      }),
    );

    expect(result).toBe("COMMITTED");
    expect(sent).toHaveLength(1); // one transaction, never a follow-up write
    expect(sent[0]).toHaveLength(4);

    const itemEntry = sent[0]?.find((entry) => entry.Update?.Key.PK === itemKey("t1", "item1").PK)?.Update;
    expect(itemEntry).toBeDefined();
    // Bare {PK,SK} key only - the exact defect that broke the manual confirm route against a real table.
    expect(itemEntry?.Key).toEqual(itemKey("t1", "item1"));
    expect(itemEntry?.ConditionExpression).toContain("#version = :expectedVersion");
    expect(itemEntry?.ExpressionAttributeValues[":expectedVersion"]).toBe(7);
    expect(Object.values(itemEntry?.ExpressionAttributeValues ?? {})).toContain("2027-03-31");
    expect(Object.values(itemEntry?.ExpressionAttributeValues ?? {})).toContain("DUE#2027-03-31#ITEM#item1");
  });
});

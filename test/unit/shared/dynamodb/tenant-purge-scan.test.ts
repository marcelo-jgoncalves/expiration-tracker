/**
 * Adapter-level shape test for the real W3-07 purge pipeline scan adapters
 * (`shared/dynamodb/tenant-purge-scan.ts`) — same pattern as
 * `test/unit/extraction/dynamodb-extracted-field-store.test.ts`: capture the real
 * `ScanCommand`/`DeleteCommand` input, assert against the exact string built, never against a
 * behavioral fake. This is the class of gap Wave B2B-9's Codex round 1 critique (C3) flagged: the
 * pure-logic layer (`dynamo-tenant-purge.test.ts`) never constructs a real `ScanCommand`, so a
 * regression in this adapter's `FilterExpression` could ship without any test noticing.
 */
import { describe, expect, it } from "vitest";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDbSessionTablePurgeSource, DynamoDbTenantPurgeCandidateSource } from "../../../../src/shared/dynamodb/tenant-purge-scan.js";

interface CapturedCommand {
  name: string;
  input: Record<string, unknown>;
}

function makeClient(response: Record<string, unknown> = {}) {
  const sent: CapturedCommand[] = [];
  const client = {
    async send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
      sent.push({ name: command.constructor.name, input: command.input });
      return response;
    },
  } as unknown as DynamoDBDocumentClient;
  return { client, sent };
}

describe("DynamoDbTenantPurgeCandidateSource.scanTenantItems", () => {
  it("builds a Scan with the 3-clause FilterExpression covering TENANT# prefix, tenantId, and organizationId", async () => {
    const { client, sent } = makeClient({ Items: [] });
    const source = new DynamoDbTenantPurgeCandidateSource(client, "main-table");

    await source.scanTenantItems("org-1");

    expect(sent).toHaveLength(1);
    expect(sent[0]!.name).toBe("ScanCommand");
    // Mutation: dropping the 3rd OR clause (organizationId = :tenantId) makes this assertion fail —
    // exactly the InvitationTokenPointer gap Wave B2B-9 (D-104) closed.
    expect(sent[0]!.input.FilterExpression).toBe("begins_with(PK, :prefix) OR tenantId = :tenantId OR organizationId = :tenantId");
    expect(sent[0]!.input.ExpressionAttributeValues).toEqual({ ":prefix": "TENANT#org-1#", ":tenantId": "org-1" });
    expect(sent[0]!.input.TableName).toBe("main-table");
  });

  it("threads pagination (ExclusiveStartKey/Limit) through unchanged", async () => {
    const { client, sent } = makeClient({ Items: [], LastEvaluatedKey: { PK: "x", SK: "y" } });
    const source = new DynamoDbTenantPurgeCandidateSource(client, "main-table", 250);

    const page = await source.scanTenantItems("org-1", { PK: "start" });

    expect(sent[0]!.input.ExclusiveStartKey).toEqual({ PK: "start" });
    expect(sent[0]!.input.Limit).toBe(250);
    expect(page.lastEvaluatedKey).toEqual({ PK: "x", SK: "y" });
  });
});

describe("DynamoDbSessionTablePurgeSource", () => {
  it("scanTenantSessions builds a Scan filtered only by the plain tenantId attribute (no key prefix on this table)", async () => {
    const { client, sent } = makeClient({ Items: [] });
    const source = new DynamoDbSessionTablePurgeSource(client, "bff-session-table");

    await source.scanTenantSessions("org-1");

    expect(sent[0]!.input.FilterExpression).toBe("tenantId = :tenantId");
    expect(sent[0]!.input.ExpressionAttributeValues).toEqual({ ":tenantId": "org-1" });
  });

  it("deleteSession sends a conditional Delete asserting the item's own stored tenantId, not a caller-supplied claim", async () => {
    const { client, sent } = makeClient({});
    const source = new DynamoDbSessionTablePurgeSource(client, "bff-session-table");

    const result = await source.deleteSession({ PK: "SESSION#hash", SK: "POINTER" }, "org-1");

    expect(result).toEqual({ deleted: true });
    expect(sent[0]!.name).toBe("DeleteCommand");
    expect(sent[0]!.input.ConditionExpression).toBe("attribute_not_exists(PK) OR tenantId = :expectedTenantId");
    expect(sent[0]!.input.ExpressionAttributeValues).toEqual({ ":expectedTenantId": "org-1" });
  });

  it("deleteSession returns { deleted: false } (never throws) on a conditional-check failure", async () => {
    const client = {
      async send() {
        const err = new Error("The conditional request failed");
        err.name = "ConditionalCheckFailedException";
        throw err;
      },
    } as unknown as DynamoDBDocumentClient;
    const source = new DynamoDbSessionTablePurgeSource(client, "bff-session-table");

    const result = await source.deleteSession({ PK: "SESSION#hash", SK: "POINTER" }, "org-1");

    expect(result).toEqual({ deleted: false });
  });
});

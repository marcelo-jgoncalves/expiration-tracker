import { describe, expect, it } from "vitest";
import { buildAssignedActiveRequirementsLookup } from "../../../src/runtime/aws/composition/organization.js";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

/**
 * D-194 Fatia 2 - proves `buildAssignedActiveRequirementsLookup`'s core contract: 4 status
 * partitions (`MISSING`/`PENDING`/`SATISFIED`/`NOT_SATISFIED`) queried in PARALLEL, each paged to
 * exhaustion, merged into one true count BEFORE the 20-item cap is applied - and that
 * `NOT_APPLICABLE` is never queried at all (excluded by construction, not filtered post-hoc).
 */
function fakeClient(byPk: Record<string, Array<{ requirementId: string }>>): { client: DynamoDBDocumentClient; queriedPks: string[] } {
  const queriedPks: string[] = [];
  const client = {
    send: async (command: { input: { ExpressionAttributeValues: Record<string, string> } }) => {
      const pk: string = command.input.ExpressionAttributeValues[":pk"] ?? "";
      queriedPks.push(pk);
      return { Items: byPk[pk] ?? [], LastEvaluatedKey: undefined, ConsumedCapacity: { CapacityUnits: 0.5 } };
    },
  } as unknown as DynamoDBDocumentClient;
  return { client, queriedPks };
}

describe("buildAssignedActiveRequirementsLookup", () => {
  // Mutação: consultar só um status (ex. esquecer PENDING/NOT_SATISFIED) faria isto perder
  // Requirements reais atribuídos - as 4 partições MISSING/PENDING/SATISFIED/NOT_SATISFIED devem
  // ser somadas, nunca uma escolhida arbitrariamente.
  it("merges matches across all 4 non-terminal statuses", async () => {
    const { client, queriedPks } = fakeClient({
      "TENANT#org-1#REQSTATUS#MISSING": [{ requirementId: "req-missing" }],
      "TENANT#org-1#REQSTATUS#PENDING": [{ requirementId: "req-pending" }],
      "TENANT#org-1#REQSTATUS#SATISFIED": [{ requirementId: "req-satisfied" }],
      "TENANT#org-1#REQSTATUS#NOT_SATISFIED": [{ requirementId: "req-not-satisfied" }],
    });
    const lookup = buildAssignedActiveRequirementsLookup(client, "MainTable");

    const result = await lookup.findAssignedActiveRequirements("org-1", "user-1");
    expect(result.totalKnownRequirements).toBe(4);
    expect(new Set(result.requirementIds)).toEqual(new Set(["req-missing", "req-pending", "req-satisfied", "req-not-satisfied"]));
    expect(result.truncatedRequirements).toBe(false);
    // Proves NOT_APPLICABLE is never queried - a Requirement flipped to NOT_APPLICABLE is not an
    // actionable obligation (module doc comment), excluded by construction, not by filtering.
    expect(queriedPks.some((pk) => pk.includes("NOT_APPLICABLE"))).toBe(false);
  });

  // Mutação central (mesma classe da Correção 2 do port irmão): usar o tamanho de uma única
  // página/status como proxy de truncamento em vez do total real somado across partitions faria
  // `truncated` mentir no caso limítrofe (exatamente 20 no total, espalhados por status).
  it("caps requirementIds at 20 across the merged total, never per-status", async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ requirementId: `missing-${i}` }));
    const { client } = fakeClient({
      "TENANT#org-1#REQSTATUS#MISSING": many,
      "TENANT#org-1#REQSTATUS#PENDING": [{ requirementId: "pending-1" }, { requirementId: "pending-2" }, { requirementId: "pending-3" }, { requirementId: "pending-4" }, { requirementId: "pending-5" }, { requirementId: "pending-6" }],
      "TENANT#org-1#REQSTATUS#SATISFIED": [],
      "TENANT#org-1#REQSTATUS#NOT_SATISFIED": [],
    });
    const lookup = buildAssignedActiveRequirementsLookup(client, "MainTable");

    const result = await lookup.findAssignedActiveRequirements("org-1", "user-1");
    expect(result.totalKnownRequirements).toBe(21);
    expect(result.requirementIds).toHaveLength(20);
    expect(result.truncatedRequirements).toBe(true);
  });

  it("returns no matches and truncatedRequirements=false when the assignee has nothing assigned", async () => {
    const { client } = fakeClient({});
    const lookup = buildAssignedActiveRequirementsLookup(client, "MainTable");

    const result = await lookup.findAssignedActiveRequirements("org-1", "user-1");
    expect(result).toEqual({ requirementIds: [], totalKnownRequirements: 0, truncatedRequirements: false });
  });
});

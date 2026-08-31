import { describe, expect, it } from "vitest";
import { buildAssignedActiveItemsLookup } from "../../../src/runtime/aws/composition/organization.js";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

/**
 * D-122/D-125 (Responsibility Reassignment on Member Removal) - proves the pagination-to-
 * exhaustion contract from Round-3 Correção 2 (`responsibility-reassignment-scoping/
 * round-3-claude-proposal.md`): the composition-root adapter must page GSI1's ACTIVE partition
 * to exhaustion via `LastEvaluatedKey`, never rely on DynamoDB `Limit` as a truncation proxy, and
 * only cap the RETURNED `itemIds` list (after counting the true total) at 20.
 */
function fakeClient(pages: Array<{ items: Array<{ itemId: string }>; lastEvaluatedKey?: Record<string, unknown> }>): DynamoDBDocumentClient {
  let call = 0;
  return {
    send: async () => {
      const page = pages[call];
      call += 1;
      return { Items: page?.items ?? [], LastEvaluatedKey: page?.lastEvaluatedKey };
    },
  } as unknown as DynamoDBDocumentClient;
}

describe("buildAssignedActiveItemsLookup", () => {
  // Mutação: trocar o `do { ... } while (exclusiveStartKey)` por uma única chamada (sem seguir
  // LastEvaluatedKey) faria isto ver só a página 1 e reportar totalKnown=1 em vez de 2.
  it("pages to exhaustion across multiple GSI1 pages", async () => {
    const client = fakeClient([
      { items: [{ itemId: "item-1" }], lastEvaluatedKey: { PK: "cursor-1" } },
      { items: [{ itemId: "item-2" }], lastEvaluatedKey: undefined },
    ]);
    const lookup = buildAssignedActiveItemsLookup(client, "MainTable");

    const result = await lookup.findAssignedActiveItems("org-1", "user-1");
    expect(result).toEqual({ itemIds: ["item-1", "item-2"], totalKnown: 2, truncated: false });
  });

  // Mutação central da Correção 2: se a implementação usasse `Limit: 20` do DynamoDB como proxy
  // de truncamento em vez de contar o total real após paginar, um FilterExpression que descarta
  // itens de outras partições/páginas poderia mascarar matches reais além da página avaliada -
  // este teste prova que totalKnown reflete a contagem verdadeira de TODAS as páginas, não o
  // tamanho de uma única página crua.
  it("computes totalKnown as the true count across all pages, never derived from a single page size", async () => {
    const manyItems = Array.from({ length: 25 }, (_, i) => ({ itemId: `item-${i}` }));
    const client = fakeClient([{ items: manyItems, lastEvaluatedKey: undefined }]);
    const lookup = buildAssignedActiveItemsLookup(client, "MainTable");

    const result = await lookup.findAssignedActiveItems("org-1", "user-1");
    expect(result.totalKnown).toBe(25);
    expect(result.itemIds).toHaveLength(20);
    expect(result.truncated).toBe(true);
  });

  // Mutação: usar `itemIds.length > 0` (em vez de `totalKnown > itemIds.length`) como condição de
  // `truncated` continuaria correto no caso truncado, mas mascararia o caso exatamente-no-limite
  // (totalKnown === 20) como truncated incorretamente se invertido - prova o caso não truncado.
  it("reports truncated=false when totalKnown is within the 20-item cap", async () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ itemId: `item-${i}` }));
    const client = fakeClient([{ items, lastEvaluatedKey: undefined }]);
    const lookup = buildAssignedActiveItemsLookup(client, "MainTable");

    const result = await lookup.findAssignedActiveItems("org-1", "user-1");
    expect(result).toEqual({ itemIds: items.map((i) => i.itemId), totalKnown: 5, truncated: false });
  });

  it("returns no items and truncated=false when the assignee has no ACTIVE items", async () => {
    const client = fakeClient([{ items: [], lastEvaluatedKey: undefined }]);
    const lookup = buildAssignedActiveItemsLookup(client, "MainTable");

    const result = await lookup.findAssignedActiveItems("org-1", "user-1");
    expect(result).toEqual({ itemIds: [], totalKnown: 0, truncated: false });
  });
});

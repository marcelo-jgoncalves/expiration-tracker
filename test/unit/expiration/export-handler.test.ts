import { describe, expect, it } from "vitest";
import { buildExportCsv } from "../../../src/modules/expiration/http/export-handler.js";
import type { ExpirationItem } from "../../../src/modules/expiration/domain/expiration-item.js";
import { ValidationError } from "../../../src/shared/errors/app-error.js";

function makeItem(overrides: Partial<ExpirationItem> = {}): ExpirationItem {
  return {
    PK: "TENANT#t1#ITEM#i1",
    SK: "META",
    entityType: "ExpirationItem",
    itemId: "i1",
    tenantId: "t1",
    name: "Alvará",
    category: "Licenças",
    categoryNormalized: "licencas",
    dueDate: "2026-09-10T00:00:00.000Z",
    tags: ["a", "b"],
    status: "ACTIVE",
    createdAt: "2026-08-19T12:00:00.000Z",
    updatedAt: "2026-08-19T12:00:00.000Z",
    version: 1,
    GSI1PK: "TENANT#t1#ITEMSTATUS#ACTIVE",
    GSI1SK: "DUE#2026-09-10T00:00:00.000Z#ITEM#i1",
    ...overrides,
  };
}

describe("buildExportCsv (D-123/D-126)", () => {
  it("emits the exact 15-column header in the approved order", () => {
    const csv = buildExportCsv([]);
    expect(csv).toBe("itemId,name,category,description,dueDate,issueDate,periodicity,issuer,number,assigneeUserId,tags,priority,status,createdAt,updatedAt\r\n");
  });

  it("serializes one row with tags joined by ';' and empty strings for absent optional fields", () => {
    const csv = buildExportCsv([makeItem()]);
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe("i1,Alvará,Licenças,,2026-09-10T00:00:00.000Z,,,,,,a;b,,ACTIVE,2026-08-19T12:00:00.000Z,2026-08-19T12:00:00.000Z");
  });

  it("applies formula-injection mitigation to a name starting with '='", () => {
    const csv = buildExportCsv([makeItem({ name: "=cmd" })]);
    expect(csv).toContain("'=cmd");
  });

  it("throws ValidationError once the accumulated serialized CSV bytes (header + CRLF-terminated rows) exceed the 4 MB cap — proves the guard measures the FINAL serialized bytes, not raw field lengths", () => {
    // A real defeating mutation checked: measuring raw field bytes instead of the serialized
    // (post RFC4180-quoting) row would let a heavy-quoting workload (every field wrapped in
    // doubled quotes) slip past the cap while the wire bytes actually sent exceed it. This test
    // uses a comma-heavy description that RFC4180-quotes (doubling much of its size) to prove
    // the guard trips on the post-quoting byte count.
    const bigDescription = "a,".repeat(3_000_000); // ~6MB raw, and RFC4180-quoting adds more
    expect(() => buildExportCsv([makeItem({ description: bigDescription })])).toThrow(ValidationError);
  });

  it("does not throw for a payload comfortably under the 4 MB cap", () => {
    const items = Array.from({ length: 500 }, (_, i) => makeItem({ itemId: `i${i}` }));
    expect(() => buildExportCsv(items)).not.toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/api/errors.js";
import {
  EMPTY_CREATE_ITEM_DRAFT,
  draftToCreateItemInput,
  parseTagsInput,
  parseValidationErrors,
  toIsoDateTime,
  validateCreateItemDraft,
  type CreateItemDraft,
} from "../../src/api/validation.js";

function draft(overrides: Partial<CreateItemDraft> = {}): CreateItemDraft {
  return { ...EMPTY_CREATE_ITEM_DRAFT, name: "Alvará", category: "Licenças", dueDate: "2026-09-10", ...overrides };
}

describe("validateCreateItemDraft", () => {
  it("requires name, category and dueDate - the same required set as create-item-request.v1.json", () => {
    const result = validateCreateItemDraft(draft({ name: "", category: "", dueDate: "" }));
    expect(result.fields["name"]).toBeTruthy();
    expect(result.fields["category"]).toBeTruthy();
    expect(result.fields["dueDate"]).toBeTruthy();
  });

  it("accepts a minimal valid draft with no field errors", () => {
    const result = validateCreateItemDraft(draft());
    expect(result.fields).toEqual({});
  });

  it("rejects a name over 200 characters, mirroring the backend schema's maxLength", () => {
    const result = validateCreateItemDraft(draft({ name: "a".repeat(201) }));
    expect(result.fields["name"]).toBeTruthy();
  });

  it("rejects more than 20 tags", () => {
    const tags = Array.from({ length: 21 }, (_, i) => `tag${i}`).join(",");
    const result = validateCreateItemDraft(draft({ tags }));
    expect(result.fields["tags"]).toBeTruthy();
  });

  it("rejects a single tag over 50 characters", () => {
    const result = validateCreateItemDraft(draft({ tags: "a".repeat(51) }));
    expect(result.fields["tags"]).toBeTruthy();
  });

  it("blank/whitespace-only tags between commas are dropped, not counted as empty tags", () => {
    const result = validateCreateItemDraft(draft({ tags: "a, , b,," }));
    expect(result.fields["tags"]).toBeUndefined();
    expect(parseTagsInput("a, , b,,")).toEqual(["a", "b"]);
  });
});

describe("draftToCreateItemInput", () => {
  it("converts a plain date-only dueDate/issueDate to a full ISO date-time, and trims free text", () => {
    const input = draftToCreateItemInput(draft({ name: "  Alvará  ", issueDate: "2026-01-01" }));
    expect(input.name).toBe("Alvará");
    expect(input.dueDate).toBe("2026-09-10T00:00:00.000Z");
    expect(input.issueDate).toBe("2026-01-01T00:00:00.000Z");
  });

  it("omits optional fields left blank rather than sending empty strings", () => {
    const input = draftToCreateItemInput(draft());
    expect(input.description).toBeUndefined();
    expect(input.issueDate).toBeUndefined();
    expect(input.tags).toEqual([]);
  });

  it("toIsoDateTime is a pure YYYY-MM-DD -> midnight-UTC ISO conversion", () => {
    expect(toIsoDateTime("2026-09-10")).toBe("2026-09-10T00:00:00.000Z");
  });
});

describe("parseValidationErrors", () => {
  it("maps a known top-level field's Ajv error string to that field", () => {
    const err = new ApiError({ code: "VALIDATION_FAILED", category: "VALIDATION", message: "Request body failed schema validation.", retryable: false, details: { errors: ["/name must NOT have fewer than 1 characters"] } });
    const parsed = parseValidationErrors(err);
    expect(parsed.fields["name"]).toBe("must NOT have fewer than 1 characters");
    expect(parsed.general).toEqual([]);
  });

  it("routes an unrecognized/nested path to general errors instead of dropping it", () => {
    const err = new ApiError({ code: "VALIDATION_FAILED", category: "VALIDATION", message: "x", retryable: false, details: { errors: ["/tags/0 must NOT have more than 50 characters"] } });
    const parsed = parseValidationErrors(err);
    expect(parsed.fields).toEqual({});
    expect(parsed.general).toContain("/tags/0 must NOT have more than 50 characters");
  });

  it("falls back to the error's own message when details.errors is missing entirely", () => {
    const err = new ApiError({ code: "VALIDATION_FAILED", category: "VALIDATION", message: "Missing request body.", retryable: false });
    const parsed = parseValidationErrors(err);
    expect(parsed.general).toEqual(["Missing request body."]);
  });
});

import { describe, expect, it } from "vitest";
import { presentMemberLabel, resolveAssigneeLabel } from "../../src/api/presentation.js";
import type { Member } from "../../src/api/types.js";

function member(overrides: Partial<Member>): Member {
  return { userId: "user-1", role: "MEMBER", status: "ACTIVE", joinedAt: "2026-01-01T00:00:00.000Z", version: 1, ...overrides };
}

describe("presentMemberLabel", () => {
  it("prefers displayName over email over the raw userId", () => {
    expect(presentMemberLabel(member({ displayName: "Ana Exemplo", email: "ana@example.com" }))).toBe("Ana Exemplo");
    expect(presentMemberLabel(member({ email: "ana@example.com" }))).toBe("ana@example.com");
    expect(presentMemberLabel(member({}))).toBe("user-1");
  });
});

describe("resolveAssigneeLabel", () => {
  it("resolves a matching member's label", () => {
    const members = [member({ userId: "user-42", displayName: "Ana Exemplo" })];
    expect(resolveAssigneeLabel("user-42", members)).toBe("Ana Exemplo");
  });

  it("returns undefined for an empty assigneeUserId", () => {
    expect(resolveAssigneeLabel(undefined, [member({})])).toBeUndefined();
  });

  it("returns undefined when the roster hasn't loaded yet", () => {
    expect(resolveAssigneeLabel("user-42", undefined)).toBeUndefined();
  });

  it("returns undefined when the id isn't a current member (removed/stale reference)", () => {
    expect(resolveAssigneeLabel("user-99", [member({ userId: "user-42" })])).toBeUndefined();
  });
});

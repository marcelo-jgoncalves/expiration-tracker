import { describe, expect, it } from "vitest";
import { issueOpaqueToken, parseOpaqueToken, opaqueTokenSecretMatches } from "../../../src/modules/bff/domain/opaque-token.js";

describe("opaque-token", () => {
  const pepper = "test-pepper";

  it("issues a token whose secret verifies against its own hash", () => {
    const issued = issueOpaqueToken(pepper);
    const parsed = parseOpaqueToken(issued.token);
    expect(parsed).toBeDefined();
    expect(opaqueTokenSecretMatches(pepper, parsed!.secret, issued.secretHash)).toBe(true);
  });

  it("never persists the raw token - only hashes are exposed", () => {
    const issued = issueOpaqueToken(pepper);
    expect(issued.selectorHash).not.toBe(issued.selector);
    expect(issued.secretHash).not.toContain(issued.token);
  });

  it("rejects a tampered secret", () => {
    const issued = issueOpaqueToken(pepper);
    const tampered = "0".repeat(64);
    expect(opaqueTokenSecretMatches(pepper, tampered, issued.secretHash)).toBe(false);
  });

  it("rejects the correct secret under a different pepper", () => {
    const issued = issueOpaqueToken(pepper);
    const parsed = parseOpaqueToken(issued.token)!;
    expect(opaqueTokenSecretMatches("different-pepper", parsed.secret, issued.secretHash)).toBe(false);
  });

  it("parseOpaqueToken never throws on malformed input, always returns undefined", () => {
    expect(parseOpaqueToken("")).toBeUndefined();
    expect(parseOpaqueToken("no-dot")).toBeUndefined();
    expect(parseOpaqueToken("a.b.c")).toBeUndefined();
    expect(parseOpaqueToken("short.short")).toBeUndefined();
    expect(parseOpaqueToken("../../etc/passwd")).toBeUndefined();
    expect(parseOpaqueToken("g".repeat(32) + "." + "g".repeat(64))).toBeUndefined(); // not hex
  });
});

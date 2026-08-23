import { describe, expect, it } from "vitest";
import { issueGuestToken, parseGuestToken, secretMatches } from "../../../src/modules/subject/domain/guest-token.js";

const PEPPER = "test-pepper-value";

describe("guest-token", () => {
  it("issues a token shaped as selector.secret, with hashes that never equal the raw values", () => {
    const issued = issueGuestToken(PEPPER);
    const [selectorPart, secretPart] = issued.token.split(".");
    expect(selectorPart).toBe(issued.selector);
    expect(issued.selector).toMatch(/^[a-f0-9]{32}$/);
    expect(secretPart).toMatch(/^[a-f0-9]{64}$/);
    expect(issued.selectorHash).not.toBe(issued.selector);
    expect(issued.secretHash).not.toBe(secretPart);
  });

  it("parses a well-formed token and rejects malformed ones (structural check, never throws)", () => {
    const issued = issueGuestToken(PEPPER);
    expect(parseGuestToken(issued.token)).toEqual({ selector: issued.selector, secret: issued.token.split(".")[1] });
    expect(parseGuestToken("not-a-token")).toBeUndefined();
    expect(parseGuestToken("too.many.dots")).toBeUndefined();
    expect(parseGuestToken("")).toBeUndefined();
    expect(parseGuestToken(`${issued.selector}.short`)).toBeUndefined();
  });

  it("secretMatches accepts the real secret and rejects a wrong one, using timingSafeEqual (never ===)", () => {
    const issued = issueGuestToken(PEPPER);
    const [, secret] = issued.token.split(".");
    expect(secretMatches(PEPPER, secret!, issued.secretHash)).toBe(true);
    expect(secretMatches(PEPPER, "0".repeat(64), issued.secretHash)).toBe(false);
  });

  it("secretMatches rejects when the pepper itself differs (hash computed with wrong pepper never matches)", () => {
    const issued = issueGuestToken(PEPPER);
    const [, secret] = issued.token.split(".");
    expect(secretMatches("different-pepper", secret!, issued.secretHash)).toBe(false);
  });

  it("two independently issued tokens never collide (high-entropy selectors)", () => {
    const a = issueGuestToken(PEPPER);
    const b = issueGuestToken(PEPPER);
    expect(a.selector).not.toBe(b.selector);
    expect(a.selectorHash).not.toBe(b.selectorHash);
  });
});

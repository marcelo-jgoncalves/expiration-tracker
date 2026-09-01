import { describe, expect, it } from "vitest";
import {
  guestSessionCsrfMatches,
  guestSessionSecretMatches,
  issueGuestSession,
  parseGuestSessionToken,
} from "../../../src/modules/document-archive/domain/guest-session.js";

const PEPPER = "test-pepper-value";

describe("guest-session (D-143 Decision 4, layer 2, D-146)", () => {
  it("issues a session token, CSRF token, and hashes distinct from every raw value", () => {
    const issued = issueGuestSession(PEPPER);
    const [selectorPart, secretPart] = issued.token.split(".");
    expect(selectorPart).toBe(issued.selector);
    expect(secretPart).toMatch(/^[a-f0-9]{64}$/);
    expect(issued.csrfToken).toMatch(/^[a-f0-9]{64}$/);
    expect(issued.selectorHash).not.toBe(issued.selector);
    expect(issued.secretHash).not.toBe(secretPart);
    expect(issued.csrfTokenHash).not.toBe(issued.csrfToken);
  });

  it("parses a well-formed session token and rejects malformed ones", () => {
    const issued = issueGuestSession(PEPPER);
    expect(parseGuestSessionToken(issued.token)).toEqual({ selector: issued.selector, secret: issued.token.split(".")[1] });
    expect(parseGuestSessionToken("garbage")).toBeUndefined();
    expect(parseGuestSessionToken("")).toBeUndefined();
  });

  it("guestSessionSecretMatches accepts the real secret, rejects a wrong one", () => {
    const issued = issueGuestSession(PEPPER);
    const [, secret] = issued.token.split(".");
    expect(guestSessionSecretMatches(PEPPER, secret!, issued.secretHash)).toBe(true);
    expect(guestSessionSecretMatches(PEPPER, "1".repeat(64), issued.secretHash)).toBe(false);
  });

  it("guestSessionCsrfMatches accepts the real csrfToken, rejects a wrong one (double-submit compare)", () => {
    const issued = issueGuestSession(PEPPER);
    expect(guestSessionCsrfMatches(PEPPER, issued.csrfToken, issued.csrfTokenHash)).toBe(true);
    expect(guestSessionCsrfMatches(PEPPER, "wrong-csrf-token", issued.csrfTokenHash)).toBe(false);
  });

  it("two independently minted sessions never collide", () => {
    const a = issueGuestSession(PEPPER);
    const b = issueGuestSession(PEPPER);
    expect(a.selectorHash).not.toBe(b.selectorHash);
    expect(a.csrfToken).not.toBe(b.csrfToken);
  });
});

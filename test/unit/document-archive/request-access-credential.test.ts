import { describe, expect, it } from "vitest";
import {
  epochSecondsFromIso,
  issueRequestAccessCredential,
  parseRequestAccessToken,
  requestAccessSecretMatches,
} from "../../../src/modules/document-archive/domain/request-access-credential.js";

const PEPPER = "test-pepper-value";

describe("request-access-credential (D-143 Decision 4, D-146)", () => {
  it("issues a token shaped as selector.secret, with hashes that never equal the raw values", () => {
    const issued = issueRequestAccessCredential(PEPPER);
    const [selectorPart, secretPart] = issued.token.split(".");
    expect(selectorPart).toBe(issued.selector);
    expect(issued.selector).toMatch(/^[a-f0-9]{32}$/);
    expect(secretPart).toMatch(/^[a-f0-9]{64}$/);
    expect(issued.selectorHash).not.toBe(issued.selector);
    expect(issued.secretHash).not.toBe(secretPart);
  });

  it("parses a well-formed token and rejects malformed ones (structural check, never throws)", () => {
    const issued = issueRequestAccessCredential(PEPPER);
    expect(parseRequestAccessToken(issued.token)).toEqual({ selector: issued.selector, secret: issued.token.split(".")[1] });
    expect(parseRequestAccessToken("not-a-token")).toBeUndefined();
    expect(parseRequestAccessToken("too.many.dots.here")).toBeUndefined();
    expect(parseRequestAccessToken("")).toBeUndefined();
    expect(parseRequestAccessToken(`${issued.selector}.short`)).toBeUndefined();
  });

  it("requestAccessSecretMatches accepts the real secret and rejects a wrong one (timingSafeEqual, never ===)", () => {
    const issued = issueRequestAccessCredential(PEPPER);
    const [, secret] = issued.token.split(".");
    expect(requestAccessSecretMatches(PEPPER, secret!, issued.secretHash)).toBe(true);
    expect(requestAccessSecretMatches(PEPPER, "0".repeat(64), issued.secretHash)).toBe(false);
  });

  it("requestAccessSecretMatches rejects when the pepper differs", () => {
    const issued = issueRequestAccessCredential(PEPPER);
    const [, secret] = issued.token.split(".");
    expect(requestAccessSecretMatches("different-pepper", secret!, issued.secretHash)).toBe(false);
  });

  it("requestAccessSecretMatches never throws on a length mismatch (dummy-hash anti-timing path)", () => {
    // A dummy hash built from a shorter/longer hex string must be handled by the length check,
    // not crash timingSafeEqual (which throws on unequal buffer lengths if not guarded).
    expect(requestAccessSecretMatches(PEPPER, "ab", "ff")).toBe(false);
  });

  it("two independently issued credentials never collide (high-entropy selectors)", () => {
    const a = issueRequestAccessCredential(PEPPER);
    const b = issueRequestAccessCredential(PEPPER);
    expect(a.selector).not.toBe(b.selector);
    expect(a.selectorHash).not.toBe(b.selectorHash);
  });

  it("epochSecondsFromIso converts an ISO instant to numeric epoch seconds (DynamoDB TTL requires this)", () => {
    expect(epochSecondsFromIso("2026-08-23T00:00:00.000Z")).toBe(1787443200);
    expect(Number.isInteger(epochSecondsFromIso(new Date().toISOString()))).toBe(true);
  });
});

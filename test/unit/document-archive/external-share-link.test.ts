import { describe, expect, it } from "vitest";
import {
  externalShareLinkSecretMatches,
  issueExternalShareLinkToken,
  parseExternalShareLinkToken,
} from "../../../src/modules/document-archive/domain/external-share-link.js";

const PEPPER = "share-link-test-pepper";

describe("external-share-link domain (D-225 Decision 1/2)", () => {
  it("issues a token shaped selector.secret with 128/256-bit hex halves", () => {
    const issued = issueExternalShareLinkToken(PEPPER);
    const [selector, secret] = issued.token.split(".");
    expect(selector).toHaveLength(32);
    expect(secret).toHaveLength(64);
    expect(parseExternalShareLinkToken(issued.token)).toEqual({ selector, secret });
  });

  it("parseExternalShareLinkToken never throws on malformed input (anti-enumeration)", () => {
    expect(parseExternalShareLinkToken("")).toBeUndefined();
    expect(parseExternalShareLinkToken("no-dot")).toBeUndefined();
    expect(parseExternalShareLinkToken("a.b.c")).toBeUndefined();
    expect(parseExternalShareLinkToken(`${"z".repeat(32)}.${"z".repeat(64)}`)).toBeUndefined(); // not hex
  });

  it("externalShareLinkSecretMatches is true only for the exact issued secret", () => {
    const issued = issueExternalShareLinkToken(PEPPER);
    expect(externalShareLinkSecretMatches(PEPPER, issued.token.split(".")[1]!, issued.secretHash)).toBe(true);
    expect(externalShareLinkSecretMatches(PEPPER, "f".repeat(64), issued.secretHash)).toBe(false);
  });

  it("uses its own pepper — the same secret hashes differently under a different pepper", () => {
    const issued = issueExternalShareLinkToken(PEPPER);
    expect(externalShareLinkSecretMatches("a-different-pepper", issued.token.split(".")[1]!, issued.secretHash)).toBe(false);
  });
});

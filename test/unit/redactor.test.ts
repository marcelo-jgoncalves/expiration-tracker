import { describe, expect, it } from "vitest";
import { Redactor } from "../../src/shared/observability/redactor.js";

const CANARY_SECRET = "super-secret-token-value-12345";
const CANARY_EMAIL = "canary@example.com";

describe("Redactor", () => {
  const redactor = new Redactor();

  it("redacts known sensitive field names at the top level", () => {
    const result = redactor.redact({ password: CANARY_SECRET, ok: true }) as Record<string, unknown>;
    expect(JSON.stringify(result)).not.toContain(CANARY_SECRET);
    expect(result.password).toBe("[REDACTED]");
    expect(result.ok).toBe(true);
  });

  it("redacts sensitive field names at arbitrary nesting depth", () => {
    const input = {
      level1: { level2: { level3: { token: CANARY_SECRET, safe: "keep-me" } } },
    };
    const result = redactor.redact(input);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(CANARY_SECRET);
    expect(serialized).toContain("keep-me");
  });

  it("redacts sensitive field names inside arrays", () => {
    const input = { attempts: [{ email: CANARY_EMAIL }, { email: "second@example.com" }] };
    const serialized = JSON.stringify(redactor.redact(input));
    expect(serialized).not.toContain(CANARY_EMAIL);
    expect(serialized).not.toContain("second@example.com");
  });

  it("redacts email-shaped values embedded in free text", () => {
    const message = `Delivery failed for ${CANARY_EMAIL} after 3 attempts`;
    const result = redactor.redactString(message);
    expect(result).not.toContain(CANARY_EMAIL);
    expect(result).toContain("[REDACTED]");
  });

  it("redacts bearer tokens embedded in free text (sanitized SDK error messages)", () => {
    const message = `Request failed: Authorization: Bearer ${CANARY_SECRET} was rejected`;
    const result = redactor.redactString(message);
    expect(result).not.toContain(CANARY_SECRET);
  });

  it("redacts Error objects without leaking full stack traces", () => {
    const err = new Error(`Provider rejected request for ${CANARY_EMAIL}`);
    const result = redactor.redactError(err);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(CANARY_EMAIL);
  });

  it("handles circular references without throwing", () => {
    const obj: Record<string, unknown> = { name: "x" };
    obj.self = obj;
    expect(() => redactor.redact(obj)).not.toThrow();
  });

  it("truncates strings beyond the configured max length", () => {
    const longString = "a".repeat(5000);
    const result = redactor.redactString(longString);
    expect(result.length).toBeLessThan(5000);
    expect(result).toContain("TRUNCATED");
  });

  it("caps array length per configured limits", () => {
    const bigArray = Array.from({ length: 500 }, (_, i) => i);
    const result = redactor.redact(bigArray) as unknown[];
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it("does not redact safe primitive values", () => {
    const result = redactor.redact({ count: 42, active: true, note: "hello world" }) as Record<
      string,
      unknown
    >;
    expect(result.count).toBe(42);
    expect(result.active).toBe(true);
    expect(result.note).toBe("hello world");
  });

  it("passes through null/undefined without error", () => {
    expect(redactor.redact(null)).toBeNull();
    expect(redactor.redact(undefined)).toBeUndefined();
  });

  it("redacts guestToken and cognitoSub - the codebase's real field names for those values, distinct from the generic 'token'/'cognitoSubject' entries (W3-05 finding)", () => {
    const result = redactor.redact({ guestToken: CANARY_SECRET, cognitoSub: "sub-12345" }) as Record<string, unknown>;
    expect(result.guestToken).toBe("[REDACTED]");
    expect(result.cognitoSub).toBe("[REDACTED]");
  });
});

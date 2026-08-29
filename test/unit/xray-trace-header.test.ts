import { describe, expect, it } from "vitest";
import { parseXrayTraceHeader } from "../../src/shared/observability/xray-trace-header.js";

const VALID_ROOT = "1-5e1b4151-5ac6c58dc39a56f8dead5e08";

describe("parseXrayTraceHeader", () => {
  it("parses Root and Sampled regardless of field order", () => {
    expect(parseXrayTraceHeader(`Root=${VALID_ROOT};Sampled=1`)).toEqual({
      xrayTraceId: VALID_ROOT,
      xraySampled: true,
    });
    expect(parseXrayTraceHeader(`Sampled=0;Root=${VALID_ROOT}`)).toEqual({
      xrayTraceId: VALID_ROOT,
      xraySampled: false,
    });
  });

  it("ignores Parent and Lineage entirely (not surfaced in v1)", () => {
    expect(parseXrayTraceHeader(`Root=${VALID_ROOT};Parent=53995c3f42cd8ad8;Sampled=1;Lineage=1:abcdef12:0`)).toEqual({
      xrayTraceId: VALID_ROOT,
      xraySampled: true,
    });
  });

  it("ignores unknown keys", () => {
    expect(parseXrayTraceHeader(`Root=${VALID_ROOT};Bogus=whatever`)).toEqual({
      xrayTraceId: VALID_ROOT,
    });
  });

  it("returns undefined for absent or empty input", () => {
    expect(parseXrayTraceHeader(undefined)).toBeUndefined();
    expect(parseXrayTraceHeader("")).toBeUndefined();
  });

  it("omits xrayTraceId when Root fails strict format validation, without throwing", () => {
    for (const badRoot of [
      "not-a-root",
      "1-tooshort-5ac6c58dc39a56f8dead5e08",
      "1-5e1b4151-tooshort",
      "1-5e1b4151-5ac6c58dc39a56f8dead5e0g", // non-hex trailing char
      "2-5e1b4151-5ac6c58dc39a56f8dead5e08", // wrong version prefix
    ]) {
      expect(() => parseXrayTraceHeader(`Root=${badRoot};Sampled=1`)).not.toThrow();
      expect(parseXrayTraceHeader(`Root=${badRoot};Sampled=1`)).toEqual({ xraySampled: true });
    }
  });

  it("omits xraySampled when Sampled has any value other than the literal 0/1, without throwing", () => {
    for (const badSampled of ["true", "false", "2", "", "yes"]) {
      const result = parseXrayTraceHeader(`Root=${VALID_ROOT};Sampled=${badSampled}`);
      expect(result).toEqual({ xrayTraceId: VALID_ROOT });
    }
  });

  it("never throws on garbage input (fail-open)", () => {
    for (const garbage of [";;;", "===", "Root", "Root=", "=1-abc", "a;b;c=d=e"]) {
      expect(() => parseXrayTraceHeader(garbage)).not.toThrow();
    }
  });

  it("returns undefined when no recognized field is present", () => {
    expect(parseXrayTraceHeader("Parent=53995c3f42cd8ad8;Lineage=1:abcdef12:0")).toBeUndefined();
  });
});

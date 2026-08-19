import { describe, expect, it } from "vitest";
import { envFields, loadConfig } from "../../src/shared/config/config.js";
import { ValidationError } from "../../src/shared/errors/app-error.js";

describe("loadConfig", () => {
  const schema = {
    TABLE_NAME: envFields.string(),
    RETRY_LIMIT: envFields.int(),
    FEATURE_FLAG: envFields.bool(),
    STAGE: envFields.enum(["dev", "staging", "prod"] as const),
  };

  it("parses a fully-populated env into a typed config object", () => {
    const config = loadConfig(schema, {
      TABLE_NAME: "MainTable",
      RETRY_LIMIT: "5",
      FEATURE_FLAG: "true",
      STAGE: "prod",
    });
    expect(config).toEqual({
      TABLE_NAME: "MainTable",
      RETRY_LIMIT: 5,
      FEATURE_FLAG: true,
      STAGE: "prod",
    });
  });

  it("throws ValidationError listing every missing required var (fail fast at cold start)", () => {
    expect(() => loadConfig(schema, {})).toThrowError(ValidationError);
    try {
      loadConfig(schema, {});
      expect.fail("should have thrown");
    } catch (err) {
      const validationError = err as ValidationError;
      expect(validationError.details?.problems).toHaveLength(4);
    }
  });

  it("throws ValidationError for a malformed value with a clear message", () => {
    expect(() =>
      loadConfig(schema, {
        TABLE_NAME: "MainTable",
        RETRY_LIMIT: "not-a-number",
        FEATURE_FLAG: "true",
        STAGE: "prod",
      }),
    ).toThrowError(/RETRY_LIMIT/);
  });

  it("rejects an enum value outside the allowed set", () => {
    expect(() =>
      loadConfig(schema, {
        TABLE_NAME: "MainTable",
        RETRY_LIMIT: "1",
        FEATURE_FLAG: "true",
        STAGE: "not-a-stage",
      }),
    ).toThrowError(/STAGE/);
  });

  it("applies default values when provided and var is absent", () => {
    const withDefault = loadConfig(
      { LOG_LEVEL: { ...envFields.string(), defaultValue: "info" } },
      {},
    );
    expect(withDefault.LOG_LEVEL).toBe("info");
  });

  it("allows optional fields to be omitted without defaults", () => {
    const withOptional = loadConfig({ OPTIONAL_VAR: { ...envFields.string(), optional: true } }, {});
    expect(withOptional.OPTIONAL_VAR).toBeUndefined();
  });
});

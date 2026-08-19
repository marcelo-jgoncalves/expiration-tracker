/**
 * Central redactor - implementation-blueprint.md #14.1, threat-model.md redactor gap.
 * Loads the denylist from schemas/sensitive-fields.json (single source of truth shared
 * with any future documentation/tooling) and scrubs field names + known value patterns
 * before anything reaches logs, trace annotations, DLQ diagnostic metadata or operational
 * events.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

interface SensitiveFieldsConfig {
  redactedFieldNames: string[];
  redactedValuePatterns: { name: string; pattern: string }[];
  limits: {
    maxDepth: number;
    maxStringLength: number;
    maxArrayLength: number;
    maxObjectKeys: number;
  };
  redactedValuePlaceholder: string;
}

const PLACEHOLDER_FALLBACK = "[REDACTED]";
const TRUNCATED_SUFFIX = "…[TRUNCATED]";

function resolveSchemaPath(): string {
  // src/shared/observability -> repo root/schemas/sensitive-fields.json
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../schemas/sensitive-fields.json");
}

function loadConfig(explicitPath?: string): SensitiveFieldsConfig {
  const configPath = explicitPath ?? resolveSchemaPath();
  const raw = readFileSync(configPath, "utf-8");
  return JSON.parse(raw) as SensitiveFieldsConfig;
}

export interface RedactorOptions {
  /** Override for tests; defaults to schemas/sensitive-fields.json relative to this file. */
  configPath?: string;
}

export class Redactor {
  private readonly fieldNames: Set<string>;
  private readonly valuePatterns: { name: string; regex: RegExp }[];
  private readonly limits: SensitiveFieldsConfig["limits"];
  private readonly placeholder: string;

  constructor(options: RedactorOptions = {}) {
    const config = loadConfig(options.configPath);
    this.fieldNames = new Set(config.redactedFieldNames.map((f) => f.toLowerCase()));
    this.valuePatterns = config.redactedValuePatterns.map((p) => ({
      name: p.name,
      regex: new RegExp(p.pattern, "gi"),
    }));
    this.limits = config.limits;
    this.placeholder = config.redactedValuePlaceholder ?? PLACEHOLDER_FALLBACK;
  }

  /** Redacts an arbitrary structured value (object/array/primitive) recursively. */
  redact(value: unknown): unknown {
    return this.redactValue(value, 0, new WeakSet());
  }

  /** Redacts known value patterns (emails, bearer tokens, ...) inside a free-text string,
   * e.g. sanitized SDK/provider exception messages (implementation-blueprint.md #14.1). */
  redactString(value: string): string {
    let result = this.truncateString(value);
    for (const { regex } of this.valuePatterns) {
      regex.lastIndex = 0;
      result = result.replace(regex, this.placeholder);
    }
    return result;
  }

  /** Redacts an Error, producing a plain object safe to log (never logs raw `.stack` of
   * SDK errors, which frequently embed request bodies/headers). */
  redactError(err: unknown): Record<string, unknown> {
    if (err instanceof Error) {
      return {
        name: err.name,
        message: this.redactString(err.message),
        // Stack traces can leak values interpolated into error messages (SDKs do this a lot);
        // keep only the first line (type + message) to preserve some debuggability.
        stackSummary: this.redactString(err.stack?.split("\n")[0] ?? err.message),
      };
    }
    return { message: this.redactString(String(err)) };
  }

  private truncateString(value: string): string {
    if (value.length <= this.limits.maxStringLength) {
      return value;
    }
    return value.slice(0, this.limits.maxStringLength) + TRUNCATED_SUFFIX;
  }

  private redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
    if (depth > this.limits.maxDepth) {
      return "[MAX_DEPTH_EXCEEDED]";
    }
    if (value === null || value === undefined) {
      return value;
    }
    if (typeof value === "string") {
      return this.redactString(value);
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    if (value instanceof Error) {
      return this.redactError(value);
    }
    if (Array.isArray(value)) {
      if (seen.has(value)) return "[CIRCULAR]";
      seen.add(value);
      return value.slice(0, this.limits.maxArrayLength).map((v) => this.redactValue(v, depth + 1, seen));
    }
    if (typeof value === "object") {
      if (seen.has(value as object)) return "[CIRCULAR]";
      seen.add(value as object);
      const entries = Object.entries(value as Record<string, unknown>).slice(0, this.limits.maxObjectKeys);
      const out: Record<string, unknown> = {};
      for (const [key, v] of entries) {
        if (this.fieldNames.has(key.toLowerCase())) {
          out[key] = this.placeholder;
        } else {
          out[key] = this.redactValue(v, depth + 1, seen);
        }
      }
      return out;
    }
    // functions, symbols, bigint etc - never log these verbatim
    return "[UNSUPPORTED_TYPE]";
  }
}

/** Shared default instance - stateless config load, safe to reuse across a Lambda's lifecycle. */
export const defaultRedactor = new Redactor();

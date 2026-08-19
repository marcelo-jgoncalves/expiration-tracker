/**
 * Configuration loading pattern (M0 deliverable per implementation-blueprint.md #19).
 * The blueprint doesn't prescribe a specific config library (§17.3 mentions AppConfig for
 * runtime kill switches, which is a separate M1+ concern - the AppConfig *client* port
 * belongs to shared/config too but reads from the AWS AppConfig extension at runtime, not
 * implemented here since no Lambda runtime exists yet in M0).
 *
 * This module is the static/env-var config loader: validates required env vars fail fast
 * at cold start (never at first request), never reads secrets from process.env for anything
 * PII/credential-shaped without going through Secrets Manager references (env var carries the
 * ARN, not the value) - judgment call, blueprint is silent on the exact mechanism.
 */
import { ValidationError } from "../errors/app-error.js";

export interface EnvSchemaField<T> {
  parse: (raw: string) => T;
  optional?: boolean;
  defaultValue?: T;
}

export type EnvSchema = Record<string, EnvSchemaField<unknown>>;

export const envFields = {
  string(): EnvSchemaField<string> {
    return { parse: (raw) => raw };
  },
  int(): EnvSchemaField<number> {
    return {
      parse: (raw) => {
        const n = Number.parseInt(raw, 10);
        if (Number.isNaN(n)) {
          throw new Error(`expected integer, got "${raw}"`);
        }
        return n;
      },
    };
  },
  bool(): EnvSchemaField<boolean> {
    return {
      parse: (raw) => {
        if (raw === "true") return true;
        if (raw === "false") return false;
        throw new Error(`expected "true"|"false", got "${raw}"`);
      },
    };
  },
  enum<T extends string>(values: readonly T[]): EnvSchemaField<T> {
    return {
      parse: (raw) => {
        if (!values.includes(raw as T)) {
          throw new Error(`expected one of ${values.join(", ")}, got "${raw}"`);
        }
        return raw as T;
      },
    };
  },
};

/**
 * Loads and validates a typed config object from `env` (defaults to process.env).
 * Throws ValidationError with an aggregated list of problems on the FIRST call (cold start),
 * so a misconfigured Lambda fails at init rather than mid-request.
 */
export function loadConfig<S extends EnvSchema>(
  schema: S,
  env: NodeJS.ProcessEnv = process.env,
): { [K in keyof S]: S[K] extends EnvSchemaField<infer T> ? T : never } {
  const result: Record<string, unknown> = {};
  const problems: string[] = [];

  for (const [key, field] of Object.entries(schema)) {
    const raw = env[key];
    if (raw === undefined || raw === "") {
      if (field.defaultValue !== undefined) {
        result[key] = field.defaultValue;
        continue;
      }
      if (field.optional) {
        result[key] = undefined;
        continue;
      }
      problems.push(`${key}: missing required env var`);
      continue;
    }
    try {
      result[key] = field.parse(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      problems.push(`${key}: ${message}`);
    }
  }

  if (problems.length > 0) {
    throw new ValidationError(`Invalid configuration: ${problems.join("; ")}`, { problems });
  }

  return result as { [K in keyof S]: S[K] extends EnvSchemaField<infer T> ? T : never };
}

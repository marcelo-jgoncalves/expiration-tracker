/**
 * Ajv-backed loader/validator for schemas/**. implementation-blueprint.md #6.3 requires
 * "Schemas JSON ficam em schemas/, com testes de exemplos válidos e inválidos" - this is
 * the shared loader both production code (validating inbound SQS/webhook payloads per #6.2)
 * and tests use, so there's one source of truth for how $ref resolution / formats work.
 *
 * Judgment call: ajv + ajv-formats chosen for JSON Schema validation - the blueprint names
 * the schema format (JSON Schema under schemas/) but not a library; ajv is the de facto
 * standard, actively maintained, zero-install-script.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

function repoRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../");
}

export function schemasDir(): string {
  return path.join(repoRoot(), "schemas");
}

function walkJsonFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walkJsonFiles(full));
    } else if (entry.endsWith(".json")) {
      out.push(full);
    }
  }
  return out;
}

export class SchemaRegistry {
  private readonly ajv: Ajv2020;
  private readonly compiled = new Map<string, ValidateFunction>();

  constructor(private readonly dir: string = schemasDir()) {
    this.ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(this.ajv);
    this.loadAll();
  }

  private loadAll(): void {
    const files = walkJsonFiles(this.dir);
    // Two passes: add all schemas by $id first (so $ref between files resolves),
    // then compile.
    for (const file of files) {
      const schema = JSON.parse(readFileSync(file, "utf-8"));
      if (schema.$id) {
        this.ajv.addSchema(schema, schema.$id);
      }
    }
  }

  /** Validates `data` against the schema identified by its `$id`. Returns { valid, errors }. */
  validate(schemaId: string, data: unknown): { valid: boolean; errors: string[] } {
    let validateFn = this.compiled.get(schemaId);
    if (!validateFn) {
      const fn = this.ajv.getSchema(schemaId);
      if (!fn) {
        throw new Error(`Unknown schema $id: ${schemaId}`);
      }
      validateFn = fn;
      this.compiled.set(schemaId, validateFn);
    }
    const valid = validateFn(data) as boolean;
    const errors = (validateFn.errors ?? []).map(
      (e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`,
    );
    return { valid, errors };
  }
}

export const defaultSchemaRegistry = new SchemaRegistry();

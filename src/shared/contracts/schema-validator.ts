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

// Statically imported schema modules for `defaultSchemaRegistry` (production runtime path -
// see comment on that export below for why this list exists separately from the dynamic
// directory walk used by `new SchemaRegistry()`).
import domainEventEnvelopeV1 from "../../../schemas/events/domain-event-envelope.v1.json";
import commandEnvelopeV1 from "../../../schemas/queues/command-envelope.v1.json";
import webhookInboxV1 from "../../../schemas/api/webhook-inbox.v1.json";
import notificationIntentCreatedV1 from "../../../schemas/events/notification-intent-created.v1.json";
import itemDueDateChangedV1 from "../../../schemas/events/item-due-date-changed.v1.json";
import notificationEmailDeliverV1 from "../../../schemas/queues/notification-email-deliver.v1.json";
import reminderDispatchV1 from "../../../schemas/queues/reminder-dispatch.v1.json";

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

  /**
   * Two construction paths (full-audit round1/qualidade, 2026-08-19 - same class of bug as
   * the Redactor fix in the Arquitetura axis, commit 494f4e5):
   *  - `new SchemaRegistry()` (default, dynamic directory walk via `import.meta.url` +
   *    `readdirSync`) - safe ONLY when running as real ESM under Node directly (tests via
   *    Vitest, `npm run validate-schemas` via tsx). `import.meta.url` resolves correctly
   *    there and picking up every file under schemas/ automatically (including ones not yet
   *    wired into any handler) is exactly what "validate every schema" needs.
   *  - `new SchemaRegistry(preloadedSchemas)` - explicit list of already-imported schema
   *    objects, no filesystem/import.meta.url access at all. Required for any registry that
   *    ends up inside a Lambda bundle (esbuild "cjs" output, `infra/lib/scoped-lambda-
   *    function.ts`): `import.meta.url` is empty under cjs, which silently breaks
   *    `repoRoot()`/`readdirSync()` at cold start - this is what `defaultSchemaRegistry`
   *    (the one production handlers import) now uses.
   */
  constructor(preloadedSchemas?: object[]) {
    this.ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(this.ajv);
    if (preloadedSchemas) {
      this.loadFromMemory(preloadedSchemas);
    } else {
      this.loadFromDisk(schemasDir());
    }
  }

  private loadFromMemory(schemas: object[]): void {
    for (const schema of schemas) {
      const withId = schema as { $id?: string };
      if (withId.$id) {
        this.ajv.addSchema(schema, withId.$id);
      }
    }
  }

  private loadFromDisk(dir: string): void {
    const files = walkJsonFiles(dir);
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

/**
 * Production runtime singleton - imported by Lambda handlers (e.g. reminder-dispatch-
 * handler.ts). Built from statically-imported schema modules so esbuild inlines them as JS
 * object literals into the bundle at build time, same fix as Redactor's
 * schemas/sensitive-fields.json (Arquitetura axis round1, commit 494f4e5). Do NOT change
 * this back to `new SchemaRegistry()` (dynamic directory walk) - that depends on
 * `import.meta.url`, which is empty under the esbuild "cjs" bundle format
 * (infra/lib/scoped-lambda-function.ts's bundleEntry) and would silently resolve zero
 * schemas at real Lambda cold start. New schema added under schemas/ that a handler needs
 * at runtime: add both the file AND a static import line above.
 */
export const defaultSchemaRegistry = new SchemaRegistry([
  domainEventEnvelopeV1,
  commandEnvelopeV1,
  webhookInboxV1,
  notificationIntentCreatedV1,
  itemDueDateChangedV1,
  notificationEmailDeliverV1,
  reminderDispatchV1,
]);

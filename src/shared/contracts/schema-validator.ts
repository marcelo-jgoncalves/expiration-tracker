/**
 * Ajv-backed schema registry for schemas/**. implementation-blueprint.md #6.3 requires
 * "Schemas JSON ficam em schemas/, com testes de exemplos válidos e inválidos" - this is
 * the shared validator both production code (validating inbound SQS/webhook payloads per
 * #6.2) and tests use, so there's one source of truth for how $ref resolution / formats work.
 *
 * Judgment call: ajv + ajv-formats chosen for JSON Schema validation - the blueprint names
 * the schema format (JSON Schema under schemas/) but not a library; ajv is the de facto
 * standard, actively maintained, zero-install-script.
 *
 * This module deliberately has NO filesystem/`import.meta.url` access (full-audit
 * round1/qualidade, 2026-08-19 - same bug class as the Redactor fix, commit 494f4e5):
 * `import.meta.url` is empty under esbuild's "cjs" bundle format
 * (infra/lib/scoped-lambda-function.ts's bundleEntry), and even unreachable code that
 * references it still gets bundled and still trips esbuild's warning for every handler that
 * imports anything from this file. Dynamic disk discovery (walking every file under
 * schemas/, used by `npm run validate-schemas` and contract tests, never by a Lambda) lives
 * in the separate `schema-registry-disk.ts` instead, which this file never imports.
 */
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

// Statically imported schema modules for `defaultSchemaRegistry` (production runtime path).
import domainEventEnvelopeV1 from "../../../schemas/events/domain-event-envelope.v1.json";
import commandEnvelopeV1 from "../../../schemas/queues/command-envelope.v1.json";
import webhookInboxV1 from "../../../schemas/api/webhook-inbox.v1.json";
import notificationIntentCreatedV1 from "../../../schemas/events/notification-intent-created.v1.json";
import itemDueDateChangedV1 from "../../../schemas/events/item-due-date-changed.v1.json";
import itemDeactivatedV1 from "../../../schemas/events/item-deactivated.v1.json";
import reminderPolicyChangedV1 from "../../../schemas/events/reminder-policy-changed.v1.json";
import reminderMaterializationTriggerV1 from "../../../schemas/queues/reminder-materialization-trigger.v1.json";
import notificationEmailDeliverV1 from "../../../schemas/queues/notification-email-deliver.v1.json";
import reminderDispatchV1 from "../../../schemas/queues/reminder-dispatch.v1.json";
import documentChasingDispatchV1 from "../../../schemas/queues/document-chasing-dispatch.v1.json";
import createItemRequestV1 from "../../../schemas/api/create-item-request.v1.json";
import updateItemRequestV1 from "../../../schemas/api/update-item-request.v1.json";
import renewItemRequestV1 from "../../../schemas/api/renew-item-request.v1.json";
import putPolicyRequestV1 from "../../../schemas/api/put-policy-request.v1.json";
import updateNotificationPreferencesRequestV1 from "../../../schemas/api/update-notification-preferences-request.v1.json";
import reserveDocumentUploadRequestV1 from "../../../schemas/api/reserve-document-upload-request.v1.json";
import createSubjectRequestV1 from "../../../schemas/api/create-subject-request.v1.json";
import updateSubjectRequestV1 from "../../../schemas/api/update-subject-request.v1.json";
import assignRequirementRequestV1 from "../../../schemas/api/assign-requirement-request.v1.json";
import updateRequirementAssignmentRequestV1 from "../../../schemas/api/update-requirement-assignment-request.v1.json";
import linkRequirementItemRequestV1 from "../../../schemas/api/link-requirement-item-request.v1.json";
import createDocumentRequestRequestV1 from "../../../schemas/api/create-document-request-request.v1.json";
import updateDocumentRequestDeliveryPreferenceRequestV1 from "../../../schemas/api/update-document-request-delivery-preference-request.v1.json";
import startGuestSubmissionRequestV1 from "../../../schemas/api/start-guest-submission-request.v1.json";
import reserveImportRequestV1 from "../../../schemas/api/reserve-import-request.v1.json";
import importCommitV1 from "../../../schemas/queues/import-commit.v1.json";

export class SchemaRegistry {
  private readonly ajv: Ajv2020;
  private readonly compiled = new Map<string, ValidateFunction>();

  /** Takes an explicit list of already-loaded schema objects - no filesystem access. Callers
   * that need "every schema under schemas/" (CLI/tests) use
   * `schema-registry-disk.ts#loadAllSchemasFromDisk()` instead of constructing this directly
   * with an empty/missing list. */
  constructor(schemas: object[]) {
    this.ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(this.ajv);
    // Two passes not needed here since all schemas are added before any compile() call below
    // (compile is lazy, triggered by the first validate() per schemaId) - $ref between
    // schemas resolves correctly regardless of list order.
    for (const schema of schemas) {
      const withId = schema as { $id?: string };
      if (withId.$id) {
        this.ajv.addSchema(schema, withId.$id);
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
  itemDeactivatedV1,
  reminderPolicyChangedV1,
  reminderMaterializationTriggerV1,
  notificationEmailDeliverV1,
  reminderDispatchV1,
  documentChasingDispatchV1,
  createItemRequestV1,
  updateItemRequestV1,
  renewItemRequestV1,
  putPolicyRequestV1,
  updateNotificationPreferencesRequestV1,
  reserveDocumentUploadRequestV1,
  createSubjectRequestV1,
  updateSubjectRequestV1,
  assignRequirementRequestV1,
  updateRequirementAssignmentRequestV1,
  linkRequirementItemRequestV1,
  createDocumentRequestRequestV1,
  startGuestSubmissionRequestV1,
  updateDocumentRequestDeliveryPreferenceRequestV1,
  reserveImportRequestV1,
  importCommitV1,
]);

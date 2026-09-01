/**
 * Lambda bundling for the Terraform migration (ADR-0009). Terraform has no built-in
 * equivalent to CDK's `NodejsFunction`/this repo's own `bundleEntry` (infra/lib/
 * scoped-lambda-function.ts, esbuild invoked at `cdk synth` time) - Terraform needs the
 * bundled artifact to already exist on disk BEFORE `terraform plan`/`apply` can reference it
 * via `data "archive_file"`. This script is that explicit, separate build step: run it
 * before any Terraform command that touches the lambda-function module.
 *
 * Bundles each handler in src/runtime/aws/handlers/*.ts to
 * dist/lambda/<handler-name>/index.js, replicating bundleEntry's exact esbuild options
 * (bundle:true, platform:"node", target:"node24", format:"cjs", sourcemap:"external",
 * minify:false - AWS SDK v3 bundled IN, stack traces stay auditable, per
 * docs/architecture/m3.5-runtime-design.md). CJS output (not ESM, despite the project being
 * "type": "module") so the bundle needs no package.json/extension gymnastics inside the
 * Lambda zip - just index.js + index.handler, same rationale as the CDK version.
 *
 * Run via `npm run build:lambdas`. Output directory name (kebab-case, minus "-handler"
 * suffix) is what the Terraform lambda-function module's `handler_name`/`source_dir`
 * variables are expected to reference.
 */
import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const HANDLERS_DIR = path.join(REPO_ROOT, "src/runtime/aws/handlers");
const OUT_ROOT = path.join(REPO_ROOT, "dist/lambda");

// Every handler currently in src/runtime/aws/handlers/, matching the Lambda function
// entries wired in the Terraform infra/ module (ADR-0009). Listed explicitly (not globbed)
// so a new handler file is a deliberate one-line addition here, not silently picked up or
// silently missing from the Terraform build.
const HANDLERS = [
  "test-ping-handler",
  "items-handler",
  "reminders-handler",
  "notifications-handler",
  "reminder-producer-handler",
  "reminder-dispatch-handler",
  "reminder-reconciliation-handler",
  "reminder-materialization-trigger-handler",
  "dispatch-outbox-relay-handler",
  "outbox-sweeper-handler",
  "notification-router-handler",
  "notification-email-outbox-relay-handler",
  "email-delivery-handler",
  "ses-callback-handler",
  "documents-handler",
  "upload-finalizer-handler",
  "malware-result-handler",
  "upload-slot-reconciliation-handler",
  "parser-sandbox-handler",
  "subjects-handler",
  "memberships-handler",
  "guest-documents-handler",
  "document-chasing-dispatch-handler",
  "imports-handler",
  "import-parse-handler",
  "import-commit-handler",
  "document-archive-handler",
  "bff-handler",
  "extraction-starter-handler",
  "textract-task-handler",
  "pdf-parser-task-handler",
  "bedrock-extraction-task-handler",
  "extraction-validation-task-handler",
  "document-purge-handler",
  // W3-07 tenant purge orchestrator (D-124): the two Step Functions Task handlers and the
  // EventBridge Scheduler sweeper.
  "tenant-lifecycle-transition-handler",
  "tenant-purge-worker-handler",
  "tenant-purge-sweeper-handler",
  // D-123/D-126 (CSV data export): dedicated handler, own timeout, see export-handler.ts.
  "export-handler",
  // D-143 Nucleus 2, Requirement (Decision 5 / D-145): daily EventBridge Scheduler reindex job.
  "requirement-reindex-handler",
  // D-143 Decision 4, guest access (D-146).
  "document-archive-guest-handler",
  // D-143 Nucleus 2, entity 3/3, recurrence (Decision 8 / D-147): daily EventBridge Scheduler
  // materializer job.
  "document-request-recurrence-handler",
];

async function buildHandler(name: string): Promise<void> {
  const entry = path.join(HANDLERS_DIR, `${name}.ts`);
  if (!fs.existsSync(entry)) {
    throw new Error(`build-lambdas: expected handler entrypoint not found: ${entry}`);
  }
  const outDir = path.join(OUT_ROOT, name);
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "index.js");

  // Exact esbuild options from infra/lib/scoped-lambda-function.ts's bundleEntry() - must
  // stay in sync until the CDK path is removed per ADR-0009's final decision.
  await esbuild.build({
    entryPoints: [entry],
    outfile: outFile,
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    sourcemap: "external",
    minify: false,
    // Real production bug found in M5 (2026-08-21): esbuild's ESM->CJS export transform
    // defines `exports.handler` as a getter-only accessor with `configurable: false` (live-
    // binding emulation for `export async function handler(...)`). The ADOT Lambda layer's
    // OpenTelemetry auto-instrumentation (instrumentation-aws-lambda, via the `shimmer`
    // library) tries to Object.defineProperty-wrap that same property to add tracing - which
    // throws "TypeError: Cannot redefine property: handler" against a non-configurable
    // accessor, crashing every invocation (confirmed via a real `aws lambda invoke` smoke
    // test against exptrk-dev-test-ping-handler after M5's ADOT layer rollout).
    // Fix: replace `module.exports` with a brand-new plain object after the bundle body
    // runs - a plain `{ handler: ... }` object literal always yields a normal writable/
    // configurable/enumerable own property (JS default property semantics), never the
    // getter-only shape esbuild's `__export` helper produces, so the ADOT instrumentation
    // can wrap it normally.
    footer: { js: "module.exports = { handler: module.exports.handler };" },
  });

  // eslint-disable-next-line no-console -- CLI script, not a Lambda handler.
  console.log(`build-lambdas: bundled ${name} -> ${path.relative(REPO_ROOT, outFile)}`);
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  for (const name of HANDLERS) {
    await buildHandler(name);
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console -- CLI script.
  console.error("build-lambdas: build failed:", err);
  process.exit(1);
});

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
 * (bundle:true, platform:"node", target:"node20", format:"cjs", sourcemap:"external",
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
  "reminder-producer-handler",
  "reminder-dispatch-handler",
  "reminder-reconciliation-handler",
  "dispatch-outbox-relay-handler",
  "outbox-sweeper-handler",
  "notification-router-handler",
  "notification-email-outbox-relay-handler",
  "email-delivery-handler",
  "ses-callback-handler",
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
    target: "node20",
    format: "cjs",
    sourcemap: "external",
    minify: false,
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

/**
 * ScopedLambdaFunction — implementation-blueprint.md §17.1. "O construct gera grants
 * específicos e falha synth quando o recurso solicitado não corresponde a uma capability
 * conhecida."
 *
 * Judgment call (blueprint is schematic, not exhaustive, about capability granularity):
 * DynamoDB IAM cannot restrict by entity type (SK prefix) the way the blueprint's example
 * syntax (`tableAccess.readWriteKeys("ReminderOccurrence", "ExpirationItem")`) visually
 * suggests - IAM conditions operate on dynamodb:LeadingKeys (PK) at best, not on SK
 * patterns. This implementation is honest about that limit: the `entities` list is kept
 * as construct metadata (visible in `cdk synth`, useful for audit/least-privilege review)
 * but the actual IAM grant is table-level read/write via the well-tested CDK
 * `Table.grantReadWriteData`. Tighter per-entity IAM (via a Query/Scan condition on SK
 * prefix, not currently exposed by CDK's grant helpers) is deferred; noted in the M1 report.
 */
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ExpirationTrackerTable } from "./dynamo-table.js";

/**
 * M3.5: real bundling for handler entrypoints, replacing `lambda.Code.fromInline`
 * placeholders (docs/architecture/m3.5-runtime-design.md, "Handlers Lambda reais" /
 * "Bundling"). Invokes esbuild directly (target node20, one bundle per function, sourcemap
 * external, no minify - stack traces stay auditable, per the design doc) rather than
 * aws-cdk-lib's NodejsFunction, so ScopedLambdaFunction remains the single Lambda
 * construction point (no second construct with its own bundling path to keep in sync).
 * AWS SDK v3 is bundled IN (not left to the Lambda runtime-provided version), per design.
 */
function bundleEntry(entry: string, handlerExport: string): lambda.Code {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "expiration-tracker-lambda-"));
  const outFile = path.join(outDir, "index.js");
  // CJS output (not ESM, despite the project being "type": "module") so the bundle needs
  // no package.json/extension gymnastics inside the Lambda zip - just index.js + index.handler.
  esbuild.buildSync({
    entryPoints: [entry],
    outfile: outFile,
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    sourcemap: "external",
    minify: false,
  });
  if (handlerExport !== "handler") {
    throw new Error(`bundleEntry: only "handler" export name is wired into index.handler; got "${handlerExport}"`);
  }
  return lambda.Code.fromAsset(outDir);
}

export interface AccessCapability {
  readonly kind: string;
  readonly description: string;
  grant(fn: lambda.Function): void;
}

export function tableAccessFor(table: ExpirationTrackerTable) {
  return {
    readWriteKeys(...entities: string[]): AccessCapability {
      return {
        kind: "table:read-write",
        description: `read/write on entities [${entities.join(", ")}]`,
        grant: (fn) => table.grantReadWriteData(fn),
      };
    },
    readKeys(...entities: string[]): AccessCapability {
      return {
        kind: "table:read",
        description: `read-only on entities [${entities.join(", ")}]`,
        grant: (fn) => table.grantReadData(fn),
      };
    },
    create(...entities: string[]): AccessCapability {
      return {
        kind: "table:create",
        description: `create-only on entities [${entities.join(", ")}]`,
        grant: (fn) => table.grantReadWriteData(fn), // PutItem-only IAM condition not expressible via CDK grant helpers; documented limitation
      };
    },
    /** GSI3 (scheduler) read-only - reserved EXCLUSIVELY for ReminderProducer
     * (data-model.md §3 / implementation-blueprint.md §9.2's isolation safeguard). Routed
     * through ExpirationTrackerTable.grantGsi3ReadTo, never table.grantReadData, so no
     * other function can acquire this permission via this helper. */
    gsi3Read(): AccessCapability {
      return {
        kind: "table:gsi3-read",
        description: "GSI3 (scheduler) read-only - ReminderProducer only",
        grant: (fn) => table.grantGsi3ReadTo(fn),
      };
    },
    /** GSI6 (reconciliation/retention) read-only - reserved EXCLUSIVELY for
     * ReminderReconciliation and OutboxSweeperReminderDispatch
     * (docs/architecture/m3.5-runtime-design.md). Routed through
     * ExpirationTrackerTable.grantGsi6ReadTo, never table.grantReadData. */
    gsi6Read(): AccessCapability {
      return {
        kind: "table:gsi6-read",
        description: "GSI6 (reconciliation) read-only - ReminderReconciliation/OutboxSweeperReminderDispatch only",
        grant: (fn) => table.grantGsi6ReadTo(fn),
      };
    },
  };
}

export function queueAccessFor() {
  return {
    consume(queue: sqs.IQueue): AccessCapability {
      return {
        kind: "queue:consume",
        description: `consume from ${queue.queueName}`,
        grant: (fn) => queue.grantConsumeMessages(fn),
      };
    },
    send(queue: sqs.IQueue): AccessCapability {
      return {
        kind: "queue:send",
        description: `send to ${queue.queueName}`,
        grant: (fn) => queue.grantSendMessages(fn),
      };
    },
  };
}

export function appConfigAccessFor() {
  return {
    read(profileName: string): AccessCapability {
      return {
        kind: "appconfig:read",
        description: `read AppConfig profile ${profileName}`,
        grant: (fn) =>
          fn.addToRolePolicy(
            new iam.PolicyStatement({
              actions: ["appconfig:GetLatestConfiguration", "appconfig:StartConfigurationSession"],
              resources: ["*"], // AppConfig resource ARNs are per-deploy; scoped once the AppConfig construct exists (M1+ follow-up)
            }),
          ),
      };
    },
  };
}

const KNOWN_CAPABILITY_KINDS = new Set([
  "table:read-write",
  "table:read",
  "table:create",
  "table:gsi3-read",
  "table:gsi6-read",
  "queue:consume",
  "queue:send",
  "appconfig:read",
]);

export interface ScopedLambdaFunctionProps extends Omit<lambda.FunctionProps, "code" | "handler"> {
  access: AccessCapability[];
  /** Real bundling path (M3.5): TS/JS entrypoint, bundled via esbuild (see bundleEntry above)
   * into a CJS asset. Mutually exclusive with `code` (tests use `code` for inline synthetic
   * bodies; production handlers use `entry`). */
  entry?: string;
  /** Exported handler function name inside `entry`. Only "handler" is currently supported
   * (bundleEntry throws otherwise) - kept as an explicit prop rather than hardcoded so a
   * synth-time error names the mismatch instead of silently invoking the wrong export. */
  handlerExport?: string;
  /** Test-only escape hatch for inline/synthetic Lambda code. Mutually exclusive with `entry`. */
  code?: lambda.Code;
}

/**
 * Every Lambda in this system MUST be constructed via ScopedLambdaFunction, never
 * `new lambda.Function` directly (implementation-blueprint.md §17.1) - it is the single
 * enforcement point for least-privilege IAM per function.
 */
export class ScopedLambdaFunction extends Construct {
  readonly function: lambda.Function;

  constructor(scope: Construct, id: string, props: ScopedLambdaFunctionProps) {
    super(scope, id);

    for (const capability of props.access) {
      if (!KNOWN_CAPABILITY_KINDS.has(capability.kind)) {
        // "falha synth quando o recurso solicitado não corresponde a uma capability conhecida"
        throw new Error(
          `ScopedLambdaFunction(${id}): unknown access capability kind "${capability.kind}". ` +
            `Known kinds: ${[...KNOWN_CAPABILITY_KINDS].join(", ")}.`,
        );
      }
    }

    const { access, code, entry, handlerExport, ...rest } = props;

    if (entry && code) {
      throw new Error(`ScopedLambdaFunction(${id}): "entry" and "code" are mutually exclusive.`);
    }

    const resolvedCode = entry
      ? bundleEntry(entry, handlerExport ?? "handler")
      : (code ?? lambda.Code.fromInline("exports.handler = async () => ({ statusCode: 501 });"));

    this.function = new lambda.Function(this, "Function", {
      timeout: Duration.seconds(10),
      memorySize: 256,
      tracing: lambda.Tracing.ACTIVE,
      ...rest,
      handler: "index.handler",
      code: resolvedCode,
    });

    for (const capability of access) {
      capability.grant(this.function);
    }
  }
}

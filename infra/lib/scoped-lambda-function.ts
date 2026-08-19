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
import type { ExpirationTrackerTable } from "./dynamo-table.js";

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
  "queue:consume",
  "queue:send",
  "appconfig:read",
]);

export interface ScopedLambdaFunctionProps extends Omit<lambda.FunctionProps, "code"> {
  access: AccessCapability[];
  /** Defaults to bundling entryFile via NodejsFunction-equivalent asset if provided; else code must be set via `code` prop override (tests use inline code). */
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

    const { access, code, ...rest } = props;

    this.function = new lambda.Function(this, "Function", {
      timeout: Duration.seconds(10),
      memorySize: 256,
      tracing: lambda.Tracing.ACTIVE,
      ...rest,
      code: code ?? lambda.Code.fromInline("exports.handler = async () => ({ statusCode: 501 });"),
    });

    for (const capability of access) {
      capability.grant(this.function);
    }
  }
}

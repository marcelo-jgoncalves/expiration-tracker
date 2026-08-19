/**
 * Single-table DynamoDB construct — data-model.md §3 (GSI1-GSI6) + §"Governança do
 * single-table", on-demand billing per decisions-log.md D-014, PITR per
 * implementation-blueprint.md §17.2.
 *
 * GSI3 is the documented exception: its PK (GSI3PK) is deliberately NOT prefixed with
 * TENANT#tenantId (data-model.md §3 "única exceção... IAM do índice restrito
 * exclusivamente ao ReminderProducer"). This construct exposes a narrow
 * `grantGsi3ReadTo` method instead of a general grantReadData-on-GSI3 path, so callers
 * cannot accidentally give a tenant-facing function access to it.
 *
 * M3.5: GSI6 gains the same treatment for two specific global (non-tenant-prefixed) key
 * families - `WORKSTATE#CLAIMED`/`WORKSTATE#DST_PENDING` (reminder reconciliation
 * candidates) and `RECON#OUTBOX#PENDING` (outbox sweeper) - alongside its existing
 * tenant-scoped uses (retention/purge, upload slots, per docs/architecture/data-model.md
 * §"GSI6"). `docs/architecture/m3.5-runtime-design.md` fixes exactly two roles allowed to
 * query it: `ReminderReconciliation` and `OutboxSweeperReminderDispatch`. GSI6 is therefore
 * EXCLUDED from `tenantFacingResources()`/`grantReadWriteData`/`grantReadData` (same
 * treatment as GSI3) and exposed only via `grantGsi6ReadTo`.
 */
import { RemovalPolicy } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import type { IGrantable } from "aws-cdk-lib/aws-iam";

export interface ExpirationTrackerTableProps {
  /** RETAIN in real environments; DESTROY only for ephemeral/test stacks. */
  removalPolicy?: RemovalPolicy;
}

export class ExpirationTrackerTable extends Construct {
  readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: ExpirationTrackerTableProps = {}) {
    super(scope, id);

    this.table = new dynamodb.Table(this, "Table", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // D-014: on-demand
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true }, // §17.2
      encryption: dynamodb.TableEncryption.AWS_MANAGED, // CMK upgrade tracked as infra follow-up, see report
      removalPolicy: props.removalPolicy ?? RemovalPolicy.RETAIN,
      timeToLiveAttribute: "purgeAfterTtl", // auxiliary cleanup only, never operational trigger (data-model.md §3)
      // M3.5: NEW_IMAGE stream feeds DispatchOutboxRelay (docs/architecture/
      // m3.5-runtime-design.md "Decisão central: outbox durável") - it only needs the
      // post-write item shape, never the old image.
      stream: dynamodb.StreamViewType.NEW_IMAGE,
    });

    // GSI1 - vencimentos/dashboard: PK=TENANT#t#ITEMSTATUS#<status>, SK=DUE#<dueDate>#ITEM#i
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI1SK", type: dynamodb.AttributeType.STRING },
    });

    // GSI2 - responsável/categoria
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI2",
      partitionKey: { name: "GSI2PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI2SK", type: dynamodb.AttributeType.STRING },
    });

    // GSI3 - scheduler. Global PK (no tenantId), IAM-restricted to ReminderProducer only
    // (M2+ deliverable) - grantGsi3ReadTo below is the only exposed access path.
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI3",
      partitionKey: { name: "GSI3PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI3SK", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY, // minimal projection, no business content (data-model.md §3)
    });

    // GSI4 - membership por usuário: PK=TENANT#t#USER#u, SK=ORG#o#MEMBERSHIP#m
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI4",
      partitionKey: { name: "GSI4PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI4SK", type: dynamodb.AttributeType.STRING },
    });

    // GSI5 - provider callback
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI5",
      partitionKey: { name: "GSI5PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI5SK", type: dynamodb.AttributeType.STRING },
    });

    // GSI6 - retenção/reconciliação
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI6",
      partitionKey: { name: "GSI6PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI6SK", type: dynamodb.AttributeType.STRING },
    });
  }

  /**
   * Resource ARNs for every GSI EXCEPT GSI3 (data-model.md §3's isolation safeguard).
   *
   * M3 correction: CDK's built-in `Table.grantReadWriteData`/`grantReadData`/`grant()`
   * helpers always include a blanket `<tableArn>/index/*` resource whenever the table has
   * ANY index - there is no way to exclude a single GSI through them. Using those helpers
   * for tenant-facing functions would silently grant `dynamodb:Query` on GSI3 to every
   * such function, contradicting the documented safeguard ("IAM do índice restrito
   * exclusivamente ao ReminderProducer"). This construct therefore builds its own
   * PolicyStatements with an explicit resource list (base table + the 5 non-GSI3 indexes)
   * instead of delegating to those helpers.
   */
  private tenantFacingResources(): string[] {
    const indexNames = ["GSI1", "GSI2", "GSI4", "GSI5"];
    return [
      this.table.tableArn,
      ...indexNames.map((name) => `${this.table.tableArn}/index/${name}`),
    ];
  }

  private gsi3Resource(): string {
    return `${this.table.tableArn}/index/GSI3`;
  }

  private gsi6Resource(): string {
    return `${this.table.tableArn}/index/GSI6`;
  }

  /** General read/write grant on the base table + GSI1/GSI2/GSI4/GSI5 (tenant-scoped indexes). Never includes GSI3/GSI6 - see tenantFacingResources() above. */
  grantReadWriteData(grantee: IGrantable) {
    grantee.grantPrincipal.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          "dynamodb:BatchGetItem",
          "dynamodb:GetItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:BatchWriteItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:ConditionCheckItem",
          "dynamodb:DescribeTable",
        ],
        resources: this.tenantFacingResources(),
      }),
    );
    if (this.table.encryptionKey) {
      this.table.encryptionKey.grantEncryptDecrypt(grantee);
    }
  }

  grantReadData(grantee: IGrantable) {
    grantee.grantPrincipal.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:BatchGetItem", "dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:DescribeTable"],
        resources: this.tenantFacingResources(),
      }),
    );
    if (this.table.encryptionKey) {
      this.table.encryptionKey.grantDecrypt(grantee);
    }
  }

  /** The ONLY sanctioned way to read GSI3 - resource is the GSI3 index ARN exclusively (never the table or any other index), intended solely for the M3 ReminderProducer. test/infra/stack.test.ts's isolation test asserts no other function's synthesized IAM policy references this index. */
  grantGsi3ReadTo(grantee: IGrantable) {
    grantee.grantPrincipal.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:Query", "dynamodb:GetItem"],
        resources: [this.gsi3Resource()],
      }),
    );
    if (this.table.encryptionKey) {
      this.table.encryptionKey.grantDecrypt(grantee);
    }
  }

  /** The ONLY sanctioned way to read GSI6 - resource is the GSI6 index ARN exclusively.
   * `docs/architecture/m3.5-runtime-design.md` fixes exactly two callers:
   * `ReminderReconciliation` (WORKSTATE#CLAIMED/WORKSTATE#DST_PENDING candidates) and
   * `OutboxSweeperReminderDispatch` (RECON#OUTBOX#PENDING). test/infra/stack.test.ts's
   * isolation test asserts no other function's synthesized IAM policy references this index. */
  grantGsi6ReadTo(grantee: IGrantable) {
    grantee.grantPrincipal.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:Query", "dynamodb:GetItem"],
        resources: [this.gsi6Resource()],
      }),
    );
    if (this.table.encryptionKey) {
      this.table.encryptionKey.grantDecrypt(grantee);
    }
  }
}

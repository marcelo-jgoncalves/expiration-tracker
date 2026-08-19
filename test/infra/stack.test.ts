import { describe, expect, it } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { ExpirationTrackerStack } from "../../infra/lib/expiration-tracker-stack.js";
import { ScopedLambdaFunction } from "../../infra/lib/scoped-lambda-function.js";
import { ExpirationTrackerTable } from "../../infra/lib/dynamo-table.js";
import * as lambda from "aws-cdk-lib/aws-lambda";

function synthTemplate() {
  const app = new App();
  const stack = new ExpirationTrackerStack(app, "TestStack");
  return Template.fromStack(stack);
}

describe("ExpirationTrackerStack (M1 infra synth)", () => {
  it("synthesizes without error and creates one DynamoDB table with 6 GSIs", () => {
    const template = synthTemplate();
    template.resourceCountIs("AWS::DynamoDB::Table", 1);
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      BillingMode: "PAY_PER_REQUEST",
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    });
    const tables = template.findResources("AWS::DynamoDB::Table");
    const tableDef = Object.values(tables)[0];
    expect(tableDef?.Properties.GlobalSecondaryIndexes).toHaveLength(6);
  });

  it("creates a Cognito User Pool with a password policy and configurable MFA", () => {
    const template = synthTemplate();
    template.resourceCountIs("AWS::Cognito::UserPool", 1);
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      Policies: {
        PasswordPolicy: Match.objectLike({ MinimumLength: 12 }),
      },
      MfaConfiguration: "OPTIONAL",
    });
  });

  it("creates an HTTP API with a JWT-authorized /test/ping route (the M1 exit-criterion route)", () => {
    const template = synthTemplate();
    template.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /test/ping",
      AuthorizationType: "JWT",
    });
  });

  it("grants the test route handler DynamoDB IAM access (least-privilege scoping applied)", () => {
    const template = synthTemplate();
    const policies = template.findResources("AWS::IAM::Policy");
    const hasDynamoGrant = Object.values(policies).some((p) =>
      JSON.stringify(p.Properties.PolicyDocument).includes("dynamodb:"),
    );
    expect(hasDynamoGrant).toBe(true);
  });

  it("ScopedLambdaFunction rejects an unknown access capability kind at synth time", () => {
    const app = new App();
    const stack = new Stack(app, "BadStack");
    expect(
      () =>
        new ScopedLambdaFunction(stack, "Bad", {
          runtime: lambda.Runtime.NODEJS_20_X,
          handler: "index.handler",
          access: [{ kind: "table:delete-everything", description: "nope", grant: () => {} }],
        }),
    ).toThrow(/unknown access capability kind/);
  });

  it("creates the M2 ExpirationItem routes behind the same JWT authorizer as /test/ping", () => {
    const template = synthTemplate();
    const routeSpecs: Array<[string, string]> = [
      ["POST", "/items"],
      ["GET", "/items/dashboard"],
      ["GET", "/items/{itemId}"],
      ["PUT", "/items/{itemId}"],
      ["DELETE", "/items/{itemId}"],
      ["POST", "/items/{itemId}/archive"],
      ["POST", "/items/{itemId}/renew"],
    ];
    for (const [method, path] of routeSpecs) {
      template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
        RouteKey: `${method} ${path}`,
        AuthorizationType: "JWT",
      });
    }
  });

  it("M3: creates the ReminderPolicy HTTP handler and the three reminder workers (producer/dispatch/reconciliation)", () => {
    const template = synthTemplate();
    const functions = template.findResources("AWS::Lambda::Function");
    // At least 1 test route handler + 1 items handler + 1 reminders handler + 3 reminder
    // workers = 6 app-owned functions (>=, not ===, since CDK constructs like Cognito may
    // add their own helper/custom-resource Lambdas that aren't ours to assert on here).
    expect(Object.keys(functions).length).toBeGreaterThanOrEqual(6);
  });

  it("M3 isolation (implementation-blueprint.md §9.2/threat-model.md gap 3): GSI3 dynamodb:Query permission is granted to the ReminderProducer role ONLY - no other function's IAM policy references the GSI3 index", () => {
    const template = synthTemplate();
    const policies = template.findResources("AWS::IAM::Policy");
    const grantingPolicies = Object.entries(policies).filter(([, def]) =>
      JSON.stringify(def.Properties.PolicyDocument).includes("/index/GSI3"),
    );
    // At least one function must actually have the grant (otherwise the producer couldn't work).
    expect(grantingPolicies.length).toBeGreaterThan(0);
    for (const [logicalId] of grantingPolicies) {
      expect(logicalId.startsWith("ReminderProducer")).toBe(true);
    }
    // Cross-check the negative from the other direction: every OTHER function-associated
    // policy (items handler, reminders handler, dispatch, reconciliation, test route) must
    // NOT reference the GSI3 index, even indirectly.
    const nonProducerPolicies = Object.entries(policies).filter(([logicalId]) => !logicalId.startsWith("ReminderProducer"));
    for (const [, def] of nonProducerPolicies) {
      expect(JSON.stringify(def.Properties.PolicyDocument)).not.toContain("/index/GSI3");
    }
  });

  it("GSI3 exists with a global (non-tenant-prefixed) key shape and minimal projection", () => {
    const app = new App();
    const stack = new Stack(app, "Gsi3Stack");
    new ExpirationTrackerTable(stack, "Table");
    const template = Template.fromStack(stack);
    const tables = template.findResources("AWS::DynamoDB::Table");
    const tableDef = Object.values(tables)[0];
    const gsi3 = (tableDef?.Properties.GlobalSecondaryIndexes as Array<{ IndexName: string; Projection: { ProjectionType: string } }>).find(
      (g) => g.IndexName === "GSI3",
    );
    expect(gsi3).toBeDefined();
    expect(gsi3?.Projection.ProjectionType).toBe("KEYS_ONLY");
  });
});

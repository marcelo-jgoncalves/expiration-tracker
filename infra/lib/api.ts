/**
 * API Gateway HTTP API skeleton — M1 deliverable #7. One real authenticated route
 * (GET /test/ping) wired through a Cognito JWT authorizer + the ScopedLambdaFunction
 * carrying resolver+authz+quota (src/modules/identity/http/test-route-handler.ts).
 * This is the milestone's exit-criterion route.
 */
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Construct } from "constructs";
import type { ScopedLambdaFunction } from "./scoped-lambda-function.js";
import type { ExpirationTrackerAuth } from "./cognito.js";

export interface ExpirationTrackerApiProps {
  auth: ExpirationTrackerAuth;
  testRouteHandler: ScopedLambdaFunction;
  /** M2 deliverable: CRUD/renew/dashboard routes for ExpirationItem, all behind the same
   * JWT authorizer as /test/ping. One Lambda handles every route (Lambda-monolith
   * architecture per the project's stated approach), consistent with §17.1's
   * least-privilege construct - it's the routing table, not the IAM boundary, that's
   * per-module. */
  itemsHandler?: ScopedLambdaFunction;
  /** M3.5: policy CRUD routes, wired the moment the handler is real (was unreachable while
   * the handler was still an inline 501 placeholder). */
  remindersHandler?: ScopedLambdaFunction;
}

export class ExpirationTrackerApi extends Construct {
  readonly httpApi: apigwv2.HttpApi;

  constructor(scope: Construct, id: string, props: ExpirationTrackerApiProps) {
    super(scope, id);

    this.httpApi = new apigwv2.HttpApi(this, "HttpApi", {
      description: "Expiration Tracker API skeleton (M1)",
      corsPreflight: {
        allowOrigins: ["https://app.example.invalid"], // placeholder - real frontend origin set once domain exists (not decided in M1)
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST],
        allowCredentials: true, // BFF cookie-based session (§4.2) requires credentialed CORS
        allowHeaders: ["Content-Type", "Authorization"],
      },
    });

    const authorizer = new authorizers.HttpJwtAuthorizer(
      "JwtAuthorizer",
      `https://cognito-idp.${props.auth.userPool.stack.region}.amazonaws.com/${props.auth.userPool.userPoolId}`,
      {
        jwtAudience: [props.auth.userPoolClient.userPoolClientId],
      },
    );

    this.httpApi.addRoutes({
      path: "/test/ping",
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration("TestPingIntegration", props.testRouteHandler.function),
      authorizer,
    });

    if (props.itemsHandler) {
      const itemsIntegration = new integrations.HttpLambdaIntegration("ItemsIntegration", props.itemsHandler.function);

      this.httpApi.addRoutes({ path: "/items", methods: [apigwv2.HttpMethod.POST], integration: itemsIntegration, authorizer });
      this.httpApi.addRoutes({ path: "/items/dashboard", methods: [apigwv2.HttpMethod.GET], integration: itemsIntegration, authorizer });
      this.httpApi.addRoutes({ path: "/items/{itemId}", methods: [apigwv2.HttpMethod.GET], integration: itemsIntegration, authorizer });
      this.httpApi.addRoutes({ path: "/items/{itemId}", methods: [apigwv2.HttpMethod.PUT], integration: itemsIntegration, authorizer });
      this.httpApi.addRoutes({ path: "/items/{itemId}", methods: [apigwv2.HttpMethod.DELETE], integration: itemsIntegration, authorizer });
      this.httpApi.addRoutes({ path: "/items/{itemId}/archive", methods: [apigwv2.HttpMethod.POST], integration: itemsIntegration, authorizer });
      this.httpApi.addRoutes({ path: "/items/{itemId}/renew", methods: [apigwv2.HttpMethod.POST], integration: itemsIntegration, authorizer });
    }

    if (props.remindersHandler) {
      const remindersIntegration = new integrations.HttpLambdaIntegration("RemindersIntegration", props.remindersHandler.function);

      this.httpApi.addRoutes({ path: "/reminders/policies", methods: [apigwv2.HttpMethod.POST], integration: remindersIntegration, authorizer });
      this.httpApi.addRoutes({ path: "/reminders/policies/{policyId}", methods: [apigwv2.HttpMethod.GET], integration: remindersIntegration, authorizer });
      this.httpApi.addRoutes({ path: "/reminders/policies/{policyId}", methods: [apigwv2.HttpMethod.PUT], integration: remindersIntegration, authorizer });
      this.httpApi.addRoutes({ path: "/reminders/policies/{policyId}/disable", methods: [apigwv2.HttpMethod.POST], integration: remindersIntegration, authorizer });
    }
  }
}

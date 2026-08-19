#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { ExpirationTrackerStack } from "../lib/expiration-tracker-stack.js";

const app = new App();

// AWS region for PRODUCTION is a documented pending external decision (NEXT_SESSION_PROMPT.md
// item 7, blocking for LGPD/international transfer) - NOT decided here. The `dev` stack below
// is an explicit, user-confirmed exception for a throwaway development/validation environment
// only (2026-08-19: "esse ambiente é de dev então pode ficar na n virginia") - us-east-1,
// never treated as the production region decision. A future prod stack must set its own env
// once the real region is decided, not inherit this one.
const devAccount = process.env["CDK_DEFAULT_ACCOUNT"];
new ExpirationTrackerStack(app, "ExpirationTrackerStack-Dev", {
  env: { account: devAccount, region: "us-east-1" },
  schedulesEnabled: true,
});

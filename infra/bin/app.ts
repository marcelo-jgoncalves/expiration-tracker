#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { ExpirationTrackerStack } from "../lib/expiration-tracker-stack.js";

const app = new App();
new ExpirationTrackerStack(app, "ExpirationTrackerStack-M1", {
  // AWS region is a documented pending external decision (NEXT_SESSION_PROMPT.md item 5,
  // blocking for LGPD/international transfer) - env left unset so `cdk synth` stays
  // region/account-agnostic until that decision lands.
});

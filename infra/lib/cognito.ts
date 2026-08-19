/**
 * Cognito User Pool — M1 deliverable #1. MFA: UNK-006 ("MFA obrigatório vs. opcional")
 * is explicitly listed as pending external research in NEXT_SESSION_PROMPT.md item 5 and
 * is NOT a blocker for M1 per that same doc - implemented here as a configurable prop
 * (default OPTIONAL, never hardcoded to OFF/REQUIRED) so enabling REQUIRED later is a
 * one-line prop change, not a rewrite.
 */
import * as cognito from "aws-cdk-lib/aws-cognito";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";

export type MfaPolicy = "OFF" | "OPTIONAL" | "REQUIRED";

export interface ExpirationTrackerAuthProps {
  /** UNK-006 still pending external research - default OPTIONAL, override once decided. */
  mfaPolicy?: MfaPolicy;
  removalPolicy?: RemovalPolicy;
}

const MFA_MAP: Record<MfaPolicy, cognito.Mfa> = {
  OFF: cognito.Mfa.OFF,
  OPTIONAL: cognito.Mfa.OPTIONAL,
  REQUIRED: cognito.Mfa.REQUIRED,
};

export class ExpirationTrackerAuth extends Construct {
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: ExpirationTrackerAuthProps = {}) {
    super(scope, id);

    const mfaPolicy = props.mfaPolicy ?? "OPTIONAL";

    this.userPool = new cognito.UserPool(this, "UserPool", {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: false },
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      mfa: MFA_MAP[mfaPolicy],
      mfaSecondFactor: { sms: false, otp: true }, // TOTP only - avoids SMS provider/cost dependency (COST/SEC judgment call, see report)
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: props.removalPolicy ?? RemovalPolicy.RETAIN,
      deviceTracking: {
        challengeRequiredOnNewDevice: true,
        deviceOnlyRememberedOnUserPrompt: true,
      },
    });

    this.userPoolClient = this.userPool.addClient("WebClient", {
      authFlows: { userSrp: true },
      generateSecret: true, // BFF session pattern (§4.2): client secret held server-side only, never in the browser
      // Access token short-lived per blueprint §4.2 (5-15 min target); refresh rotation
      // + reuse detection is enforced by the BFF /session/refresh endpoint (M1's session
      // module), not by Cognito's own (non-rotating) refresh token alone.
      accessTokenValidity: Duration.minutes(15),
      idTokenValidity: Duration.minutes(15),
      refreshTokenValidity: Duration.days(30),
      preventUserExistenceErrors: true,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
      },
    });
  }
}

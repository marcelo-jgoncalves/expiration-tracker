/**
 * RequestContext — implementation-blueprint.md §4.1. The single, immutable object every
 * authenticated handler receives; no handler/repository accepts tenantId/userId/roles
 * from a client DTO (blueprint §4.1: "O router remove ou rejeita tenantId, userId, roles
 * e membershipId fornecidos pelo cliente").
 */
export interface RequestContext {
  readonly requestId: string;
  readonly correlationId: string;
  readonly principal: {
    readonly userId: string;
    readonly cognitoSubject: string; // in-memory only; never logged (see redactor corpus)
    readonly sessionId: string;
    readonly deviceId?: string;
  };
  readonly tenant: {
    readonly tenantId: string;
    readonly membershipId?: string;
    readonly roles: string[];
  };
  readonly auth: {
    readonly issuedAt: string;
    readonly expiresAt: string;
    readonly tokenId: string;
  };
}

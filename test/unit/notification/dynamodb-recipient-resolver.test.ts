/**
 * Wave B2B-11 (Responsibility + Notifications): DynamoDbNotificationRecipientResolver migrated
 * from `UserProfile` (vestigial for authorization since B2B-5) to `Membership`+`GlobalUser`, the
 * real authority on tenant access under the B2B model. Adapter-level test - a fake
 * DynamoDBDocumentClient responding to real GetCommand Keys, same pattern as
 * test/unit/extraction/dynamodb-extracted-field-store.test.ts.
 */
import { describe, expect, it } from "vitest";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDbNotificationRecipientResolver } from "../../../src/modules/notification/persistence/dynamodb-recipient-resolver.js";
import { membershipKey } from "../../../src/modules/organization/domain/membership.js";
import { globalUserKey } from "../../../src/modules/identity/persistence/global-user-repository.js";

const TABLE = "MainTable";

function makeClient(items: Map<string, Record<string, unknown>>) {
  const client = {
    async send(command: { input: { Key: { PK: string; SK: string } } }) {
      const key = `${command.input.Key.PK}#${command.input.Key.SK}`;
      return { Item: items.get(key) };
    },
  } as unknown as DynamoDBDocumentClient;
  return client;
}

function keyOf(key: { PK: string; SK: string }): string {
  return `${key.PK}#${key.SK}`;
}

describe("DynamoDbNotificationRecipientResolver", () => {
  it("returns undefined (RECIPIENT_NOT_FOUND) when no Membership exists for this (tenantId, candidateUserId) pair", async () => {
    const client = makeClient(new Map());
    const resolver = new DynamoDbNotificationRecipientResolver(client, TABLE);

    const result = await resolver.resolve({ tenantId: "org-1", candidateUserId: "user-1" });

    expect(result).toBeUndefined();
  });

  it("returns active:true when Membership is ACTIVE and GlobalUser.identityStatus is ACTIVE", async () => {
    const items = new Map<string, Record<string, unknown>>([
      [keyOf(membershipKey("org-1", "user-1")), { entityType: "Membership", userId: "user-1", organizationId: "org-1", status: "ACTIVE" }],
      [keyOf(globalUserKey("user-1")), { entityType: "GlobalUser", userId: "user-1", identityStatus: "ACTIVE" }],
    ]);
    const resolver = new DynamoDbNotificationRecipientResolver(makeClient(items), TABLE);

    const result = await resolver.resolve({ tenantId: "org-1", candidateUserId: "user-1" });

    expect(result).toEqual({ userId: "user-1", tenantId: "org-1", active: true });
  });

  // Mutação: checar só Membership.status (sem GlobalUser.identityStatus) faria este teste falhar -
  // achado real da Rodada 2 do Codex (resolve-request-context.ts já aplica a mesma regra dupla
  // para autenticação normal, esta wave estende para elegibilidade de notificação).
  it("returns active:false (RECIPIENT_NOT_ELIGIBLE) when Membership is ACTIVE but GlobalUser is SUSPENDED - never undefined", async () => {
    const items = new Map<string, Record<string, unknown>>([
      [keyOf(membershipKey("org-1", "user-1")), { entityType: "Membership", userId: "user-1", organizationId: "org-1", status: "ACTIVE" }],
      [keyOf(globalUserKey("user-1")), { entityType: "GlobalUser", userId: "user-1", identityStatus: "SUSPENDED" }],
    ]);
    const resolver = new DynamoDbNotificationRecipientResolver(makeClient(items), TABLE);

    const result = await resolver.resolve({ tenantId: "org-1", candidateUserId: "user-1" });

    expect(result).toEqual({ userId: "user-1", tenantId: "org-1", active: false });
  });

  it("returns active:false when Membership itself is SUSPENDED, even with an ACTIVE GlobalUser", async () => {
    const items = new Map<string, Record<string, unknown>>([
      [keyOf(membershipKey("org-1", "user-1")), { entityType: "Membership", userId: "user-1", organizationId: "org-1", status: "SUSPENDED" }],
      [keyOf(globalUserKey("user-1")), { entityType: "GlobalUser", userId: "user-1", identityStatus: "ACTIVE" }],
    ]);
    const resolver = new DynamoDbNotificationRecipientResolver(makeClient(items), TABLE);

    const result = await resolver.resolve({ tenantId: "org-1", candidateUserId: "user-1" });

    expect(result).toEqual({ userId: "user-1", tenantId: "org-1", active: false });
  });

  it("returns active:false when Membership is REMOVED", async () => {
    const items = new Map<string, Record<string, unknown>>([
      [keyOf(membershipKey("org-1", "user-1")), { entityType: "Membership", userId: "user-1", organizationId: "org-1", status: "REMOVED" }],
      [keyOf(globalUserKey("user-1")), { entityType: "GlobalUser", userId: "user-1", identityStatus: "ACTIVE" }],
    ]);
    const resolver = new DynamoDbNotificationRecipientResolver(makeClient(items), TABLE);

    const result = await resolver.resolve({ tenantId: "org-1", candidateUserId: "user-1" });

    expect(result).toEqual({ userId: "user-1", tenantId: "org-1", active: false });
  });
});

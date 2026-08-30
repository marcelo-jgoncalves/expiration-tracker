/** Composition root for the expiration module against real DynamoDB (M3.5). */
import { GetCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDbExpirationStore } from "../../../modules/expiration/persistence/dynamodb-expiration-store.js";
import { ExpirationService } from "../../../modules/expiration/application/expiration-service.js";
import { ItemWatchService } from "../../../modules/expiration/application/item-watch-service.js";
import type { MemberEligibilityChecker } from "../../../modules/expiration/ports/member-eligibility.js";
import { membershipKey, type Membership } from "../../../modules/organization/domain/membership.js";
import { globalUserKey } from "../../../modules/identity/persistence/global-user-repository.js";
import { UlidIdGenerator } from "../ids.js";

/** Wave B2B-11 (Responsibility + Notifications): same 2-condition eligibility rule as
 * `notification/persistence/dynamodb-recipient-resolver.ts` (Membership ACTIVE in this
 * Organization AND GlobalUser identityStatus ACTIVE) - deliberately a THIN adapter directly
 * against the shared main table (both entities live there) rather than pulling in
 * `DynamoDbOrganizationStore`/`GlobalUserRepository`'s full port surface for a single read each. */
function buildMemberEligibilityChecker(client: DynamoDBDocumentClient, tableName: string): MemberEligibilityChecker {
  return {
    async isEligibleMember(organizationId: string, userId: string): Promise<boolean> {
      const [membershipResult, globalUserResult] = await Promise.all([
        client.send(new GetCommand({ TableName: tableName, Key: membershipKey(organizationId, userId), ConsistentRead: true })),
        client.send(new GetCommand({ TableName: tableName, Key: globalUserKey(userId), ConsistentRead: true })),
      ]);
      const membership = membershipResult.Item as Membership | undefined;
      const globalUser = globalUserResult.Item as { identityStatus?: string } | undefined;
      return membership?.status === "ACTIVE" && globalUser?.identityStatus === "ACTIVE";
    },
  };
}

export function buildExpirationDeps(client: DynamoDBDocumentClient, tableName: string) {
  const store = new DynamoDbExpirationStore(client, tableName);
  const ids = new UlidIdGenerator();
  const members = buildMemberEligibilityChecker(client, tableName);
  const expiration = new ExpirationService({ store, tableName, ids, members });
  // D-040 (07-domain-model-escalation-watchers-digest.md): reaproveita o mesmo store, nunca
  // muta o agregado ExpirationItem.
  const watches = new ItemWatchService({ store, tableName, members });
  return { store, expiration, watches };
}

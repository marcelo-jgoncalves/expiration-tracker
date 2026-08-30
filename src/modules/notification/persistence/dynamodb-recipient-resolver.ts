/**
 * Real DynamoDB implementation of NotificationRecipientResolver (M4, migrated Wave B2B-11).
 *
 * Wave B2B-11 (Responsibility + Notifications, `docs/architecture/reviews/
 * multi-user-b2b-wave-b2b11-scoping/`, Claude 9.2/Codex 9.2, 3 rounds): migrated from `UserProfile`
 * (vestigial for authorization since B2B-5/D-095 - `identity/persistence/user-repository.ts`'s own
 * header comment) to `Membership`, the real authority on tenant access under the B2B model.
 *
 * Eligibility requires BOTH `Membership.status === "ACTIVE"` (this Organization specifically) AND
 * `GlobalUser.identityStatus === "ACTIVE"` (Round 3 finding: a Membership can remain ACTIVE while
 * the person's GLOBAL identity has since been suspended - `resolve-request-context.ts` already
 * enforces this same two-layer check for normal request authentication). The 2-state distinction
 * this resolver already provided is preserved deliberately: `Membership` never existed for this
 * `(tenantId, candidateUserId)` pair -> `undefined` (RECIPIENT_NOT_FOUND, "not a member of this
 * Organization"); `Membership` exists but either condition above fails -> `active: false`
 * (RECIPIENT_NOT_ELIGIBLE, "is/was a member, not eligible right now") - never collapsed into a
 * single state, so the router's existing cancellation-reason distinction stays meaningful.
 */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import type { NotificationRecipientResolver, ResolvedRecipient } from "../ports/recipient-resolver.js";
import { mapDynamoError } from "../../../shared/dynamodb/sdk-errors.js";
import { membershipKey, type Membership } from "../../organization/domain/membership.js";
import { globalUserKey, type GlobalUser } from "../../identity/persistence/global-user-repository.js";

export class DynamoDbNotificationRecipientResolver implements NotificationRecipientResolver {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async resolve(input: { tenantId: string; candidateUserId: string }): Promise<ResolvedRecipient | undefined> {
    let membership: Membership | undefined;
    let globalUser: GlobalUser | undefined;
    try {
      const [membershipResult, globalUserResult] = await Promise.all([
        this.client.send(new GetCommand({ TableName: this.tableName, Key: membershipKey(input.tenantId, input.candidateUserId), ConsistentRead: true })),
        this.client.send(new GetCommand({ TableName: this.tableName, Key: globalUserKey(input.candidateUserId), ConsistentRead: true })),
      ]);
      membership = membershipResult.Item as Membership | undefined;
      globalUser = globalUserResult.Item as GlobalUser | undefined;
    } catch (err) {
      throw mapDynamoError(err, "NotificationRecipientResolver.resolve");
    }

    if (!membership) return undefined; // never a member of this Organization - RECIPIENT_NOT_FOUND
    const active = membership.status === "ACTIVE" && globalUser?.identityStatus === "ACTIVE";
    return { userId: membership.userId, tenantId: membership.organizationId, active };
  }
}

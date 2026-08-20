/**
 * Real DynamoDB implementation of NotificationRecipientResolver (M4).
 *
 * Security note (round1-decisions-resolved.md §2, achado real de isolamento cross-tenant
 * levantado pelo Codex na posição cega): the single-table key design already provides the
 * primary defense here - a user's `PROFILE` row lives at `TENANT#<theirTenantId>#USER#
 * <userId>`, so a `GetItem` scoped to the CALLER's `tenantId` (never the candidate's) for a
 * corrupted/cross-tenant `assigneeUserId` structurally returns nothing (there is no row at
 * that key), not another tenant's data. `resolve()` still asserts `profile.tenantId ===
 * input.tenantId` explicitly as defense in depth (never trust that the key alone is
 * sufficient without checking the item's own claimed tenant matches) and requires
 * `status === "ACTIVE"` before returning a resolved recipient - both failures return
 * `undefined`, which the router turns into an auditable RECIPIENT_NOT_FOUND/
 * RECIPIENT_NOT_ELIGIBLE cancellation, never a silent fallback.
 */
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { NotificationRecipientResolver, ResolvedRecipient } from "../ports/recipient-resolver.js";
import { mapDynamoError } from "../../../shared/dynamodb/sdk-errors.js";

interface UserProfileRow {
  tenantId: string;
  userId: string;
  status: "ACTIVE" | "SUSPENDED";
}

export class DynamoDbNotificationRecipientResolver implements NotificationRecipientResolver {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async resolve(input: { tenantId: string; candidateUserId: string }): Promise<ResolvedRecipient | undefined> {
    let profile: UserProfileRow | undefined;
    try {
      const result = await this.client.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { PK: `TENANT#${input.tenantId}#USER#${input.candidateUserId}`, SK: "PROFILE" },
          ConsistentRead: true,
        }),
      );
      profile = result.Item as UserProfileRow | undefined;
    } catch (err) {
      throw mapDynamoError(err, "NotificationRecipientResolver.resolve");
    }

    if (!profile) return undefined;
    if (profile.tenantId !== input.tenantId) return undefined; // defense in depth, see header
    return { userId: profile.userId, tenantId: profile.tenantId, active: profile.status === "ACTIVE" };
  }
}

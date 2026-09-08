/** Real DynamoDB adapter for `GuestCredentialDeliveryMarkerStore` (D-233, revises D-228's
 * original boolean `claim()`). Writes into the SAME dedicated `guest-credential-delivery` table
 * `GuestCredentialDeliveryRecord` lives in (never the main table), under the record's own `PK`
 * (`DOCREQUEST#<id>#GEN#<gen>`), distinct `SK` (`DELIVERED`) - same key discipline the original
 * adapter established. Needs `PutItem`/`UpdateItem`/`DeleteItem` on this table now (D-233 also
 * fixes a latent IAM gap: the handler's role only ever had `GetItem`/stream-read actions, so the
 * original `claim()`'s `PutItem` had no grant at all - see `infra/main.tf`'s
 * `guest_credential_delivery_marker_write` policy). */
import { randomUUID } from "node:crypto";
import { PutCommand, UpdateCommand, DeleteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { guestCredentialDeliveryKey } from "../domain/guest-credential-delivery.js";
import { isConditionalCheckFailed, mapDynamoError } from "../../../shared/dynamodb/sdk-errors.js";
import type { GuestCredentialDeliveryClaimResult, GuestCredentialDeliveryMarkerStore } from "../ports/guest-credential-delivery-marker-store.js";

const MARKER_SK = "DELIVERED";

export class DynamoDbGuestCredentialDeliveryMarkerStore implements GuestCredentialDeliveryMarkerStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly deliveryTableName: string,
  ) {}

  async claim(documentRequestId: string, issuanceGeneration: number, now: string, leaseExpiresAt: string): Promise<GuestCredentialDeliveryClaimResult> {
    const { PK } = guestCredentialDeliveryKey(documentRequestId, issuanceGeneration);
    const claimId = randomUUID();
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.deliveryTableName,
          Item: {
            PK,
            SK: MARKER_SK,
            entityType: "GuestCredentialDeliveryMarker",
            documentRequestId,
            issuanceGeneration,
            status: "CLAIMED",
            claimId,
            leaseExpiresAt,
            createdAt: now,
            updatedAt: now,
          },
          ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        }),
      );
      return { outcome: "CLAIMED", claimId };
    } catch (err) {
      if (!isConditionalCheckFailed(err)) throw mapDynamoError(err, "GuestCredentialDeliveryMarkerStore.claim");
    }

    // Item already exists - read the reconciliation path via a conditional Update attempt
    // rather than a separate GetItem: avoids a read-then-write race window entirely.
    return this.reconcileExistingMarker(PK, now);
  }

  private async reconcileExistingMarker(PK: string, now: string): Promise<GuestCredentialDeliveryClaimResult> {
    // Attempt: item is CLAIMED with an EXPIRED lease -> reconcile to SEND_UNCERTAIN (never a
    // fresh claim). This is the ONLY automatic transition claim() itself performs.
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.deliveryTableName,
          Key: { PK, SK: MARKER_SK },
          ConditionExpression: "#status = :claimed AND leaseExpiresAt < :now",
          UpdateExpression: "SET #status = :uncertain, failureKind = :ambiguous, updatedAt = :now",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":claimed": "CLAIMED", ":uncertain": "SEND_UNCERTAIN", ":ambiguous": "AMBIGUOUS", ":now": now },
        }),
      );
      return { outcome: "PREVIOUSLY_UNCERTAIN", failureKind: "AMBIGUOUS" };
    } catch (err) {
      if (!isConditionalCheckFailed(err)) throw mapDynamoError(err, "GuestCredentialDeliveryMarkerStore.claim(reconcile-expired-lease)");
    }

    // Not an expired CLAIMED lease - read the actual current status to classify the outcome.
    // A plain GetItem here is safe (no write), used only to report the right outcome kind.
    const current = await this.client.send(new GetCommand({ TableName: this.deliveryTableName, Key: { PK, SK: MARKER_SK }, ConsistentRead: true }));
    const item = current.Item as { status?: string; failureKind?: string; leaseExpiresAt?: string } | undefined;
    if (!item || item.status === "DELIVERED") return { outcome: "ALREADY_DELIVERED" };
    if (item.status === "SEND_UNCERTAIN") return { outcome: "PREVIOUSLY_UNCERTAIN", failureKind: item.failureKind ?? "AMBIGUOUS" };
    // status === "CLAIMED" with a still-valid lease (the expired-lease Update above lost the
    // race against this exact check, or genuinely still valid) - another invocation owns it.
    return { outcome: "LEASE_ACTIVE" };
  }

  async markDelivered(documentRequestId: string, issuanceGeneration: number, claimId: string, now: string): Promise<void> {
    const { PK } = guestCredentialDeliveryKey(documentRequestId, issuanceGeneration);
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.deliveryTableName,
          Key: { PK, SK: MARKER_SK },
          ConditionExpression: "#status = :claimed AND claimId = :claimId",
          UpdateExpression: "SET #status = :delivered, updatedAt = :now REMOVE leaseExpiresAt",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":claimed": "CLAIMED", ":claimId": claimId, ":delivered": "DELIVERED", ":now": now },
        }),
      );
    } catch (err) {
      if (isConditionalCheckFailed(err)) return; // idempotent - already resolved by another invocation.
      throw mapDynamoError(err, "GuestCredentialDeliveryMarkerStore.markDelivered");
    }
  }

  async releaseClaim(documentRequestId: string, issuanceGeneration: number, claimId: string): Promise<void> {
    const { PK } = guestCredentialDeliveryKey(documentRequestId, issuanceGeneration);
    try {
      await this.client.send(
        new DeleteCommand({
          TableName: this.deliveryTableName,
          Key: { PK, SK: MARKER_SK },
          ConditionExpression: "#status = :claimed AND claimId = :claimId",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":claimed": "CLAIMED", ":claimId": claimId },
        }),
      );
    } catch (err) {
      if (isConditionalCheckFailed(err)) return; // a newer invocation already reclaimed/resolved it.
      throw mapDynamoError(err, "GuestCredentialDeliveryMarkerStore.releaseClaim");
    }
  }

  async markUncertain(documentRequestId: string, issuanceGeneration: number, claimId: string, failureKind: string, now: string): Promise<void> {
    const { PK } = guestCredentialDeliveryKey(documentRequestId, issuanceGeneration);
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.deliveryTableName,
          Key: { PK, SK: MARKER_SK },
          ConditionExpression: "#status = :claimed AND claimId = :claimId",
          UpdateExpression: "SET #status = :uncertain, failureKind = :failureKind, updatedAt = :now",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":claimed": "CLAIMED", ":claimId": claimId, ":uncertain": "SEND_UNCERTAIN", ":failureKind": failureKind, ":now": now },
        }),
      );
    } catch (err) {
      if (isConditionalCheckFailed(err)) return; // idempotent - already resolved by another invocation.
      throw mapDynamoError(err, "GuestCredentialDeliveryMarkerStore.markUncertain");
    }
  }
}

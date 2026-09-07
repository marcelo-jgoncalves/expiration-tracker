/** Real DynamoDB adapter for `GuestCredentialDeliveryMarkerStore` (D-228). Writes into the
 * SAME dedicated `guest-credential-delivery` table `GuestCredentialDeliveryRecord` lives in
 * (never the main table) — a conditional Put under the record's own `PK`
 * (`DOCREQUEST#<id>#GEN#<gen>`), distinct `SK` (`DELIVERED`), mirroring the exact
 * `attribute_not_exists(PK) AND attribute_not_exists(SK)` idempotent-create discipline
 * `DynamoDbDocumentArchiveStore.putIfAbsent` already uses on the main table. */
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { guestCredentialDeliveryKey } from "../domain/guest-credential-delivery.js";
import { isConditionalCheckFailed, mapDynamoError } from "../../../shared/dynamodb/sdk-errors.js";
import type { GuestCredentialDeliveryMarkerStore } from "../ports/guest-credential-delivery-marker-store.js";

export class DynamoDbGuestCredentialDeliveryMarkerStore implements GuestCredentialDeliveryMarkerStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly deliveryTableName: string,
  ) {}

  async claim(documentRequestId: string, issuanceGeneration: number, now: string): Promise<boolean> {
    const { PK } = guestCredentialDeliveryKey(documentRequestId, issuanceGeneration);
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.deliveryTableName,
          Item: { PK, SK: "DELIVERED", entityType: "GuestCredentialDeliveryMarker", documentRequestId, issuanceGeneration, createdAt: now },
          ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw mapDynamoError(err, "GuestCredentialDeliveryMarkerStore.claim");
    }
  }
}

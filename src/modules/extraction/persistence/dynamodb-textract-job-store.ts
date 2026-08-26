/** Real DynamoDB adapter for `TextractJobStore`. Uses the shared single table (main
 * `TABLE_NAME`) — `TextractJob` is keyed by `jobId` alone (see domain/textract-job.ts's own
 * doc comment on why), never tenant-scoped, so this adapter never needs a tenant argument. */
import { PutCommand, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { TextractJobStore } from "../ports/textract-job-store.js";
import { textractJobKey, type TextractJob } from "../domain/textract-job.js";
import { isConditionalCheckFailed, mapDynamoError } from "../../../shared/dynamodb/sdk-errors.js";

export class DynamoDbTextractJobStore implements TextractJobStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  key(jobId: string): EntityKey {
    return textractJobKey(jobId);
  }

  async create(job: TextractJob): Promise<void> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: job,
          ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        }),
      );
    } catch (err) {
      throw mapDynamoError(err, "TextractJobStore.create");
    }
  }

  async getByJobId(jobId: string): Promise<TextractJob | null> {
    try {
      const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: this.key(jobId) }));
      return (result.Item as TextractJob | undefined) ?? null;
    } catch (err) {
      throw mapDynamoError(err, "TextractJobStore.getByJobId");
    }
  }

  /** No `tenantId` equality check here (unlike `buildVersionedUpdate`'s usual tenant-scoped
   * convention) — `TextractJob` is deliberately not tenant-scoped (see domain doc comment), so
   * the only fencing fact available is `version` itself. */
  async updateConditional(job: TextractJob, expected: { version: number }): Promise<boolean> {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: this.key(job.jobId),
          ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK) AND #version = :expectedVersion",
          UpdateExpression: job.taskTokenCiphertext === undefined ? "SET #status = :status, #updatedAt = :updatedAt, #version = :newVersion REMOVE #taskTokenCiphertext" : "SET #status = :status, #updatedAt = :updatedAt, #version = :newVersion, #taskTokenCiphertext = :taskTokenCiphertext",
          ExpressionAttributeNames: {
            "#version": "version",
            "#status": "status",
            "#updatedAt": "updatedAt",
            "#taskTokenCiphertext": "taskTokenCiphertext",
          },
          ExpressionAttributeValues: {
            ":expectedVersion": expected.version,
            ":status": job.status,
            ":updatedAt": job.updatedAt,
            ":newVersion": job.version,
            ...(job.taskTokenCiphertext === undefined ? {} : { ":taskTokenCiphertext": job.taskTokenCiphertext }),
          },
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw mapDynamoError(err, "TextractJobStore.updateConditional");
    }
  }
}

/**
 * Camada 2 (docs/architecture/m3.5-runtime-design.md): DynamoDB Local via Testcontainers,
 * proving the real adapters against a real DynamoDB wire protocol - not mocks, not fakes.
 * Table schema mirrors infra/lib/dynamo-table.ts exactly (PK/SK + GSI1-GSI6, GSI3 KEYS_ONLY).
 */
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { DynamoDBClient, CreateTableCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export const TABLE_NAME = "ExpirationTrackerTestTable";

export async function startDynamoDbLocal(): Promise<{
  container: StartedTestContainer;
  client: DynamoDBDocumentClient;
  raw: DynamoDBClient;
  stop: () => Promise<void>;
}> {
  const container = await new GenericContainer("amazon/dynamodb-local:2.5.4")
    .withExposedPorts(8000)
    .withCommand(["-jar", "DynamoDBLocal.jar", "-inMemory", "-sharedDb"])
    .start();

  const port = container.getMappedPort(8000);
  const raw = new DynamoDBClient({
    endpoint: `http://localhost:${port}`,
    region: "us-east-1",
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  });
  const client = DynamoDBDocumentClient.from(raw, {
    marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: false },
  });

  await raw.send(
    new CreateTableCommand({
      TableName: TABLE_NAME,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" },
        { AttributeName: "SK", AttributeType: "S" },
        { AttributeName: "GSI1PK", AttributeType: "S" },
        { AttributeName: "GSI1SK", AttributeType: "S" },
        { AttributeName: "GSI3PK", AttributeType: "S" },
        { AttributeName: "GSI3SK", AttributeType: "S" },
        { AttributeName: "GSI6PK", AttributeType: "S" },
        { AttributeName: "GSI6SK", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "GSI1",
          KeySchema: [
            { AttributeName: "GSI1PK", KeyType: "HASH" },
            { AttributeName: "GSI1SK", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "ALL" },
        },
        {
          IndexName: "GSI3",
          KeySchema: [
            { AttributeName: "GSI3PK", KeyType: "HASH" },
            { AttributeName: "GSI3SK", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "KEYS_ONLY" },
        },
        {
          IndexName: "GSI6",
          KeySchema: [
            { AttributeName: "GSI6PK", KeyType: "HASH" },
            { AttributeName: "GSI6SK", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "ALL" },
        },
      ],
    }),
  );

  return {
    container,
    client,
    raw,
    stop: async () => {
      raw.destroy();
      await container.stop();
    },
  };
}

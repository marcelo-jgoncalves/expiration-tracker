/**
 * Real DynamoDB client factory (M3.5, docs/architecture/m3.5-runtime-design.md §"Adapters
 * DynamoDB reais"). The only place the AWS SDK v3 DynamoDB clients are constructed - every
 * adapter in src/modules/*\/persistence and src/runtime/aws/dynamodb receives its
 * `DynamoDBDocumentClient` from here, never constructs its own.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export interface DynamoClientOptions {
  /** Override endpoint - used by DynamoDB Local / LocalStack integration tests. Production leaves this unset. */
  endpoint?: string;
  region?: string;
}

export function createDocumentClient(options: DynamoClientOptions = {}): DynamoDBDocumentClient {
  const base = new DynamoDBClient({
    endpoint: options.endpoint,
    region: options.region ?? process.env.AWS_REGION ?? "us-east-1",
    maxAttempts: 3,
  });
  return DynamoDBDocumentClient.from(base, {
    marshallOptions: {
      removeUndefinedValues: true,
      convertClassInstanceToMap: false,
    },
  });
}

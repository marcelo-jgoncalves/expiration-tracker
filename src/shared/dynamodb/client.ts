/**
 * Real DynamoDB client factory (M3.5, docs/architecture/m3.5-runtime-design.md §"Adapters
 * DynamoDB reais"). The only place the AWS SDK v3 DynamoDB clients are constructed - every
 * adapter in src/modules/*\/persistence and src/runtime/aws/dynamodb receives its
 * `DynamoDBDocumentClient` from here, never constructs its own.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { logger } from "../observability/logger.js";
import { emitMetric } from "../observability/metrics.js";

export interface DynamoClientOptions {
  /** Override endpoint - used by DynamoDB Local / LocalStack integration tests. Production leaves this unset. */
  endpoint?: string;
  region?: string;
}

/**
 * PERF-02 slice 2: a `serialize`-step middleware fires once per SDK command, before retries and
 * network I/O, wrapping `next()` (both middleware chains, of `middlewareStack` and clients built
 * `.from()` it, share the same stack) - the single choke point that times every DynamoDB call
 * without touching any of the persistence adapters that use this client. `commandName` (e.g.
 * "GetCommand", "PutCommand", "QueryCommand") and `tableName` are both closed/low-cardinality -
 * safe as EMF dimensions per metrics.ts's dimension-discipline doc comment. Deliberately does
 * NOT log request/response bodies (could carry PII) - timing + operation + table name only.
 */
function addDynamoTimingMiddleware(client: DynamoDBDocumentClient): void {
  client.middlewareStack.add(
    (next, context) => async (args) => {
      const operation = context.commandName ?? "UnknownCommand";
      const input = args.input as Record<string, unknown> | undefined;
      const tableName = input && typeof input["TableName"] === "string" ? input["TableName"] : undefined;
      const start = Date.now();
      try {
        return await next(args);
      } finally {
        const operationMs = Date.now() - start;
        logger.info("dynamodb operation timing", { operationMs, operation, tableName });
        emitMetric("ExpirationTracker/DynamoDB", {
          name: "dynamodb.operation_ms",
          value: operationMs,
          unit: "Milliseconds",
          dimensions: { operation },
        });
      }
    },
    { step: "initialize", name: "dynamoTimingMiddleware" },
  );
}

export function createDocumentClient(options: DynamoClientOptions = {}): DynamoDBDocumentClient {
  const base = new DynamoDBClient({
    endpoint: options.endpoint,
    region: options.region ?? process.env.AWS_REGION ?? "us-east-1",
    maxAttempts: 3,
  });
  const documentClient = DynamoDBDocumentClient.from(base, {
    marshallOptions: {
      removeUndefinedValues: true,
      convertClassInstanceToMap: false,
    },
  });
  addDynamoTimingMiddleware(documentClient);
  return documentClient;
}

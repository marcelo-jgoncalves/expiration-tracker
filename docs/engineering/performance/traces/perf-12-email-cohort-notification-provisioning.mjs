// PERF-12 (D-303 post-fix verification, 2026-09-19): the 10 email-cohort tenants provisioned by
// perf-12-email-cohort-tenant-setup.mjs were created purely via the public item/policy APIs, so
// they never went through any real onboarding flow. Real incident found live during a 1k
// verification round: notification-router-workflow.ts RETRY-loops forever on
// ENTITLEMENT_UNAVAILABLE/PREFERENCE_UNAVAILABLE because neither NotificationEntitlements nor
// NotificationPreferences exists for these tenants/users - confirmed via a direct GetItem, both
// keys return no Item.
//
// This is NOT purely a synthetic-tenant gap: grep across src/ found NO production code path that
// ever writes a NotificationEntitlements record (the domain type's own file is the only writer-
// side reference; notification-router{,-workflow}.ts are read-only consumers) - the M4 design
// intended plan-driven provisioning that depends on the still-blocked billing integration (D-052).
// NotificationPreferences DOES have a real creation path
// (notification-preferences-service.ts's getOrCreatePreferences), but only lazily, the first time
// a real user opens their own preferences page/API - these synthetic users never do that either.
// Tracked as a real product-level finding in docs/engineering/performance/TODO.md, not just a
// test-fixture issue; this script only unblocks the synthetic cohort for verification purposes.
//
// Usage:
//   node docs/engineering/performance/traces/perf-12-email-cohort-notification-provisioning.mjs
//
// Idempotent: uses the same putIfAbsent (attribute_not_exists) semantics the app itself uses -
// re-running never overwrites an existing record.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.resolve(__dirname, "../.local/perf-12-email-tenants.json");
const TABLE = "exptrk-dev-table";
const REGION = "us-east-1";
const PROFILE = "claude-dev";

process.env.AWS_PROFILE = PROFILE;
const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
const now = new Date().toISOString();

async function putIfAbsent(item) {
  try {
    await client.send(new PutCommand({ TableName: TABLE, Item: item, ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" }));
    return "created";
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") return "already-exists";
    throw err;
  }
}

for (const tenant of manifest.tenants) {
  const entitlements = {
    PK: `TENANT#${tenant.organizationId}#NOTIFICATION`,
    SK: "ENTITLEMENTS",
    entityType: "NotificationEntitlements",
    tenantId: tenant.organizationId,
    email: { enabled: true },
    whatsapp: { enabled: false },
    planVersion: 1,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  const preferences = {
    PK: `TENANT#${tenant.organizationId}#USER#${tenant.userId}`,
    SK: "NOTIFICATION_PREFERENCES",
    entityType: "NotificationPreferences",
    tenantId: tenant.organizationId,
    userId: tenant.userId,
    emailEnabled: true,
    locale: "pt-BR",
    quietHours: null,
    consentSource: "MIGRATED_DEFAULT",
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  const entitlementsResult = await putIfAbsent(entitlements);
  const preferencesResult = await putIfAbsent(preferences);
  console.log(JSON.stringify({ tenant: tenant.index, organizationId: tenant.organizationId, entitlementsResult, preferencesResult }));
}

/** Real handler behind every transition Task of the tenant-purge state machine (W3-07/D-124,
 * implementing D-121 Rodada 2 Fix 3). ONE handler for all four forward edges and every MarkBlocked
 * state — the `from`/`to` come from each ASL state's own Parameters, never from anywhere else. */
import { randomUUID } from "node:crypto";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildTenantLifecycleTransitionDeps } from "../composition/tenant-purge.js";
import { advanceTenantLifecycle, type LifecycleTransitionInput, type LifecycleTransitionOutput } from "../../../workers/tenant-purge/lifecycle-transition.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableNameEnv = process.env["TABLE_NAME"];
if (!tableNameEnv) throw new Error("TABLE_NAME env var is required.");

const deps = buildTenantLifecycleTransitionDeps(client, tableNameEnv);
const logger = new SecureLogger({ baseContext: { service: "tenant-lifecycle-transition" } });

export async function handler(event: LifecycleTransitionInput): Promise<LifecycleTransitionOutput> {
  return runWithContext({ correlationId: randomUUID() }, async () => {
    // A thrown error here is deliberately NOT caught: an unexpected lifecycle state must surface
    // to Step Functions as a Task failure so the ASL's own Catch routes the tenant to BLOCKED.
    // Swallowing it would let the workflow march on past a state it never actually reached.
    const result = await advanceTenantLifecycle(deps, event);
    logger.info("tenant lifecycle transition", { tenantId: event.tenantId, from: event.from, to: event.to, alreadyAdvanced: result.alreadyAdvanced });
    return result;
  });
}

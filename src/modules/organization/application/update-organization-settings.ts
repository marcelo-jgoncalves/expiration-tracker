/**
 * UpdateOrganizationSettingsService — Wave B2B-10 (Tenant-aware Frontend, "settings" scope
 * item, `docs/architecture/reviews/multi-user-b2b-wave-b2b10-scoping/`). Real writer that was
 * genuinely missing before this wave (verified by exhaustive read of
 * `src/modules/organization/application/` — only create/list/invite/revoke/role/remove/leave
 * existed, never an update of `Organization.displayName`/`timezone`).
 *
 * Same OCC-versioned Update pattern as `change-membership-role.ts` (raw `store.transactWrite`,
 * not routed through `TenantBusinessMutation` — Organization/Membership writers are not yet
 * migrated onto that fence, a pre-existing gap this wave does not expand scope to close, see
 * `w3-07-writer-inventory.md`/§125.4). Authorization tier: `OWNER_ROLES`, same as
 * `tenant:configure-document-request-delivery` - workspace identity/settings that reads
 * externally (invitation emails, guest-facing name) is kept OWNER-only in this codebase, never
 * paritary with ADMIN like most other membership-management actions.
 */
import { authorize } from "../../identity/domain/authorization.js";
import type { RequestContext } from "../../identity/domain/request-context.js";
import { isTransactionCanceled, type TransactWriteEntry } from "../../../shared/dynamodb/occ.js";
import { NotFoundError, ValidationError, ConflictError } from "../../../shared/errors/app-error.js";
import { organizationKey, type Organization } from "../domain/organization.js";
import type { OrganizationStore } from "../ports/organization-store.js";

export interface UpdateOrganizationSettingsInput {
  displayName?: string;
  timezone?: string;
}

export class UpdateOrganizationSettingsService {
  constructor(
    private readonly store: OrganizationStore,
    private readonly tableName: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async update(ctx: RequestContext, input: UpdateOrganizationSettingsInput, expectedVersion: number): Promise<Organization> {
    authorize({ context: ctx, action: "organization:update-settings", resource: { tenantId: ctx.tenant.tenantId } });

    const displayName = input.displayName?.trim();
    const timezone = input.timezone?.trim();
    if (displayName === undefined && timezone === undefined) {
      throw new ValidationError("At least one of displayName or timezone must be provided.");
    }
    if (displayName !== undefined && displayName.length === 0) {
      throw new ValidationError("displayName cannot be blank.");
    }
    if (timezone !== undefined && timezone.length === 0) {
      throw new ValidationError("timezone cannot be blank.");
    }

    const organization = await this.store.get<Organization>(organizationKey(ctx.tenant.tenantId));
    if (!organization) {
      throw new NotFoundError("Organization not found.", { organizationId: ctx.tenant.tenantId });
    }

    const setClauses = ["version = version + :one", "updatedAt = :updatedAt"];
    const values: Record<string, unknown> = { ":one": 1, ":updatedAt": this.now(), ":expectedVersion": expectedVersion };
    if (displayName !== undefined) {
      setClauses.push("displayName = :displayName");
      values[":displayName"] = displayName;
    }
    if (timezone !== undefined) {
      setClauses.push("#timezone = :timezone");
      values[":timezone"] = timezone;
    }

    // Wave B2B-14 (Operational Evidence, D-119): real finding - `ExpressionAttributeNames: {}`
    // (an empty object, present but empty) is NOT the same as omitting the key entirely.
    // DynamoDB's TransactWriteItems (unlike the raw single-item UpdateItem/aws CLI form this
    // was apparently never checked against for real) rejects an empty map outright with
    // `ValidationException: ExpressionAttributeNames must not be empty` - every
    // displayName-only save (the common case, timezone never sent by the real Settings screen)
    // has been failing with an uncaught 500 since this service was written in Wave B2B-10,
    // never caught because no unit test exercises the real DynamoDB SDK/API and no E2E test
    // hits the real deployed backend. The key must be OMITTED (never present) when there is
    // nothing to map, not set to `{}`.
    const expressionAttributeNames = timezone !== undefined ? { "#timezone": "timezone" } : undefined;
    const entries: TransactWriteEntry[] = [
      {
        Update: {
          TableName: this.tableName,
          Key: organizationKey(ctx.tenant.tenantId),
          UpdateExpression: `SET ${setClauses.join(", ")}`,
          ConditionExpression: "version = :expectedVersion",
          ...(expressionAttributeNames ? { ExpressionAttributeNames: expressionAttributeNames } : {}),
          ExpressionAttributeValues: values,
        },
      },
    ];

    try {
      await this.store.transactWrite(entries);
    } catch (err) {
      if (isTransactionCanceled(err)) {
        throw new ConflictError("VERSION_CONFLICT", { organizationId: ctx.tenant.tenantId, cause: "transaction condition failed" });
      }
      throw err;
    }

    return {
      ...organization,
      displayName: displayName ?? organization.displayName,
      timezone: timezone ?? organization.timezone,
      version: expectedVersion + 1,
    };
  }
}

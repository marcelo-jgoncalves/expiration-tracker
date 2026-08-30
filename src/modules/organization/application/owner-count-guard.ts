/**
 * Builder transacional único de `ownerCount`, compartilhado por `ChangeMembershipRoleService`/
 * `RemoveMembershipService`/`LeaveOrganizationService` (Wave B2B-8, D-099, checklist v2 critério
 * 1: "as 3 operações compartilham o MESMO builder... nunca uma checagem solta de aplicação").
 * Decremento condicionado a `ownerCount > :one` — física de `multi-user-b2b-physical-model.md`
 * §8 (D-086), nunca exercitado por um writer real até esta wave. Falha da condição = última
 * `Membership` `OWNER` `ACTIVE` da organização, mapeada pelo chamador para `LastOwnerError`
 * (nunca `ConditionalCheckFailedException` cru).
 *
 * Genérico o bastante para cobrir `suspend`/`unsuspend` quando essas transições existirem
 * (fora de escopo desta wave, physical model já nomeia como ação administrativa futura) — só
 * depende de "a Membership ERA OWNER ACTIVE" vs. "SERÁ OWNER ACTIVE", não do tipo de operação.
 */
import type { TransactWriteEntry } from "../../../shared/dynamodb/occ.js";
import { organizationKey } from "../domain/organization.js";

/** `undefined` quando a mutação não muda a contagem de OWNER ACTIVE (não precisa tocar
 * `Organization`). */
export function buildOwnerCountDeltaEntry(tableName: string, organizationId: string, wasActiveOwner: boolean, willBeActiveOwner: boolean): TransactWriteEntry | undefined {
  if (wasActiveOwner === willBeActiveOwner) return undefined;

  if (wasActiveOwner && !willBeActiveOwner) {
    return {
      Update: {
        TableName: tableName,
        Key: organizationKey(organizationId),
        UpdateExpression: "SET ownerCount = ownerCount - :one",
        ConditionExpression: "ownerCount > :one",
        // Wave B2B-14 (Operational Evidence, D-119): real finding, the most severe of this
        // wave - ExpressionAttributeNames must be OMITTED, never `{}` (DynamoDB's
        // TransactWriteItems rejects an explicitly-empty map with
        // `ValidationException: ExpressionAttributeNames must not be empty`). This builder is
        // the LAST-OWNER PROTECTION GUARD shared by Change/Remove/Leave - every real attempt
        // to demote/remove/leave-as-the-last-owner (the exact case this guard exists to
        // handle) crashed with an uncaught 500 instead of the correct LastOwnerError, since
        // Wave B2B-8/D-100 first wrote this file. Caught only now because no unit test
        // exercises the real DynamoDB API and no E2E test hits the real deployed backend.
        ExpressionAttributeValues: { ":one": 1 },
      },
    };
  }

  return {
    Update: {
      TableName: tableName,
      Key: organizationKey(organizationId),
      UpdateExpression: "SET ownerCount = ownerCount + :one",
      ConditionExpression: "attribute_exists(PK)",
      // Wave B2B-14 (D-119): see the decrement branch's comment above - omitted, never `{}`.
      ExpressionAttributeValues: { ":one": 1 },
    },
  };
}

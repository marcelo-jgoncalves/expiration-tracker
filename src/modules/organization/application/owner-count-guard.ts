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
        ExpressionAttributeNames: {},
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
      ExpressionAttributeNames: {},
      ExpressionAttributeValues: { ":one": 1 },
    },
  };
}

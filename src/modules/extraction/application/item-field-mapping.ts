/**
 * The one place that says which extracted field name maps to which `ExpirationItem` attribute,
 * and how the resulting `Update` set-clause is built (including the GSI1 re-key that `dueDate`
 * requires). Shared by the TWO code paths that can write the item from an extraction outcome:
 *
 *  - `confirm-reject-field.ts` — a human confirming a `PENDING_CONFIRMATION` field over HTTP;
 *  - `run-extraction-validation.ts` (`PERSIST_EXTRACTED_FIELDS`) — the pipeline auto-confirming
 *    a high-confidence, non-ambiguous field (W2-01-DECISION: Marcelo decided the auto-confirm
 *    path must reach the SAME outcome as the manual one, just without the human click).
 *
 * Keeping the map here (rather than duplicated per caller) is what guarantees the two paths
 * cannot drift — "the same outcome, reached automatically" is only true if both compute the
 * item-side effect identically.
 *
 * Schema v1 only names `expirationDate` concretely (`field-schema.ts`), so that is the only
 * entry this map needs today. A future pipeline field with no corresponding `ExpirationItem`
 * attribute simply isn't in the map, and callers fall back to their own no-item-effect
 * behaviour rather than inventing a mapping.
 */
import { gsi1Keys, type ExpirationItemStatus } from "../../expiration/domain/expiration-item.js";

export const ITEM_ATTRIBUTE_BY_FIELD_NAME: Record<string, string> = {
  expirationDate: "dueDate",
};

/**
 * The `set` payload for the `ExpirationItem` versioned update implied by a confirmed field, or
 * `undefined` when the field maps to no item attribute at all.
 *
 * `dueDate` is special-cased because it is a GSI1 key component (`data-model.md` §3): writing it
 * without re-deriving `GSI1PK`/`GSI1SK` would leave the dashboard index pointing at the old due
 * date. Any other mapped attribute is a plain scalar set.
 */
export function buildItemAttributeUpdate(input: {
  tenantId: string;
  itemId: string;
  itemStatus: ExpirationItemStatus;
  fieldName: string;
  confirmedValue: string;
}): Record<string, unknown> | undefined {
  const attribute = ITEM_ATTRIBUTE_BY_FIELD_NAME[input.fieldName];
  if (attribute === undefined) return undefined;
  if (attribute === "dueDate") {
    return { dueDate: input.confirmedValue, ...gsi1Keys(input.tenantId, input.itemStatus, input.confirmedValue, input.itemId) };
  }
  return { [attribute]: input.confirmedValue };
}

/**
 * A07 (D-349) - confirm/reject a suggested extracted field's value. The read route
 * (`useDocumentExtraction`) has existed since 2026-09-28; these mutations close the interactive
 * half - `extraction:confirm` covers both HTTP routes, idempotent via `Idempotency-Key`
 * (mission §33-35), same discipline as every other write mutation in this codebase.
 *
 * `runId`/`fieldName` travel as MUTATION VARIABLES, not hook arguments - a document can have
 * several PENDING_CONFIRMATION fields at once, and `ExtractionDisclosure`'s per-row callbacks
 * need one shared mutation per document row, not one hook instance per field.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useIdempotentMutation } from "./useIdempotentMutation.js";
import { isConflict } from "../api/errors.js";
import { confirmDocumentField, rejectDocumentField, type ConfirmDocumentFieldInput, type RejectDocumentFieldInput } from "../api/documents.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import type { DisclosedExtractedField } from "../api/types.js";

function useInvalidateDocumentExtraction(itemId: string, documentId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return () => {
    if (!organizationId) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.items.documentExtraction(organizationId, itemId, documentId) });
  };
}

export interface ConfirmDocumentFieldVariables extends ConfirmDocumentFieldInput {
  runId: string;
  fieldName: string;
}

export function useConfirmDocumentField(itemId: string, documentId: string) {
  const invalidate = useInvalidateDocumentExtraction(itemId, documentId);
  const mutation = useIdempotentMutation<{ field: DisclosedExtractedField }, ConfirmDocumentFieldVariables>({
    mutationFn: ({ runId, fieldName, ...input }, idempotencyKey) => confirmDocumentField(itemId, documentId, runId, fieldName, input, idempotencyKey),
    onSuccess: invalidate,
  });
  return { ...mutation, isConflict: mutation.isError && isConflict(mutation.error) };
}

export interface RejectDocumentFieldVariables extends RejectDocumentFieldInput {
  runId: string;
  fieldName: string;
}

export function useRejectDocumentField(itemId: string, documentId: string) {
  const invalidate = useInvalidateDocumentExtraction(itemId, documentId);
  const mutation = useIdempotentMutation<{ field: DisclosedExtractedField }, RejectDocumentFieldVariables>({
    mutationFn: ({ runId, fieldName, ...input }, idempotencyKey) => rejectDocumentField(itemId, documentId, runId, fieldName, input, idempotencyKey),
    onSuccess: invalidate,
  });
  return { ...mutation, isConflict: mutation.isError && isConflict(mutation.error) };
}

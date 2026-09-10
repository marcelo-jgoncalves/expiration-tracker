/** A14 (Block 6, D-2xx) - "Nova série recorrente" (WRITE_ROLES, `docarchive:series-create`).
 * NOT idempotent-key-wrapped: `CreateDocumentRequestSeriesInput` has no `idempotencyKey` field at
 * all (the backend generates `seriesId` server-side via `this.ids.newSeriesId()` with no
 * client-supplied dedup key) - wiring one here would silently claim a guarantee the backend does
 * not provide, same discipline as `useCreateRequirement`'s own doc comment. The caller's own
 * `pending` state is what prevents a double-submit. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createSeries } from "../api/documentRequests.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import type { CreateDocumentRequestSeriesInput, DocumentRequestSeries } from "../api/types.js";

export function useCreateSeries(subjectId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();

  return useMutation<{ series: DocumentRequestSeries }, unknown, CreateDocumentRequestSeriesInput>({
    mutationFn: (input) => createSeries(input),
    onSuccess: () => {
      if (organizationId) void queryClient.invalidateQueries({ queryKey: queryKeys.documentArchive.series(organizationId, subjectId) });
    },
  });
}

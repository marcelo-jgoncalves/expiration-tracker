import { useMutation } from "@tanstack/react-query";
import { previewTemplateApplication } from "../api/requirementTemplates.js";
import type { TemplateApplicationPreview } from "../api/types.js";

/** A21 (Block 4, D-2xx) - "Aplicar a fornecedor" step 2 preview (`docarchive:requirementtemplate-read`,
 * READ_ONLY_ROLES - the backend consumes no write quota here). A `useMutation`, not a
 * `useQuery`: it is dispatched on demand once a Subject is chosen inside the apply flow, never
 * automatically on mount. */
export function usePreviewTemplateApplication(templateId: string) {
  return useMutation<TemplateApplicationPreview, unknown, { subjectId: string }>({
    mutationFn: ({ subjectId }) => previewTemplateApplication(templateId, subjectId),
  });
}

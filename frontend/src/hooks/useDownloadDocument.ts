import { useMutation } from "@tanstack/react-query";
import { requestDocumentDownload } from "../api/documents.js";

/** D-313 (2026-09-21) - `document:read` (READ_ONLY_ROLES) backs the backend route, same tier
 * every role already has for viewing the document list itself - no separate RBAC check needed
 * here. Navigates the browser to the freshly minted presigned URL directly (never routes the
 * file bytes back through this app) - a `useMutation`, not a `useQuery`, since "click Baixar"
 * is a one-shot action, not data this screen displays. */
export function useDownloadDocument(itemId: string) {
  return useMutation<void, unknown, { documentId: string }>({
    mutationFn: async ({ documentId }) => {
      const { downloadUrl } = await requestDocumentDownload(itemId, documentId);
      window.location.assign(downloadUrl);
    },
  });
}

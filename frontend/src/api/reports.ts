/**
 * A16 (Block 10, D-2xx) - Reports & Exports. Two distinct download shapes, mirroring
 * documents.ts's "not every transport goes through apiClient" precedent:
 * (1) the 7 raw-CSV report routes (`reports-handler.ts`) are proxied through the BFF as-is (G3,
 *     D-247/D-24x) - same-origin, cookie-authenticated, but the response body is CSV text with
 *     `content-disposition`/`x-report-truncated` headers `apiClient`'s JSON-only parsing would
 *     destroy, so this uses a dedicated `fetch()`.
 * (2) report-subscription CRUD and the subscription-run download route return a JSON envelope
 *     (the run download is `{downloadUrl}`, a short-lived presigned S3 URL) - those go through
 *     `apiClient` normally, and the caller navigates the browser to that URL to trigger the save.
 *
 * REAL deviations from `A16-relatorios-exportacoes.md` (confirmed directly against
 * `src/modules/reports/{domain,application,http}/*.ts` before writing any of this, never
 * guessed):
 *  1. A subscription selects a SET of report types (`reportTypes: ReportSubscriptionReportType[]`),
 *     never one report per subscription - the spec's "Relatório" singular column assumes a 1:1
 *     model the backend doesn't have.
 *  2. Cadence is WEEKLY only (`dayOfWeek`/`localTime`/`timeZone`) - there is no
 *     Diária/Mensal option anywhere in the domain type, despite the spec naming them.
 *  3. Recipients are `recipientUserIds` (existing org members only) - the backend has no support
 *     for ad-hoc e-mail recipients on a subscription, unlike the spec's "aceita e-mails avulsos".
 *  4. There is NO update route (`report-subscription-service.ts`'s own header comment: "no
 *     update... a subscriber wanting to change reportTypes/schedule/recipients deletes and
 *     recreates") - "Editar" is never offered as a fabricated single action; Reports.tsx instead
 *     explains this and offers delete+recreate as two explicit steps, never masked as one atomic
 *     "edit".
 *  5. There is NO route to list a subscription's past runs, and `ReportSubscription` carries no
 *     `lastRunAt`/"última execução" field at all - only `nextRunAt`. The spec's run-history
 *     Drawer is not buildable; Reports.tsx shows "Próxima execução" instead and omits the
 *     history feature entirely (named gap, not a silent omission).
 */
import { apiClient } from "./apiClient.js";
import { ApiError } from "./errors.js";
import type { CreateReportSubscriptionInput, ReportKey, ReportSubscription, ReportSubscriptionsResponse } from "./types.js";

const REPORT_PATHS: Record<ReportKey, string> = {
  "expired-items": "/reports/expired-items",
  "expiring-soon-items": "/reports/expiring-soon-items",
  "renewed-items": "/reports/renewed-items",
  "expiration-items-by-assignee": "/reports/expiration-items-by-assignee",
  "missing-requirements": "/reports/missing-requirements",
  "requirements-by-subject": "/reports/requirements-by-subject",
  "requirements-by-assignee": "/reports/requirements-by-assignee",
};

export interface DownloadReportResult {
  truncated: boolean;
}

const DOWNLOAD_TIMEOUT_MS = 15_000; // Same default as apiClient.ts's DEFAULT_TIMEOUT_MS.

/** `GET /reports/{key}` - `item:export`/`docarchive:requirement-export`, ADMIN_ROLES. Deliberately
 * NOT `apiClient` (see this file's header comment) - triggers a real browser download via a
 * temporary object URL, reading `content-disposition` for the real filename the backend already
 * sends rather than inventing one.
 *
 * Codex review round (Block 10) finding, partially addressed: a hung request used to leave the
 * download button spinning forever - a timeout now bounds that. A genuinely expired session
 * (401) is NOT wired to `ApiClient`'s global `onUnauthorized` handler here (this deliberately
 * never touches `apiClient` - see the header comment above), so a 401 on this path still only
 * surfaces as this function's own error, not a session-wide re-auth prompt - a real, named
 * remaining gap, not silently dropped. */
export async function downloadReportCsv(key: ReportKey): Promise<DownloadReportResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`/bff/api${REPORT_PATHS[key]}`, { credentials: "include", signal: controller.signal });
  } catch (cause) {
    throw ApiError.network(cause);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      parsed = undefined;
    }
    throw ApiError.fromResponseBody(parsed, response.status);
  }
  const truncated = response.headers.get("x-report-truncated") !== null;
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const filename = match?.[1] ?? `${key}.csv`;
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  return { truncated };
}

export function createReportSubscription(input: CreateReportSubscriptionInput): Promise<{ subscription: ReportSubscription }> {
  return apiClient.post<{ subscription: ReportSubscription }>("/reports/subscriptions", input);
}

export function listReportSubscriptions(options?: { signal?: AbortSignal }): Promise<ReportSubscriptionsResponse> {
  return apiClient.get<ReportSubscriptionsResponse>("/reports/subscriptions", { signal: options?.signal });
}

/** `POST .../delete` (not a DELETE verb - matches the real allowlisted route). */
export function deleteReportSubscription(subscriptionId: string, expectedVersion: number): Promise<void> {
  return apiClient.post<void>(`/reports/subscriptions/${encodeURIComponent(subscriptionId)}/delete`, { expectedVersion }, { expectedVersion });
}

// NOTE: `GET .../subscriptions/{id}/runs/{runId}/download` is a real, allowlisted backend route,
// but there is no route to LIST a subscription's runs and `ReportSubscription` carries no run
// history at all - a runId is only ever learned from a delivery e-mail, never discoverable in
// this UI. No wrapper is added here since nothing in this screen has a runId to call it with
// (deviation 5 above) - a future screen reachable FROM that e-mail link would add it then.

/**
 * ReportSubscriptionDeliveryWorker — D-204 decision 6 (Roadmap P1 item 15, fatia 3). Consumes
 * `SQS_REPORT_SUBSCRIPTION_DELIVERY_V1`, fed by D-212's scheduler: one message per due
 * `ReportSubscription`, bare `ReportSubscriptionRunRequested.data` payload
 * (`runId`/`subscriptionId`/`tenantId`/`scheduledFor` - never a recipient list, decision 6
 * requires recipients re-resolved FRESH here, never trusted from claim time). Same
 * "system query, no RequestContext" posture as `requirement-evidence-refresh/refresh.ts` - this
 * worker never acts on behalf of an authenticated end-user request.
 *
 * Implementation judgment call (level 3-4, no new architecture decision - D-204 is already
 * `APPROVED`): the design's decision 6 describes "os CSVs" (plural, one per subscribed
 * `reportType`) but decision 7 names exactly ONE download route
 * (`GET .../runs/{runId}/download`, singular). Read here as ONE combined CSV artifact per run -
 * each subscribed reportType's rows appended under its own `# <label>` section header in a
 * single file - rather than N separate S3 objects/routes. Simplest interpretation consistent
 * with "one link" in the e-mail; revisit if a future need for per-report-type download surfaces.
 *
 * Idempotency (SQS at-least-once): `ReportSubscriptionRun` is created via a conditional Put
 * (`attribute_not_exists`) keyed by `runId` - a redelivered message that finds the row already
 * there reuses its FROZEN `reportTypes`/`recipientUserIds` (decision 5) instead of re-deriving
 * from the (possibly since-deleted) `ReportSubscription`. Each recipient's own
 * `ReportDeliveryAttempt` is the same PREPARED->SUBMITTING(lease)->resolved state machine
 * `email-delivery-workflow.ts` already established for M4's SES pipeline (`decideSendAction`/
 * `nextStatusAfterSendAttempt` reused verbatim, not reimplemented) - a per-recipient failure
 * never contaminates the others (decision 5's own "isolamento de falha").
 */
import { buildVersionedCreate, buildVersionedUpdate } from "../../shared/dynamodb/occ.js";
import { executeTenantBusinessMutation } from "../../shared/tenant-lifecycle/tenant-business-mutation.js";
import { decideSendAction, nextStatusAfterSendAttempt } from "../../modules/notification/application/email-delivery.js";
import { EmailSendError, type EmailProviderAdapter } from "../../modules/notification/ports/email-provider.js";
import type { NotificationRecipientResolver } from "../../modules/notification/ports/recipient-resolver.js";
import type { ReportsService } from "../../modules/reports/application/reports-service.js";
import { reportSubscriptionKey, type ReportSubscription, type ReportSubscriptionReportType } from "../../modules/reports/domain/report-subscription.js";
import { reportSubscriptionRunKey, type ReportSubscriptionRun } from "../../modules/reports/domain/report-subscription-run.js";
import { reportDeliveryAttemptKey, type ReportDeliveryAttempt } from "../../modules/reports/domain/report-delivery-attempt.js";
import { isTransactionCanceled, type ReportSubscriptionStore } from "../../modules/reports/ports/report-subscription-store.js";
import type { ReportExportStore } from "../../modules/reports/ports/report-export-store.js";

export interface ReportSubscriptionDeliveryCommand {
  tenantId: string;
  subscriptionId: string;
  runId: string;
  scheduledFor: string;
}

export interface ReportSubscriptionDeliveryDeps {
  store: ReportSubscriptionStore;
  tableName: string;
  reports: Pick<ReportsService, "generateReportCsv">;
  exportStore: ReportExportStore;
  recipients: NotificationRecipientResolver;
  emailProvider: EmailProviderAdapter;
  /** No trailing slash - e.g. `https://xxxx.execute-api.<region>.amazonaws.com` (`module.api.
   * api_endpoint`, the SAME resource API `reports-handler`'s download route lives on, never the
   * BFF's own API). */
  downloadBaseUrl: string;
  now: () => string;
  leaseDurationMs?: number;
}

const REPORT_TYPE_LABELS: Record<ReportSubscriptionReportType, string> = {
  EXPIRED_ITEMS: "Itens vencidos",
  EXPIRING_SOON_ITEMS: "Itens vencendo",
  RENEWED_ITEMS: "Itens renovados",
  EXPIRATION_ITEMS_BY_ASSIGNEE: "Itens por responsável",
  MISSING_REQUIREMENTS: "Requisitos ausentes",
  REQUIREMENTS_BY_SUBJECT: "Requisitos por assunto",
  REQUIREMENTS_BY_ASSIGNEE: "Requisitos por responsável",
};

export type RecipientDeliveryOutcome = "SENT" | "SKIPPED_INELIGIBLE" | "SKIPPED_IN_PROGRESS" | "SKIPPED_ALREADY_RESOLVED" | "SKIPPED_TENANT_NOT_ACTIVE" | "SEND_FAILED";

export type ReportSubscriptionDeliveryResult =
  | { kind: "SUBSCRIPTION_AND_RUN_NOT_FOUND" } // subscription deleted before this message's first processing attempt - nothing to freeze, nothing to deliver.
  | { kind: "PROCESSED"; truncated: boolean; recipients: { recipientUserId: string; outcome: RecipientDeliveryOutcome }[] };

export async function processReportSubscriptionDelivery(deps: ReportSubscriptionDeliveryDeps, command: ReportSubscriptionDeliveryCommand): Promise<ReportSubscriptionDeliveryResult> {
  const now = deps.now();

  const subscription = await deps.store.get<ReportSubscription>(reportSubscriptionKey(command.tenantId, command.subscriptionId));
  const run = await getOrCreateRun(deps, command, subscription, now);
  if (!run) return { kind: "SUBSCRIPTION_AND_RUN_NOT_FOUND" };

  let combinedCsv = "";
  let truncated = false;
  for (const reportType of run.reportTypes) {
    const { csv, truncated: reportTruncated } = await deps.reports.generateReportCsv(command.tenantId, reportType);
    combinedCsv += `# ${REPORT_TYPE_LABELS[reportType]}\n${csv}\n`;
    truncated = truncated || reportTruncated;
  }
  await deps.exportStore.putCsv({ tenantId: command.tenantId, subscriptionId: command.subscriptionId, runId: command.runId, body: combinedCsv });

  const downloadLink = `${deps.downloadBaseUrl}/reports/subscriptions/${command.subscriptionId}/runs/${command.runId}/download`;
  const reportTypesLabel = run.reportTypes.map((t) => REPORT_TYPE_LABELS[t]).join(", ");

  const recipients: { recipientUserId: string; outcome: RecipientDeliveryOutcome }[] = [];
  for (const recipientUserId of run.recipientUserIds) {
    const outcome = await deliverToRecipient(deps, command, recipientUserId, { reportTypesLabel, downloadLink, truncated }, now);
    recipients.push({ recipientUserId, outcome });
  }

  return { kind: "PROCESSED", truncated, recipients };
}

/** Conditional-create-or-reread, matching `report-subscription-service.ts`'s own precedent for
 * "first-writer-wins, everyone else reuses the frozen row" (`isTransactionCanceled` on a
 * `buildVersionedCreate`'s `attribute_not_exists` condition). `subscription` is only consulted
 * on the FIRST processing attempt (the row does not exist yet) - every redelivery after that
 * reuses the run's own frozen fields, never re-reads the subscription again (decision 5:
 * "conjunto de linhas congelado no preview... nunca muda depois"; the analogous freeze here is
 * at claim/first-delivery-attempt time, since there is no separate preview step for this
 * feature). */
async function getOrCreateRun(
  deps: ReportSubscriptionDeliveryDeps,
  command: ReportSubscriptionDeliveryCommand,
  subscription: ReportSubscription | undefined,
  now: string,
): Promise<ReportSubscriptionRun | undefined> {
  const key = reportSubscriptionRunKey(command.tenantId, command.subscriptionId, command.runId);
  const existing = await deps.store.get<ReportSubscriptionRun>(key);
  if (existing) return existing;
  if (!subscription) return undefined;

  const run: ReportSubscriptionRun = {
    ...key,
    entityType: "ReportSubscriptionRun",
    runId: command.runId,
    subscriptionId: command.subscriptionId,
    tenantId: command.tenantId,
    scheduledFor: command.scheduledFor,
    reportTypes: subscription.reportTypes,
    recipientUserIds: subscription.recipientUserIds,
    createdAt: now,
  };
  try {
    await deps.store.transactWrite([{ Put: buildVersionedCreate(deps.tableName, run as unknown as Record<string, unknown> & { PK: string; SK: string }) }]);
  } catch (err) {
    if (!isTransactionCanceled(err)) throw err;
    const raced = await deps.store.get<ReportSubscriptionRun>(key); // concurrent redelivery created it first
    if (raced) return raced;
    throw err; // conditional failed but a fresh read still finds nothing - genuinely unexpected.
  }
  return run;
}

async function deliverToRecipient(
  deps: ReportSubscriptionDeliveryDeps,
  command: ReportSubscriptionDeliveryCommand,
  recipientUserId: string,
  emailContext: { reportTypesLabel: string; downloadLink: string; truncated: boolean },
  now: string,
): Promise<RecipientDeliveryOutcome> {
  const key = reportDeliveryAttemptKey(command.tenantId, command.subscriptionId, command.runId, recipientUserId);
  let attempt = await deps.store.get<ReportDeliveryAttempt>(key);
  if (!attempt) {
    const created: ReportDeliveryAttempt = {
      ...key,
      entityType: "ReportDeliveryAttempt",
      tenantId: command.tenantId,
      subscriptionId: command.subscriptionId,
      runId: command.runId,
      recipientUserId,
      status: "PREPARED",
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await deps.store.transactWrite([{ Put: buildVersionedCreate(deps.tableName, created as unknown as Record<string, unknown> & { PK: string; SK: string }) }]);
      attempt = created;
    } catch (err) {
      if (!isTransactionCanceled(err)) throw err;
      attempt = await deps.store.get<ReportDeliveryAttempt>(key);
      if (!attempt) throw err;
    }
  }

  const action = decideSendAction({ status: attempt.status, leaseExpiresAt: attempt.leaseExpiresAt }, now);
  if (action.action === "SKIP_IN_PROGRESS") return "SKIPPED_IN_PROGRESS";
  if (action.action === "SKIP_RESOLVED") return "SKIPPED_ALREADY_RESOLVED";
  if (action.action === "RECONCILE_UNKNOWN") {
    await tryConditionalUpdate(deps, attempt, { status: "UNKNOWN", completedAt: now }, now);
    return "SKIPPED_ALREADY_RESOLVED";
  }

  // action.action === "SEND" from here - resolve the recipient FRESH (decision 5), never
  // trusted from the run's own frozen recipientUserIds list.
  const resolved = await deps.recipients.resolve({ tenantId: command.tenantId, candidateUserId: recipientUserId });
  if (!resolved || !resolved.active || !resolved.email) {
    const marked = await tryConditionalUpdate(deps, attempt, { status: "FAILED_TERMINAL", skippedReason: "RECIPIENT_NOT_ELIGIBLE", completedAt: now }, now);
    return marked ? "SKIPPED_INELIGIBLE" : "SKIPPED_IN_PROGRESS";
  }

  const leaseExpiresAt = new Date(Date.parse(now) + (deps.leaseDurationMs ?? 5 * 60_000)).toISOString();
  const claim = await tryFencedSubmittingClaim(deps, attempt, { status: "SUBMITTING", leaseExpiresAt }, now);
  if (claim === "LOST_RACE") return "SKIPPED_IN_PROGRESS";
  if (claim === "TENANT_NOT_ACTIVE") return "SKIPPED_TENANT_NOT_ACTIVE";

  try {
    const sendResult = await deps.emailProvider.send({
      to: resolved.email,
      templateId: "scheduled-report-delivery",
      templateVersion: 1,
      locale: "pt-BR",
      renderContext: { reportTypesLabel: emailContext.reportTypesLabel, downloadLink: emailContext.downloadLink, truncated: emailContext.truncated },
      tags: { attemptId: `${command.runId}:${recipientUserId}`, intentId: command.subscriptionId, tenantId: command.tenantId, correlationId: command.runId },
    });
    const nextStatus = nextStatusAfterSendAttempt({ kind: "ACCEPTED", providerMessageId: sendResult.providerMessageId });
    await forceUpdateAttemptStatus(deps, { ...attempt, status: "SUBMITTING", version: attempt.version + 1 }, nextStatus, now, sendResult.providerMessageId);
    return "SENT";
  } catch (err) {
    const failureKind = err instanceof EmailSendError ? err.kind : "AMBIGUOUS";
    const nextStatus = nextStatusAfterSendAttempt({ kind: "FAILURE", failureKind });
    await forceUpdateAttemptStatus(deps, { ...attempt, status: "SUBMITTING", version: attempt.version + 1 }, nextStatus, now);
    return "SEND_FAILED";
  }
}

/** OCC-conditional update FROM the attempt's currently-known status - same "another invocation
 * already moved it, return false rather than overwrite concurrent progress" contract as
 * `email-delivery-workflow.ts`'s identically named helper. */
async function tryConditionalUpdate(deps: ReportSubscriptionDeliveryDeps, attempt: ReportDeliveryAttempt, set: Record<string, unknown>, now: string): Promise<boolean> {
  try {
    await deps.store.transactWrite([{ Update: buildVersionedUpdate({ tableName: deps.tableName, key: { PK: attempt.PK, SK: attempt.SK }, tenantId: attempt.tenantId, expectedVersion: attempt.version, now, set }) }]);
    return true;
  } catch (err) {
    if (isTransactionCanceled(err)) return false;
    throw err;
  }
}

/** Fenced variant, used ONLY for the SUBMITTING claim - the one transition here that represents
 * a NEW admission of an external SES send, mirroring exactly why
 * `email-delivery-workflow.ts`'s own `tryFencedSubmittingClaim` routes through
 * `executeTenantBusinessMutation` (W3-07/D-067): a tenant that has moved to DELETING can never
 * claim a new SUBMITTING lease, even under concurrent retries. Every OTHER transactWrite in
 * this file is a status resolution of an already-admitted attempt (or a plain record-of-history
 * create), never fenced, same split that file's own comment documents. */
async function tryFencedSubmittingClaim(
  deps: ReportSubscriptionDeliveryDeps,
  attempt: ReportDeliveryAttempt,
  set: Record<string, unknown>,
  now: string,
): Promise<"CLAIMED" | "LOST_RACE" | "TENANT_NOT_ACTIVE"> {
  try {
    await executeTenantBusinessMutation({
      store: deps.store,
      tableName: deps.tableName,
      tenantId: attempt.tenantId,
      entries: [{ Update: buildVersionedUpdate({ tableName: deps.tableName, key: { PK: attempt.PK, SK: attempt.SK }, tenantId: attempt.tenantId, expectedVersion: attempt.version, now, set }) }],
    });
    return "CLAIMED";
  } catch (err) {
    if (err instanceof Error && err.name === "TenantNotActiveError") return "TENANT_NOT_ACTIVE";
    if (isTransactionCanceled(err)) return "LOST_RACE";
    throw err;
  }
}

async function forceUpdateAttemptStatus(
  deps: ReportSubscriptionDeliveryDeps,
  submittingAttempt: ReportDeliveryAttempt,
  nextStatus: string,
  now: string,
  providerMessageId?: string,
): Promise<void> {
  try {
    await deps.store.transactWrite([
      {
        Update: buildVersionedUpdate({
          tableName: deps.tableName,
          key: { PK: submittingAttempt.PK, SK: submittingAttempt.SK },
          tenantId: submittingAttempt.tenantId,
          expectedVersion: submittingAttempt.version,
          now,
          set: { status: nextStatus, ...(providerMessageId ? { providerMessageId, acceptedAt: now } : {}), completedAt: now },
        }),
      },
    ]);
  } catch (err) {
    if (!isTransactionCanceled(err)) throw err;
  }
}

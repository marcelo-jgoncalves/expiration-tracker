/**
 * DocumentChasingDispatch — M10 cluster 4 (D-039/D-046/D-048). Consome UM comando
 * `document-chasing.dispatch.v1` (produzido pelo producer branch, `document-chasing-producer.ts`)
 * e faz a transição CLAIMED -> TRIGGERED, criando um `DocumentChasingIntent` idempotente.
 *
 * Fundido dispatch+delivery num único worker (decisão deliberada, diferente do par
 * ReminderDispatch/EmailDeliveryWorker de M3/M4): chasing v1 é single-channel (e-mail),
 * sem lease/retry - o próximo tier de chasing (T7->T3->EXPIRED) já É o mecanismo de retry
 * natural do produto, não precisa duplicar a máquina de lease/attempt do módulo notification
 * para uma segunda vez. Falha de envio SES é best-effort, nunca desfaz a transação (mesmo
 * espírito de email-delivery-workflow.ts: transação primeiro, chamada externa depois, status
 * refletido por uma atualização de acompanhamento).
 *
 * Validação de staleness (mesma ordem de dispatch.ts do reminder): ocorrência precisa estar
 * CLAIMED; DocumentRequest precisa existir e estar REQUESTED/OPENED (nunca reenviar depois de
 * SUBMITTED/CANCELLED/REVOKED/EXPIRED); versões precisam bater; agendamento dentro da
 * tolerância. Qualquer falha aqui cancela a ocorrência (CLAIMED -> CANCELLED) em vez de
 * silenciosamente descartar - reparo fica a cargo da reconciliação (mesmo princípio de §9.4).
 *
 * Rotação de token (D-048): SÓ para tiers T7/T3 (destinatário externo) - emite um
 * `GuestTokenPointer` novo e atualiza `DocumentRequest.tokenSelectorHash`/`tokenVersion` NA
 * MESMA transação da claim, nunca separado. Pointer antigo não é revogado ativamente (expira
 * pela própria `expiresAt`/`deadline`, defesa em profundidade já existente em
 * `resolveToken()`). Tier EXPIRED NUNCA rotaciona nem envia link externo - notifica
 * `DocumentRequest.requestedByUserId` em vez do destinatário externo.
 */
import { buildVersionedUpdate, buildVersionedCreate, isTransactionCanceled } from "../../shared/dynamodb/occ.js";
import type { TransactWriteEntry } from "../../shared/dynamodb/occ.js";
import { documentChasingOccurrenceKey, documentChasingIntentKey, type DocumentChasingOccurrence, type DocumentChasingIntent, type DocumentChasingRecipientRef } from "../../modules/subject/domain/document-chasing.js";
import { documentRequestKey, type DocumentRequest } from "../../modules/subject/domain/document-request.js";
import { requirementAssignmentKey, type RequirementAssignment } from "../../modules/subject/domain/requirement-assignment.js";
import { guestTokenPointerKey, issueGuestToken, epochSecondsFromIso, type GuestTokenPointer } from "../../modules/subject/domain/guest-token.js";
import type { SubjectStore } from "../../modules/subject/ports/subject-store.js";
import type { EmailProviderAdapter } from "../../modules/notification/ports/email-provider.js";
import { sanitizeTenantText } from "../../modules/notification/providers/email-templates.js";
import type { ChasingDispatchCommand } from "../../modules/subject/application/document-chasing-producer.js";

const ACTIVE_REQUEST_STATUSES = new Set(["REQUESTED", "OPENED"]);

export interface ChasingDispatchDeps {
  store: SubjectStore;
  tableName: string;
  now: () => string;
  newIntentId: () => string;
  guestTokenPepper: string;
  emailProvider: EmailProviderAdapter;
  /** Resolve o e-mail do usuário interno (tier EXPIRED) - mesmo padrão de
   * `resolveRecipientEmail` já usado por `email-delivery-workflow.ts` (composition root). */
  resolveInternalUserEmail: (input: { tenantId: string; userId: string }) => Promise<string | undefined>;
  /** W5-01/GTR-01 (D-060): resolve `UserProfile.requesterDisplayName` do `requestedByUserId` -
   * usado nos tiers T7/T3 (destinatário externo), mesmo template que `guest-submission-
   * service.ts`'s `getRequestInfo` já interpola. */
  resolveRequesterDisplayName: (input: { tenantId: string; userId: string }) => Promise<string | undefined>;
  /** Base do link de guest upload - placeholder documentado (`https://app.example.invalid/...`)
   * até existir domínio real de frontend, mesma postura já aceita para `cors_allow_origins`. */
  guestUploadBaseUrl: string;
  /** Mesma tolerância/motivo de `reminder-dispatch`'s `dispatch.ts` - generosa vs. o claim TTL,
   * cobre atraso legítimo de retry SQS/Lambda. */
  toleranceMs?: number;
}

export type ChasingDispatchOutcome =
  | { kind: "SENT"; intent: DocumentChasingIntent }
  | { kind: "SEND_FAILED"; intent: DocumentChasingIntent }
  | { kind: "ALREADY_TRIGGERED" }
  | { kind: "CANCELLED_STALE"; reason: string }
  | { kind: "SKIPPED_NOT_CLAIMED" };

async function markIntentOutcome(store: SubjectStore, intent: DocumentChasingIntent, now: string, outcome: { status: "SENT" } | { status: "FAILED"; failureReason: string }): Promise<void> {
  await store.update<DocumentChasingIntent>({
    ...intent,
    status: outcome.status,
    sentAt: outcome.status === "SENT" ? now : undefined,
    failureReason: outcome.status === "FAILED" ? outcome.failureReason : undefined,
    updatedAt: now,
  });
}

export async function dispatchChasingOccurrence(deps: ChasingDispatchDeps, command: ChasingDispatchCommand): Promise<ChasingDispatchOutcome> {
  const { tenantId } = command;
  // occurrenceVersion não é revalidado aqui - mesma convenção de reminder-dispatch/dispatch.ts,
  // que também nunca usa esse campo do comando; a staleness real da OCORRÊNCIA em si já é
  // coberta pela checagem de status (CLAIMED) e pela condição OCC do próprio buildVersionedUpdate
  // abaixo (que usa occurrence.version fresco, nunca o valor ecoado pelo comando).
  const { subjectId, assignmentId, documentRequestId, occurrenceId, scheduledAt, tier, documentRequestVersion } = command.data;

  const occurrence = await deps.store.get<DocumentChasingOccurrence>(documentChasingOccurrenceKey(tenantId, subjectId, assignmentId, documentRequestId, scheduledAt, occurrenceId));
  if (!occurrence) return { kind: "SKIPPED_NOT_CLAIMED" };
  if (occurrence.status === "TRIGGERED") return { kind: "ALREADY_TRIGGERED" };
  if (occurrence.status !== "CLAIMED") return { kind: "SKIPPED_NOT_CLAIMED" };

  const request = await deps.store.get<DocumentRequest>(documentRequestKey(tenantId, subjectId, assignmentId, documentRequestId));

  const toleranceMs = deps.toleranceMs ?? 30 * 60_000;
  const withinTolerance = Math.abs(Date.parse(deps.now()) - Date.parse(occurrence.scheduledAt)) <= toleranceMs;

  const stale =
    !request ||
    !ACTIVE_REQUEST_STATUSES.has(request.status) ||
    request.version !== documentRequestVersion ||
    occurrence.documentRequestVersion !== documentRequestVersion ||
    !withinTolerance;

  if (stale) {
    const reason = !request
      ? "REQUEST_NOT_FOUND"
      : !ACTIVE_REQUEST_STATUSES.has(request.status)
        ? "REQUEST_NOT_ACTIVE"
        : request.version !== documentRequestVersion || occurrence.documentRequestVersion !== documentRequestVersion
          ? "REQUEST_VERSION_MISMATCH"
          : "OUT_OF_TOLERANCE";
    try {
      await deps.store.transactWrite([
        {
          Update: buildVersionedUpdate({
            tableName: deps.tableName,
            key: { PK: occurrence.PK, SK: occurrence.SK },
            tenantId,
            expectedVersion: occurrence.version,
            set: { status: "CANCELLED" },
            remove: ["GSI6PK", "GSI6SK"],
          }),
        },
      ]);
    } catch (err) {
      if (!isTransactionCanceled(err)) throw err;
    }
    return { kind: "CANCELLED_STALE", reason };
  }

  const assignment = await deps.store.get<RequirementAssignment>(requirementAssignmentKey(tenantId, subjectId, assignmentId));
  const requirementName = sanitizeTenantText(assignment?.requirementName, "documento solicitado");
  const now = deps.now();
  const intentId = deps.newIntentId();

  if (tier === "EXPIRED") {
    const recipient: DocumentChasingRecipientRef = { kind: "INTERNAL_USER", userId: request.requestedByUserId };
    const intent: DocumentChasingIntent = {
      ...documentChasingIntentKey(tenantId, subjectId, assignmentId, documentRequestId, intentId),
      entityType: "DocumentChasingIntent",
      intentId,
      tenantId,
      subjectId,
      assignmentId,
      documentRequestId,
      occurrenceId,
      tier,
      recipient,
      templateId: "document-request-chasing-expired-internal",
      templateVersion: 1,
      status: "PENDING",
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const entries: TransactWriteEntry[] = [
      { Put: buildVersionedCreate(deps.tableName, intent as unknown as Record<string, unknown> & { PK: string; SK: string }) },
      {
        Update: buildVersionedUpdate({
          tableName: deps.tableName,
          key: { PK: occurrence.PK, SK: occurrence.SK },
          tenantId,
          expectedVersion: occurrence.version,
          set: { status: "TRIGGERED" },
          remove: ["GSI6PK", "GSI6SK"],
        }),
      },
    ];

    try {
      await deps.store.transactWrite(entries);
    } catch (err) {
      if (isTransactionCanceled(err)) return { kind: "ALREADY_TRIGGERED" };
      throw err;
    }

    const email = await deps.resolveInternalUserEmail({ tenantId, userId: request.requestedByUserId });
    if (!email) {
      await markIntentOutcome(deps.store, intent, now, { status: "FAILED", failureReason: "INTERNAL_USER_EMAIL_NOT_FOUND" });
      return { kind: "SEND_FAILED", intent };
    }

    try {
      await deps.emailProvider.send({
        to: email,
        templateId: intent.templateId,
        templateVersion: intent.templateVersion,
        locale: "pt-BR",
        renderContext: { requirementName, recipientDisplayName: sanitizeTenantText(request.recipientDisplayName, request.recipientEmail) },
        tags: { attemptId: intentId, intentId, tenantId, correlationId: command.correlationId },
      });
      await markIntentOutcome(deps.store, intent, deps.now(), { status: "SENT" });
      return { kind: "SENT", intent };
    } catch (err) {
      await markIntentOutcome(deps.store, intent, deps.now(), { status: "FAILED", failureReason: err instanceof Error ? err.message : "SEND_FAILED" });
      return { kind: "SEND_FAILED", intent };
    }
  }

  // T7/T3: rotaciona o token (D-048) na MESMA transação da claim - nunca separado.
  const issued = issueGuestToken(deps.guestTokenPepper);
  const newTokenVersion = request.tokenVersion + 1;
  const pointer: GuestTokenPointer = {
    ...guestTokenPointerKey(issued.selectorHash),
    entityType: "GuestTokenPointer",
    selectorHash: issued.selectorHash,
    secretHash: issued.secretHash,
    tenantId,
    subjectId,
    assignmentId,
    documentRequestId,
    tokenVersion: newTokenVersion,
    expiresAt: request.tokenExpiresAt,
    purgeAfterTtl: epochSecondsFromIso(request.tokenExpiresAt),
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  const recipient: DocumentChasingRecipientRef = { kind: "EXTERNAL_EMAIL_SNAPSHOT", email: request.recipientEmail };
  const intent: DocumentChasingIntent = {
    ...documentChasingIntentKey(tenantId, subjectId, assignmentId, documentRequestId, intentId),
    entityType: "DocumentChasingIntent",
    intentId,
    tenantId,
    subjectId,
    assignmentId,
    documentRequestId,
    occurrenceId,
    tier,
    recipient,
    templateId: "document-request-chasing",
    templateVersion: 1,
    status: "PENDING",
    version: 1,
    createdAt: now,
    updatedAt: now,
  };

  const entries: TransactWriteEntry[] = [
    { Put: buildVersionedCreate(deps.tableName, pointer as unknown as Record<string, unknown> & { PK: string; SK: string }) },
    {
      Update: buildVersionedUpdate({
        tableName: deps.tableName,
        key: documentRequestKey(tenantId, subjectId, assignmentId, documentRequestId),
        tenantId,
        expectedVersion: request.version,
        set: { tokenSelectorHash: issued.selectorHash, tokenVersion: newTokenVersion },
      }),
    },
    { Put: buildVersionedCreate(deps.tableName, intent as unknown as Record<string, unknown> & { PK: string; SK: string }) },
    {
      Update: buildVersionedUpdate({
        tableName: deps.tableName,
        key: { PK: occurrence.PK, SK: occurrence.SK },
        tenantId,
        expectedVersion: occurrence.version,
        set: { status: "TRIGGERED" },
        remove: ["GSI6PK", "GSI6SK"],
      }),
    },
  ];

  try {
    await deps.store.transactWrite(entries);
  } catch (err) {
    if (isTransactionCanceled(err)) return { kind: "ALREADY_TRIGGERED" };
    throw err;
  }

  const guestLink = `${deps.guestUploadBaseUrl}?token=${encodeURIComponent(issued.token)}`;
  const requesterName = await deps.resolveRequesterDisplayName({ tenantId, userId: request.requestedByUserId });
  try {
    await deps.emailProvider.send({
      to: request.recipientEmail,
      templateId: intent.templateId,
      templateVersion: intent.templateVersion,
      locale: "pt-BR",
      renderContext: { requirementName, requesterName, deadlineLocal: request.deadline?.slice(0, 10), guestLink },
      tags: { attemptId: intentId, intentId, tenantId, correlationId: command.correlationId },
    });
    await markIntentOutcome(deps.store, intent, deps.now(), { status: "SENT" });
    return { kind: "SENT", intent };
  } catch (err) {
    await markIntentOutcome(deps.store, intent, deps.now(), { status: "FAILED", failureReason: err instanceof Error ? err.message : "SEND_FAILED" });
    return { kind: "SEND_FAILED", intent };
  }
}

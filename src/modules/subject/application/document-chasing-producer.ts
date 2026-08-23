/**
 * Lado "chasing" do producer unificado (D-039/D-046/D-048): a linha de claim em si, chamada
 * de dentro do loop de `src/workers/reminder-producer/producer.ts` quando a GSI3SK lida tem a
 * forma `TENANT#t#CHASING#o` (nunca a forma `...#OCCURRENCE#...` do reminder). Mantido FORA de
 * producer.ts para que o arquivo mais maduro/sensível do projeto ganhe só uma chamada de função
 * a mais no lugar do reminder path já existente — a mecânica de claim/outbox em si vive aqui,
 * não lá.
 *
 * Deps deliberadamente estruturais (get/transactWrite), não o tipo nominal
 * `ReminderProducerStore` — o producer já injeta exatamente essa forma, sem acoplar este
 * módulo ao tipo do módulo reminder.
 */
import { buildVersionedUpdate } from "../../../shared/dynamodb/occ.js";
import { appendToTransaction, type DynamoTransactPutEntry } from "../../../shared/outbox/outbox.js";
import { isTransactionCanceled, type EntityKey, type TransactWriteEntry } from "../../../shared/dynamodb/occ.js";
import { buildChasingClaimGsi6Sk, type DocumentChasingOccurrence } from "../domain/document-chasing.js";
import { GSI6PK_WORKSTATE_CLAIMED } from "../../reminder/ports/reconciliation-candidate-source.js";
import type { DomainEvent } from "../../../shared/contracts/events.js";

export interface ChasingProducerStore {
  get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined>;
  transactWrite(entries: TransactWriteEntry[]): Promise<void>;
}

export interface ChasingDispatchCommand {
  messageVersion: 1;
  messageId: string;
  createdAt: string;
  correlationId: string;
  commandType: "document-chasing.dispatch.v1";
  tenantId: string;
  deduplicationKey: string;
  data: {
    subjectId: string;
    assignmentId: string;
    documentRequestId: string;
    occurrenceId: string;
    occurrenceVersion: number;
    tier: string;
    scheduledAt: string;
    documentRequestVersion: number;
  };
}

export interface ChasingClaimDeps {
  store: ChasingProducerStore;
  tableName: string;
  now: () => string;
  claimTtlMs: number;
  newEventId: () => string;
  correlationId: () => string;
}

export type ChasingClaimOutcome =
  | { kind: "CLAIMED"; command: ChasingDispatchCommand }
  | { kind: "SKIPPED_NOT_SCHEDULED" }
  | { kind: "LOST_CLAIM_RACE" };

/** Equivalente ao corpo do loop de `runProducerTick` para o caminho reminder, mas para
 * `DocumentChasingOccurrence`. Chamado com a base PK/SK já lida da linha do GSI3 (projeção
 * KEYS_ONLY sempre inclui as chaves primárias da tabela base, mesmo mecanismo já usado pelo
 * caminho reminder). */
export async function claimChasingOccurrence(deps: ChasingClaimDeps, baseKey: EntityKey): Promise<ChasingClaimOutcome> {
  const occurrence = await deps.store.get<DocumentChasingOccurrence>(baseKey);
  if (!occurrence || occurrence.status !== "SCHEDULED") {
    return { kind: "SKIPPED_NOT_SCHEDULED" };
  }

  const { tenantId, occurrenceId } = occurrence;
  const claimExpiresAt = new Date(Date.parse(deps.now()) + deps.claimTtlMs).toISOString();
  const newVersion = occurrence.version + 1;
  const now = deps.now();
  const correlationId = deps.correlationId();

  const command: ChasingDispatchCommand = {
    messageVersion: 1,
    messageId: deps.newEventId(),
    createdAt: now,
    correlationId,
    commandType: "document-chasing.dispatch.v1",
    tenantId,
    deduplicationKey: `${tenantId}|${occurrenceId}|${newVersion}`,
    data: {
      subjectId: occurrence.subjectId,
      assignmentId: occurrence.assignmentId,
      documentRequestId: occurrence.documentRequestId,
      occurrenceId,
      occurrenceVersion: newVersion,
      tier: occurrence.tier,
      scheduledAt: occurrence.scheduledAt,
      documentRequestVersion: occurrence.documentRequestVersion,
    },
  };

  const event: DomainEvent = {
    specVersion: "1.0",
    eventId: deps.newEventId(),
    eventType: "DocumentChasingDispatchRequested",
    source: "expiration-tracker.document-chasing-producer",
    occurredAt: now,
    correlationId,
    tenantId,
    actor: { type: "SYSTEM" },
    aggregate: { type: "DocumentChasingOccurrence", id: occurrenceId, version: newVersion },
    data: command as unknown as Record<string, unknown>,
  };
  const outboxEntries: DynamoTransactPutEntry[] = [];
  appendToTransaction(outboxEntries, deps.tableName, event, "SQS_DOCUMENT_CHASING_DISPATCH_V1");

  try {
    await deps.store.transactWrite([
      {
        Update: buildVersionedUpdate({
          tableName: deps.tableName,
          key: { PK: occurrence.PK, SK: occurrence.SK },
          tenantId,
          expectedVersion: occurrence.version,
          set: {
            status: "CLAIMED",
            claimedAt: deps.now(),
            claimExpiresAt,
            GSI6PK: GSI6PK_WORKSTATE_CLAIMED,
            GSI6SK: buildChasingClaimGsi6Sk(claimExpiresAt, tenantId, occurrenceId),
          },
        }),
      },
      ...outboxEntries,
    ]);
  } catch (err) {
    if (isTransactionCanceled(err)) {
      return { kind: "LOST_CLAIM_RACE" };
    }
    throw err;
  }

  return { kind: "CLAIMED", command };
}

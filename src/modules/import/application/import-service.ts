/**
 * ImportService — lado HTTP de M11 (D-042): reservar upload (presigned PUT, mesmo padrão de
 * document-service.ts's reserveUpload), consultar status, solicitar commit. O parse/commit
 * em si roda em workers assíncronos (import-parse-service.ts/import-commit-service.ts),
 * disparados por evento S3 (parse) e por outbox (commit) respectivamente — nunca síncronos
 * aqui, mesmo para preview pequeno (design: "sync só até 128 KiB/100 linhas" fica registrado
 * como possível otimização futura, não implementado em v1 — simplicidade > latência agora).
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "../../identity/domain/request-context.js";
import { authorize } from "../../identity/domain/authorization.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import { buildVersionedUpdate } from "../../../shared/dynamodb/occ.js";
import { IdempotencyStore, transitionIdempotencyStatus, type DynamoLike } from "../../../shared/idempotency/idempotency.js";
import { appendToTransaction } from "../../../shared/outbox/outbox.js";
import type { DomainEvent } from "../../../shared/contracts/events.js";
import { importJobKey, IMPORT_JOB_TTL_SECONDS, MAX_IMPORT_FILE_BYTES, type ImportJob } from "../domain/import-job.js";
import { isTransactionCanceled, type ImportStore, type TransactWriteEntry } from "../ports/import-store.js";
import type { UploadUrlSigner } from "../../document/ports/upload-url-signer.js";
import type { ImportIdGenerator } from "./id-generator.js";
import type { TenantQuotaService } from "../../identity/application/quota.js";

const PRESIGN_TTL_SECONDS = 15 * 60;
const OPERATION = "import.reserve";

export interface ReserveImportInput {
  contentLength: number;
  checksumSha256: string;
}

export interface ReserveImportResult {
  jobId: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresAt: string;
}

/** Envelope da mensagem SQS_IMPORT_COMMIT_V1 - schemas/queues/import-commit.v1.json. Mesmo
 * padrão do `DispatchCommand` de reminder-producer/producer.ts: como o relay/sweeper só
 * reenvia `OutboxRecord.payload` (== `DomainEvent.data`), este tipo precisa carregar sozinho
 * tudo que command-envelope.v1.json exige no nível raiz (tenantId incluso). */
export interface ImportCommitCommand {
  messageVersion: 1;
  messageId: string;
  createdAt: string;
  correlationId: string;
  commandType: "import.commit.v1";
  tenantId: string;
  deduplicationKey: string;
  data: { jobId: string };
}

export interface ImportServiceDeps {
  store: ImportStore;
  tableName: string;
  rawBucket: string;
  ids: ImportIdGenerator;
  signer: UploadUrlSigner;
  quota: TenantQuotaService;
  now?: () => string;
}

export class ImportService {
  private readonly store: ImportStore;
  private readonly tableName: string;
  private readonly rawBucket: string;
  private readonly ids: ImportIdGenerator;
  private readonly signer: UploadUrlSigner;
  private readonly quota: TenantQuotaService;
  private readonly now: () => string;
  private readonly idempotency: IdempotencyStore;

  constructor(deps: ImportServiceDeps) {
    this.store = deps.store;
    this.tableName = deps.tableName;
    this.rawBucket = deps.rawBucket;
    this.ids = deps.ids;
    this.signer = deps.signer;
    this.quota = deps.quota;
    this.now = deps.now ?? (() => new Date().toISOString());
    const adapter: DynamoLike = {
      putIfAbsent: async (item) => ((await this.store.putIfAbsent(item)) ? "PUT" : "ALREADY_EXISTS"),
      get: (key) => this.store.get(key),
      update: (item) => this.store.update(item),
      transitionIfStatus: (item, expectedStatus) => transitionIdempotencyStatus(this.store, this.tableName, item, expectedStatus),
    };
    this.idempotency = new IdempotencyStore(adapter, this.tableName, this.now);
  }

  async reserveImport(ctx: RequestContext, input: ReserveImportInput, idempotencyKey: string): Promise<ReserveImportResult> {
    authorize({ context: ctx, action: "import:create", resource: { tenantId: ctx.tenant.tenantId } });

    if (input.contentLength <= 0 || input.contentLength > MAX_IMPORT_FILE_BYTES) {
      throw new ValidationError("contentLength must be between 1 byte and 5 MiB.", { contentLength: input.contentLength, maxBytes: MAX_IMPORT_FILE_BYTES });
    }
    if (!/^[a-f0-9]{64}$/i.test(input.checksumSha256)) {
      throw new ValidationError("checksumSha256 must be a 64-character hex SHA-256 digest.");
    }

    // Novos tipos de quota (design): IMPORT_COUNT (jobs por janela) e IMPORT_BYTES (soma de
    // bytes reservados por janela) - separados de UPLOAD_* (M6), mesmo mecanismo
    // TenantQuotaService já testado. IMPORT_ROWS é verificado no parse worker (só ali o
    // total real de linhas é conhecido).
    await this.quota.consume({ tenantId: ctx.tenant.tenantId, quotaType: "IMPORT_COUNT", window: "current", limit: 10, windowSeconds: 60 * 60 });
    await this.quota.consume({ tenantId: ctx.tenant.tenantId, quotaType: "IMPORT_BYTES", window: "current", limit: 50 * MAX_IMPORT_FILE_BYTES, windowSeconds: 60 * 60 });

    const requestHash = `${input.contentLength}|${input.checksumSha256}`;
    const now = this.now();
    const expiresAt = new Date(Date.parse(now) + PRESIGN_TTL_SECONDS * 1000).toISOString();

    const begin = await this.idempotency.begin({ tenantId: ctx.tenant.tenantId, operation: OPERATION, key: idempotencyKey, requestHash, expiresAt });

    let jobId: string;
    if (begin === "COMPLETED_SAME_REQUEST") {
      const record = await this.store.get({ PK: `TENANT#${ctx.tenant.tenantId}#IDEMPOTENCY#${OPERATION}`, SK: `KEY#${idempotencyKey}` });
      const existingJobId = (record as { responseRef?: string } | undefined)?.responseRef;
      if (!existingJobId) throw new ConflictError("reserveImport idempotency record missing responseRef.");
      jobId = existingJobId;
    } else {
      jobId = this.ids.newImportJobId();
      const jobExpiresAt = new Date(Date.parse(now) + IMPORT_JOB_TTL_SECONDS * 1000).toISOString();
      const job: ImportJob = {
        ...importJobKey(ctx.tenant.tenantId, jobId),
        entityType: "ImportJob",
        jobId,
        tenantId: ctx.tenant.tenantId,
        targetEntityType: "TrackedSubject",
        status: "UPLOADED",
        createdByUserId: ctx.principal.userId,
        checksumSha256: input.checksumSha256,
        mappingVersion: 1,
        expiresAt: jobExpiresAt,
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      await this.store.putIfAbsent(job);
      await this.idempotency.complete({ tenantId: ctx.tenant.tenantId, operation: OPERATION, key: idempotencyKey, responseRef: jobId });
    }

    const key = this.rawObjectKey(ctx.tenant.tenantId, jobId);
    const { uploadUrl, requiredHeaders } = await this.signer.presignUpload({
      bucket: this.rawBucket,
      key,
      mediaType: "text/csv",
      contentLength: input.contentLength,
      checksumSha256: input.checksumSha256,
      metadata: { tenantId: ctx.tenant.tenantId, jobId },
      expiresInSeconds: PRESIGN_TTL_SECONDS,
    });

    return { jobId, uploadUrl, requiredHeaders, expiresAt };
  }

  async getImportJob(ctx: RequestContext, jobId: string): Promise<ImportJob> {
    authorize({ context: ctx, action: "import:read", resource: { tenantId: ctx.tenant.tenantId } });
    const job = await this.store.get<ImportJob>(importJobKey(ctx.tenant.tenantId, jobId));
    if (!job) throw new NotFoundError("ImportJob not found.", { jobId });
    return job;
  }

  async requestCommit(ctx: RequestContext, jobId: string, expectedVersion: number): Promise<void> {
    authorize({ context: ctx, action: "import:commit", resource: { tenantId: ctx.tenant.tenantId } });
    const job = await this.store.get<ImportJob>(importJobKey(ctx.tenant.tenantId, jobId));
    if (!job) throw new NotFoundError("ImportJob not found.", { jobId });
    if (job.status !== "PREVIEW_READY") {
      throw new ConflictError(`ImportJob must be PREVIEW_READY to commit (current status: ${job.status}).`, { jobId, status: job.status });
    }

    const now = this.now();
    const entries: TransactWriteEntry[] = [
      {
        Update: buildVersionedUpdate({
          tableName: this.tableName,
          key: importJobKey(ctx.tenant.tenantId, jobId),
          tenantId: ctx.tenant.tenantId,
          expectedVersion,
          set: { status: "COMMITTING" },
        }),
      },
    ];
    // O relay/sweeper só reenvia `event.data` para a fila (nunca o DomainEvent completo) -
    // por isso `data` aqui precisa já SER o envelope inteiro exigido por command-envelope.v1.json
    // (messageVersion/messageId/tenantId/deduplicationKey no nível raiz), mesmo padrão do
    // DispatchCommand de reminder-producer/producer.ts. Sem isso o commit worker nunca teria
    // tenantId disponível na mensagem SQS.
    const command: ImportCommitCommand = {
      messageVersion: 1,
      messageId: randomUUID(),
      createdAt: now,
      correlationId: ctx.correlationId,
      commandType: "import.commit.v1",
      tenantId: ctx.tenant.tenantId,
      deduplicationKey: `${ctx.tenant.tenantId}|${jobId}|${expectedVersion + 1}`,
      data: { jobId },
    };
    const event: DomainEvent = {
      specVersion: "1.0",
      eventId: randomUUID(),
      eventType: "ImportCommitRequested",
      source: "expiration-tracker.import-service",
      occurredAt: now,
      correlationId: ctx.correlationId,
      tenantId: ctx.tenant.tenantId,
      actor: { type: "USER", userId: ctx.principal.userId },
      aggregate: { type: "ImportJob", id: jobId, version: expectedVersion + 1 },
      data: command as unknown as Record<string, unknown>,
    };
    appendToTransaction(entries, this.tableName, event, "SQS_IMPORT_COMMIT_V1");

    try {
      await this.store.transactWrite(entries);
    } catch (err) {
      if (isTransactionCanceled(err)) throw new ConflictError("Failed to request import commit under contention.", { jobId });
      throw err;
    }
  }

  private rawObjectKey(tenantId: string, jobId: string): string {
    // Nunca o nome de arquivo original (mesmo motivo de M6's quarantineKey) - só IDs internos.
    return `tenant/${tenantId}/imports/${jobId}/raw.csv`;
  }
}

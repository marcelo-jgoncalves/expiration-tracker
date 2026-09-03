/**
 * ImportService — lado HTTP de M11 (D-042): reservar upload (presigned PUT, mesmo padrão de
 * document-service.ts's reserveUpload), consultar status, solicitar commit. O parse/commit
 * em si roda em workers assíncronos (import-parse-service.ts/import-commit-service.ts),
 * disparados por evento S3 (parse) e por outbox (commit) respectivamente — nunca síncronos
 * aqui, mesmo para preview pequeno (design: "sync só até 128 KiB/100 linhas" fica registrado
 * como possível otimização futura, não implementado em v1 — simplicidade > latência agora).
 */
import { createHash, randomUUID } from "node:crypto";
import type { RequestContext } from "../../identity/domain/request-context.js";
import { authorize } from "../../identity/domain/authorization.js";
import { ConflictError, NotFoundError, ValidationError, TenantNotActiveError } from "../../../shared/errors/app-error.js";
import { buildVersionedUpdate, buildVersionedCreate } from "../../../shared/dynamodb/occ.js";
import { executeTenantBusinessMutation } from "../../../shared/tenant-lifecycle/tenant-business-mutation.js";
import { IdempotencyStore, transitionIdempotencyStatus, type DynamoLike } from "../../../shared/idempotency/idempotency.js";
import { appendToTransaction } from "../../../shared/outbox/outbox.js";
import type { DomainEvent } from "../../../shared/contracts/events.js";
import { canonicalJsonStringify } from "../../../shared/json/canonical-json.js";
import {
  importJobKey,
  IMPORT_JOB_TTL_SECONDS,
  MAX_IMPORT_FILE_BYTES,
  DEFAULT_TRACKED_SUBJECT_COLUMN_MAPPING,
  FIELD_CATALOG,
  buildImportJobClaim,
  type ImportJob,
  type ColumnMapping,
  type ImportTargetEntityType,
} from "../domain/import-job.js";
import { isTransactionCanceled, type ImportStore, type TransactWriteEntry } from "../ports/import-store.js";
import type { ImportObjectStore } from "../ports/import-object-store.js";
import { parseCsv } from "./csv-parser.js";
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
  /** D-192 slice 9: only required by `getImportJobSchema()`/`submitImportMapping()` (both read
   * the raw CSV to sniff headers). Optional so every pre-existing test/composition that never
   * exercises those two new methods keeps working unchanged. */
  objectStore?: ImportObjectStore;
  now?: () => string;
}

/** `GET /import-jobs/{jobId}/schema` result — D-192 §3. `objectETag` is diagnostic-only for the
 * UI (design §9, qualification 1: "não-autoritativo" — there is an accepted TOCTOU between this
 * read and the real parse; `columnMappingSha256` is what actually fences correctness, not this). */
export interface ImportJobSchemaResult {
  targetEntityType: ImportTargetEntityType;
  fields: { field: string; required: boolean }[];
  headers: string[];
  sampleRows: string[][];
  objectETag: string | undefined;
}

const SAMPLE_ROW_COUNT = 5;

function rawCsvNotYetUploaded(err: unknown): boolean {
  const e = err as { name?: string; Code?: string } | undefined;
  return e?.name === "NoSuchKey" || e?.Code === "NoSuchKey";
}

/** Which `ColumnMapping.columns` values are actual CSV header references (vs. fixed-vocabulary
 * mode selectors like `subjectRefKind`/`documentTypeRefKind`, which are never header names) —
 * only these are checked against the uploaded file's real header. Kept in one place so the
 * `submitImportMapping()` validation and any future caller never drift on which fields mean
 * "a column in the file" vs. "a client-chosen enum". */
function mappingHeaderRefFields(mapping: ColumnMapping): string[] {
  const fields: (string | undefined)[] =
    mapping.targetKind === "TrackedSubject"
      ? [mapping.columns.displayName, mapping.columns.type, mapping.columns.externalId, mapping.columns.notes, mapping.columns.tags]
      : mapping.targetKind === "Document"
        ? [mapping.columns.subjectRef, mapping.columns.documentTypeRef, mapping.columns.hasValidity, mapping.columns.externalId]
        : [mapping.columns.subjectRef, mapping.columns.name, mapping.columns.notes, mapping.columns.applicability, mapping.columns.externalId];
  return fields.filter((f): f is string => !!f);
}

export class ImportService {
  private readonly store: ImportStore;
  private readonly tableName: string;
  private readonly rawBucket: string;
  private readonly ids: ImportIdGenerator;
  private readonly signer: UploadUrlSigner;
  private readonly quota: TenantQuotaService;
  private readonly objectStore: ImportObjectStore | undefined;
  private readonly now: () => string;
  private readonly idempotency: IdempotencyStore;

  constructor(deps: ImportServiceDeps) {
    this.store = deps.store;
    this.tableName = deps.tableName;
    this.rawBucket = deps.rawBucket;
    this.ids = deps.ids;
    this.signer = deps.signer;
    this.quota = deps.quota;
    this.objectStore = deps.objectStore;
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

    const requestHash = `${input.contentLength}|${input.checksumSha256}`;
    const now = this.now();
    const expiresAt = new Date(Date.parse(now) + PRESIGN_TTL_SECONDS * 1000).toISOString();

    // W3-07 D-072/D-075/D-076 item 3, re-reviewed (Codex round 3, still BLOCKING at 6.0/10):
    // idempotency.begin() now runs FIRST, before either quota.consume() call - the ordering
    // Codex's own lower-effort mitigation suggested and this session's first attempt did NOT
    // implement (it left both quota.consume() calls ahead of begin(), which meant: a plain retry
    // charged quota again on every call even when begin() would return COMPLETED_SAME_REQUEST; a
    // concurrent second caller with the SAME idempotency key still consumed quota before losing
    // the race at begin(), leaking it forever; and a failure on the SECOND quota.consume() (after
    // the first already succeeded) had no compensation at all, since the try/catch only wrapped
    // job creation). Reordering closes all three: a replay short-circuits before quota is ever
    // touched; a losing concurrent caller's begin() throws ConcurrentOperationError before quota
    // is touched; and both quota.consume() calls now live inside the same try/catch as job
    // creation, with per-call success tracked so compensation only releases what was actually
    // consumed on THIS attempt.
    const begin = await this.idempotency.begin({ tenantId: ctx.tenant.tenantId, operation: OPERATION, key: idempotencyKey, requestHash, expiresAt });

    let jobId: string;
    if (begin === "COMPLETED_SAME_REQUEST") {
      const record = await this.store.get({ PK: `TENANT#${ctx.tenant.tenantId}#IDEMPOTENCY#${OPERATION}`, SK: `KEY#${idempotencyKey}` });
      const existingJobId = (record as { responseRef?: string } | undefined)?.responseRef;
      if (!existingJobId) throw new ConflictError("reserveImport idempotency record missing responseRef.");
      jobId = existingJobId;
    } else {
      // Codex round 4 (D-080) non-blocking finding: jobId/jobExpiresAt/job construction used to
      // sit BETWEEN idempotency.begin() (ACQUIRED) and the try/catch below that owns compensation
      // - if the injected ID generator (this.ids.newImportJobId()) or the Date/object
      // construction ever threw, the idempotency record would be stuck IN_PROGRESS with no
      // compensation reachable (quota was never touched at that point, so no quota leak, but the
      // idempotency key would still wedge). Moved inside the try so idempotency.abort() below
      // covers this window too, not just the quota/job-creation window it already covered.
      let countConsumed = false;
      let bytesConsumed = false;
      let jobIdForResponse!: string;
      try {
        jobIdForResponse = this.ids.newImportJobId();
        const jobExpiresAt = new Date(Date.parse(now) + IMPORT_JOB_TTL_SECONDS * 1000).toISOString();
        const job: ImportJob = {
          ...importJobKey(ctx.tenant.tenantId, jobIdForResponse),
          entityType: "ImportJob",
          jobId: jobIdForResponse,
          tenantId: ctx.tenant.tenantId,
          targetEntityType: "TrackedSubject",
          status: "UPLOADED",
          createdByUserId: ctx.principal.userId,
          checksumSha256: input.checksumSha256,
          // D-192 §3 backward compat: um job TrackedSubject sempre nasce com o mapeamento fixo
          // v1 já preenchido (CSV header convention de D-042) - nunca passa por
          // AWAITING_MAPPING, vai direto UPLOADED->PARSING quando o evento S3 chegar, exatamente
          // como hoje. Só Document/Requirement (fatia futura, POST /mapping) nascem sem ele.
          columnMapping: DEFAULT_TRACKED_SUBJECT_COLUMN_MAPPING,
          columnMappingSha256: createHash("sha256").update(JSON.stringify(DEFAULT_TRACKED_SUBJECT_COLUMN_MAPPING), "utf-8").digest("hex"),
          expiresAt: jobExpiresAt,
          createdAt: now,
          updatedAt: now,
          version: 1,
        };
        // Novos tipos de quota (design): IMPORT_COUNT (jobs por janela) e IMPORT_BYTES (soma de
        // bytes reservados por janela) - separados de UPLOAD_* (M6), mesmo mecanismo
        // TenantQuotaService já testado. IMPORT_ROWS é verificado no parse worker (só ali o
        // total real de linhas é conhecido). Only reached on ACQUIRED - a replay or a losing
        // concurrent caller never touches quota at all (see comment above).
        await this.quota.consume({ tenantId: ctx.tenant.tenantId, quotaType: "IMPORT_COUNT", window: "current", limit: 10, windowSeconds: 60 * 60 });
        countConsumed = true;
        await this.quota.consume({ tenantId: ctx.tenant.tenantId, quotaType: "IMPORT_BYTES", window: "current", limit: 50 * MAX_IMPORT_FILE_BYTES, windowSeconds: 60 * 60 });
        bytesConsumed = true;

        // W3-07 (D-070 chunk 8/N): ImportJob creation was a bare `putIfAbsent` (single item, no
        // transaction) - converted to a 1-entry TransactWriteItems through
        // executeTenantBusinessMutation so the real admission point that gates a NEW presigned
        // URL issuance is fenced, same pattern as document-service.ts's reserveUpload. This is
        // additive on top of the already-transitive protection from quota.consume() above
        // (IMPORT_COUNT/IMPORT_BYTES) - that fence protects the quota row, this one protects the
        // job row itself against the gap between the quota check and this write.
        await executeTenantBusinessMutation({
          store: this.store,
          tableName: this.tableName,
          tenantId: ctx.tenant.tenantId,
          entries: [{ Put: buildVersionedCreate(this.tableName, job as unknown as Record<string, unknown> & { PK: string; SK: string }) }],
        });
      } catch (err) {
        // W3-07 D-072/D-075/D-076 item 3 review: a failure anywhere in this block (either quota
        // reservation, or the fenced job creation) previously left whatever HAD succeeded so far
        // permanently leaked - the idempotency key stuck IN_PROGRESS forever (same "idempotency
        // liveness residual" class of bug abort() exists to close elsewhere, e.g. renewItem's
        // OCC-conflict path) and any already-consumed quota recoverable only by window expiry.
        // This does NOT unify the sequence into one larger transaction (that trade-off - latency
        // vs. atomicity - remains the deferred product decision, D-074/D-075) - it is a cheap,
        // fail-closed compensating mitigation for the failure window that exists either way:
        // best-effort release only what THIS attempt actually reserved before rethrowing, so a
        // failed reservation attempt does not also poison the tenant's quota or idempotency key
        // for a request that never actually got admitted. Every compensation is best-effort and
        // swallowed (never lets a compensation failure hide the real error, or block the caller
        // from seeing/retrying it) - same discipline as the evidence-mutation workers' orphan-
        // object compensation (D-072 finding 3).
        const compensations: Promise<unknown>[] = [
          this.idempotency.abort({ tenantId: ctx.tenant.tenantId, operation: OPERATION, key: idempotencyKey }),
        ];
        if (countConsumed) {
          compensations.push(this.quota.release({ tenantId: ctx.tenant.tenantId, quotaType: "IMPORT_COUNT", window: "current", windowSeconds: 60 * 60 }));
        }
        if (bytesConsumed) {
          compensations.push(this.quota.release({ tenantId: ctx.tenant.tenantId, quotaType: "IMPORT_BYTES", window: "current", windowSeconds: 60 * 60 }));
        }
        await Promise.allSettled(compensations);
        if (err instanceof TenantNotActiveError) throw err;
        throw new ConflictError("Failed to reserve import job.", { cause: err instanceof Error ? err.message : String(err) });
      }
      jobId = jobIdForResponse;
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

  /**
   * `GET /import-jobs/{jobId}/schema` (D-192 §3, slice 9) — read-only, allowed only in
   * `UPLOADED`/`AWAITING_MAPPING` (the two states a client can still submit a mapping into).
   * Sniffs the raw CSV's header + a small sample so a client can build a mapping UI, alongside
   * `FIELD_CATALOG`'s per-`targetEntityType` field list. Judgment call vs. the design's literal
   * 64 KiB `Range` GET: `objectStore.getObject()` fetches the whole object (the module's port is
   * deliberately small, no Range support — see `ports/import-object-store.ts`) — safe given the
   * pre-existing 5 MiB file cap (`MAX_IMPORT_FILE_BYTES`), same worst case the parse worker
   * already reads in full; only the true streaming-Range optimization is deferred, not any
   * correctness property (header/sample content is byte-identical either way).
   */
  async getImportJobSchema(ctx: RequestContext, jobId: string): Promise<ImportJobSchemaResult> {
    authorize({ context: ctx, action: "import:read", resource: { tenantId: ctx.tenant.tenantId } });
    const job = await this.store.get<ImportJob>(importJobKey(ctx.tenant.tenantId, jobId));
    if (!job) throw new NotFoundError("ImportJob not found.", { jobId });
    if (job.status !== "UPLOADED" && job.status !== "AWAITING_MAPPING") {
      throw new ConflictError(`ImportJob schema is only readable in UPLOADED/AWAITING_MAPPING (current status: ${job.status}).`, { jobId, status: job.status });
    }
    if (!this.objectStore) throw new Error("ImportService.objectStore dependency required for getImportJobSchema().");

    const { headers, sampleRows, objectETag } = await this.readCsvHeaderAndSample(ctx.tenant.tenantId, jobId);
    return { targetEntityType: job.targetEntityType, fields: FIELD_CATALOG[job.targetEntityType], headers, sampleRows, objectETag };
  }

  /**
   * `POST /import-jobs/{jobId}/mapping` (D-192 §3, slice 9). Validates the submitted mapping
   * against the job's `targetEntityType` (400 on mismatch — defensive per §2, `targetKind` is
   * never an independent source of truth) and, when the raw file has already arrived, against
   * its actual CSV headers (a header a client maps to that doesn't exist in the file is a 400,
   * never silently accepted and only discovered at parse time). Then performs the
   * `AWAITING_MAPPING`->`PARSING` (or `UPLOADED`->`UPLOADED`, mapping-only) OCC-guarded
   * transition from `buildImportJobClaim()`, dispatching `SQS_IMPORT_PARSE_V1` in the SAME
   * `TransactWriteItems` only when the transition actually resolves to `PARSING`.
   */
  async submitImportMapping(ctx: RequestContext, jobId: string, mapping: ColumnMapping, expectedVersion: number): Promise<{ status: ImportJob["status"] }> {
    authorize({ context: ctx, action: "import:map", resource: { tenantId: ctx.tenant.tenantId } });
    const job = await this.store.get<ImportJob>(importJobKey(ctx.tenant.tenantId, jobId));
    if (!job) throw new NotFoundError("ImportJob not found.", { jobId });
    if (job.status !== "UPLOADED" && job.status !== "AWAITING_MAPPING") {
      throw new ConflictError(`ImportJob mapping can only be submitted in UPLOADED/AWAITING_MAPPING (current status: ${job.status}).`, { jobId, status: job.status });
    }
    if (mapping.targetKind !== job.targetEntityType) {
      throw new ValidationError("columnMapping.targetKind does not match ImportJob.targetEntityType.", { targetKind: mapping.targetKind, targetEntityType: job.targetEntityType });
    }

    const catalog = FIELD_CATALOG[job.targetEntityType];
    const columns = mapping.columns as Record<string, string | undefined>;
    for (const entry of catalog) {
      if (entry.required && !columns[entry.field]?.trim()) {
        throw new ValidationError(`columnMapping is missing required field "${entry.field}".`, { field: entry.field });
      }
    }

    // Header-vs-file validation only when the raw file has already arrived — per §3, a job can
    // still be UPLOADED with the file not yet delivered (S3 hasn't confirmed to the backend
    // synchronously), and this POST must still accept a mapping-only write in that case.
    let fileHeaders: string[] | undefined;
    if (this.objectStore) {
      try {
        const sniffed = await this.readCsvHeaderAndSample(ctx.tenant.tenantId, jobId);
        fileHeaders = sniffed.headers;
      } catch (err) {
        if (!rawCsvNotYetUploaded(err)) throw err;
      }
    }
    if (fileHeaders) {
      const normalizedHeaders = new Set(fileHeaders.map((h) => h.trim().toLowerCase()));
      const referencedHeaderFields = mappingHeaderRefFields(mapping);
      for (const headerName of referencedHeaderFields) {
        if (!normalizedHeaders.has(headerName.trim().toLowerCase())) {
          throw new ValidationError(`columnMapping references a column not present in the uploaded CSV header: "${headerName}".`, { headerName });
        }
      }
    }

    const now = this.now();
    const columnMappingSha256 = createHash("sha256").update(canonicalJsonStringify(mapping), "utf-8").digest("hex");
    const toStatus: ImportJob["status"] = job.status === "AWAITING_MAPPING" ? "PARSING" : "UPLOADED";

    const entries: TransactWriteEntry[] = [
      buildImportJobClaim({
        tableName: this.tableName,
        tenantId: ctx.tenant.tenantId,
        jobId,
        expectedVersion,
        fromStatus: job.status,
        toStatus,
        set: { columnMapping: mapping, columnMappingSha256, updatedAt: now },
      }),
    ];

    if (toStatus === "PARSING") {
      const event: DomainEvent = {
        specVersion: "1.0",
        eventId: randomUUID(),
        eventType: "ImportMappingSubmitted",
        source: "expiration-tracker.import-service",
        occurredAt: now,
        correlationId: ctx.correlationId,
        tenantId: ctx.tenant.tenantId,
        actor: { type: "USER", userId: ctx.principal.userId },
        aggregate: { type: "ImportJob", id: jobId, version: expectedVersion + 1 },
        data: { tenantId: ctx.tenant.tenantId, jobId },
      };
      appendToTransaction(entries, this.tableName, event, "SQS_IMPORT_PARSE_V1");
    }

    try {
      await this.store.transactWrite(entries);
    } catch (err) {
      if (isTransactionCanceled(err)) throw new ConflictError("Failed to submit import mapping under contention.", { jobId });
      throw err;
    }

    return { status: toStatus };
  }

  private async readCsvHeaderAndSample(tenantId: string, jobId: string): Promise<{ headers: string[]; sampleRows: string[][]; objectETag: string }> {
    if (!this.objectStore) throw new Error("ImportService.objectStore dependency required.");
    const bytes = await this.objectStore.getObject(this.rawBucket, this.rawObjectKey(tenantId, jobId));
    const objectETag = createHash("sha256").update(bytes).digest("hex");
    const { header, rows } = parseCsv(bytes.toString("utf-8"));
    return { headers: header, sampleRows: rows.slice(0, SAMPLE_ROW_COUNT), objectETag };
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

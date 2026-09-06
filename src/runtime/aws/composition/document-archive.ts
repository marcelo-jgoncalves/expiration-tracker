/** Composition root for the document-archive module against real DynamoDB (D-143 Nucleus 1/2). */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import type { AppConfigDataClient } from "@aws-sdk/client-appconfigdata";
import { DynamoDbDocumentArchiveStore } from "../../../modules/document-archive/persistence/dynamodb-document-archive-store.js";
import { DocumentArchiveService } from "../../../modules/document-archive/application/document-archive-service.js";
import { DocumentArchiveGuestRateLimiter } from "../../../modules/document-archive/application/document-archive-guest-rate-limiter.js";
import { GuestDocumentAccessService } from "../../../modules/document-archive/application/guest-document-access-service.js";
import { DocumentRequestRecurrenceService } from "../../../modules/document-archive/application/document-request-recurrence-service.js";
import { S3UploadUrlSigner } from "../../../modules/document/persistence/s3-upload-url-signer.js";
import { S3DocumentObjectStore } from "../../../modules/document/persistence/s3-document-object-store.js";
import { S3DossierExportStore } from "../../../modules/document-archive/persistence/s3-dossier-export-store.js";
import { AppConfigFeatureFlagsReader } from "../../../modules/extraction/persistence/appconfig-feature-flags-reader.js";
import { UlidIdGenerator } from "../ids.js";
import { buildMemberEligibilityChecker } from "./expiration.js";

/** D-163 §7: reuses the SAME quarantine bucket M6 already provisions (`QUARANTINE_BUCKET_NAME`,
 * `infra/modules/document-buckets`) — no new bucket for `DocumentFile`, only a new key
 * namespace within it (`DocumentArchiveService.buildQuarantineKey`). Item 3 (2026-09-02): also
 * reuses M6's own `S3UploadUrlSigner` adapter verbatim — the port is bucket-agnostic, no new
 * signer implementation needed for a second module presigning against the same bucket.
 * `reportExportsBucketName` (D-205 fatia 3, decision 9) is optional so every OTHER caller of
 * this composition (guest/worker deps, and this same function for routes that never touch the
 * dossier download route) keeps working unchanged - only `document-archive-handler.ts`'s
 * download route actually needs `dossierExportStore` wired. Reuses D-204's `report_exports`
 * bucket under a distinct key prefix, never a new bucket. */
export function buildDocumentArchiveDeps(client: DynamoDBDocumentClient, tableName: string, quarantineBucket: string, reportExportsBucketName?: string) {
  const store = new DynamoDbDocumentArchiveStore(client, tableName);
  const ids = new UlidIdGenerator();
  const signer = new S3UploadUrlSigner(new S3Client({}));
  // D-194 Fatia 2: same THIN adapter `buildExpirationDeps` already builds against the shared
  // main table - reused verbatim (not duplicated) so both modules validate `assigneeUserId`
  // against the exact same eligibility rule.
  const members = buildMemberEligibilityChecker(client, tableName);
  const documentArchive = new DocumentArchiveService({ store, tableName, ids, quarantineBucket, signer, members });
  // D-143 Nucleus 2, entity 3/3 (Decision 8, D-147). Shares the same store/ids as
  // `documentArchive` above — recurrence is not a separate module, just a separate service
  // class within document-archive (same rationale `document-archive-service.ts`'s doc comment
  // gives for hosting Requirement in the same class rather than a new one).
  const recurrence = new DocumentRequestRecurrenceService({ store, tableName, ids });
  const dossierExportStore = reportExportsBucketName ? new S3DossierExportStore(new S3Client({}), reportExportsBucketName) : undefined;
  // `ids` is also returned directly (not just embedded in the services above) - D-166's
  // DocumentFileReconciliationWorker needs it for `apply-file-scan-result.ts`'s
  // `ApplyFileScanResultDeps` shape (unused by `applyFileScanTimeout` itself, but the type is
  // shared with `applyFileScanResult`/`confirmFileScanClean`, which do use it).
  return { store, ids, documentArchive, recurrence, dossierExportStore };
}

/** D-205 fatia 2: composition root for the DossierExportGenerationWorker Lambda. Reuses the SAME
 * `DocumentArchiveService`/store shapes `buildDocumentArchiveDeps` above already builds - a
 * fresh instance here, not the shared one, since this Lambda's own module-level singleton never
 * overlaps with the document-archive-handler Lambda's. */
export function buildDossierExportGenerationDeps(client: DynamoDBDocumentClient, tableName: string, quarantineBucket: string, reportExportsBucketName: string) {
  const store = new DynamoDbDocumentArchiveStore(client, tableName);
  const ids = new UlidIdGenerator();
  const signer = new S3UploadUrlSigner(new S3Client({}));
  const members = buildMemberEligibilityChecker(client, tableName);
  const documentArchive = new DocumentArchiveService({ store, tableName, ids, quarantineBucket, signer, members });
  const exportStore = new S3DossierExportStore(new S3Client({}), reportExportsBucketName);
  return { store, tableName, documentArchive, exportStore, now: () => new Date().toISOString() };
}

/** D-193 ("Ingestão física") — the third `upload-finalizer-handler.ts`/`malware-result-
 * handler.ts` branch's deps. Reuses M6's own bucket-agnostic `S3DocumentObjectStore` verbatim
 * (same "port is bucket-agnostic, no new adapter" reasoning `buildDocumentArchiveDeps`'s doc
 * comment already gives for reusing `S3UploadUrlSigner`) — `document-archive`'s clean/quarantine
 * copy-and-verify needs exactly the same `headObject`/`copyObject`/`deleteObjectVersion` surface
 * M6's own finalizer/malware-result workers already depend on. */
export function buildDocumentArchiveWorkerDeps(
  client: DynamoDBDocumentClient,
  tableName: string,
  cleanBucket: string,
  appConfigData: AppConfigDataClient,
  appConfig: { applicationId: string; environmentId: string; configurationProfileId: string },
) {
  const store = new DynamoDbDocumentArchiveStore(client, tableName);
  const objects = new S3DocumentObjectStore(new S3Client({}));
  const ids = new UlidIdGenerator();
  // D-193 item 8/9 (PROMOTER gate) - same AppConfigFeatureFlagsReader adapter every other
  // AppConfig-gated worker in this repo already uses.
  const featureFlags = new AppConfigFeatureFlagsReader(appConfigData, appConfig);
  return { store, objects, ids, tableName, cleanBucket, featureFlags };
}

/** D-143 Decision 4 / D-146 (guest access). Separate from `buildDocumentArchiveDeps` — the
 * guest surface is deliberately its own composition (own pepper env var, own Lambda,
 * no Cognito/RequestContext machinery), same separation `subject`'s
 * `buildGuestSubmissionDeps` keeps from its authenticated sibling. */
export function buildDocumentArchiveGuestDeps(client: DynamoDBDocumentClient, tableName: string, guestAccessPepper: string) {
  const store = new DynamoDbDocumentArchiveStore(client, tableName);
  const ids = new UlidIdGenerator();
  const rateLimiter = new DocumentArchiveGuestRateLimiter(store);
  const guestAccess = new GuestDocumentAccessService({ store, tableName, ids, rateLimiter, pepper: guestAccessPepper });
  return { store, guestAccess };
}

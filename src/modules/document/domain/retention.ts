/**
 * Retention classes — closed union matching `privacy-lgpd.md` §4's retention matrix exactly
 * (only the two classes real Document/UploadSlot entities actually use; the others belong to
 * different aggregates and are declared elsewhere or not yet materialized anywhere - full
 * cross-entity retention/purge worker is explicitly out of scope for M6, per
 * `privacy-lgpd.md` line 69: "não implementado ainda... retentionClass/purgeAfter
 * materializados em entidades e worker de purge"). M6 closes the entity half of that gap for
 * Document/UploadSlot specifically; a general-purpose purge worker across all retentionClass
 * values remains a separate, larger piece of future work.
 */
export type DocumentRetentionClass = "USER_DOCUMENT" | "TRANSIENT";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** `privacy-lgpd.md` §4: USER_DOCUMENT = "exclusão/encerramento + 30 dias". Computed from the
 * event that starts the clock (deletion/account closure), never from creation. */
export function computeUserDocumentPurgeAfter(deletionOrClosureIso: string): string {
  return new Date(Date.parse(deletionOrClosureIso) + 30 * MS_PER_DAY).toISOString();
}

/** `privacy-lgpd.md` §4: DELIVERY_RECORD = "criação + 180 dias". Used here for
 * `DocumentPurgeReceipt` (W3-06) - a non-sensitive proof-of-purge record, same retention
 * rationale as intents/attempts (process evidence, not third-party data), reusing the existing
 * class instead of inventing a new one for a single new entity. */
export function computeDeliveryRecordPurgeAfter(createdAtIso: string): string {
  return new Date(Date.parse(createdAtIso) + 180 * MS_PER_DAY).toISOString();
}

/** `privacy-lgpd.md` §4: TRANSIENT (UploadSlot) = "7 dias; slot incompleto: 24h". A slot that
 * never got confirmed by the upload finalizer uses the shorter 24h window; a slot that WAS
 * confirmed (and its Document is now progressing through SCANNING/CLEAN/REJECTED) falls back
 * to the general 7-day transient window for the slot record itself. */
export function computeUploadSlotPurgeAfter(reservedAtIso: string, wasConfirmed: boolean): string {
  const days = wasConfirmed ? 7 : 1;
  return new Date(Date.parse(reservedAtIso) + days * MS_PER_DAY).toISOString();
}

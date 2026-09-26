import { claimReminderOccurrence, type ReminderClaimDeps } from "../../modules/reminder/application/reminder-claim.js";
import { InternalError } from "../../shared/errors/app-error.js";
import type { ClaimExpiryCandidate } from "./reconciliation.js";

/** PAGED recovery: renew the claim and append dispatch outbox atomically, without
 * returning work behind a COMPLETED scan cursor. Helpers reread the current item;
 * a stale GSI6 image can never renew a live/finished claim. ADR-0016 Decision A (2026-09-25)
 * retired the `DocumentChasingOccurrence` branch this used to also recover (document-chasing
 * feature, fully removed) - `ReminderOccurrence` is the only entityType left. */
export async function recoverExpiredClaims(
  deps: ReminderClaimDeps,
  candidates: (ClaimExpiryCandidate & { entityType: string })[],
): Promise<number> {
  let recovered = 0;
  for (const candidate of candidates) {
    const key = { PK: candidate.PK, SK: candidate.SK };
    if (candidate.entityType !== "ReminderOccurrence") {
      throw new InternalError("Unknown entity type in expired claim recovery.");
    }
    const outcome = await claimReminderOccurrence(deps, key, candidate.tenantId, "EXPIRED");
    if (outcome.kind === "CLAIMED") recovered += 1;
  }
  return recovered;
}

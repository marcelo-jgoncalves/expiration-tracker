import { claimReminderOccurrence, type ReminderClaimDeps } from "../../modules/reminder/application/reminder-claim.js";
import { claimChasingOccurrence } from "../../modules/subject/application/document-chasing-producer.js";
import { InternalError } from "../../shared/errors/app-error.js";
import type { ClaimExpiryCandidate } from "./reconciliation.js";

/** PAGED recovery: renew the claim and append dispatch outbox atomically, without
 * returning work behind a COMPLETED scan cursor. Helpers reread the current item;
 * a stale GSI6 image can never renew a live/finished claim. */
export async function recoverExpiredClaims(
  deps: ReminderClaimDeps,
  candidates: (ClaimExpiryCandidate & { entityType: string })[],
): Promise<number> {
  let recovered = 0;
  for (const candidate of candidates) {
    const key = { PK: candidate.PK, SK: candidate.SK };
    const outcome = candidate.entityType === "ReminderOccurrence"
      ? await claimReminderOccurrence(deps, key, candidate.tenantId, "EXPIRED")
      : candidate.entityType === "DocumentChasingOccurrence"
        ? await claimChasingOccurrence(deps, key, "EXPIRED")
        : undefined;
    if (!outcome) throw new InternalError("Unknown entity type in expired claim recovery.");
    if (outcome.kind === "CLAIMED") recovered += 1;
  }
  return recovered;
}

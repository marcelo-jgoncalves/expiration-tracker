/**
 * D-204 (Roadmap P1 item 15, decision 4): computes the NEXT `nextRunAt` a claim transaction
 * advances a `ReportSubscription` to, once its current `nextRunAt` has fired. Weekly-only (v1,
 * `ReportSubscriptionCadence`) - the next occurrence of `dayOfWeek`/`localTime` in `timeZone`
 * strictly after `afterIso`, timezone/DST-aware via the same `zonedTimeToUtc` primitive
 * `reminder/domain/recurrence.ts` already established (reused cross-module, same precedent as
 * `notification/application/quiet-hours.ts`) - never a frozen UTC offset.
 */
import { addCalendarDays, instantToLocalParts, parseLocalTime, zonedTimeToUtc } from "../../reminder/domain/recurrence.js";

/**
 * Converts JS `Date.UTC(...).getUTCDay()`'s 0=Sunday..6=Saturday convention to
 * `ReportSubscription.dayOfWeek`'s ISO 1=Monday..7=Sunday convention (the domain's own doc
 * comment on `dayOfWeek` names this exact convention explicitly to avoid an off-by-one bug -
 * this is the one place that conversion happens).
 */
function isoDayOfWeek(jsGetUTCDay: number): number {
  return jsGetUTCDay === 0 ? 7 : jsGetUTCDay;
}

/** Hard bound on the forward search - 8 calendar days always contains at least one occurrence
 * of any weekday (today, if it still matches after time-of-day, through +7, its next
 * recurrence) - never actually reachable without matching, kept as a defensive cap against an
 * infinite loop from a malformed `dayOfWeek`. */
const MAX_SEARCH_DAYS = 8;

/**
 * Returns the ISO instant of the next occurrence of `dayOfWeek` (1=Monday..7=Sunday) at
 * `localTime` ("HH:mm") in `timeZone`, strictly after `afterIso`. Starts the search from
 * `afterIso`'s OWN calendar date as seen in `timeZone` (never UTC's calendar date - a subscriber
 * in a timezone behind UTC can have a different local date than the instant's UTC date).
 */
export function nextWeeklyOccurrenceUtc(afterIso: string, dayOfWeek: number, localTime: string, timeZone: string): string {
  const { hour, minute } = parseLocalTime(localTime);
  const afterMs = Date.parse(afterIso);
  const localNow = instantToLocalParts(afterMs, timeZone);
  let candidateDate = { year: localNow.year, month: localNow.month, day: localNow.day };

  for (let i = 0; i < MAX_SEARCH_DAYS; i++) {
    const jsWeekday = new Date(Date.UTC(candidateDate.year, candidateDate.month - 1, candidateDate.day)).getUTCDay();
    if (isoDayOfWeek(jsWeekday) === dayOfWeek) {
      const resolved = zonedTimeToUtc({ ...candidateDate, hour, minute }, timeZone);
      if (resolved.utcMillis > afterMs) {
        return new Date(resolved.utcMillis).toISOString();
      }
    }
    candidateDate = addCalendarDays(candidateDate, 1);
  }
  throw new Error(`nextWeeklyOccurrenceUtc: no candidate found for dayOfWeek=${dayOfWeek} within ${MAX_SEARCH_DAYS} days of ${afterIso} (malformed dayOfWeek?)`);
}

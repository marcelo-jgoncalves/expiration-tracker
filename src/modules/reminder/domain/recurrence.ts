/**
 * IANA-timezone-aware local-wall-clock -> UTC conversion, with explicit DST edge-case
 * handling (implementation-blueprint.md §9.2/§9.5: "regra de recorrência + timezone IANA
 * devem ser reavaliadas, não um offset UTC congelado").
 *
 * No date library dependency (none is in package.json and the blueprint doesn't mandate
 * one) - this uses the standard Intl.DateTimeFormat offset-probing technique (the same
 * core algorithm libraries like date-fns-tz/luxon use under the hood): format a UTC
 * instant back into the target timeZone, compare to the requested wall-clock time, and
 * iterate until the offset stabilizes. Two DST edge cases are handled explicitly:
 *  - AMBIGUOUS (fall-back): the wall-clock time occurs twice. We deterministically pick
 *    the EARLIER UTC instant (the first occurrence), a documented judgment call - the
 *    blueprint requires the case be "covered", not a specific tie-break.
 *  - NONEXISTENT (spring-forward gap): the wall-clock time never occurs. We shift forward
 *    by the size of the gap (typically 60 minutes) to the first valid instant at/after
 *    the requested wall-clock time - never silently drop the reminder.
 */

export type ZonedResolutionKind = "NORMAL" | "AMBIGUOUS" | "NONEXISTENT";

export interface ZonedResolution {
  utcMillis: number;
  kind: ZonedResolutionKind;
}

export interface LocalDateTimeParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second?: number;
}

function formatParts(instantMillis: number, timeZone: string): LocalDateTimeParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(instantMillis));
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return {
    year: Number(map["year"]),
    month: Number(map["month"]),
    day: Number(map["day"]),
    hour: Number(map["hour"]),
    minute: Number(map["minute"]),
    second: Number(map["second"]),
  };
}

/** Offset (minutes) such that: asUtcMillis(localPartsAt(instant)) - instant === offset*60000. */
function offsetMinutesAt(instantMillis: number, timeZone: string): number {
  const p = formatParts(instantMillis, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second ?? 0);
  return (asUtc - instantMillis) / 60_000;
}

function sameWallClock(a: LocalDateTimeParts, b: LocalDateTimeParts): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute;
}

/**
 * Resolves a local wall-clock date/time in `timeZone` to a UTC instant.
 * `requested` seconds default to 0.
 */
export function zonedTimeToUtc(requested: LocalDateTimeParts, timeZone: string): ZonedResolution {
  const naiveUtc = Date.UTC(
    requested.year,
    requested.month - 1,
    requested.day,
    requested.hour,
    requested.minute,
    requested.second ?? 0,
  );

  const offset0 = offsetMinutesAt(naiveUtc, timeZone);
  const guess1 = naiveUtc - offset0 * 60_000;
  const offset1 = offsetMinutesAt(guess1, timeZone);
  const guess2 = naiveUtc - offset1 * 60_000;
  const offset2 = offsetMinutesAt(guess2, timeZone);

  const candidateA = naiveUtc - offset0 * 60_000;
  const candidateB = naiveUtc - offset1 * 60_000;
  const localA = formatParts(candidateA, timeZone);
  const localB = formatParts(candidateB, timeZone);
  const matchesA = sameWallClock(localA, requested);
  const matchesB = sameWallClock(localB, requested);

  if (offset1 === offset2 && matchesA && matchesB) {
    // Both iterations converged to the same instant AND it round-trips - but that alone
    // doesn't rule out AMBIGUOUS: a fall-back wall clock also round-trips at its first
    // (pre-transition) instant, since the offset-probing walk naturally lands there first.
    // Probe a neighboring instant one typical DST-shift (60 min) on the other side of the
    // transition to check whether the SAME wall clock reoccurs there too (documented
    // judgment call: 60 min covers every real-world IANA transition this product targets;
    // sub-hour shifts are historical/rare and out of scope for M3).
    const probeLater = candidateA + 60 * 60_000;
    const probeEarlier = candidateA - 60 * 60_000;
    const laterMatches = sameWallClock(formatParts(probeLater, timeZone), requested);
    const earlierMatches = sameWallClock(formatParts(probeEarlier, timeZone), requested);
    if (laterMatches) return { utcMillis: Math.min(candidateA, probeLater), kind: "AMBIGUOUS" };
    if (earlierMatches) return { utcMillis: Math.min(candidateA, probeEarlier), kind: "AMBIGUOUS" };
    return { utcMillis: guess2, kind: "NORMAL" };
  }

  if (matchesA && matchesB) {
    // Fall-back: two UTC instants produce the same wall clock. Deterministic tie-break:
    // earlier instant (first occurrence).
    return { utcMillis: Math.min(candidateA, candidateB), kind: "AMBIGUOUS" };
  }
  if (matchesA) return { utcMillis: candidateA, kind: "NORMAL" };
  if (matchesB) return { utcMillis: candidateB, kind: "NORMAL" };

  // Spring-forward gap: neither candidate reproduces the requested wall clock because it
  // never occurred. Resolve to the first valid instant at/after the requested wall clock,
  // by applying the offset that is in effect AFTER the transition (candidateB, which used
  // offset1 - probed slightly closer to the post-transition regime).
  return { utcMillis: Math.max(candidateA, candidateB), kind: "NONEXISTENT" };
}

/** Parses "YYYY-MM-DD" (date-only) or an ISO date-time, returning just the calendar date parts (UTC-anchored, no time-of-day). */
export function toCalendarDate(isoDateOrDateTime: string): { year: number; month: number; day: number } {
  const datePart = isoDateOrDateTime.slice(0, 10);
  const [y, m, d] = datePart.split("-").map(Number);
  return { year: y as number, month: m as number, day: d as number };
}

/** Adds a signed number of days to a calendar date, in pure calendar arithmetic (no timezone involved yet). */
export function addCalendarDays(date: { year: number; month: number; day: number }, days: number): { year: number; month: number; day: number } {
  const asUtcMillis = Date.UTC(date.year, date.month - 1, date.day) + days * 86_400_000;
  const d = new Date(asUtcMillis);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Parses an ISO-8601 duration of the restricted form used by ReminderTrigger.offsetIso: optional sign, "P", integer days, "D" (e.g. "-P7D", "P0D", "-P1D"). Sufficient for the relative-offset-from-dueDate model documented in data-model.md/blueprint §9.1 - broader ISO-8601 duration grammar (weeks/months/time components) is out of scope for M3. */
export function parseDayOffset(offsetIso: string): number {
  const match = /^(-)?P(\d+)D$/.exec(offsetIso);
  if (!match) {
    throw new Error(`Unsupported offset format: ${offsetIso} (expected [-]P<N>D)`);
  }
  const sign = match[1] === "-" ? -1 : 1;
  return sign * Number(match[2]);
}

/** Parses "HH:mm" into hour/minute. */
export function parseLocalTime(hhmm: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) {
    throw new Error(`Unsupported local time format: ${hhmm} (expected HH:mm)`);
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

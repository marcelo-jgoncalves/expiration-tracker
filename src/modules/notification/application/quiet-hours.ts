/**
 * Quiet hours evaluation (M4, docs/architecture/reviews/m4-notification-engine-design/
 * codex-proposal-round1.md §5.3). Reuses the same IANA-aware wall-clock<->UTC conversion
 * already built for the Reminder Engine (reminder/domain/recurrence.ts) rather than
 * reinventing DST handling - same NONEXISTENT/AMBIGUOUS cases apply here.
 *
 * Deferral mechanism (round1 cross-critique: the original Claude proposal's
 * `changeMessageVisibility` approach was technically wrong - SQS visibility timeout caps at
 * 12h) is EventBridge Scheduler one-shot, per the base design - this module only computes
 * the deliverNotBefore instant; scheduling it is the caller's (router's) job.
 */
import { parseLocalTime, zonedTimeToUtc } from "../../reminder/domain/recurrence.js";

export interface QuietHoursConfig {
  enabled: boolean;
  startLocal: string; // HH:mm
  endLocal: string; // HH:mm
  timeZone: string; // IANA
}

function localPartsAt(instantMillis: number, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(instantMillis));
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  return {
    year: Number(map["year"]),
    month: Number(map["month"]),
    day: Number(map["day"]),
    hour: Number(map["hour"]),
    minute: Number(map["minute"]),
  };
}

function minutesOfDay(hour: number, minute: number): number {
  return hour * 60 + minute;
}

/**
 * Returns the UTC instant (ISO) at which delivery becomes allowed again if `nowIso` falls
 * within the quiet-hours window, or `undefined` if delivery is allowed right now (window
 * disabled, or `nowIso` is outside it). Handles a window that crosses local midnight
 * (start > end, treated as a continuous overnight interval) as a first-class case, per the
 * base design.
 */
export function computeDeliverNotBefore(nowIso: string, config: QuietHoursConfig): string | undefined {
  if (!config.enabled) return undefined;

  const nowMillis = Date.parse(nowIso);
  const local = localPartsAt(nowMillis, config.timeZone);
  const nowMinutes = minutesOfDay(local.hour, local.minute);

  const start = parseLocalTime(config.startLocal);
  const end = parseLocalTime(config.endLocal);
  const startMinutes = minutesOfDay(start.hour, start.minute);
  const endMinutes = minutesOfDay(end.hour, end.minute);

  const crossesMidnight = startMinutes > endMinutes;
  const withinWindow = crossesMidnight
    ? nowMinutes >= startMinutes || nowMinutes < endMinutes
    : nowMinutes >= startMinutes && nowMinutes < endMinutes;

  if (!withinWindow) return undefined;

  // The window ends today (if we're in the pre-midnight part of an overnight window, or in
  // a same-day window) or tomorrow (if we're in the post-midnight part of an overnight
  // window, i.e. nowMinutes < endMinutes already means "end" is on the current calendar
  // day too - only the START was yesterday). Either way, "end" always resolves to the next
  // occurrence of that local time at/after `now`, on the correct calendar day.
  const endIsSameCalendarDay = !crossesMidnight || nowMinutes < endMinutes;
  const dayOffset = endIsSameCalendarDay ? 0 : 1;

  const endDate = new Date(Date.UTC(local.year, local.month - 1, local.day) + dayOffset * 86_400_000);
  const resolution = zonedTimeToUtc(
    {
      year: endDate.getUTCFullYear(),
      month: endDate.getUTCMonth() + 1,
      day: endDate.getUTCDate(),
      hour: end.hour,
      minute: end.minute,
    },
    config.timeZone,
  );
  return new Date(resolution.utcMillis).toISOString();
}

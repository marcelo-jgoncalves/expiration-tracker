/** Used only for organizations created before this feature existed (`defaultReminderLocalTime`
 * absent) - never applied retroactively as a real value, just the pre-existing UI default. */
export const FALLBACK_DEFAULT_LOCAL_TIME = "09:00";

/** Mirrors backend `REMINDER_LOCAL_TIME_CANDIDATES` (`organization.ts`) - the 15 sanctioned
 * on-the-hour/half-hour BRT values (10:00-17:00) the onboarding sorteio picks from. Not imported
 * across the frontend/backend build boundary (separate bundlers) - kept in sync by literal value.
 * `FALLBACK_DEFAULT_LOCAL_TIME` is prepended so a legacy organization's current value (backend
 * validation accepts any HH:mm, not just these 15) renders as genuinely selected instead of a
 * `<select>` silently falling back to its first option on a value with no matching `<option>`. */
export const REMINDER_LOCAL_TIME_OPTIONS = [
  { value: FALLBACK_DEFAULT_LOCAL_TIME, label: FALLBACK_DEFAULT_LOCAL_TIME },
  ...Array.from({ length: 15 }, (_, i) => {
    const totalMinutes = 10 * 60 + i * 30;
    const value = `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
    return { value, label: value };
  }),
];

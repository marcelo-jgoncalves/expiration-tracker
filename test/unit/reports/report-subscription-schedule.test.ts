import { describe, expect, it } from "vitest";
import { nextWeeklyOccurrenceUtc } from "../../../src/modules/reports/domain/report-subscription-schedule.js";

describe("nextWeeklyOccurrenceUtc (D-211 fatia 2, D-204 decision 4)", () => {
  it("returns the next occurrence later this week when the target weekday hasn't happened yet", () => {
    // 2026-09-07 is a Monday (UTC). Target Wednesday (ISO dayOfWeek=3) at 09:00 UTC.
    const result = nextWeeklyOccurrenceUtc("2026-09-07T00:00:00.000Z", 3, "09:00", "UTC");
    expect(result).toBe("2026-09-09T09:00:00.000Z");
  });

  it("rolls over to next week when `afterIso` is already past this week's occurrence", () => {
    // 2026-09-09 (Wednesday) 10:00 UTC is after today's 09:00 occurrence.
    const result = nextWeeklyOccurrenceUtc("2026-09-09T10:00:00.000Z", 3, "09:00", "UTC");
    expect(result).toBe("2026-09-16T09:00:00.000Z");
  });

  it("rolls over to next week when `afterIso` is exactly the occurrence instant (strictly-after semantics)", () => {
    const result = nextWeeklyOccurrenceUtc("2026-09-09T09:00:00.000Z", 3, "09:00", "UTC");
    expect(result).toBe("2026-09-16T09:00:00.000Z");
  });

  it("honors ISO dayOfWeek=7 (Sunday), never JS Date.getUTCDay()'s 0=Sunday", () => {
    // 2026-09-07 is Monday. Next Sunday (ISO 7) is 2026-09-13.
    const result = nextWeeklyOccurrenceUtc("2026-09-07T00:00:00.000Z", 7, "08:30", "UTC");
    expect(result).toBe("2026-09-13T08:30:00.000Z");
  });

  it("is timezone-aware: the same instant/dayOfWeek/localTime resolves differently in a non-UTC zone", () => {
    const utcResult = nextWeeklyOccurrenceUtc("2026-09-07T00:00:00.000Z", 3, "09:00", "UTC");
    const spResult = nextWeeklyOccurrenceUtc("2026-09-07T00:00:00.000Z", 3, "09:00", "America/Sao_Paulo");
    expect(spResult).not.toBe(utcResult);
    expect(spResult).toBe("2026-09-09T12:00:00.000Z"); // America/Sao_Paulo is fixed UTC-3 since 2019.
  });

  it("finds today's occurrence when `afterIso` is earlier the same local day", () => {
    const result = nextWeeklyOccurrenceUtc("2026-09-09T00:00:00.000Z", 3, "09:00", "UTC");
    expect(result).toBe("2026-09-09T09:00:00.000Z");
  });

  it("starts the search from the LOCAL calendar date, not UTC's, near a day boundary", () => {
    // 2026-09-07T01:00:00Z is already 2026-09-06 22:00 in America/Sao_Paulo (UTC-3) - local
    // calendar date is still Sunday the 6th there, one day behind UTC's Monday the 7th.
    const result = nextWeeklyOccurrenceUtc("2026-09-07T01:00:00.000Z", 7, "23:00", "America/Sao_Paulo");
    // ISO dayOfWeek=7 (Sunday) at 23:00 local - local calendar date is still Sunday 2026-09-06,
    // and 23:00 local hasn't happened yet relative to 22:00 local `afterIso` - fires today.
    expect(result).toBe("2026-09-07T02:00:00.000Z"); // 2026-09-06T23:00 America/Sao_Paulo = 2026-09-07T02:00Z.
  });
});

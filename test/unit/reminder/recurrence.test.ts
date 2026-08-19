import { describe, expect, it } from "vitest";
import { zonedTimeToUtc, addCalendarDays, toCalendarDate, parseDayOffset, parseLocalTime, timeZoneObservesDst } from "../../../src/modules/reminder/domain/recurrence.js";

describe("recurrence - IANA timezone-aware local->UTC conversion (implementation-blueprint.md §9.5 DST)", () => {
  it("resolves a normal (non-DST-boundary) local time correctly", () => {
    // America/Sao_Paulo has no DST since 2019 - fixed UTC-3.
    const r = zonedTimeToUtc({ year: 2026, month: 9, day: 10, hour: 9, minute: 0 }, "America/Sao_Paulo");
    expect(r.kind).toBe("NORMAL");
    expect(new Date(r.utcMillis).toISOString()).toBe("2026-09-10T12:00:00.000Z");
  });

  it("handles a nonexistent local time (US spring-forward gap, America/New_York 2026-03-08 02:30 doesn't exist)", () => {
    const r = zonedTimeToUtc({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, "America/New_York");
    expect(r.kind).toBe("NONEXISTENT");
    // Resolves forward past the gap - never silently dropped.
    const backAsLocal = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(r.utcMillis));
    expect(backAsLocal).toBe("03:30"); // shifted forward by the 1h gap
  });

  it("handles an ambiguous local time (US fall-back, America/New_York 2026-11-01 01:30 occurs twice)", () => {
    const r = zonedTimeToUtc({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, "America/New_York");
    expect(r.kind).toBe("AMBIGUOUS");
    // Deterministic tie-break: earlier instant (first occurrence, still EDT/-04:00).
    expect(new Date(r.utcMillis).toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });

  it("addCalendarDays / toCalendarDate round-trip across month boundaries", () => {
    const date = toCalendarDate("2026-09-01");
    const before = addCalendarDays(date, -7);
    expect(before).toEqual({ year: 2026, month: 8, day: 25 });
  });

  it("parseDayOffset accepts the restricted [-]P<N>D grammar", () => {
    expect(parseDayOffset("-P7D")).toBe(-7);
    expect(parseDayOffset("P0D")).toBe(0);
    expect(() => parseDayOffset("P1W")).toThrow();
  });

  it("parseLocalTime parses HH:mm", () => {
    expect(parseLocalTime("09:05")).toEqual({ hour: 9, minute: 5 });
    expect(() => parseLocalTime("9:5")).toThrow();
  });

  describe("timeZoneObservesDst (M3.5)", () => {
    it("returns true for a DST-observing zone (America/New_York)", () => {
      expect(timeZoneObservesDst("America/New_York", 2026)).toBe(true);
    });

    it("returns false for a fixed-offset zone (America/Sao_Paulo, no DST since 2019)", () => {
      expect(timeZoneObservesDst("America/Sao_Paulo", 2026)).toBe(false);
    });

    it("returns false for UTC", () => {
      expect(timeZoneObservesDst("UTC", 2026)).toBe(false);
    });

    it("catches a transition NOT visible by comparing only January and July (Codex round 2 finding: monthly sampling, not a two-point comparison)", () => {
      // Africa/Casablanca observes a short DST pause during Ramadan - its January and July
      // offsets are typically equal, exactly the false-negative case a two-point Jan/Jul
      // comparison would miss. Monthly sampling still catches it.
      expect(timeZoneObservesDst("Africa/Casablanca", 2026)).toBe(true);
    });
  });
});

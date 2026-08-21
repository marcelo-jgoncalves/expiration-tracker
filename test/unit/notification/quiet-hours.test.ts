import { describe, expect, it } from "vitest";
import { computeDeliverNotBefore } from "../../../src/modules/notification/application/quiet-hours.js";

describe("computeDeliverNotBefore", () => {
  it("disabled config -> always deliverable now", () => {
    expect(
      computeDeliverNotBefore("2026-09-10T02:00:00.000Z", {
        enabled: false,
        startLocal: "22:00",
        endLocal: "07:00",
        timeZone: "America/Sao_Paulo",
      }),
    ).toBeUndefined();
  });

  it("outside the window -> deliverable now", () => {
    // America/Sao_Paulo has no DST since 2019, fixed UTC-3. 12:00 UTC = 09:00 local.
    expect(
      computeDeliverNotBefore("2026-09-10T12:00:00.000Z", {
        enabled: true,
        startLocal: "22:00",
        endLocal: "07:00",
        timeZone: "America/Sao_Paulo",
      }),
    ).toBeUndefined();
  });

  it("inside an overnight (midnight-crossing) window, pre-midnight side -> deferred to end-of-window tomorrow morning", () => {
    // 2026-09-10T02:00:00Z = 2026-09-09T23:00 local (UTC-3) - inside 22:00-07:00.
    const result = computeDeliverNotBefore("2026-09-10T02:00:00.000Z", {
      enabled: true,
      startLocal: "22:00",
      endLocal: "07:00",
      timeZone: "America/Sao_Paulo",
    });
    expect(result).toBe(new Date(Date.UTC(2026, 8, 10, 10, 0, 0)).toISOString()); // 07:00 local on 09-10 = 10:00 UTC
  });

  it("inside an overnight window, post-midnight side -> deferred to end-of-window same calendar day", () => {
    // 2026-09-10T08:00:00Z = 2026-09-10T05:00 local - inside 22:00-07:00 (post-midnight leg).
    const result = computeDeliverNotBefore("2026-09-10T08:00:00.000Z", {
      enabled: true,
      startLocal: "22:00",
      endLocal: "07:00",
      timeZone: "America/Sao_Paulo",
    });
    expect(result).toBe(new Date(Date.UTC(2026, 8, 10, 10, 0, 0)).toISOString());
  });

  it("same-day window (no midnight crossing) -> works the same way", () => {
    // 13:00 local is inside 09:00-18:00.
    const result = computeDeliverNotBefore("2026-09-10T16:00:00.000Z", {
      enabled: true,
      startLocal: "09:00",
      endLocal: "18:00",
      timeZone: "America/Sao_Paulo",
    });
    expect(result).toBe(new Date(Date.UTC(2026, 8, 10, 21, 0, 0)).toISOString()); // 18:00 local = 21:00 UTC
  });
});

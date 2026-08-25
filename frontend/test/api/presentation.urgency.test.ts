import { describe, expect, it } from "vitest";
import { daysUntilDueDate, formatAbsoluteDate, formatRelativeDueDate, presentItemUrgency, sortByDueDateAscending } from "../../src/api/presentation.js";

const NOW = new Date("2026-08-24T15:00:00.000Z");

describe("daysUntilDueDate", () => {
  it("is 0 for a due date matching today, regardless of the time-of-day component on either side", () => {
    expect(daysUntilDueDate("2026-08-24T23:59:00.000Z", NOW)).toBe(0);
    expect(daysUntilDueDate("2026-08-24T00:00:00.000Z", new Date("2026-08-24T00:00:01.000Z"))).toBe(0);
  });

  it("is negative for a past date and positive for a future one", () => {
    expect(daysUntilDueDate("2026-08-20T00:00:00.000Z", NOW)).toBe(-4);
    expect(daysUntilDueDate("2026-08-31T00:00:00.000Z", NOW)).toBe(7);
  });
});

describe("presentItemUrgency", () => {
  const active = (dueDate: string) => ({ status: "ACTIVE" as const, dueDate });

  it("labels an overdue ACTIVE item as Vencido/danger, group overdue", () => {
    const result = presentItemUrgency(active("2026-08-20T00:00:00.000Z"), NOW);
    expect(result).toMatchObject({ label: "Vencido", tone: "danger", group: "overdue", daysUntil: -4 });
  });

  it("labels a due-today ACTIVE item as Vence hoje/warning, group soon", () => {
    const result = presentItemUrgency(active("2026-08-24T00:00:00.000Z"), NOW);
    expect(result).toMatchObject({ label: "Vence hoje", tone: "warning", group: "soon", daysUntil: 0 });
  });

  it("labels an item due in exactly 1 day using singular wording", () => {
    const result = presentItemUrgency(active("2026-08-25T00:00:00.000Z"), NOW);
    expect(result).toMatchObject({ label: "Vence em 1 dia", tone: "warning", group: "soon" });
  });

  it("includes the boundary day 7 in the soon group, and excludes day 8", () => {
    const day7 = presentItemUrgency(active("2026-08-31T00:00:00.000Z"), NOW);
    expect(day7.group).toBe("soon");
    expect(day7.label).toBe("Vence em 7 dias");

    const day8 = presentItemUrgency(active("2026-09-01T00:00:00.000Z"), NOW);
    expect(day8.group).toBe("later");
    expect(day8.label).toBe("Ativo");
    expect(day8.tone).toBe("neutral");
  });

  it("a non-ACTIVE item never gets urgency semantics - it keeps its lifecycle label and lands in group later", () => {
    const archived = presentItemUrgency({ status: "ARCHIVED", dueDate: "2026-08-20T00:00:00.000Z" }, NOW);
    expect(archived).toMatchObject({ label: "Arquivado", tone: "neutral", group: "later" });

    const renewed = presentItemUrgency({ status: "RENEWED", dueDate: "2026-08-20T00:00:00.000Z" }, NOW);
    expect(renewed.label).toBe("Renovado");
  });
});

describe("formatAbsoluteDate", () => {
  it("formats as DD/MM/YYYY", () => {
    expect(formatAbsoluteDate("2026-08-30T00:00:00.000Z")).toBe("30/08/2026");
  });
});

describe("formatRelativeDueDate", () => {
  it("pairs the absolute date with relative context - overdue, today, and future phrasing (mission §20)", () => {
    expect(formatRelativeDueDate("2026-08-20T00:00:00.000Z", NOW)).toBe("20/08/2026 · Venceu há 4 dias");
    expect(formatRelativeDueDate("2026-08-24T00:00:00.000Z", NOW)).toBe("24/08/2026 · Vence hoje");
    expect(formatRelativeDueDate("2026-08-30T00:00:00.000Z", NOW)).toBe("30/08/2026 · Vence em 6 dias");
    expect(formatRelativeDueDate("2026-08-25T00:00:00.000Z", NOW)).toBe("25/08/2026 · Vence em 1 dia");
    expect(formatRelativeDueDate("2026-08-23T00:00:00.000Z", NOW)).toBe("23/08/2026 · Venceu há 1 dia");
  });
});

describe("sortByDueDateAscending", () => {
  it("orders most-urgent (earliest due date) first, without mutating the input array", () => {
    const items = [{ dueDate: "2026-12-01" }, { dueDate: "2026-01-01" }, { dueDate: "2026-06-01" }];
    const sorted = sortByDueDateAscending(items);
    expect(sorted.map((i) => i.dueDate)).toEqual(["2026-01-01", "2026-06-01", "2026-12-01"]);
    expect(items.map((i) => i.dueDate)).toEqual(["2026-12-01", "2026-01-01", "2026-06-01"]);
  });
});

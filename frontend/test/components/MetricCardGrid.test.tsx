import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MetricCardGrid, type MetricCardData } from "../../src/components/MetricCardGrid.js";

function renderGrid(cards: MetricCardData[]) {
  return render(
    <MemoryRouter>
      <MetricCardGrid cards={cards} />
    </MemoryRouter>,
  );
}

describe("MetricCardGrid (SLF-01 remediation, D-2xx Block 0)", () => {
  it("renders a resolved card as a link showing its count and label", () => {
    renderGrid([{ id: "overdue", label: "Vencidos", to: "/items?status=overdue", srDescription: "Ver vencimentos vencidos", status: { kind: "value", value: 3 } }]);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/items?status=overdue");
    expect(link).toHaveTextContent("3");
    expect(link).toHaveTextContent("Vencidos");
  });

  it("exposes the sr-only destination description via aria-describedby", () => {
    renderGrid([{ id: "overdue", label: "Vencidos", to: "/items", srDescription: "Ver vencimentos vencidos", status: { kind: "value", value: 3 } }]);
    const link = screen.getByRole("link");
    const describedById = link.getAttribute("aria-describedby");
    expect(describedById).toBeTruthy();
    expect(document.getElementById(describedById as string)).toHaveTextContent("Ver vencimentos vencidos");
  });

  it("gives the critical card a distinct visual-weight class the other cards never get", () => {
    renderGrid([
      { id: "overdue", label: "Vencidos", to: "/items?status=overdue", srDescription: "d1", status: { kind: "value", value: 3 }, critical: true },
      { id: "due-soon", label: "Vencem em 7 dias", to: "/items?status=due-soon", srDescription: "d2", status: { kind: "value", value: 5 } },
    ]);
    const links = screen.getAllByRole("link");
    const critical = links.find((el) => el.textContent?.includes("Vencidos"));
    const routine = links.find((el) => el.textContent?.includes("Vencem"));
    expect(critical?.className).toContain("ui-metric-card--critical");
    expect(routine?.className).not.toContain("ui-metric-card--critical");
  });

  it("shows an independent loading placeholder for a card still resolving, without blocking others", () => {
    renderGrid([
      { id: "overdue", label: "Vencidos", to: "/items", srDescription: "d1", status: { kind: "loading" } },
      { id: "due-soon", label: "Vencem em 7 dias", to: "/items", srDescription: "d2", status: { kind: "value", value: 5 } },
    ]);
    expect(screen.getByText("Vencem em 7 dias")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    // The loading card renders no link (nothing to navigate to yet) and is hidden from the
    // accessibility tree (aria-hidden) - only its resolved sibling exposes a link.
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("shows a per-card retry action on failure, never blanking the whole grid", () => {
    const onRetry = vi.fn();
    renderGrid([
      { id: "overdue", label: "Vencidos", to: "/items", srDescription: "d1", status: { kind: "error", message: "Não foi possível carregar.", onRetry } },
      { id: "due-soon", label: "Vencem em 7 dias", to: "/items", srDescription: "d2", status: { kind: "value", value: 5 } },
    ]);
    expect(screen.getByText("Não foi possível carregar.")).toBeInTheDocument();
    expect(screen.getByText("Vencem em 7 dias")).toBeInTheDocument();
    screen.getByRole("button", { name: "Tentar novamente" }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("enforces at most one critical card - only the first critical=true card keeps it, others are demoted", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderGrid([
      { id: "overdue", label: "Vencidos", to: "/items?status=overdue", srDescription: "d1", status: { kind: "value", value: 3 }, critical: true },
      { id: "missing-requirements", label: "Requisitos em falta", to: "/requirements", srDescription: "d2", status: { kind: "value", value: 7 }, critical: true },
    ]);
    const links = screen.getAllByRole("link");
    const first = links.find((el) => el.textContent?.includes("Vencidos"));
    const second = links.find((el) => el.textContent?.includes("Requisitos"));
    expect(first?.className).toContain("ui-metric-card--critical");
    expect(second?.className).not.toContain("ui-metric-card--critical");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("renders a genuine zero the same as any other resolved value, never as an error/loading treatment", () => {
    renderGrid([{ id: "overdue", label: "Vencidos", to: "/items", srDescription: "d1", status: { kind: "value", value: 0 } }]);
    expect(screen.getByRole("link")).toHaveTextContent("0");
  });
});

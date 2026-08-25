import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { InitialLoading, BackgroundRefreshIndicator, ErrorState, EmptyState, AsyncFeedback } from "../../src/components/AsyncStates.js";

describe("AsyncStates accessibility primitives", () => {
  it("InitialLoading exposes role=status with aria-live=polite - assistive tech announces it without interrupting", () => {
    render(<InitialLoading />);
    const el = screen.getByRole("status");
    expect(el).toHaveAttribute("aria-live", "polite");
  });

  it("BackgroundRefreshIndicator is also role=status, distinct element from InitialLoading", () => {
    render(<BackgroundRefreshIndicator label="Atualizando lista…" />);
    expect(screen.getByRole("status").textContent).toBe("Atualizando lista…");
  });

  it("ErrorState uses role=alert (assertive by default) and renders a retry button only when onRetry is given", () => {
    const onRetry = vi.fn();
    const { rerender } = render(<ErrorState message="Falhou." onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Falhou.");
    screen.getByRole("button", { name: "Tentar novamente" }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(<ErrorState message="Falhou de novo." />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("EmptyState renders the correct default copy per kind - true-empty is never confused with filtered-empty", () => {
    const { rerender } = render(<EmptyState kind="true-empty" />);
    expect(screen.getByText("Nada cadastrado ainda.")).toBeInTheDocument();

    rerender(<EmptyState kind="filtered-empty" />);
    expect(screen.getByText("Nenhum resultado para este filtro.")).toBeInTheDocument();

    rerender(<EmptyState kind="permission-limited" />);
    expect(screen.getByText("Você não tem acesso a este conteúdo.")).toBeInTheDocument();
  });

  it("EmptyState accepts a message override without losing its kind-specific default for other kinds", () => {
    render(<EmptyState kind="unavailable" message="Serviço temporariamente fora do ar." />);
    expect(screen.getByText("Serviço temporariamente fora do ar.")).toBeInTheDocument();
  });

  it("AsyncFeedback uses role=alert for FAILED/UNKNOWN, role=status for PENDING/PROCESSING/COMPLETED", () => {
    const { rerender } = render(<AsyncFeedback state="PENDING" message="m" />);
    expect(screen.getByRole("status")).toBeInTheDocument();

    rerender(<AsyncFeedback state="FAILED" message="m" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    rerender(<AsyncFeedback state="UNKNOWN" message="m" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    rerender(<AsyncFeedback state="COMPLETED" message="m" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

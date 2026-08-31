import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Button } from "../../src/components/ui/Button.js";
import { StatusBadge } from "../../src/components/ui/StatusBadge.js";
import { InlineNotice } from "../../src/components/ui/InlineNotice.js";
import { DataTable, type DataTableColumn } from "../../src/components/ui/DataTable.js";
import { Divider } from "../../src/components/ui/Divider.js";
import { IconButton } from "../../src/components/ui/IconButton.js";

/**
 * Design-system primitives - behaviour only. Appearance is covered by the Playwright visual
 * baselines (e2e/visual-regression.spec.ts); asserting CSS values here would just restate the
 * stylesheet. Several of these are direct regression tests for Codex Round B findings.
 */
describe("Button", () => {
  it("is inert while pending EVEN when the caller passes an explicit disabled={false} (Codex Round B, B-01)", () => {
    // The exact shape RenewItem produces during a normal renewal: `disabled={conflict}` is
    // `false`, not `undefined`, so a `??` here silently left an in-flight submit button live.
    render(
      <Button type="submit" variant="primary" pending disabled={false}>
        Renovando…
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Renovando…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("is enabled and not busy in its ordinary state", () => {
    render(<Button variant="primary">Criar</Button>);
    const button = screen.getByRole("button", { name: "Criar" });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-busy");
  });

  it("defaults to type=button so it can never submit a surrounding form by accident", () => {
    render(<Button>Atualizar</Button>);
    expect(screen.getByRole("button", { name: "Atualizar" })).toHaveAttribute("type", "button");
  });
});

describe("StatusBadge", () => {
  it("always carries a text label plus a non-colour marker, so status never depends on colour alone", () => {
    const { container } = render(<StatusBadge presentation={{ label: "Vencido", tone: "danger" }} />);
    expect(screen.getByText("Vencido")).toBeInTheDocument();
    const marker = container.querySelector(".ui-badge__marker");
    expect(marker).not.toBeNull();
    // Decorative: the label already carries the meaning, so it must not be announced twice.
    expect(marker).toHaveAttribute("aria-hidden", "true");
  });

  it("maps the domain tone to a visual tone rather than letting the call site pick one", () => {
    const { container, rerender } = render(<StatusBadge presentation={{ label: "Vencido", tone: "danger" }} />);
    expect(container.querySelector(".ui-badge--critical")).not.toBeNull();

    rerender(<StatusBadge presentation={{ label: "Ativo", tone: "neutral" }} />);
    expect(container.querySelector(".ui-badge--neutral")).not.toBeNull();
    // No mapping produces `success`: this domain has no state that proves "tudo certo".
    expect(container.querySelector(".ui-badge--success")).toBeNull();
  });
});

describe("InlineNotice", () => {
  it("renders no live region by default - a notice present on first paint must not interrupt", () => {
    render(
      <InlineNotice tone="info">
        <p>Renovar cria um novo ciclo.</p>
      </InlineNotice>,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("uses role=alert only when explicitly asked to interrupt", () => {
    render(
      <InlineNotice tone="warning" announce="alert" title="Este vencimento mudou">
        <p>Recarregue antes de renovar.</p>
      </InlineNotice>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Este vencimento mudou");
  });
});

interface Row {
  id: string;
  name: string;
  due: string;
}

const COLUMNS: DataTableColumn<Row>[] = [
  { key: "name", header: "Vencimento", primary: true, render: (row) => row.name },
  { key: "due", header: "Data de vencimento", numeric: true, render: (row) => row.due },
];

describe("DataTable", () => {
  it("names the table programmatically via a caption without showing it twice on screen", () => {
    render(<DataTable caption="Vencimentos ativos" columns={COLUMNS} rows={[{ id: "a", name: "Alvará", due: "01/09/2026" }]} rowKey={(row) => row.id} />);
    expect(screen.getByRole("table", { name: "Vencimentos ativos" })).toBeInTheDocument();
  });

  it("heads each row group with scope=rowgroup, not colgroup (Codex Round B, B-02)", () => {
    // "Vencidos" heads the ROWS of its <tbody>. scope="colgroup" would associate it with the
    // wrong table dimension - precisely the navigation aid a 140-row table depends on.
    render(
      <DataTable
        caption="Vencimentos"
        columns={COLUMNS}
        groups={[
          { id: "overdue", label: "Vencidos", rows: [{ id: "a", name: "Alvará", due: "01/08/2026" }] },
          { id: "later", label: "Demais ativos", rows: [{ id: "b", name: "Apólice", due: "01/12/2026" }] },
        ]}
        rowKey={(row) => row.id}
      />,
    );
    const groupHeader = screen.getByRole("rowheader", { name: /Vencidos/ });
    expect(groupHeader).toHaveAttribute("scope", "rowgroup");
    // ...and it heads the right rows.
    const tbody = groupHeader.closest("tbody") as HTMLElement;
    expect(within(tbody).getByText("Alvará")).toBeInTheDocument();
    expect(within(tbody).queryByText("Apólice")).toBeNull();
  });

  it("labels every non-identifier cell so the narrow stacked layout stays self-describing", () => {
    const { container } = render(
      <DataTable caption="Vencimentos" columns={COLUMNS} rows={[{ id: "a", name: "Alvará", due: "01/09/2026" }]} rowKey={(row) => row.id} />,
    );
    expect(container.querySelector('td[data-label="Data de vencimento"]')).not.toBeNull();
    // The identifier cell carries no label - it is the record's name, not an attribute of it.
    expect(container.querySelector("td.ui-table__cell--primary")).not.toHaveAttribute("data-label");
  });

  it("adds no keyboard stop when nothing can scroll (Codex Round B, B-04)", () => {
    // jsdom has no layout, so nothing overflows - which is exactly the non-scrollable case.
    // An unconditional tabIndex would put an empty, meaningless tab stop on every collection.
    const { container } = render(
      <DataTable caption="Vencimentos" columns={COLUMNS} rows={[{ id: "a", name: "Alvará", due: "01/09/2026" }]} rowKey={(row) => row.id} />,
    );
    const scroll = container.querySelector(".ui-table-scroll") as HTMLElement;
    expect(scroll).not.toHaveAttribute("tabindex");
    expect(scroll).not.toHaveAttribute("role");
  });
});

describe("Divider", () => {
  it("is decorative and never announced by assistive tech (mission §11 - a rule is never the only signal of structure)", () => {
    const { container } = render(<Divider />);
    const divider = container.querySelector(".ui-divider--horizontal");
    expect(divider).not.toBeNull();
    expect(divider).toHaveAttribute("aria-hidden", "true");
  });

  it("renders the vertical orientation class when asked", () => {
    const { container } = render(<Divider orientation="vertical" />);
    expect(container.querySelector(".ui-divider--vertical")).not.toBeNull();
    expect(container.querySelector(".ui-divider--horizontal")).toBeNull();
  });
});

describe("IconButton", () => {
  it("requires a label and exposes it as the accessible name (mission §23 - icon-only needs a real name)", () => {
    render(
      <IconButton label="Fechar">
        <svg aria-hidden="true" />
      </IconButton>,
    );
    expect(screen.getByRole("button", { name: "Fechar" })).toBeInTheDocument();
  });

  it("defaults to type=button so it can never submit a surrounding form by accident", () => {
    render(
      <IconButton label="Menu">
        <svg aria-hidden="true" />
      </IconButton>,
    );
    expect(screen.getByRole("button", { name: "Menu" })).toHaveAttribute("type", "button");
  });
});

describe("router-bound primitives", () => {
  it("ButtonLink renders a real link, not a button, for navigation", async () => {
    const { ButtonLink } = await import("../../src/components/ui/Button.js");
    render(
      <MemoryRouter>
        <ButtonLink to="/items/new" variant="primary">
          Novo vencimento
        </ButtonLink>
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Novo vencimento" })).toHaveAttribute("href", "/items/new");
    expect(screen.queryByRole("button")).toBeNull();
  });
});

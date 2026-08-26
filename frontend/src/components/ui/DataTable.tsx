/**
 * DataTable / OperationalList (mission §24-§27).
 *
 * A generic, typed wrapper over a real `<table>`. It exists so every operational collection
 * in the product gets the same column semantics, the same group headers, the same narrow
 * stacking behaviour and the same scroll container — instead of each route hand-rolling a
 * `<ul>` (which is what the Core Expiration slice had before this milestone: an unordered
 * list of comparable records, unscannable at volume).
 *
 * Deliberate non-features: no sorting UI, no column resizing, no row selection, no virtual
 * scrolling. None of those are needed by an approved journey today, and adding them would be
 * a UX change without evidence (mission §109/VL-G14).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import "./DataTable.css";

export interface DataTableColumn<T> {
  /** Stable key; also used as the React key for the cell. */
  key: string;
  /** Visible column header, and the label shown before the value in the stacked layout. */
  header: string;
  /** The record's human identifier — first column, widest, wraps, no `data-label` prefix. */
  primary?: boolean;
  /** Dates/counts: nowrap on desktop so a date never breaks mid-value. */
  numeric?: boolean;
  /** Row actions: right-aligned on desktop, left-aligned and unlabelled when stacked. */
  actions?: boolean;
  render: (row: T) => ReactNode;
}

export interface DataTableGroup<T> {
  id: string;
  label: string;
  rows: T[];
}

export interface DataTableProps<T> {
  /** Required. Rendered visually hidden — a table needs a programmatic name, and repeating
   * the page's own <h1> on screen would be visual noise. */
  caption: string;
  columns: DataTableColumn<T>[];
  /** Either a flat list of rows, or grouped rows — not both. */
  rows?: T[];
  groups?: DataTableGroup<T>[];
  rowKey: (row: T) => string;
}

function cellClassName<T>(column: DataTableColumn<T>): string {
  if (column.primary) return "ui-table__cell--primary";
  if (column.actions) return "ui-table__cell--actions";
  if (column.numeric) return "ui-table__cell--numeric";
  return "";
}

function Row<T>({ row, columns, rowKey }: { row: T; columns: DataTableColumn<T>[]; rowKey: (row: T) => string }) {
  return (
    <tr>
      {columns.map((column) => (
        <td key={`${rowKey(row)}:${column.key}`} className={cellClassName(column)} data-label={column.primary || column.actions ? undefined : column.header}>
          {column.render(row)}
        </td>
      ))}
    </tr>
  );
}

/**
 * True while the element's content is wider than its box. Kept as a hook rather than a CSS
 * media query because overflow depends on the CONTENT (a long licence name, a wide column
 * set), not only on the viewport width.
 *
 * `ResizeObserver` is absent in jsdom, where the component tests run; there is no layout
 * there to overflow either, so falling back to `false` is the honest answer rather than a
 * polyfill that would fabricate measurements.
 */
function useIsOverflowing(ref: React.RefObject<HTMLElement>): boolean {
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;

    const measure = () => setOverflowing(element.scrollWidth > element.clientWidth + 1);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    // The table itself, too: a column growing without the container changing size is exactly
    // the case observing only the container would miss.
    const table = element.firstElementChild;
    if (table) observer.observe(table);
    return () => observer.disconnect();
  }, [ref]);

  return overflowing;
}

export function DataTable<T>({ caption, columns, rows, groups, rowKey }: DataTableProps<T>) {
  const body = groups
    ? groups.map((group) => (
        <tbody key={group.id}>
          <tr className="ui-table__group-header">
            {/* `rowgroup`, not `colgroup` (Codex Round B, B-02): "Vencidos" heads the ROWS of
                this <tbody>, not a set of columns. With scope="colgroup" assistive technology
                associates the heading with the wrong table dimension, which is exactly the
                navigation aid a 140-row table depends on. */}
            <th scope="rowgroup" colSpan={columns.length}>
              {group.label}
              <span className="ui-table__group-count">{group.rows.length}</span>
            </th>
          </tr>
          {group.rows.map((row) => (
            <Row key={rowKey(row)} row={row} columns={columns} rowKey={rowKey} />
          ))}
        </tbody>
      ))
    : [
        <tbody key="rows">
          {(rows ?? []).map((row) => (
            <Row key={rowKey(row)} row={row} columns={columns} rowKey={rowKey} />
          ))}
        </tbody>,
      ];

  const scrollRef = useRef<HTMLDivElement>(null);
  const isScrollable = useIsOverflowing(scrollRef);

  return (
    // A scrollable region MUST be keyboard focusable to be operable (WCAG 2.1.1): Firefox and
    // Safari give no other way to scroll it without a mouse. But ONLY while it can actually
    // scroll - below 820px the layout stacks and nothing overflows, so an unconditional
    // tabIndex would leave a keyboard user with an empty, meaningless tab stop on every
    // collection (Codex Round B, B-04). Both the tab stop and the `region` name appear and
    // disappear together, so a focusable element is never anonymous.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div
      ref={scrollRef}
      className="ui-table-scroll"
      tabIndex={isScrollable ? 0 : undefined}
      role={isScrollable ? "region" : undefined}
      aria-label={isScrollable ? caption : undefined}
    >
      <table className="ui-table">
        <caption className="u-visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={cellClassName(column)}>
                {column.actions ? <span className="u-visually-hidden">{column.header}</span> : column.header}
              </th>
            ))}
          </tr>
        </thead>
        {body}
      </table>
    </div>
  );
}

/** Secondary line under a primary cell's main value (issuer, document number). Kept as a
 * component so the "supporting metadata" treatment is one decision, not per-route CSS. */
export function CellSecondary({ children }: { children: ReactNode }) {
  return <span className="ui-table__secondary">{children}</span>;
}

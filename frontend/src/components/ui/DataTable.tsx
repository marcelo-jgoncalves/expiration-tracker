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
import { type ReactNode } from "react";
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

export function DataTable<T>({ caption, columns, rows, groups, rowKey }: DataTableProps<T>) {
  const body = groups
    ? groups.map((group) => (
        <tbody key={group.id}>
          <tr className="ui-table__group-header">
            <th scope="colgroup" colSpan={columns.length}>
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

  return (
    // tabIndex/role make the scroll container keyboard-operable when (and only when) it can
    // actually scroll; without them a keyboard-only user cannot reach clipped columns.
    // A scrollable region MUST be keyboard focusable to be operable (WCAG 2.1.1): Firefox
    // and Safari give no other way to scroll it without a mouse. It is named and exposed as
    // a `region` so the extra tab stop is announced meaningfully, not as a mystery focus.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div className="ui-table-scroll" tabIndex={0} role="region" aria-label={caption}>
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

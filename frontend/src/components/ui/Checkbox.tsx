/**
 * Checkbox (design-system.md §29 catalog item). A real `<input type="checkbox">`, never a
 * styled `<div>` (mission §5 - assistive tech gets native checked/indeterminate state and
 * keyboard toggling for free; a custom-drawn box would have to reimplement all of it).
 *
 * `indeterminate` is a DOM property, not an HTML attribute - React has no prop for it, so it
 * is set imperatively via a ref (the standard, and only, way to express it). It never implies
 * `checked`; a caller in a tri-state "select all" header decides both independently.
 *
 * Label is a real `<label>` wrapping the input (not `aria-label`) so clicking the text also
 * toggles the control - the same discipline as `TextField`, extended to the click target
 * itself rather than only the accessible name.
 */
import { useEffect, useId, useRef } from "react";
import "./Checkbox.css";

export interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Tri-state marker for a "select all" header whose children are partially selected. Purely
   * visual/AT state - does not affect `checked`. */
  indeterminate?: boolean;
  disabled?: boolean;
  hint?: string;
  id?: string;
}

export function Checkbox({ label, checked, onChange, indeterminate, disabled, hint, id: providedId }: CheckboxProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const hintId = `${id}-hint`;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = Boolean(indeterminate);
    }
  }, [indeterminate]);

  return (
    <div className="ui-checkbox">
      <label className="ui-checkbox__label">
        <input
          ref={inputRef}
          id={id}
          type="checkbox"
          className="ui-checkbox__input"
          checked={checked}
          disabled={disabled}
          aria-describedby={hint ? hintId : undefined}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="ui-checkbox__box" aria-hidden="true" />
        <span className="ui-checkbox__text">{label}</span>
      </label>
      {hint ? (
        <p className="ui-checkbox__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

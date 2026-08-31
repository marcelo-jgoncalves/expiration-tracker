/**
 * Switch (design-system.md §29 catalog item) — an immediate-effect on/off toggle, distinct
 * from `Checkbox` in MEANING (mission §62 - variant/kind describes intent, not appearance):
 * a checkbox is a selection inside a form that a Submit button commits, a switch takes effect
 * the instant it is toggled (e.g. a notification preference). There is no native HTML control
 * for this, so it follows the WAI-ARIA APG switch pattern - a real `<button>` (keyboard/click
 * for free) with `role="switch"` and `aria-checked`, never a `<div onClick>`.
 */
import { useId } from "react";
import "./Switch.css";

export interface SwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  hint?: string;
  id?: string;
}

export function Switch({ label, checked, onChange, disabled, hint, id: providedId }: SwitchProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className="ui-switch">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={hintId}
        disabled={disabled}
        className="ui-switch__control"
        onClick={() => onChange(!checked)}
      >
        <span className="ui-switch__track" aria-hidden="true">
          <span className="ui-switch__thumb" />
        </span>
        <span className="ui-switch__text">{label}</span>
      </button>
      {hint ? (
        <p className="ui-switch__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * RadioGroup (design-system.md §29 catalog item "Radio"). Native `<input type="radio">` only
 * ever makes sense as a set sharing one `name` - there is no meaningful standalone `<Radio>`
 * the way there is a standalone `<Checkbox>` - so the catalog entry is implemented as the
 * group, with a real `<fieldset>`/`<legend>` (mission §5's "real semantics before ARIA")
 * naming the whole set for assistive tech, matching `TextField`'s discipline of a real
 * associated label rather than a placeholder or a bare `aria-label`.
 */
import { useId } from "react";
import "../forms/Form.css";
import "./RadioGroup.css";

export interface RadioOption {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

export interface RadioGroupProps {
  legend: string;
  options: RadioOption[];
  value: string | null;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  name?: string;
}

export function RadioGroup({ legend, options, value, onChange, error, required, name: providedName }: RadioGroupProps) {
  const generatedName = useId();
  const name = providedName ?? generatedName;
  const errorId = `${name}-error`;

  return (
    <fieldset className={`ui-radio-group${error ? " ui-radio-group--invalid" : ""}`} aria-describedby={error ? errorId : undefined}>
      <legend className="ui-radio-group__legend">
        {legend} <span className="ui-field__requirement">{required ? "(obrigatório)" : "(opcional)"}</span>
      </legend>
      <div className="ui-radio-group__options">
        {options.map((option) => {
          const id = `${name}-${option.value}`;
          const hintId = option.hint ? `${id}-hint` : undefined;
          return (
            <div className="ui-radio" key={option.value}>
              <label className="ui-radio__label">
                <input
                  id={id}
                  type="radio"
                  className="ui-radio__input"
                  name={name}
                  value={option.value}
                  checked={value === option.value}
                  disabled={option.disabled}
                  aria-describedby={hintId}
                  onChange={() => onChange(option.value)}
                />
                <span className="ui-radio__dot" aria-hidden="true" />
                <span className="ui-radio__text">{option.label}</span>
              </label>
              {option.hint ? (
                <p className="ui-radio__hint" id={hintId}>
                  {option.hint}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      {error ? (
        <p className="ui-field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

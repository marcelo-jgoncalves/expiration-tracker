/**
 * Accessible text/date/textarea field primitive (mission §55): a visible <label> with a real
 * `htmlFor`/`id` association, never a placeholder standing in for a label, plus an error
 * message associated via `aria-describedby` and `aria-invalid` (mission §56: error
 * association survives focus/validation cycles because it's structural, not incidental).
 */
import { useId } from "react";

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  required?: boolean;
  maxLength?: number;
  type?: "text" | "date";
  autoComplete?: string;
  multiline?: boolean;
}

export function TextField({ label, value, onChange, error, hint, required, maxLength, type = "text", autoComplete, multiline }: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [hint ? hintId : undefined, error ? errorId : undefined].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      <label htmlFor={id}>
        {label}
        {required ? " *" : ""}
      </label>
      {multiline ? (
        <textarea
          id={id}
          value={value}
          maxLength={maxLength}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          id={id}
          type={type}
          value={value}
          maxLength={maxLength}
          autoComplete={autoComplete}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {hint ? <p id={hintId}>{hint}</p> : null}
      {error ? (
        <p id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

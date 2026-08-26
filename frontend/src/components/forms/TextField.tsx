/**
 * Accessible text/date/textarea field primitive (Frontend Production Foundation §55): a
 * visible <label> with a real `htmlFor`/`id` association, never a placeholder standing in for
 * a label, plus an error message associated via `aria-describedby` and `aria-invalid`.
 *
 * Visual Language additions (this milestone):
 *  - required/optional is stated in words, not as a bare "*" (mission §38);
 *  - the invalid state is signalled by border weight + a left rule + the message, never by
 *    colour alone (mission §11);
 *  - `id` may be supplied so an ErrorSummary at the top of the form can link straight to the
 *    control (mission §40). When omitted it still falls back to a generated `useId`.
 */
import { useId } from "react";
import "./Form.css";

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
  /** Stable id, so an error summary can link to this control. */
  id?: string;
}

export function TextField({ label, value, onChange, error, hint, required, maxLength, type = "text", autoComplete, multiline, id: providedId }: TextFieldProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [hint ? hintId : undefined, error ? errorId : undefined].filter(Boolean).join(" ") || undefined;

  const control = multiline ? (
    <textarea
      id={id}
      className="ui-field__control"
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
      className="ui-field__control"
      type={type}
      value={value}
      maxLength={maxLength}
      autoComplete={autoComplete}
      required={required}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
      onChange={(event) => onChange(event.target.value)}
    />
  );

  return (
    <div className={`ui-field${error ? " ui-field--invalid" : ""}`}>
      <label className="ui-field__label" htmlFor={id}>
        {label} <span className="ui-field__requirement">{required ? "(obrigatório)" : "(opcional)"}</span>
      </label>
      {hint ? (
        <p className="ui-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {control}
      {error ? (
        // No icon glyph inside the message: the invalid state already carries three
        // non-colour cues (thicker control border, the left rule on the whole field, bold
        // weight) and keeping the element's text content EXACTLY the error string keeps it
        // identical to the string the ErrorSummary links with.
        <p className="ui-field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

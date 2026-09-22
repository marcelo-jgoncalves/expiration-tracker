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
import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import "./Form.css";

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  required?: boolean;
  maxLength?: number;
  type?: "text" | "date" | "month" | "time" | "email" | "password";
  autoComplete?: string;
  multiline?: boolean;
  /** Stable id, so an error summary can link to this control. */
  id?: string;
  /** Visually hides `label` (world-class search-bar convention, e.g. a toolbar's own search
   * field) while keeping the real `<label>`/`htmlFor` association in the DOM - never a
   * `placeholder` standing in for a label (this file's own header comment/mission §55): the
   * label still exists for assistive tech, it just does not take up visible layout. */
  hideLabel?: boolean;
  /** In-field ephemeral hint, gone the moment the user types (real `placeholder`) - distinct
   * from `hint`, which stays visible below the label for as long as the field is empty AND
   * full. Never the sole source of the field's accessible name. */
  placeholder?: string;
}

export function TextField({ label, value, onChange, error, hint, required, maxLength, type = "text", autoComplete, multiline, id: providedId, hideLabel, placeholder }: TextFieldProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [hint ? hintId : undefined, error ? errorId : undefined].filter(Boolean).join(" ") || undefined;
  // Every password field gets a reveal toggle (Marcelo, 2026-09-22) - state lives here, not per
  // call site, so Login/SignUp/ResetPassword all get it for free and never drift out of sync.
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === "password";

  const control = multiline ? (
    <textarea
      id={id}
      className="ui-field__control"
      value={value}
      maxLength={maxLength}
      required={required}
      placeholder={placeholder}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
      onChange={(event) => onChange(event.target.value)}
    />
  ) : (
    <input
      id={id}
      className={isPassword ? "ui-field__control ui-field__control--with-toggle" : "ui-field__control"}
      type={isPassword && revealed ? "text" : type}
      value={value}
      maxLength={maxLength}
      autoComplete={autoComplete}
      required={required}
      placeholder={placeholder}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
      onChange={(event) => onChange(event.target.value)}
    />
  );

  return (
    <div className={`ui-field${error ? " ui-field--invalid" : ""}`}>
      <label className={hideLabel ? "ui-field__label u-visually-hidden" : "ui-field__label"} htmlFor={id}>
        {label} <span className="ui-field__requirement">{required ? "(obrigatório)" : "(opcional)"}</span>
      </label>
      {hint ? (
        <p className="ui-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {isPassword ? (
        <div className="ui-field__toggle-wrap">
          {control}
          <button
            type="button"
            className="ui-field__toggle"
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? "Ocultar senha" : "Mostrar senha"}
            aria-pressed={revealed}
          >
            {revealed ? <EyeOff size={18} strokeWidth={2} aria-hidden="true" /> : <Eye size={18} strokeWidth={2} aria-hidden="true" />}
          </button>
        </div>
      ) : (
        control
      )}
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

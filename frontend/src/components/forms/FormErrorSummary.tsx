/**
 * Whole-form error summary (mission §40 / Frontend Production Foundation §34).
 *
 * Two kinds of problem end up here and they are kept distinct:
 *  - `errors`      — problems NOT attributable to one known field (a nested validation path,
 *                    a network failure, an unconfirmed outcome). Text only; there is nothing
 *                    to link to. Never silently dropped.
 *  - `fieldErrors` — problems that DO map to a control. Rendered as in-page links that move
 *                    focus to the offending field. The message string is the SAME string the
 *                    field itself renders, passed by the caller — the two can therefore never
 *                    drift apart (mission §40's consistency requirement is structural here,
 *                    not a convention someone has to remember).
 *
 * `role="alert"` is deliberate: a summary appears as the RESULT of a submit attempt, so
 * interrupting is correct — the user just acted and needs to know the action did not happen.
 */
import "./Form.css";

export interface SummaryFieldError {
  /** id of the control to focus. */
  fieldId: string;
  label: string;
  message: string;
}

export interface FormErrorSummaryProps {
  errors: string[];
  fieldErrors?: SummaryFieldError[];
}

export function FormErrorSummary({ errors, fieldErrors = [] }: FormErrorSummaryProps) {
  if (errors.length === 0 && fieldErrors.length === 0) return null;

  const onlyOneGeneralError = errors.length === 1 && fieldErrors.length === 0;

  return (
    <div className="ui-error-summary" role="alert">
      {onlyOneGeneralError ? (
        <p className="ui-error-summary__title">{errors[0]}</p>
      ) : (
        <>
          <p className="ui-error-summary__title">Corrija os seguintes problemas:</p>
          <ul className="ui-error-summary__list">
            {fieldErrors.map((fieldError) => (
              <li key={fieldError.fieldId}>
                <a href={`#${fieldError.fieldId}`}>
                  {fieldError.label}: {fieldError.message}
                </a>
              </li>
            ))}
            {errors.map((message, index) => (
              <li key={`general-${index}`}>{message}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

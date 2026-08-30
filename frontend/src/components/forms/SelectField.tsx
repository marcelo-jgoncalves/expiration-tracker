/**
 * Accessible select field primitive (Wave B2B-10) - same `.ui-field*` classes/label
 * association convention as `TextField.tsx`, for the one control shape TextField doesn't
 * cover (a closed set of options, e.g. `MembershipRole`).
 */
import { useId } from "react";
import "./Form.css";

export interface SelectFieldOption {
  value: string;
  label: string;
}

export interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectFieldOption[];
  required?: boolean;
  disabled?: boolean;
  id?: string;
}

export function SelectField({ label, value, onChange, options, required, disabled, id: providedId }: SelectFieldProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;

  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={id}>
        {label} <span className="ui-field__requirement">{required ? "(obrigatório)" : "(opcional)"}</span>
      </label>
      <select id={id} className="ui-field__control" value={value} required={required} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

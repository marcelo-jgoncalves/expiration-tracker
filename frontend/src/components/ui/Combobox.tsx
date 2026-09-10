/**
 * Combobox (design-system.md, WAI-ARIA 1.2 combobox pattern) — first real usage in this
 * codebase, added for A14 (Block 6, D-2xx): "Requisito" field in both creation dialogs, "busca
 * pelos Requirements do Subject sem solicitação avulsa pendente aberta" — the CALLER filters
 * `options` before passing them in (this component has no opinion on WHICH Requirements are
 * eligible, only on how to search/select among whatever list it's given).
 *
 * Generic over the option type `T` so the caller supplies `getOptionId`/`getOptionLabel` rather
 * than this component assuming a `Requirement` shape — kept small and undomain-specific per
 * implementation-sequencing-plan.md §2's design-system-extension discipline.
 */
import { useId, useRef, useState, type KeyboardEvent } from "react";
import "./Combobox.css";

export interface ComboboxProps<T> {
  id?: string;
  label: string;
  options: readonly T[];
  value: T | null;
  onChange: (value: T) => void;
  getOptionId: (option: T) => string;
  getOptionLabel: (option: T) => string;
  required?: boolean;
  placeholder?: string;
  emptyMessage?: string;
}

export function Combobox<T>({ id: providedId, label, options, value, onChange, getOptionId, getOptionLabel, required, placeholder, emptyMessage = "Nenhum resultado." }: ComboboxProps<T>) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const listboxId = `${id}-listbox`;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query.trim().length === 0 ? options : options.filter((option) => getOptionLabel(option).toLowerCase().includes(query.trim().toLowerCase()));

  function selectOption(option: T) {
    onChange(option);
    setQuery("");
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      if (open && activeIndex >= 0 && filtered[activeIndex]) {
        event.preventDefault();
        selectOption(filtered[activeIndex]);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  const displayValue = open ? query : (value ? getOptionLabel(value) : "");

  return (
    <div className="ui-combobox">
      <label className="ui-field__label" htmlFor={id}>
        {label} <span className="ui-field__requirement">{required ? "(obrigatório)" : "(opcional)"}</span>
      </label>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={open && activeIndex >= 0 && filtered[activeIndex] ? `${id}-option-${getOptionId(filtered[activeIndex])}` : undefined}
        className="ui-field__control"
        value={displayValue}
        placeholder={placeholder}
        required={required}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Deferred so a click on an option (which blurs the input first) still registers.
          setTimeout(() => setOpen(false), 150);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onKeyDown={handleKeyDown}
      />
      {open ? (
        <ul id={listboxId} role="listbox" className="ui-combobox__listbox" aria-label={label}>
          {filtered.length === 0 ? (
            <li className="ui-combobox__empty" role="presentation">
              {emptyMessage}
            </li>
          ) : (
            filtered.map((option, index) => (
              <li
                key={getOptionId(option)}
                id={`${id}-option-${getOptionId(option)}`}
                role="option"
                aria-selected={value ? getOptionId(value) === getOptionId(option) : false}
                className={index === activeIndex ? "ui-combobox__option ui-combobox__option--active" : "ui-combobox__option"}
                // Mousedown (not click) - fires before the input's blur handler tears the list down.
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectOption(option);
                }}
              >
                {getOptionLabel(option)}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

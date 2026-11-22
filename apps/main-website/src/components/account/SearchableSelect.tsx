"use client";

import { useId, useMemo, useRef, useState } from "react";

/**
 * A select you can type into.
 *
 * Hyderabad has hundreds of areas and the directory has a category for most trades, which a plain
 * `<select>` turns into a scroll. This filters as you type and keeps the chosen value in a hidden
 * input, so the form posts exactly what the dropdown posted -- a slug the API already accepts --
 * and nothing about the server side changes.
 *
 * <b>Keyboard.</b> The input is a combobox: Down opens the list and moves into it, Up moves back,
 * Enter chooses what is highlighted, Escape closes without choosing. `aria-activedescendant` names
 * the highlighted option so a screen reader announces it without focus leaving the input, which is
 * what the combobox pattern asks for.
 *
 * <b>Touch.</b> The options are real buttons at 44px, not a hover menu, and the list is scrollable
 * rather than tall -- so it works the same under a thumb as under a mouse.
 *
 * <b>Other.</b> Last in the list, and choosing it reveals a text box. It deliberately does not
 * create anything: the name is sent with the form and a person sets it up, because an area or a
 * category invented by whoever signed up last is one the whole directory then has to live with.
 */
export type SearchableOption = {
  /** What the form posts. */
  value: string;
  /** What the owner reads. */
  label: string;
  /** Shown faintly after the label, for a parent category or a city. */
  hint?: string;
};

type Props = {
  /** The hidden input's name, so the form posts what the old `<select>` posted. */
  name: string;
  id: string;
  options: readonly SearchableOption[];
  defaultValue?: string;
  placeholder: string;
  /** Text for the last option, when "not in the list" is a possible answer. */
  otherLabel?: string;
  /** The name of the text input revealed by Other. Required when `otherLabel` is set. */
  otherName?: string;
  otherPlaceholder?: string;
  otherDefaultValue?: string;
  invalid?: boolean;
  describedBy?: string;
};

/** The sentinel the hidden input carries when Other is chosen. Never a real slug. */
export const OTHER_VALUE = "__other__";

export function SearchableSelect({
  name,
  id,
  options,
  defaultValue = "",
  placeholder,
  otherLabel,
  otherName,
  otherPlaceholder,
  otherDefaultValue = "",
  invalid,
  describedBy,
}: Props) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const chosenAtFirst = options.find((option) => option.value === defaultValue);
  const [query, setQuery] = useState(chosenAtFirst?.label ?? "");
  const [value, setValue] = useState(defaultValue === OTHER_VALUE ? OTHER_VALUE : (chosenAtFirst?.value ?? ""));
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);

  /* Matched on the label and the hint, so typing a parent category finds its children and typing a
     city finds its areas. Case-insensitive, and the whole list when nothing is typed. */
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const found = needle === ""
      ? [...options]
      : options.filter(
          (option) =>
            option.label.toLowerCase().includes(needle) ||
            (option.hint ?? "").toLowerCase().includes(needle),
        );
    return otherLabel ? [...found, { value: OTHER_VALUE, label: otherLabel }] : found;
  }, [options, query, otherLabel]);

  const choose = (option: SearchableOption) => {
    setValue(option.value);
    setQuery(option.value === OTHER_VALUE ? "" : option.label);
    setOpen(false);
    setHighlighted(0);
  };

  const showOtherField = value === OTHER_VALUE && otherLabel && otherName;

  return (
    <div className="relative">
      <input type="hidden" name={name} value={value} />

      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[highlighted] ? `${listId}-${highlighted}` : undefined}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        value={query}
        placeholder={placeholder}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setHighlighted(0);
          /* Typing after choosing clears the choice: the box would otherwise read one thing and
             post another, which is the one way a search box like this goes wrong quietly. */
          if (value !== "") setValue("");
        }}
        onFocus={() => setOpen(true)}
        /* A click on an option would otherwise be lost: blur fires first and closes the list. The
           delay is long enough for the click to land and short enough not to be noticed. */
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setHighlighted((current) => Math.min(current + 1, matches.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlighted((current) => Math.max(current - 1, 0));
          } else if (event.key === "Enter" && open && matches[highlighted]) {
            // Only when the list is open, so Enter still submits the form otherwise.
            event.preventDefault();
            choose(matches[highlighted]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        className={`w-full rounded-lg border bg-white px-4 py-3 text-base outline-none focus:border-brand-700 ${
          invalid ? "border-red-400" : "border-line"
        }`}
      />

      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-[0_10px_28px_#002a3422]"
        >
          {matches.length === 0 ? (
            <li className="px-4 py-3 text-sm text-muted">Nothing matches that.</li>
          ) : (
            matches.map((option, index) => (
              <li key={option.value} id={`${listId}-${index}`} role="option" aria-selected={index === highlighted}>
                <button
                  type="button"
                  /* onMouseDown, not onClick: blur fires before click and would close the list. */
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(option);
                  }}
                  onMouseEnter={() => setHighlighted(index)}
                  className={`block min-h-11 w-full px-4 py-2.5 text-left text-base ${
                    index === highlighted ? "bg-brand-50 text-brand-800" : "text-ink"
                  }`}
                >
                  {option.label}
                  {option.hint ? <span className="ml-1.5 text-sm text-muted">{option.hint}</span> : null}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}

      {showOtherField ? (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <label htmlFor={`${id}-other`} className="block text-sm font-black text-amber-900">
            {otherLabel}
          </label>
          <input
            id={`${id}-other`}
            name={otherName}
            type="text"
            defaultValue={otherDefaultValue}
            placeholder={otherPlaceholder}
            maxLength={80}
            className="mt-2 w-full rounded-lg border border-amber-300 bg-white px-4 py-2.5 text-base outline-none focus:border-amber-500"
          />
          <p className="mt-2 text-xs text-amber-900">
            We will not add it automatically. Tell us the name and a person will set it up, usually
            within a working day.
          </p>
        </div>
      ) : null}
    </div>
  );
}

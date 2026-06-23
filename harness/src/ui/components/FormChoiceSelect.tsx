import { Search } from "lucide-react";
import { useMemo, useState, type ReactElement } from "react";

import type { AgentChoiceView } from "../../server/api-types.js";
import { filterChoices } from "../lib/choice-picker.js";

function choiceValue(fieldName: string, choice: AgentChoiceView): string {
  const params = choice.params ?? {};
  if (fieldName === "categoryId") return String(params.categoryId ?? "");
  if (fieldName === "itemId") return String(params.itemId ?? "");
  if (fieldName === "customerId") return String(params.customerId ?? "");
  if (fieldName === "chargeId") return String(params.chargeId ?? "");
  return String(params[fieldName] ?? choice.id);
}

export function FormChoiceSelect(props: {
  fieldName: string;
  choices: AgentChoiceView[];
  value: string;
  placeholder: string;
  disabled?: boolean;
  required?: boolean;
  onChange: (value: string, label?: string) => void;
}): ReactElement {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(false);
  const filtered = useMemo(() => filterChoices(props.choices, query), [props.choices, query]);

  const selected = props.choices.find((choice) => choiceValue(props.fieldName, choice) === props.value);

  return (
    <div className={`form-choice-select ${active ? "form-choice-select--open" : ""}`}>
      <div className="form-choice-select__field">
        <Search aria-hidden="true" className="form-choice-select__icon" size={16} />
        <input
          aria-label={props.placeholder}
          className="form-choice-select__input"
          disabled={props.disabled}
          onBlur={() => window.setTimeout(() => setActive(false), 120)}
          onChange={(event) => {
            setQuery(event.target.value);
            if (!active) setActive(true);
          }}
          onFocus={() => setActive(true)}
          placeholder={selected?.label ?? props.placeholder}
          required={props.required && !props.value}
          type="search"
          value={active ? query : selected?.label ?? ""}
        />
      </div>

      {active && filtered.length > 0 ? (
        <div className="form-choice-select__panel">
          <ul className="form-choice-select__results" role="listbox">
            {filtered.map((choice) => {
              const id = choiceValue(props.fieldName, choice);
              return (
                <li key={choice.id}>
                  <button
                    className="form-choice-select__option"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      props.onChange(id, choice.label);
                      setQuery("");
                      setActive(false);
                    }}
                    role="option"
                    type="button"
                  >
                    <span className="form-choice-select__option-label">{choice.label}</span>
                    {choice.description ? (
                      <span className="form-choice-select__option-desc">{choice.description}</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {active && query.trim().length > 0 && filtered.length === 0 && props.choices.length > 0 ? (
        <div className="form-choice-select__panel">
          <p className="form-choice-select__empty">Nenhum resultado para &quot;{query.trim()}&quot;.</p>
        </div>
      ) : null}

      {props.value ? <input name={props.fieldName} type="hidden" value={props.value} /> : null}
    </div>
  );
}

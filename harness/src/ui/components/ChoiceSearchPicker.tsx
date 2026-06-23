import { Search, UserPlus } from "lucide-react";
import { useMemo, useState, type ReactElement } from "react";

import type { AgentChoiceView } from "../../server/api-types.js";
import type { ChoicePickerConfig } from "../lib/choice-picker.js";
import { filterChoices } from "../lib/choice-picker.js";

export function ChoiceSearchPicker(props: {
  config: ChoicePickerConfig;
  choices?: AgentChoiceView[];
  disabled?: boolean;
  onSelect: (choice: AgentChoiceView) => void;
  onCreateNew?: (query: string) => void;
}): ReactElement {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(false);
  const choices = props.choices ?? [];
  const filtered = useMemo(() => filterChoices(choices, query), [choices, query]);

  const showCreate =
    props.config.allowCreate &&
    !props.disabled &&
    query.trim().length > 0 &&
    filtered.length === 0;

  function handleSubmitSearch(): void {
    const trimmed = query.trim();
    if (!trimmed || props.disabled) return;
    if (filtered.length === 1) {
      props.onSelect(filtered[0]!);
    }
  }

  return (
    <div className={`choice-search ${active ? "choice-search--open" : ""}`}>
      <div className="choice-search__field">
        <Search aria-hidden="true" className="choice-search__icon" size={16} />
        <input
          aria-label={props.config.placeholder}
          className="choice-search__input"
          disabled={props.disabled}
          onBlur={() => window.setTimeout(() => setActive(false), 120)}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setActive(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleSubmitSearch();
            }
          }}
          placeholder={props.config.placeholder}
          type="search"
          value={query}
        />
      </div>

      {active && filtered.length > 0 ? (
        <ul className="choice-search__results" role="listbox">
          {filtered.map((choice) => (
            <li key={choice.id}>
              <button
                className="choice-search__option"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => props.onSelect(choice)}
                role="option"
                type="button"
              >
                <span className="choice-search__option-label">{choice.label}</span>
                {choice.description ? (
                  <span className="choice-search__option-desc">{choice.description}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {showCreate ? (
        <button
          className="choice-search__create"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => props.onCreateNew?.(query.trim())}
          type="button"
        >
          <UserPlus aria-hidden="true" size={16} />
          <span>
            {props.config.createLabel ?? "Criar novo"}
            {query.trim() ? ` · "${query.trim()}"` : ""}
          </span>
        </button>
      ) : null}

      {active && query.trim().length > 0 && filtered.length === 0 && choices.length > 0 ? (
        <p className="choice-search__empty">Nenhum resultado para &quot;{query.trim()}&quot;.</p>
      ) : null}
    </div>
  );
}

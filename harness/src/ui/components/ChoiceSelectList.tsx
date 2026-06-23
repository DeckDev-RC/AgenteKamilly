import type { ReactElement } from "react";

import type { AgentChoiceView } from "../../server/api-types.js";

export function ChoiceSelectList(props: {
  choices: AgentChoiceView[];
  disabled?: boolean;
  onSelect: (choice: AgentChoiceView) => void;
}): ReactElement {
  return (
    <div className="choice-actions" role="listbox">
      {props.choices.map((choice) => (
        <button
          className="choice-action"
          disabled={props.disabled}
          key={choice.id}
          onClick={() => props.onSelect(choice)}
          role="option"
          type="button"
        >
          <span className="choice-action__text">
            <span>{choice.label}</span>
            {choice.description ? <small>{choice.description}</small> : null}
          </span>
        </button>
      ))}
    </div>
  );
}

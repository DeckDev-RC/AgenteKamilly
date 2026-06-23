import type { ChangeEvent, ReactElement } from "react";

import type { AgentChoiceView } from "../../server/api-types.js";

function choiceChargeId(choice: AgentChoiceView): string {
  return String(choice.params?.chargeId ?? choice.id.replace(/^asaas-charge:/, ""));
}

export function FormChargePickList(props: {
  choices: AgentChoiceView[];
  selectedIds: string[];
  multiple?: boolean;
  disabled?: boolean;
  required?: boolean;
  emptyMessage?: string;
  onChange: (ids: string[]) => void;
}): ReactElement {
  const selectedSet = new Set(props.selectedIds);
  const inputType = props.multiple ? "checkbox" : "radio";
  const groupName = "form-charge-picklist";

  function handleToggle(id: string, checked: boolean): void {
    if (props.disabled) return;

    if (props.multiple) {
      props.onChange(
        checked
          ? [...new Set([...props.selectedIds, id])]
          : props.selectedIds.filter((value) => value !== id)
      );
      return;
    }

    props.onChange(checked ? [id] : []);
  }

  if (props.choices.length === 0) {
    return (
      <p className="form-charge-picklist__empty">
        {props.emptyMessage ?? "Nenhuma cobrança pendente para este cliente."}
      </p>
    );
  }

  return (
    <ul className="form-charge-picklist" role="listbox">
      {props.choices.map((choice) => {
        const id = choiceChargeId(choice);
        const selected = selectedSet.has(id);
        const inputId = `charge-pick-${id}`;

        return (
          <li key={choice.id}>
            <label
              className={`form-charge-picklist__item ${selected ? "form-charge-picklist__item--selected" : ""}`}
              htmlFor={inputId}
            >
              <input
                checked={selected}
                className="form-charge-picklist__input"
                disabled={props.disabled}
                id={inputId}
                name={groupName}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  handleToggle(id, event.target.checked)
                }
                type={inputType}
              />
              <span aria-hidden="true" className="form-charge-picklist__marker" />
              <span className="form-charge-picklist__body">
                <span className="form-charge-picklist__label">{choice.label}</span>
                {choice.description ? (
                  <span className="form-charge-picklist__desc">{choice.description}</span>
                ) : null}
              </span>
            </label>
          </li>
        );
      })}
      {props.required && props.selectedIds.length > 0 ? (
        <input name="chargeIds" type="hidden" value={props.selectedIds.join(",")} />
      ) : null}
    </ul>
  );
}

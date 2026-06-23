import { Send } from "lucide-react";
import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactElement } from "react";

import type { AgentResultView } from "../../server/api-types.js";
import { applyInputMask } from "../lib/input-masks.js";
import type { InlineFormDefinition } from "../lib/inline-form.js";
import { FormChargePickList } from "./FormChargePickList.js";
import { FormChoiceSelect } from "./FormChoiceSelect.js";

export function ChatInlineForm(props: {
  definition: InlineFormDefinition;
  result: AgentResultView;
  disabled?: boolean;
  onSubmit: (text: string, params: Record<string, unknown>) => void;
}): ReactElement {
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...emptyValues(props.definition),
    ...(props.result.formDefaults ?? {})
  }));
  const [selectedChargeIds, setSelectedChargeIds] = useState<string[]>(() =>
    parseChargeIdsFromDefaults(props.result.formDefaults?.chargeIds)
  );

  useEffect(() => {
    setValues((current) => ({
      ...current,
      ...(props.result.formDefaults ?? {})
    }));
  }, [props.result.formDefaults]);

  useEffect(() => {
    setSelectedChargeIds(parseChargeIdsFromDefaults(props.result.formDefaults?.chargeIds));
  }, [props.result.formChoices?.chargeId?.length, props.result.formDefaults?.chargeIds]);

  function updateField(name: string, value: string, options?: { itemLabel?: string }): void {
    setValues((current) => {
      const next = { ...current, [name]: value };
      if (name === "itemId" && options?.itemLabel) {
        next.serviceDescription = options.itemLabel;
      }
      if (name === "customerId") {
        next.chargeIds = "";
        setSelectedChargeIds([]);
      }
      return next;
    });
  }

  function handleSelectChange(fieldName: string, value: string, label?: string): void {
    const nextValues = {
      ...values,
      [fieldName]: value,
      ...(fieldName === "itemId" && label ? { serviceDescription: label } : {}),
      ...(fieldName === "customerId" ? { chargeIds: "", customerName: label ?? "" } : {})
    };
    if (fieldName === "customerId") {
      setSelectedChargeIds([]);
    }
    setValues(nextValues);

    const changeAction = props.definition.fieldChangeActions?.[fieldName];
    if (changeAction) {
      props.onSubmit("", {
        __interactive: {
          flow: props.definition.flow,
          action: changeAction
        },
        ...nextValues
      });
    }
  }

  function handleFieldChange(fieldName: string, fieldType: string, raw: string): void {
    updateField(fieldName, applyInputMask(fieldType, raw));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (props.disabled) return;

    const requiresCharges = props.definition.fields.some(
      (field) => field.type === "charge_picklist" && field.required
    );
    if (requiresCharges && selectedChargeIds.length === 0) {
      return;
    }

    props.onSubmit(props.definition.submitLabel, {
      __interactive: {
        flow: props.definition.flow,
        action: props.definition.action
      },
      ...values,
      chargeIds: selectedChargeIds,
      ...(values.customerName ? { customerName: values.customerName } : {})
    });
  }

  const context = props.result.formContext ?? {};
  const formChoices = props.result.formChoices ?? {};

  return (
    <form className="chat-form" onSubmit={handleSubmit}>
      <div className="chat-form__header">
        <h3 className="chat-form__title">{props.definition.title}</h3>
        {context.customerName && !values.customerId ? (
          <p className="chat-form__subtitle">{context.customerName}</p>
        ) : null}
        {context.chargeSummary ? (
          <p className="chat-form__subtitle">{context.chargeSummary}</p>
        ) : null}
      </div>

      <div className="chat-form__grid">
        {props.definition.fields.map((field) => {
          const id = `chat-form-${field.name}`;
          const isWide = field.wide === true || field.type === "textarea";

          if (field.type === "charge_picklist") {
            const choices = formChoices.chargeId ?? formChoices.chargeIds ?? [];
            const showCharges = Boolean(values.customerId);

            return (
              <div
                className={`chat-form__field ${isWide ? "chat-form__field--wide" : ""}`}
                key={field.name}
              >
                <span className="chat-form__label">
                  {field.label}
                  {field.required ? <span className="chat-form__required">*</span> : null}
                </span>
                {!showCharges ? (
                  <p className="form-charge-picklist__empty">Selecione o cliente acima para ver as cobranças.</p>
                ) : (
                  <FormChargePickList
                    choices={choices}
                    disabled={props.disabled}
                    emptyMessage={field.emptyMessage}
                    multiple={field.multiple}
                    onChange={setSelectedChargeIds}
                    required={field.required}
                    selectedIds={selectedChargeIds}
                  />
                )}
                {field.hint ? <span className="chat-form__hint">{field.hint}</span> : null}
              </div>
            );
          }

          if (field.type === "select") {
            const choices = formChoices[field.name] ?? [];
            const placeholder =
              field.name === "chargeId" && !values.customerId
                ? "Selecione o cliente primeiro..."
                : choices.length === 0 && field.name === "chargeId"
                  ? "Nenhuma cobrança pendente"
                  : (field.placeholder ?? "Pesquisar...");

            return (
              <label
                className={`chat-form__field ${isWide ? "chat-form__field--wide" : ""}`}
                htmlFor={id}
                key={field.name}
              >
                <span className="chat-form__label">
                  {field.label}
                  {field.required ? <span className="chat-form__required">*</span> : null}
                </span>
                <FormChoiceSelect
                  choices={choices}
                  disabled={props.disabled || (field.name === "chargeId" && !values.customerId)}
                  fieldName={field.name}
                  onChange={(value, label) => handleSelectChange(field.name, value, label)}
                  placeholder={placeholder}
                  required={field.required}
                  value={values[field.name] ?? ""}
                />
                {field.hint ? <span className="chat-form__hint">{field.hint}</span> : null}
              </label>
            );
          }

          const common = {
            id,
            name: field.name,
            className: "chat-form__input",
            disabled: props.disabled,
            placeholder: field.placeholder,
            value: values[field.name] ?? "",
            onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
              handleFieldChange(field.name, field.type, event.target.value),
            required: field.required
          };

          return (
            <label
              className={`chat-form__field ${isWide ? "chat-form__field--wide" : ""}`}
              htmlFor={id}
              key={field.name}
            >
              <span className="chat-form__label">
                {field.label}
                {field.required ? <span className="chat-form__required">*</span> : null}
              </span>
              {field.type === "textarea" ? (
                <textarea {...common} rows={3} />
              ) : (
                <input
                  {...common}
                  autoComplete="off"
                  inputMode={
                    field.type === "money" || field.type === "tel"
                      ? "decimal"
                      : field.type === "date"
                        ? "numeric"
                        : undefined
                  }
                  type={field.type === "email" ? "email" : field.type === "tel" ? "tel" : "text"}
                />
              )}
              {field.hint ? <span className="chat-form__hint">{field.hint}</span> : null}
            </label>
          );
        })}
      </div>

      <div className="chat-form__actions">
        <button className="chat-form__submit" disabled={props.disabled} type="submit">
          {props.definition.submitLabel}
          <Send aria-hidden="true" size={16} />
        </button>
      </div>
    </form>
  );
}

function emptyValues(definition: InlineFormDefinition): Record<string, string> {
  return Object.fromEntries(
    definition.fields
      .filter((field) => field.type !== "charge_picklist")
      .map((field) => [field.name, ""])
  );
}

function parseChargeIdsFromDefaults(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

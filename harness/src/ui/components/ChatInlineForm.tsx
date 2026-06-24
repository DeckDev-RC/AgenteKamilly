import { Send } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactElement } from "react";

import type { AgentResultView } from "../../server/api-types.js";
import { sanitizeFormDefaultValues } from "../../core/redaction.js";
import { applyInputMask } from "../lib/input-masks.js";
import type { InlineFormDefinition } from "../lib/inline-form.js";
import { FormChargePickList } from "./FormChargePickList.js";
import { FormChoiceSelect } from "./FormChoiceSelect.js";

export function ChatInlineForm(props: {
  definition: InlineFormDefinition;
  result: AgentResultView;
  disabled?: boolean;
  busy?: boolean;
  onSubmit: (text: string, params: Record<string, unknown>) => void;
}): ReactElement {
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...emptyValues(props.definition),
    ...sanitizeFormDefaultValues(props.result.formDefaults ?? {})
  }));
  const [selectedChargeIds, setSelectedChargeIds] = useState<string[]>(() =>
    initialChargeIdsFromDefaults(props.result.formDefaults)
  );
  const [lookupBusy, setLookupBusy] = useState(false);
  const lookupDefaultsRef = useRef(props.result.formDefaults);
  const formChoices = props.result.formChoices ?? {};
  const formDisabled = props.disabled || props.busy || lookupBusy;

  useEffect(() => {
    setValues((current) => ({
      ...current,
      ...sanitizeFormDefaultValues(props.result.formDefaults ?? {})
    }));
    if (props.result.formDefaults !== lookupDefaultsRef.current) {
      lookupDefaultsRef.current = props.result.formDefaults;
      setLookupBusy(false);
    }
  }, [props.result.formDefaults]);

  useEffect(() => {
    setSelectedChargeIds(initialChargeIdsFromDefaults(props.result.formDefaults));
  }, [
    props.result.formChoices?.chargeId?.length,
    props.result.formDefaults?.chargeIds,
    props.result.formDefaults?.chargeId
  ]);

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
      ...(fieldName === "customerId" || fieldName === "pendingOnly" ? { chargeIds: "", ...(fieldName === "customerId" ? { customerName: label ?? "" } : {}) } : {})
    };
    if (fieldName === "customerId" || fieldName === "pendingOnly") {
      setSelectedChargeIds([]);
    }
    setValues(nextValues);

    const changeAction = props.definition.fieldChangeActions?.[fieldName];
    if (changeAction) {
      if (changeAction === "lookup_cnpj" && !shouldLookupCnpj(nextValues)) {
        return;
      }
      triggerInteractiveAction(changeAction, nextValues, {
        userNotice:
          fieldName === "customerId" && label
            ? `Cliente: ${label}`
            : changeAction === "lookup_cnpj"
              ? ""
              : ""
      });
    }
  }

  function shouldLookupCnpj(nextValues: Record<string, string>): boolean {
    if (nextValues.personType !== "Jurídica") return false;
    return nextValues.document.replace(/\D/g, "").length === 14;
  }

  function triggerInteractiveAction(
    action: string,
    nextValues: Record<string, string>,
    options?: { userNotice?: string }
  ): void {
    if (formDisabled) return;
    if (action === "lookup_cnpj") {
      setLookupBusy(true);
    }
    props.onSubmit(options?.userNotice ?? "", {
      __interactive: {
        flow: props.definition.flow,
        action
      },
      ...nextValues
    });
  }

  function handleFieldBlur(fieldName: string): void {
    const blurAction = props.definition.fieldBlurActions?.[fieldName];
    if (!blurAction || formDisabled) return;
    if (blurAction === "lookup_cnpj" && !shouldLookupCnpj(values)) return;
    triggerInteractiveAction(blurAction, values);
  }

  function handleFieldChange(fieldName: string, fieldType: string, raw: string): void {
    updateField(fieldName, applyInputMask(fieldType, raw));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (formDisabled) return;

    const requiresCharges = props.definition.fields.some(
      (field) => field.type === "charge_picklist" && field.required
    );
    if (requiresCharges && selectedChargeIds.length === 0) {
      return;
    }

    props.onSubmit(
      buildFormSubmitText(props.definition, values, selectedChargeIds, formChoices),
      {
      __interactive: {
        flow: props.definition.flow,
        action: props.definition.action
      },
      ...values,
      chargeIds: selectedChargeIds,
      ...(selectedChargeIds[0] ? { chargeId: selectedChargeIds[0] } : {}),
      ...(values.customerName ? { customerName: values.customerName } : {})
    });
  }

  const context = props.result.formContext ?? {};

  return (
    <form className="chat-form" onSubmit={handleSubmit}>
      <div className="chat-form__header">
        <h3 className="chat-form__title">{props.definition.title}</h3>
        {context.tenantName ? (
          <p className="chat-form__subtitle">Empresa: {context.tenantName}</p>
        ) : null}
        {context.customerName && !values.customerId ? (
          <p className="chat-form__subtitle">{context.customerName}</p>
        ) : null}
        {context.chargeSummary ? (
          <p className="chat-form__subtitle">{context.chargeSummary}</p>
        ) : null}
        {lookupBusy ? (
          <p className="chat-form__lookup" role="status">
            Buscando dados na Receita…
          </p>
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
                    disabled={formDisabled}
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
                  disabled={formDisabled || (field.name === "chargeId" && !values.customerId)}
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
            disabled: formDisabled,
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
                  onBlur={() => handleFieldBlur(field.name)}
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
        <button className="chat-form__submit" disabled={formDisabled} type="submit">
          {buildFormSubmitText(props.definition, values, selectedChargeIds, formChoices)}
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

function initialChargeIdsFromDefaults(
  defaults?: Record<string, string | undefined>
): string[] {
  const fromList = parseChargeIdsFromDefaults(defaults?.chargeIds);
  if (fromList.length > 0) return fromList;
  const single = defaults?.chargeId?.trim();
  return single ? [single] : [];
}

function buildFormSubmitText(
  definition: InlineFormDefinition,
  values: Record<string, string>,
  selectedChargeIds: string[],
  formChoices: AgentResultView["formChoices"]
): string {
  if (definition.flow === "asaas_download_boleto") {
    const chargeId = selectedChargeIds[0];
    const choice = formChoices?.chargeId?.find(
      (item) => String(item.params?.chargeId ?? "") === chargeId
    );
    if (choice) {
      const valuePart = choice.description?.split("·")[0]?.trim();
      return valuePart
        ? `Baixar PDF · ${choice.label} · ${valuePart}`
        : `Baixar PDF · ${choice.label}`;
    }
  }

  if (definition.flow === "asaas_update_charge_due_date" && values.dueDateBr?.trim()) {
    return `Alterar vencimento para ${values.dueDateBr.trim()}`;
  }

  if (definition.flow === "contaazul_update_due_date" && values.dueDateBr?.trim()) {
    return `Alterar vencimento para ${values.dueDateBr.trim()}`;
  }

  if (definition.flow === "contaazul_create_customer") {
    const name = values.name?.trim();
    return name ? `Preparar cadastro · ${name}` : definition.submitLabel;
  }

  return definition.submitLabel;
}

import type { AgentChoiceView, AgentResultView } from "../../server/api-types.js";

export type ChoicePickerConfig = {
  mode: "local";
  display: "search" | "select";
  placeholder: string;
  allowCreate?: boolean;
  createLabel?: string;
};

const LOCAL_CHOICE_FIELDS = new Set([
  "tenantId",
  "customerId",
  "categoryId",
  "itemId",
  "statementId",
  "provider",
  "personType",
  "chargeId",
  "operation"
]);

const SELECT_DISPLAY_FIELDS = new Set(["provider", "operation", "personType"]);

export function inferChoicePicker(result: AgentResultView): ChoicePickerConfig | null {
  const field = result.missingFields[0];
  const choiceCount = result.choices?.length ?? 0;
  const isContaAzul =
    result.provider === "contaazul" ||
    result.toolName?.startsWith("contaazul.") ||
    (!result.provider && result.toolName?.includes("contaazul"));

  if (field === "customerId" && isContaAzul) {
    return {
      mode: "local",
      display: "search",
      placeholder: placeholderForField(field),
      allowCreate: true,
      createLabel: "Criar novo cliente"
    };
  }

  if (field && LOCAL_CHOICE_FIELDS.has(field) && (choiceCount > 0 || field === "customerId")) {
    return {
      mode: "local",
      display: field && SELECT_DISPLAY_FIELDS.has(field) ? "select" : "search",
      placeholder: placeholderForField(field)
    };
  }

  if (choiceCount > 0) {
    return {
      mode: "local",
      display: "search",
      placeholder: "Pesquisar..."
    };
  }

  return null;
}

function placeholderForField(field: string): string {
  switch (field) {
    case "tenantId":
      return "Pesquisar empresa...";
    case "customerId":
      return "Pesquisar cliente...";
    case "categoryId":
      return "Pesquisar categoria...";
    case "itemId":
      return "Pesquisar item de serviço...";
    case "statementId":
      return "Pesquisar lançamento...";
    case "provider":
      return "Pesquisar destino...";
    case "operation":
      return "Selecione a operação...";
    case "personType":
      return "Pesquisar tipo...";
    case "chargeId":
      return "Pesquisar cobrança...";
    default:
      return "Pesquisar...";
  }
}

export function filterChoices(choices: AgentChoiceView[], query: string): AgentChoiceView[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return choices;
  return choices.filter((choice) => {
    const haystack = `${choice.label} ${choice.description ?? ""}`.toLowerCase();
    return haystack.includes(normalized);
  });
}

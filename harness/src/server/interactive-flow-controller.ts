import type { AgentChoiceView, AgentResultView } from "./api-types.js";
import { understand, normalize, type NluEntities, type NluProvider } from "../core/nlu.js";
import type { PreferencesStore, RememberedTenant } from "../core/preferences-store.js";
import { isRedactedPlaceholder, sanitizeFormDefaultValues } from "../core/redaction.js";
import type { ToolRegistry } from "../core/tool-registry.js";
import type { AccountancyClient, CustomerMatch, FinancialStatementItem, PendingCharge, ToolReceipt } from "../core/tool-types.js";
import {
  mergePrefillIntoFormDefaults,
  prefillToFormDefaults,
  prefillToWorkflowSlots,
  type CustomerCnpjPrefill
} from "../modules/contaazul/cnpj-prefill.js";

const CONTAZUL_FLOW = "contaazul_service_sale_boleto";
const ASAAS_FLOW = "asaas_boleto_charge";
const PROVIDER_CHOICE_FLOW = "provider_choice";
const INTERACTIVE_TOOL_NAME = "contaazul.interactive_service_sale_boleto";
const PROVIDER_CHOICE_TOOL_NAME = "confere.interactive_boleto_provider";
const PROVIDER_MENU_TOOL_NAME = "confere.interactive_provider_menu";
const ANCHOR_FLOW = "anchor";
const PROVIDER_MENU_FLOW = "provider_menu";
const ASAAS_UPDATE_FLOW = "asaas_update_charge_due_date";
const ASAAS_DOWNLOAD_FLOW = "asaas_download_boleto";
const CONTAZUL_UPDATE_FLOW = "contaazul_update_due_date";
const CONTAZUL_CREATE_CUSTOMER_FLOW = "contaazul_create_customer";
const CONTAZUL_LIST_FLOW = "contaazul_list_charges";
const ASAAS_UPDATE_TOOL_NAME = "asaas.interactive_update_charge_due_date";
const ASAAS_DOWNLOAD_TOOL_NAME = "asaas.interactive_download_boleto";
const CONTAZUL_UPDATE_TOOL_NAME = "contaazul.interactive_update_due_date";
const CONTAZUL_CREATE_CUSTOMER_TOOL_NAME = "contaazul.interactive_create_customer";

type InteractiveFlowName =
  | typeof CONTAZUL_FLOW
  | typeof ASAAS_FLOW
  | typeof ASAAS_UPDATE_FLOW
  | typeof ASAAS_DOWNLOAD_FLOW
  | typeof CONTAZUL_UPDATE_FLOW
  | typeof CONTAZUL_CREATE_CUSTOMER_FLOW
  | typeof CONTAZUL_LIST_FLOW
  | typeof PROVIDER_MENU_FLOW;

type InteractiveMarker = {
  flow?: unknown;
  action?: unknown;
};

type InteractiveFlowState = {
  flow: InteractiveFlowName;
  step:
    | "tenant"
    | "customerSearch"
    | "customerChoice"
    | "categorySearch"
    | "categoryChoice"
    | "itemSearch"
    | "itemChoice"
    | "saleDetailsForm"
    | "serviceDescription"
    | "unitValue"
    | "dueDate"
    | "notificationPhone"
    | "notificationEmail"
    | "notificationReplyTo"
    | "asaasCustomerSearch"
    | "asaasCustomerChoice"
    | "asaasDetailsForm"
    | "asaasUpdateDetailsForm"
    | "asaasDownloadDetailsForm"
    | "asaasValue"
    | "asaasDueDate"
    | "asaasDescription"
    | "asaasUpdateCustomerSearch"
    | "asaasUpdateChargeChoice"
    | "asaasUpdateDueDate"
    | "caUpdateDetailsForm"
    | "createCustomerDetailsForm"
    | "provider"
    | "operation";
  slots: Record<string, unknown>;
  formChoices?: Record<string, AgentChoiceView[]>;
};

export type InteractiveFlowStore = Map<string, InteractiveFlowState>;

export function createInteractiveFlowStore(): InteractiveFlowStore {
  return new Map();
}

export type InteractiveFlowInput = {
  request: string;
  registry: ToolRegistry;
  sessionId?: string;
  store: InteractiveFlowStore;
  params?: Record<string, unknown>;
  /** Memória de preferências (última empresa, clientes recentes). Opcional. */
  memory?: PreferencesStore;
};

export type OperationDraftPayload = {
  operationId: string;
  toolName: string;
  params: Record<string, unknown>;
};

export type InteractiveFlowResult =
  | {
      handled: false;
    }
  | {
      handled: true;
      result: AgentResultView;
      draftOperationId?: string;
      draft?: OperationDraftPayload;
      drafts?: OperationDraftPayload[];
    };

export async function runInteractiveFlowTurn(input: InteractiveFlowInput): Promise<InteractiveFlowResult> {
  const sessionKey = input.sessionId ?? "default";
  const marker = getInteractiveMarker(input.params);
  const existing = input.store.get(sessionKey);

  if (!marker.flow && existing?.flow === PROVIDER_MENU_FLOW) {
    const continued = await continueProviderMenu(input, sessionKey, existing);
    if (continued.handled) return continued;
  }

  rememberFromSelection(input, marker, existing);

  if (
    (marker.flow === PROVIDER_CHOICE_FLOW || marker.flow === ANCHOR_FLOW) &&
    existing?.flow === PROVIDER_MENU_FLOW
  ) {
    input.store.delete(sessionKey);
  }

  if (marker.flow === PROVIDER_CHOICE_FLOW) {
    if (marker.action === "select_contaazul_service_sale") {
      const state: InteractiveFlowState = {
        flow: CONTAZUL_FLOW,
        step: "tenant",
        slots: {}
      };
      input.store.set(sessionKey, state);
      return promptContaAzulTenant(input);
    }
    if (marker.action === "select_asaas_boleto") {
      const state: InteractiveFlowState = {
        flow: ASAAS_FLOW,
        step: "asaasDetailsForm",
        slots: {}
      };
      input.store.set(sessionKey, state);
      return transitionToAsaasBoletoForm(input, state, sessionKey);
    }
  }

  if (marker.flow === ANCHOR_FLOW) {
    if (marker.action === "start_contaazul_service_sale") {
      input.store.set(sessionKey, { flow: CONTAZUL_FLOW, step: "tenant", slots: {} });
      return promptContaAzulTenant(input);
    }
    if (marker.action === "start_asaas_update_due_date") {
      const state: InteractiveFlowState = {
        flow: ASAAS_UPDATE_FLOW,
        step: "asaasUpdateDetailsForm",
        slots: {}
      };
      input.store.set(sessionKey, state);
      return transitionToAsaasUpdateForm(input, state, sessionKey);
    }
    if (marker.action === "start_asaas_download_boleto") {
      const state: InteractiveFlowState = {
        flow: ASAAS_DOWNLOAD_FLOW,
        step: "asaasDownloadDetailsForm",
        slots: {}
      };
      input.store.set(sessionKey, state);
      return transitionToAsaasDownloadForm(input, state, sessionKey);
    }
    if (marker.action === "start_contaazul_create_customer") {
      input.store.set(sessionKey, { flow: CONTAZUL_CREATE_CUSTOMER_FLOW, step: "tenant", slots: {} });
      return promptContaAzulTenant(input, CONTAZUL_CREATE_CUSTOMER_FLOW);
    }
    if (marker.action === "start_contaazul_update_due_date") {
      input.store.set(sessionKey, { flow: CONTAZUL_UPDATE_FLOW, step: "tenant", slots: {} });
      return promptContaAzulTenant(input, CONTAZUL_UPDATE_FLOW);
    }
    if (marker.action === "start_asaas_boleto") {
      const state: InteractiveFlowState = {
        flow: ASAAS_FLOW,
        step: "asaasDetailsForm",
        slots: {}
      };
      input.store.set(sessionKey, state);
      return transitionToAsaasBoletoForm(input, state, sessionKey);
    }
  }

  if (marker.flow === ASAAS_FLOW) {
    const state = existing ?? {
      flow: ASAAS_FLOW,
      step: "asaasCustomerSearch" as const,
      slots: {}
    };
    return continueAsaasFlow(input, sessionKey, state, marker);
  }

  if (marker.flow === ASAAS_UPDATE_FLOW) {
    const state = existing ?? {
      flow: ASAAS_UPDATE_FLOW,
      step: "asaasUpdateCustomerSearch" as const,
      slots: {}
    };
    return continueAsaasUpdateFlow(input, sessionKey, state, marker);
  }

  if (marker.flow === ASAAS_DOWNLOAD_FLOW) {
    const state = existing ?? {
      flow: ASAAS_DOWNLOAD_FLOW,
      step: "asaasDownloadDetailsForm" as const,
      slots: {}
    };
    return continueAsaasDownloadFlow(input, sessionKey, state, marker);
  }

  if (marker.flow === CONTAZUL_UPDATE_FLOW) {
    const state = existing ?? {
      flow: CONTAZUL_UPDATE_FLOW,
      step: "tenant" as const,
      slots: {}
    };
    return continueContaAzulUpdateFlow(input, sessionKey, state, marker);
  }

  if (marker.flow === CONTAZUL_CREATE_CUSTOMER_FLOW) {
    const state = existing ?? {
      flow: CONTAZUL_CREATE_CUSTOMER_FLOW,
      step: "tenant" as const,
      slots: {}
    };
    return continueContaAzulCreateCustomerFlow(input, sessionKey, state, marker);
  }

  if (marker.flow === CONTAZUL_LIST_FLOW) {
    const state = existing ?? {
      flow: CONTAZUL_LIST_FLOW,
      step: "tenant" as const,
      slots: {}
    };
    return continueContaAzulListFlow(input, sessionKey, state, marker);
  }

  if (marker.flow === CONTAZUL_FLOW) {
    const state = existing ?? {
      flow: CONTAZUL_FLOW,
      step: "tenant" as const,
      slots: {}
    };
    return continueContaAzulFlow(input, sessionKey, state, marker);
  }

  if (existing?.flow === CONTAZUL_FLOW) {
    return continueContaAzulFlow(input, sessionKey, existing, marker);
  }

  if (existing?.flow === ASAAS_FLOW) {
    return continueAsaasFlow(input, sessionKey, existing, marker);
  }

  if (existing?.flow === ASAAS_UPDATE_FLOW) {
    return continueAsaasUpdateFlow(input, sessionKey, existing, marker);
  }

  if (existing?.flow === ASAAS_DOWNLOAD_FLOW) {
    return continueAsaasDownloadFlow(input, sessionKey, existing, marker);
  }

  if (existing?.flow === CONTAZUL_UPDATE_FLOW) {
    return continueContaAzulUpdateFlow(input, sessionKey, existing, marker);
  }

  if (existing?.flow === CONTAZUL_CREATE_CUSTOMER_FLOW) {
    return continueContaAzulCreateCustomerFlow(input, sessionKey, existing, marker);
  }

  if (existing?.flow === CONTAZUL_LIST_FLOW) {
    return continueContaAzulListFlow(input, sessionKey, existing, marker);
  }

  return startFromNaturalLanguage(input, sessionKey);
}

/**
 * Roteamento determinístico de linguagem natural: entende a intenção e as
 * entidades (valor, data, CPF/CNPJ, cliente) e inicia o fluxo certo já com os
 * slots semeados — sem depender do LLM.
 */
async function startFromNaturalLanguage(
  input: InteractiveFlowInput,
  sessionKey: string
): Promise<InteractiveFlowResult> {
  const nlu = understand(input.request);
  if (!nlu.intent) {
    if (nlu.entities.provider) {
      return promptProviderOperations(input, sessionKey, nlu.entities.provider);
    }
    return { handled: false };
  }

  const seeded = seedSlots(nlu.entities);

  switch (nlu.intent) {
    case "boleto_provider_choice":
      return promptBoletoProvider(input, sessionKey);

    case "create_service_sale_boleto":
      input.store.set(sessionKey, { flow: CONTAZUL_FLOW, step: "tenant", slots: seeded });
      return promptContaAzulTenant(input);

    case "create_asaas_boleto": {
      const state: InteractiveFlowState = { flow: ASAAS_FLOW, step: "asaasDetailsForm", slots: seeded };
      input.store.set(sessionKey, state);
      return transitionToAsaasBoletoForm(input, state, sessionKey);
    }

    case "create_customer":
      input.store.set(sessionKey, {
        flow: CONTAZUL_CREATE_CUSTOMER_FLOW,
        step: "tenant",
        slots: customerSeedSlots(nlu.entities)
      });
      return promptContaAzulTenant(input, CONTAZUL_CREATE_CUSTOMER_FLOW);

    case "update_due_date_contaazul":
      input.store.set(sessionKey, { flow: CONTAZUL_UPDATE_FLOW, step: "tenant", slots: seeded });
      return promptContaAzulTenant(input, CONTAZUL_UPDATE_FLOW);

    case "update_due_date_asaas": {
      const state: InteractiveFlowState = {
        flow: ASAAS_UPDATE_FLOW,
        step: "asaasUpdateDetailsForm",
        slots: seeded
      };
      input.store.set(sessionKey, state);
      return transitionToAsaasUpdateForm(input, state, sessionKey);
    }

    case "download_boleto_asaas": {
      const state: InteractiveFlowState = {
        flow: ASAAS_DOWNLOAD_FLOW,
        step: "asaasDownloadDetailsForm",
        slots: seeded
      };
      input.store.set(sessionKey, state);
      return transitionToAsaasDownloadForm(input, state, sessionKey);
    }

    case "list_charges": {
      // Consulta/entrega: lista os boletos (extrato) filtrados pelos clientes
      // citados e/ou apenas vencidos — em modo leitura (sem mutação).
      const hints =
        nlu.entities.customerHints ??
        (nlu.entities.customerHint ? [nlu.entities.customerHint] : []);
      input.store.set(sessionKey, {
        flow: CONTAZUL_LIST_FLOW,
        step: "tenant",
        slots: { customerHints: hints, onlyOverdue: nlu.entities.onlyOverdue === true }
      });
      return promptContaAzulTenant(input, CONTAZUL_LIST_FLOW);
    }

    default:
      return { handled: false };
  }
}

/** Mapeia entidades da NLU para os slots dos fluxos (valor/data/cliente). */
function seedSlots(entities: NluEntities): Record<string, unknown> {
  const slots: Record<string, unknown> = {};
  if (entities.valueBr) {
    slots.valueBr = entities.valueBr;
    slots.unitValueBr = entities.valueBr;
  }
  if (entities.dueDateBr) slots.dueDateBr = entities.dueDateBr;
  if (entities.dueDateIso) slots.dueDateIso = entities.dueDateIso;
  if (entities.customerHint) slots.customerHint = entities.customerHint;
  return slots;
}

/** Slots de semeadura específicos do cadastro de cliente. */
function customerSeedSlots(entities: NluEntities): Record<string, unknown> {
  const slots: Record<string, unknown> = {};
  if (entities.document) slots.document = entities.document;
  if (entities.personType) slots.personType = entities.personType;
  if (entities.customerHint) slots.suggestedName = entities.customerHint;
  return slots;
}

async function continueAsaasFlow(
  input: InteractiveFlowInput,
  sessionKey: string,
  state: InteractiveFlowState,
  marker: InteractiveMarker
): Promise<InteractiveFlowResult> {
  if (marker.action === "select_customer") {
    state.slots = {
      ...state.slots,
      customerId: stringValue(input.params?.customerId),
      customerName: stringValue(input.params?.customerName)
    };
    input.store.set(sessionKey, state);
    if (!state.formChoices?.customerId) {
      return transitionToAsaasBoletoForm(input, state, sessionKey, {
        summary: "Cliente selecionado. Complete os dados da cobrança."
      });
    }
    state.step = "asaasDetailsForm";
    input.store.set(sessionKey, state);
    return {
      handled: true,
      result: promptAsaasBoletoDetailsForm(state)
    };
  }

  if (marker.action === "submit_asaas_boleto_details") {
    return collectAsaasBoletoDetailsForm(input, state, sessionKey, asRecord(input.params));
  }

  if (state.step === "asaasDetailsForm") {
    return {
      handled: true,
      result: promptAsaasBoletoDetailsForm(state, "Use o formulário abaixo para preencher os dados da cobrança.")
    };
  }

  if (state.step === "asaasCustomerChoice") {
    return transitionToAsaasBoletoForm(input, state, sessionKey);
  }

  if (state.step === "asaasValue") {
    return collectAsaasValue(input, state, sessionKey);
  }

  if (state.step === "asaasDueDate") {
    return collectAsaasDueDate(input, state, sessionKey);
  }

  if (state.step === "asaasDescription") {
    return collectAsaasDescriptionAndPlan(input, state, sessionKey);
  }

  return transitionToAsaasBoletoForm(input, state, sessionKey);
}

async function promptAsaasCustomers(
  input: InteractiveFlowInput,
  flow: typeof ASAAS_FLOW | typeof ASAAS_UPDATE_FLOW,
  toolName: string,
  intent: string
): Promise<InteractiveFlowResult> {
  const receipt = await executeTool<CustomerMatch[]>(input.registry, "asaas.search_customers", {
    query: ""
  });
  const customers = Array.isArray(receipt.data) ? receipt.data : [];
  if (customers.length === 0) {
    return {
      handled: true,
      result: needsInput({
        toolName,
        provider: "asaas",
        intent,
        summary: "Nenhum cliente encontrado no Asaas.",
        missingFields: ["customerId"],
        questions: ["Nenhum cliente cadastrado no Asaas."],
        choices: []
      })
    };
  }

  return {
    handled: true,
    result: needsInput({
      toolName,
      provider: "asaas",
      intent,
      summary:
        flow === ASAAS_FLOW
          ? "Vamos preparar uma cobrança no Asaas."
          : "Vamos alterar o vencimento de uma cobrança no Asaas.",
      missingFields: ["customerId"],
      questions: ["Selecione o cliente."],
      choices: customers.map((customer) => asaasCustomerChoice(customer, flow))
    })
  };
}

function collectAsaasValue(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string
): InteractiveFlowResult {
  const valueBr = normalizeMoneyBr(input.request.trim());
  if (!isValidMoneyBr(valueBr)) {
    return {
      handled: true,
      result: needsInput({
        toolName: "asaas.interactive_boleto_charge",
        provider: "asaas",
        intent: "create_boleto_charge",
        summary: "Valor inválido.",
        missingFields: ["valueBr"],
        questions: ["Digite o valor da cobrança no formato 10,00."]
      })
    };
  }
  state.slots = { ...state.slots, valueBr };
  state.step = "asaasDueDate";
  input.store.set(sessionKey, state);
  return {
    handled: true,
    result: needsInput({
      toolName: "asaas.interactive_boleto_charge",
      provider: "asaas",
      intent: "create_boleto_charge",
      summary: "Valor registrado.",
      missingFields: ["dueDateBr"],
      questions: ["Digite a data de vencimento (DD/MM/AAAA)."]
    })
  };
}

function collectAsaasDueDate(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string
): InteractiveFlowResult {
  const dueDateBr = input.request.trim();
  if (!isValidDateBr(dueDateBr)) {
    return {
      handled: true,
      result: needsInput({
        toolName: "asaas.interactive_boleto_charge",
        provider: "asaas",
        intent: "create_boleto_charge",
        summary: "Data de vencimento inválida.",
        missingFields: ["dueDateBr"],
        questions: ["Digite a data de vencimento no formato DD/MM/AAAA."]
      })
    };
  }
  state.slots = { ...state.slots, dueDateBr };
  state.step = "asaasDescription";
  input.store.set(sessionKey, state);
  return {
    handled: true,
    result: needsInput({
      toolName: "asaas.interactive_boleto_charge",
      provider: "asaas",
      intent: "create_boleto_charge",
      summary: "Vencimento registrado.",
      missingFields: ["description"],
      questions: ["Digite a descrição da cobrança."]
    })
  };
}

async function collectAsaasDescriptionAndPlan(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string
): Promise<InteractiveFlowResult> {
  const description = input.request.trim();
  if (!description) {
    return {
      handled: true,
      result: needsInput({
        toolName: "asaas.interactive_boleto_charge",
        provider: "asaas",
        intent: "create_boleto_charge",
        summary: "Descrição obrigatória.",
        missingFields: ["description"],
        questions: ["Digite a descrição da cobrança."]
      })
    };
  }
  state.slots = { ...state.slots, description };
  input.store.delete(sessionKey);
  const params = {
    customerName: state.slots.customerName,
    valueBr: state.slots.valueBr,
    dueDateBr: state.slots.dueDateBr,
    description
  };
  const receipt = await executeTool<unknown>(
    input.registry,
    "asaas.create_boleto_charge_workflow",
    params
  );
  const operationId = operationIdFromReceipt(receipt);

  return {
    handled: true,
    draftOperationId: receipt.status === "planned" ? operationId : undefined,
    draft: receipt.status === "planned"
      ? {
          operationId,
          toolName: receipt.toolName,
          params
        }
      : undefined,
    result: {
      status: "executed",
      provider: "asaas",
      intent: "create_boleto_charge",
      toolName: receipt.toolName,
      operationId,
      receiptStatus: receipt.status,
      summary: receipt.status === "planned"
        ? "Dry-run concluído. Revise os dados e aprove para emitir o boleto de verdade."
        : receipt.summary,
      missingFields: [],
      questions: [],
      warnings: receipt.warnings,
      approvalAvailable: receipt.status === "planned",
      receiptData: receipt.data
    }
  };
}

async function continueAsaasUpdateFlow(
  input: InteractiveFlowInput,
  sessionKey: string,
  state: InteractiveFlowState,
  marker: InteractiveMarker
): Promise<InteractiveFlowResult> {
  if (marker.action === "select_customer") {
    state.slots = {
      ...state.slots,
      customerId: stringValue(input.params?.customerId),
      customerName: stringValue(input.params?.customerName)
    };
    input.store.set(sessionKey, state);
    return loadAsaasChargesIntoForm(input, state, sessionKey, asRecord(input.params), {
      summary: "Cliente selecionado. Escolha a cobrança e informe o novo vencimento."
    });
  }

  if (marker.action === "select_charge") {
    state.slots = { ...state.slots, chargeId: stringValue(input.params?.chargeId) };
    state.step = "asaasUpdateDetailsForm";
    input.store.set(sessionKey, state);
    return {
      handled: true,
      result: promptAsaasUpdateDetailsForm(state, "Cobrança selecionada. Informe o novo vencimento.", {
        customerId: stringValue(state.slots.customerId) ?? "",
        chargeId: stringValue(state.slots.chargeId) ?? "",
        dueDateBr: ""
      })
    };
  }

  if (marker.action === "load_asaas_charges") {
    return loadAsaasChargesIntoForm(input, state, sessionKey, asRecord(input.params));
  }

  if (marker.action === "submit_asaas_update_details") {
    return collectAsaasUpdateDetailsForm(input, state, sessionKey, asRecord(input.params));
  }

  if (state.step === "asaasUpdateDetailsForm") {
    return {
      handled: true,
      result: promptAsaasUpdateDetailsForm(
        state,
        "Use o formulário abaixo para alterar o vencimento da cobrança."
      )
    };
  }

  if (state.step === "asaasUpdateCustomerSearch") {
    return transitionToAsaasUpdateForm(input, state, sessionKey);
  }

  if (state.step === "asaasUpdateChargeChoice") {
    return loadAsaasChargesIntoForm(input, state, sessionKey, {
      customerId: stringValue(state.slots.customerId),
      customerName: stringValue(state.slots.customerName)
    });
  }

  if (state.step === "asaasUpdateDueDate") {
    return collectAsaasUpdateDueDateAndPlan(input, state, sessionKey);
  }

  return transitionToAsaasUpdateForm(input, state, sessionKey);
}

async function continueAsaasDownloadFlow(
  input: InteractiveFlowInput,
  sessionKey: string,
  state: InteractiveFlowState,
  marker: InteractiveMarker
): Promise<InteractiveFlowResult> {
  if (marker.action === "load_asaas_charges") {
    return loadAsaasDownloadChargesIntoForm(input, state, sessionKey, asRecord(input.params));
  }

  if (marker.action === "submit_asaas_download_boleto") {
    return collectAsaasDownloadBoletoForm(input, state, sessionKey, asRecord(input.params));
  }

  if (state.step === "asaasDownloadDetailsForm") {
    return {
      handled: true,
      result: promptAsaasDownloadDetailsForm(
        state,
        "Selecione o cliente. As cobranças boleto aparecem na lista abaixo."
      )
    };
  }

  return transitionToAsaasDownloadForm(input, state, sessionKey);
}

async function listAsaasChargesForChoice(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string
): Promise<InteractiveFlowResult> {
  const customerId = stringValue(state.slots.customerId);
  if (!customerId) {
    return promptAsaasCustomers(input, ASAAS_UPDATE_FLOW, ASAAS_UPDATE_TOOL_NAME, "update_charge_due_date");
  }
  const receipt = await executeTool<PendingCharge[]>(input.registry, "asaas.list_pending_charges", { customerId });
  const charges = Array.isArray(receipt.data) ? receipt.data : [];
  if (charges.length === 0) {
    state.step = "asaasUpdateChargeChoice";
    input.store.set(sessionKey, state);
    return {
      handled: true,
      result: needsInput({
        toolName: ASAAS_UPDATE_TOOL_NAME,
        provider: "asaas",
        intent: "update_charge_due_date",
        summary: `Nenhuma cobrança pendente para ${state.slots.customerName ?? "este cliente"}.`,
        missingFields: ["customerId"],
        questions: ["Selecione outro cliente."],
        choices: []
      })
    };
  }
  state.step = "asaasUpdateChargeChoice";
  input.store.set(sessionKey, state);
  return {
    handled: true,
    result: needsInput({
      toolName: ASAAS_UPDATE_TOOL_NAME,
      provider: "asaas",
      intent: "update_charge_due_date",
      summary: `Cobranças pendentes de ${state.slots.customerName ?? "este cliente"}.`,
      missingFields: ["chargeId"],
      questions: ["Selecione a cobrança."],
      choices: charges.map((ch) => ({
        id: `asaas-charge:${ch.id}`,
        label: ch.description ?? `Cobrança ${ch.id}`,
        description: `R$ ${ch.valueBr} · vence ${ch.dueDateBr}`,
        params: {
          __interactive: { flow: ASAAS_UPDATE_FLOW, action: "select_charge" },
          chargeId: ch.id
        }
      }))
    })
  };
}

async function collectAsaasUpdateDueDateAndPlan(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string
): Promise<InteractiveFlowResult> {
  const dueDateBr = input.request.trim();
  if (!isValidDateBr(dueDateBr)) {
    return {
      handled: true,
      result: needsInput({
        toolName: ASAAS_UPDATE_TOOL_NAME,
        provider: "asaas",
        intent: "update_charge_due_date",
        summary: "Data inválida.",
        missingFields: ["dueDateBr"],
        questions: ["Digite o novo vencimento no formato DD/MM/AAAA."]
      })
    };
  }
  input.store.delete(sessionKey);
  const params = { chargeId: state.slots.chargeId, dueDateBr };
  const receipt = await executeTool<unknown>(input.registry, "asaas.update_charge_due_date", params);
  const operationId = operationIdFromReceipt(receipt);
  return {
    handled: true,
    draftOperationId: receipt.status === "planned" ? operationId : undefined,
    draft: receipt.status === "planned" ? { operationId, toolName: receipt.toolName, params } : undefined,
    result: {
      status: "executed",
      provider: "asaas",
      intent: "update_charge_due_date",
      toolName: receipt.toolName,
      operationId,
      receiptStatus: receipt.status,
      summary: receipt.status === "planned" ? "Dry-run concluído. Revise os dados e aprove para emitir o boleto de verdade." : receipt.summary,
      missingFields: [],
      questions: [],
      warnings: receipt.warnings,
      approvalAvailable: receipt.status === "planned",
      receiptData: receipt.data
    }
  };
}

const CONTAZUL_PENDING_FILTER_CHOICES: AgentChoiceView[] = [
  {
    id: "pending:pending",
    label: "Apenas pendentes",
    description: "Cobranças em aberto",
    params: { pendingOnly: "pending" }
  },
  {
    id: "pending:all",
    label: "Todas",
    description: "Pendentes e liquidadas",
    params: { pendingOnly: "all" }
  }
];

async function continueContaAzulUpdateFlow(
  input: InteractiveFlowInput,
  sessionKey: string,
  state: InteractiveFlowState,
  marker: InteractiveMarker
): Promise<InteractiveFlowResult> {
  if (marker.action === "select_tenant") {
    const relationId = stringValue(input.params?.relationId);
    if (!relationId) {
      return { handled: true, result: blocked("A empresa selecionada não possui relationId.") };
    }
    const sw = await executeTool<unknown>(input.registry, "contaazul.switch_to_pro_session", { relationId });
    if (sw.status !== "succeeded") {
      return { handled: true, result: blocked(sw.summary) };
    }
    state.slots = {
      ...state.slots,
      tenantId: input.params?.tenantId,
      relationId,
      tenantName: stringValue(input.params?.tenantName)
    };
    input.store.set(sessionKey, state);
    return transitionToContaAzulUpdateForm(input, state, sessionKey);
  }

  if (marker.action === "load_contaazul_statements") {
    return loadContaAzulStatementsIntoForm(input, state, sessionKey, asRecord(input.params));
  }

  if (marker.action === "submit_contaazul_update_details") {
    return collectContaAzulUpdateDetailsForm(input, state, sessionKey, asRecord(input.params));
  }

  if (state.step === "caUpdateDetailsForm") {
    return {
      handled: true,
      result: promptContaAzulUpdateDetailsForm(
        state,
        "Selecione o cliente, filtre as cobranças e informe o novo vencimento."
      )
    };
  }

  if (state.step === "tenant") return promptContaAzulTenant(input, CONTAZUL_UPDATE_FLOW);
  return promptContaAzulTenant(input, CONTAZUL_UPDATE_FLOW);
}

async function transitionToContaAzulUpdateForm(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string,
  options?: { summary?: string }
): Promise<InteractiveFlowResult> {
  const relationId = stringValue(state.slots.relationId);
  if (!relationId) {
    return { handled: true, result: blocked("A empresa selecionada não possui relationId para buscar clientes.") };
  }

  const receipt = await executeTool<unknown[]>(input.registry, "contaazul.search_sale_customers", {
    relationId,
    listAll: true
  });
  const customers = Array.isArray(receipt.data) ? receipt.data : [];
  if (customers.length === 0) {
    return {
      handled: true,
      result: needsInput({
        toolName: CONTAZUL_UPDATE_TOOL_NAME,
        provider: "contaazul",
        intent: "update_due_date_reissue_boleto",
        summary: "Nenhum cliente encontrado nesta empresa.",
        missingFields: ["customerId"],
        questions: ["Nenhum cliente cadastrado."],
        choices: []
      })
    };
  }

  state.formChoices = {
    customerId: customers.map((customer) => contaazulCustomerFormChoice(customer)),
    pendingOnly: CONTAZUL_PENDING_FILTER_CHOICES
  };
  state.step = "caUpdateDetailsForm";
  input.store.set(sessionKey, state);

  return {
    handled: true,
    result: promptContaAzulUpdateDetailsForm(
      state,
      options?.summary ?? "Selecione o cliente e as cobranças para alterar o vencimento."
    )
  };
}

function promptContaAzulUpdateDetailsForm(
  state: InteractiveFlowState,
  summary = "Selecione o cliente e as cobranças para alterar o vencimento.",
  partialDefaults?: Record<string, string>
): AgentResultView {
  const customerId = stringValue(state.slots.customerId) ?? "";
  const customerName = stringValue(state.slots.customerName) ?? "";
  const tenantName = stringValue(state.slots.tenantName) ?? "";

  return {
    ...needsInput({
      toolName: CONTAZUL_UPDATE_TOOL_NAME,
      provider: "contaazul",
      intent: "update_due_date_reissue_boleto",
      summary,
      missingFields: ["customerId", "pendingOnly", "chargeIds", "dueDateBr"],
      questions: []
    }),
    formId: "contaazul_update_due_date",
    formDefaults: {
      customerId,
      pendingOnly: "pending",
      chargeIds: "",
      dueDateBr: "",
      ...partialDefaults
    },
    formChoices: state.formChoices,
    formContext: {
      customerName,
      tenantName
    }
  };
}

async function loadContaAzulStatementsIntoForm(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string,
  params: Record<string, unknown>,
  options?: { summary?: string }
): Promise<InteractiveFlowResult> {
  const relationId = stringValue(state.slots.relationId);
  if (!relationId) {
    return { handled: true, result: blocked("Sessão da empresa não está ativa.") };
  }

  const customerId = stringValue(params.customerId) ?? stringValue(state.slots.customerId);
  const customerName =
    stringValue(params.customerName) ??
    resolveChoiceLabel(state.formChoices?.customerId, "customerId", customerId) ??
    stringValue(state.slots.customerName);
  const pendingOnly = stringValue(params.pendingOnly) ?? "pending";
  const onlyPending = pendingOnly !== "all";

  const formDefaults = {
    ...formDefaultsFromParams(params),
    customerId: customerId ?? "",
    pendingOnly,
    chargeIds: parseChargeIds(params).join(",")
  };

  if (!customerId || !customerName) {
    return {
      handled: true,
      result: {
        ...promptContaAzulUpdateDetailsForm(state, "Selecione o cliente.", formDefaults),
        formDefaults
      }
    };
  }

  if (!state.formChoices?.customerId) {
    const customersReceipt = await executeTool<unknown[]>(input.registry, "contaazul.search_sale_customers", {
      relationId,
      listAll: true
    });
    const customers = Array.isArray(customersReceipt.data) ? customersReceipt.data : [];
    state.formChoices = {
      customerId: customers.map((customer) => contaazulCustomerFormChoice(customer)),
      pendingOnly: CONTAZUL_PENDING_FILTER_CHOICES
    };
  }

  const receipt = await executeTool<FinancialStatementItem[]>(input.registry, "contaazul.search_financial_statement", {
    relationId,
    query: statementSearchQueryFromCustomerName(customerName)
  });
  const items = Array.isArray(receipt.data) ? receipt.data : [];
  const filtered = filterStatementItems(items, [customerName], false, onlyPending);

  state.slots = {
    ...state.slots,
    customerId,
    customerName
  };
  state.formChoices = {
    ...state.formChoices,
    customerId: state.formChoices?.customerId ?? [],
    pendingOnly: state.formChoices?.pendingOnly ?? CONTAZUL_PENDING_FILTER_CHOICES,
    chargeId: filtered.map((item) => contaazulStatementFormChoice(item))
  };
  state.step = "caUpdateDetailsForm";
  input.store.set(sessionKey, state);

  const pendingLabel = onlyPending ? "pendente(s) " : "";
  const summary =
    options?.summary ??
    (filtered.length > 0
      ? `Encontrei ${filtered.length} cobrança(s) ${pendingLabel}para ${customerName}.`
      : `Nenhuma cobrança ${pendingLabel}encontrada para ${customerName}.`);

  return {
    handled: true,
    result: {
      ...promptContaAzulUpdateDetailsForm(state, summary, formDefaults),
      formDefaults
    }
  };
}

async function collectContaAzulUpdateDetailsForm(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string,
  params: Record<string, unknown>
): Promise<InteractiveFlowResult> {
  const customerId = stringValue(params.customerId)?.trim() ?? "";
  const chargeIds = parseChargeIds(params);
  const dueDateBr = stringValue(params.dueDateBr)?.trim() ?? "";
  const pendingOnly = stringValue(params.pendingOnly) ?? "pending";
  const customerName =
    stringValue(params.customerName) ??
    resolveChoiceLabel(state.formChoices?.customerId, "customerId", customerId) ??
    stringValue(state.slots.customerName);

  const formDefaults = {
    customerId,
    pendingOnly,
    chargeIds: chargeIds.join(","),
    dueDateBr
  };

  if (!customerId) {
    return {
      handled: true,
      result: {
        ...promptContaAzulUpdateDetailsForm(state, "Selecione o cliente.", formDefaults),
        formDefaults
      }
    };
  }

  if (chargeIds.length === 0) {
    return loadContaAzulStatementsIntoForm(input, state, sessionKey, params, {
      summary: "Selecione ao menos uma cobrança."
    });
  }

  if (!isValidDateBr(dueDateBr)) {
    return {
      handled: true,
      result: {
        ...promptContaAzulUpdateDetailsForm(state, "Data inválida. Use DD/MM/AAAA.", formDefaults),
        formDefaults
      }
    };
  }

  input.store.delete(sessionKey);
  const [d, m, y] = dueDateBr.split("/");
  const dueDateIso = `${y}-${m}-${d}`;

  const receipts = [];
  const drafts: OperationDraftPayload[] = [];
  for (const chargeId of chargeIds) {
    const statement = resolveStatementFromFormChoices(state.formChoices?.chargeId, chargeId);
    if (!statement) continue;

    const choice = state.formChoices?.chargeId?.find(
      (item) => stringValue(item.params?.chargeId) === chargeId
    );
    const workflowParams = {
      tenantId: state.slots.tenantId,
      financialEventId: statement.financialEventId,
      installmentId: statement.installmentId,
      dueDateIso
    };
    const receipt = await executeTool<unknown>(
      input.registry,
      "contaazul.update_due_date_reissue_boleto_workflow",
      workflowParams
    );
    receipts.push(receipt);
    if (receipt.status !== "planned") continue;

    const operationId = operationIdFromReceipt(receipt);
    drafts.push({
      operationId,
      toolName: receipt.toolName,
      params: {
        ...workflowParams,
        customerName,
        tenantName: stringValue(state.slots.tenantName),
        chargeLabel: stringValue(choice?.label)
      }
    });
  }

  const firstDraft = drafts[0];
  const firstReceipt = receipts.find((receipt) => receipt.status === "planned") ?? receipts[receipts.length - 1];
  const operationId = firstDraft?.operationId;
  const allPlanned = receipts.length > 0 && receipts.every((receipt) => receipt.status === "planned");
  const who = customerName ? ` de ${customerName}` : "";
  const summary =
    chargeIds.length > 1 && allPlanned
      ? `${chargeIds.length} alterações preparadas (dry-run). Revise e aprove cada operação em Operações.`
      : firstDraft
        ? `Dry-run concluído${who}. Revise e aprove para alterar o vencimento para ${dueDateBr} e baixar o PDF do boleto.`
        : receipts[receipts.length - 1]?.summary ?? "Alteração concluída.";

  return {
    handled: true,
    draftOperationId: firstDraft ? operationId : undefined,
    draft: firstDraft,
    drafts: drafts.length > 0 ? drafts : undefined,
    result: {
      status: "executed",
      provider: "contaazul",
      intent: "update_due_date_reissue_boleto",
      toolName: firstDraft?.toolName ?? receipts[receipts.length - 1]?.toolName ?? CONTAZUL_UPDATE_TOOL_NAME,
      operationId,
      receiptStatus: firstReceipt?.status,
      summary,
      missingFields: [],
      questions: [],
      warnings: receipts.flatMap((receipt) => receipt.warnings ?? []),
      approvalAvailable: Boolean(firstDraft),
      receiptData: receipts.length === 1 ? receipts[0]?.data : receipts.map((receipt) => receipt.data)
    }
  };
}

function formatIsoToBr(iso: string): string {
  const parts = iso.split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : iso;
}

const CUSTOMER_PERSON_TYPE_CHOICES: AgentChoiceView[] = [
  {
    id: "person:fisica",
    label: "Física",
    description: "Pessoa física (CPF)",
    params: { personType: "Física" }
  },
  {
    id: "person:juridica",
    label: "Jurídica",
    description: "Pessoa jurídica (CNPJ)",
    params: { personType: "Jurídica" }
  }
];

async function continueContaAzulCreateCustomerFlow(
  input: InteractiveFlowInput,
  sessionKey: string,
  state: InteractiveFlowState,
  marker: InteractiveMarker
): Promise<InteractiveFlowResult> {
  if (marker.action === "select_tenant") {
    const relationId = stringValue(input.params?.relationId);
    if (!relationId) {
      return { handled: true, result: blocked("Empresa sem relationId.") };
    }
    const sw = await executeTool<unknown>(input.registry, "contaazul.switch_to_pro_session", { relationId });
    if (sw.status !== "succeeded") {
      return { handled: true, result: blocked(sw.summary) };
    }
    state.slots = {
      ...state.slots,
      tenantId: input.params?.tenantId,
      relationId,
      tenantName: stringValue(input.params?.tenantName)
    };
    if (stringValue(input.params?.personType)) {
      state.slots.personType = input.params?.personType;
    }
    return transitionToCreateCustomerForm(input, state, sessionKey, {
      summary: stringValue(state.slots.suggestedName)
        ? `Vamos cadastrar "${stringValue(state.slots.suggestedName)}". Preencha os dados abaixo.`
        : `Empresa ${stringValue(state.slots.tenantName) ?? ""} selecionada. Preencha os dados do cliente.`
    });
  }
  if (marker.action === "select_person_type") {
    const personType = stringValue(input.params?.personType);
    if (!personType) {
      return {
        handled: true,
        result: blocked("Tipo de pessoa não informado para cadastro do cliente.")
      };
    }
    state.slots = { ...state.slots, personType };
    input.store.set(sessionKey, state);
    return transitionToCreateCustomerForm(input, state, sessionKey);
  }
  if (marker.action === "lookup_cnpj") {
    return loadCnpjIntoCreateCustomerForm(input, state, sessionKey, asRecord(input.params));
  }
  if (marker.action === "submit_create_customer_details") {
    return collectCreateCustomerDetailsForm(input, state, sessionKey, asRecord(input.params));
  }
  if (state.step === "createCustomerDetailsForm") {
    return {
      handled: true,
      result: promptCreateCustomerDetailsForm(state)
    };
  }
  if (state.step === "tenant") return promptContaAzulTenant(input, CONTAZUL_CREATE_CUSTOMER_FLOW);
  return promptContaAzulTenant(input, CONTAZUL_CREATE_CUSTOMER_FLOW);
}

async function transitionToCreateCustomerForm(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string,
  options?: { summary?: string }
): Promise<InteractiveFlowResult> {
  const suggested = stringValue(state.slots.suggestedName);
  if (suggested && !stringValue(state.slots.name)) {
    state.slots = { ...state.slots, name: suggested };
  }
  state.formChoices = {
    personType: CUSTOMER_PERSON_TYPE_CHOICES
  };
  state.step = "createCustomerDetailsForm";
  input.store.set(sessionKey, state);
  return {
    handled: true,
    result: promptCreateCustomerDetailsForm(
      state,
      options?.summary ??
        (suggested
          ? `Vamos cadastrar "${suggested}". Preencha os dados abaixo.`
          : "Preencha os dados do novo cliente.")
    )
  };
}

function promptCreateCustomerDetailsForm(
  state: InteractiveFlowState,
  summary?: string,
  partialDefaults?: Record<string, string>
): AgentResultView {
  const tenantName = stringValue(state.slots.tenantName) ?? "";
  const suggestedName = stringValue(state.slots.suggestedName) ?? "";
  const personType = stringValue(state.slots.personType) ?? "";

  return {
    ...needsInput({
      toolName: CONTAZUL_CREATE_CUSTOMER_TOOL_NAME,
      provider: "contaazul",
      intent: "create_customer",
      summary:
        summary ??
        (tenantName
          ? `Cadastro de cliente em ${tenantName}.`
          : "Cadastro de cliente no Conta Azul."),
      missingFields: [
        "personType",
        "document",
        "name",
        "billingEmail",
        "billingPhone"
      ],
      questions: []
    }),
    formId: "contaazul_create_customer_details",
    formDefaults: {
      personType,
      document: stringValue(state.slots.document) ?? "",
      name: stringValue(state.slots.name) ?? suggestedName,
      companyName: stringValue(state.slots.companyName) ?? "",
      email: stringValue(state.slots.email) ?? "",
      cellPhone: stringValue(state.slots.cellPhone) ?? "",
      billingEmail: stringValue(state.slots.billingEmail) ?? "",
      billingPhone: stringValue(state.slots.billingPhone) ?? "",
      zipcode: stringValue(state.slots.zipcode) ?? "",
      numberAddress: stringValue(state.slots.numberAddress) ?? "",
      ...partialDefaults
    },
    formChoices: state.formChoices,
    formContext: {
      tenantName,
      customerName: suggestedName
    }
  };
}

async function collectCreateCustomerDetailsForm(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string,
  params: Record<string, unknown>
): Promise<InteractiveFlowResult> {
  const personType = stringValue(params.personType)?.trim() ?? "";
  const document = stringValue(params.document)?.trim() ?? "";
  const name = stringValue(params.name)?.trim() ?? "";
  const billingEmailRaw =
    stringValue(params.billingEmail)?.trim() || stringValue(params.email)?.trim() || "";
  const billingEmail = isRedactedPlaceholder(billingEmailRaw) ? "" : billingEmailRaw;
  const billingPhoneRaw =
    stringValue(params.billingPhone)?.trim() || stringValue(params.cellPhone)?.trim() || "";
  const billingPhone = isRedactedPlaceholder(billingPhoneRaw) ? "" : billingPhoneRaw;

  const formDefaults = formDefaultsFromParams(params);

  if (!personType || !document || !name) {
    return {
      handled: true,
      result: {
        ...promptCreateCustomerDetailsForm(
          state,
          "Preencha tipo de pessoa, documento e nome para continuar.",
          formDefaults
        ),
        formDefaults
      }
    };
  }

  if (!billingEmail || !billingPhone) {
    return {
      handled: true,
      result: {
        ...promptCreateCustomerDetailsForm(
          state,
          "Informe e-mail e telefone de cobrança (ou preencha e-mail/celular para reaproveitar).",
          formDefaults
        ),
        formDefaults
      }
    };
  }

  state.slots = {
    ...state.slots,
    personType,
    document,
    name,
    companyName: stringValue(params.companyName)?.trim() ?? "",
    email: stringValue(params.email)?.trim() ?? "",
    cellPhone: stringValue(params.cellPhone)?.trim() ?? "",
    commercialPhone: stringValue(params.commercialPhone)?.trim() ?? "",
    zipcode: stringValue(params.zipcode)?.trim() ?? "",
    numberAddress: stringValue(params.numberAddress)?.trim() ?? "",
    billingEmail,
    billingPhone
  };
  const handoffContext = {
    tenantId: state.slots.tenantId,
    relationId: state.slots.relationId,
    tenantName: state.slots.tenantName
  };
  input.store.delete(sessionKey);

  const workflowParams = createCustomerWorkflowParams(state.slots);
  const receipt = await executeTool<unknown>(input.registry, "contaazul.create_customer_workflow", workflowParams);
  const operationId = operationIdFromReceipt(receipt);
  const receiptData = enrichCreateCustomerReceiptData(receipt.data, {
    ...handoffContext,
    personType: workflowParams.personType,
    document: workflowParams.document,
    name: workflowParams.name
  });
  return {
    handled: true,
    draftOperationId: receipt.status === "planned" ? operationId : undefined,
    draft: receipt.status === "planned" ? { operationId, toolName: receipt.toolName, params: workflowParams } : undefined,
    result: {
      status: "executed",
      provider: "contaazul",
      intent: "create_customer",
      toolName: receipt.toolName,
      operationId,
      receiptStatus: receipt.status,
      summary:
        receipt.status === "planned"
          ? "Dry-run concluído. Revise os dados e aprove para cadastrar o cliente de verdade."
          : receipt.summary,
      missingFields: [],
      questions: [],
      warnings: receipt.warnings,
      approvalAvailable: receipt.status === "planned",
      receiptData
    }
  };
}

function enrichCreateCustomerReceiptData(
  data: unknown,
  handoff: {
    tenantId?: unknown;
    relationId?: unknown;
    tenantName?: unknown;
    personType?: unknown;
    document?: unknown;
    name?: unknown;
  }
): unknown {
  if (!data || typeof data !== "object") return data;
  const record = data as Record<string, unknown>;
  const resolved = asRecord(record.resolved);
  return {
    ...record,
    personType: record.personType ?? handoff.personType,
    document: record.document ?? handoff.document,
    name: record.name ?? handoff.name,
    resolved: {
      ...resolved,
      tenantId: resolved.tenantId ?? handoff.tenantId,
      relationId: resolved.relationId ?? handoff.relationId,
      tenantName: resolved.tenantName ?? handoff.tenantName,
      customerName: resolved.customerName ?? resolved.name ?? stringValue(handoff.name)
    }
  };
}

async function loadCnpjIntoCreateCustomerForm(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string,
  params: Record<string, unknown>
): Promise<InteractiveFlowResult> {
  const formDefaults = formDefaultsFromParams(params);
  const personType = stringValue(params.personType) ?? stringValue(state.slots.personType);

  if (personType !== "Jurídica") {
    return {
      handled: true,
      result: {
        ...promptCreateCustomerDetailsForm(state, undefined, formDefaults),
        formDefaults
      }
    };
  }

  const document = stringValue(params.document)?.trim() ?? "";
  const cleanDoc = document.replace(/\D/g, "");
  if (cleanDoc.length !== 14) {
    return {
      handled: true,
      result: {
        ...promptCreateCustomerDetailsForm(
          state,
          cleanDoc.length > 0
            ? "Informe um CNPJ válido com 14 dígitos para buscar os dados automaticamente."
            : undefined,
          formDefaults
        ),
        formDefaults
      }
    };
  }

  const relationId = stringValue(state.slots.relationId);
  if (!relationId) {
    return { handled: true, result: blocked("Empresa não selecionada para buscar o CNPJ.") };
  }

  const cnpjReceipt = await executeTool<CustomerCnpjPrefill>(input.registry, "contaazul.lookup_cnpj", {
    relationId,
    cnpj: document
  });

  if (cnpjReceipt.status !== "succeeded" || !cnpjReceipt.data) {
    return {
      handled: true,
      result: {
        ...promptCreateCustomerDetailsForm(
          state,
          cnpjReceipt.summary ?? "Não foi possível buscar os dados do CNPJ. Preencha manualmente.",
          formDefaults
        ),
        formDefaults,
        warnings: cnpjReceipt.warnings ?? []
      }
    };
  }

  let prefill: CustomerCnpjPrefill = cnpjReceipt.data;
  if (prefill.zipcode) {
    const cepReceipt = await executeTool<CustomerCnpjPrefill>(input.registry, "contaazul.lookup_cep", {
      cep: prefill.zipcode
    });
    if (cepReceipt.status === "succeeded" && cepReceipt.data) {
      prefill = { ...prefill, ...cepReceipt.data };
    }
  }

  state.slots = {
    ...state.slots,
    ...prefillToWorkflowSlots(prefill),
    personType,
    document
  };
  state.step = "createCustomerDetailsForm";
  input.store.set(sessionKey, state);

  const mergedDefaults = sanitizeFormDefaultValues(
    mergePrefillIntoFormDefaults(formDefaults, prefillToFormDefaults(prefill))
  );

  return {
    handled: true,
    result: {
      ...promptCreateCustomerDetailsForm(
        state,
        prefill.name
          ? `Dados do CNPJ carregados para ${prefill.name}. Revise e complete o cadastro.`
          : "Dados do CNPJ carregados da Receita Federal. Revise e complete o cadastro.",
        mergedDefaults
      ),
      formDefaults: mergedDefaults
    }
  };
}

function createCustomerWorkflowParams(slots: Record<string, unknown>): Record<string, unknown> {
  return {
    tenantId: slots.tenantId,
    relationId: slots.relationId,
    tenantName: slots.tenantName,
    personType: slots.personType,
    document: slots.document,
    name: slots.name,
    companyName: slots.companyName,
    email: slots.email,
    commercialPhone: slots.commercialPhone,
    cellPhone: slots.cellPhone,
    zipcode: slots.zipcode,
    street: slots.street,
    numberAddress: slots.numberAddress,
    neighborhood: slots.neighborhood,
    complement: slots.complement,
    billingEmail: slots.billingEmail,
    billingPhone: slots.billingPhone
  };
}

function boletoProviderChoices(): AgentChoiceView[] {
  return [
    {
      id: "provider:contaazul",
      label: "Conta Azul",
      description: "Venda de serviço + boleto",
      params: {
        __interactive: {
          flow: PROVIDER_CHOICE_FLOW,
          action: "select_contaazul_service_sale"
        }
      }
    },
    {
      id: "provider:asaas",
      label: "Asaas",
      description: "Cobrança avulsa",
      params: {
        __interactive: { flow: PROVIDER_CHOICE_FLOW, action: "select_asaas_boleto" }
      }
    }
  ];
}

function promptBoletoProvider(input: InteractiveFlowInput, sessionKey: string): InteractiveFlowResult {
  const choices = boletoProviderChoices();
  input.store.set(sessionKey, {
    flow: PROVIDER_MENU_FLOW,
    step: "provider",
    slots: {},
    formChoices: { provider: choices }
  });

  return {
    handled: true,
    result: needsInput({
      toolName: PROVIDER_CHOICE_TOOL_NAME,
      summary: "Escolha onde vamos emitir o boleto.",
      missingFields: ["provider"],
      questions: ["Selecione onde o boleto deve ser emitido."],
      choices
    })
  };
}

function providerOperationChoices(provider: NluProvider): AgentChoiceView[] {
  return provider === "contaazul"
    ? [
        {
          id: "provider-op:ca-boleto",
          label: "Emitir boleto",
          description: "Venda de serviço com boleto",
          params: {
            __interactive: { flow: ANCHOR_FLOW, action: "start_contaazul_service_sale" }
          }
        },
        {
          id: "provider-op:ca-customer",
          label: "Criar cliente",
          description: "Cadastrar um novo cliente",
          params: {
            __interactive: { flow: ANCHOR_FLOW, action: "start_contaazul_create_customer" }
          }
        },
        {
          id: "provider-op:ca-due-date",
          label: "Mudar vencimento",
          description: "Ajustar a data de um lançamento",
          params: {
            __interactive: { flow: ANCHOR_FLOW, action: "start_contaazul_update_due_date" }
          }
        }
      ]
    : [
        {
          id: "provider-op:asaas-emit",
          label: "Emitir boleto",
          description: "Cobrança avulsa no Asaas",
          params: {
            __interactive: { flow: ANCHOR_FLOW, action: "start_asaas_boleto" }
          }
        },
        {
          id: "provider-op:asaas-download",
          label: "Baixar boleto",
          description: "Segunda via em PDF",
          params: {
            __interactive: { flow: ANCHOR_FLOW, action: "start_asaas_download_boleto" }
          }
        },
        {
          id: "provider-op:asaas-update",
          label: "Mudar vencimento",
          description: "Reagendar data da cobrança",
          params: {
            __interactive: { flow: ANCHOR_FLOW, action: "start_asaas_update_due_date" }
          }
        }
      ];
}

function promptProviderOperations(
  input: InteractiveFlowInput,
  sessionKey: string,
  provider: NluProvider
): InteractiveFlowResult {
  const providerLabel = provider === "asaas" ? "Asaas" : "Conta Azul";
  const choices = providerOperationChoices(provider);
  input.store.set(sessionKey, {
    flow: PROVIDER_MENU_FLOW,
    step: "operation",
    slots: { provider },
    formChoices: { operation: choices }
  });

  return {
    handled: true,
    result: needsInput({
      toolName: PROVIDER_MENU_TOOL_NAME,
      provider,
      intent: provider === "asaas" ? "create_asaas_boleto" : "create_service_sale_boleto",
      summary: `Qual operação você quer fazer no ${providerLabel}?`,
      missingFields: ["operation"],
      questions: [`Selecione uma das operações disponíveis no ${providerLabel}.`],
      choices
    })
  };
}

async function continueProviderMenu(
  input: InteractiveFlowInput,
  sessionKey: string,
  state: InteractiveFlowState
): Promise<InteractiveFlowResult> {
  const fieldKey = state.step === "provider" ? "provider" : "operation";
  const choices = state.formChoices?.[fieldKey] ?? [];
  const match = matchChoiceByRequest(input.request, choices);
  if (!match?.params) {
    return { handled: false };
  }

  input.store.delete(sessionKey);
  return runInteractiveFlowTurn({
    ...input,
    request: match.request ?? match.label,
    params: match.params
  });
}

function matchChoiceByRequest(request: string, choices: AgentChoiceView[]): AgentChoiceView | undefined {
  const normalizedRequest = normalize(request);
  if (!normalizedRequest) return undefined;

  return choices.find((choice) => {
    const label = normalize(choice.label);
    const description = normalize(choice.description ?? "");
    return (
      normalizedRequest === label ||
      normalizedRequest === description ||
      normalizedRequest.includes(label) ||
      label.includes(normalizedRequest)
    );
  });
}

async function continueContaAzulFlow(
  input: InteractiveFlowInput,
  sessionKey: string,
  state: InteractiveFlowState,
  marker: InteractiveMarker
): Promise<InteractiveFlowResult> {
  if (marker.action === "start_create_customer") {
    const suggestedName = stringValue(input.params?.suggestedName);
    const nextState: InteractiveFlowState = {
      flow: CONTAZUL_CREATE_CUSTOMER_FLOW,
      step: "createCustomerDetailsForm",
      slots: {
        tenantId: state.slots.tenantId,
        relationId: state.slots.relationId,
        tenantName: state.slots.tenantName,
        ...(suggestedName ? { suggestedName } : {})
      }
    };
    input.store.set(sessionKey, nextState);
    return transitionToCreateCustomerForm(input, nextState, sessionKey, {
      summary: suggestedName
        ? `Vamos cadastrar "${suggestedName}". Preencha os dados abaixo.`
        : "Vamos cadastrar um novo cliente. Preencha os dados abaixo."
    });
  }

  if (marker.action === "start_with_customer") {
    let relationId = stringValue(input.params?.relationId);
    const tenantId = input.params?.tenantId;
    if (!relationId && tenantId !== undefined) {
      const tenantsReceipt = await executeTool<AccountancyClient[]>(
        input.registry,
        "contaazul.list_accountancy_clients",
        {}
      );
      const tenants = Array.isArray(tenantsReceipt.data) ? tenantsReceipt.data : [];
      const match = tenants.find((tenant) => String(tenant.tenantId) === String(tenantId));
      relationId = match?.relationId;
    }
    if (relationId) {
      await executeTool<unknown>(input.registry, "contaazul.switch_to_pro_session", { relationId });
    }
    state.slots = {
      ...state.slots,
      tenantId,
      relationId,
      tenantName: stringValue(input.params?.tenantName) ?? state.slots.tenantName,
      customerId: stringValue(input.params?.customerId),
      customerName: stringValue(input.params?.customerName)
    };
    if (!relationId) {
      return {
        handled: true,
        result: blocked("A empresa selecionada não possui relationId para buscar categorias e itens.")
      };
    }
    input.store.set(sessionKey, state);
    return transitionToSaleDetailsForm(input, state, sessionKey, {
      summary: `Cliente ${state.slots.customerName ?? ""} selecionado. Preencha os dados da cobrança.`
    });
  }

  if (marker.action === "select_tenant") {
    const tenantId = input.params?.tenantId;
    const relationId = stringValue(input.params?.relationId);
    const tenantName = stringValue(input.params?.tenantName);
    if (!relationId) {
      return {
        handled: true,
        result: blocked("A empresa selecionada não possui relationId para abrir a sessão Pro.")
      };
    }
    const switchReceipt = await executeTool<unknown>(
      input.registry,
      "contaazul.switch_to_pro_session",
      { relationId }
    );
    if (switchReceipt.status !== "succeeded") {
      return {
        handled: true,
        result: blocked(switchReceipt.summary)
      };
    }
    state.slots = {
      ...state.slots,
      tenantId,
      relationId,
      tenantName
    };
    state.step = "customerChoice";
    input.store.set(sessionKey, state);
    return promptContaAzulCustomers(input, state, sessionKey, CONTAZUL_FLOW, {
      summary: tenantName ? `Empresa selecionada: ${tenantName}.` : "Empresa selecionada."
    });
  }

  if (marker.action === "select_customer") {
    state.slots = {
      ...state.slots,
      customerId: stringValue(input.params?.customerId),
      customerName: stringValue(input.params?.customerName)
    };
    input.store.set(sessionKey, state);
    return transitionToSaleDetailsForm(input, state, sessionKey, {
      summary: "Cliente selecionado. Preencha os dados da cobrança."
    });
  }

  if (marker.action === "select_category") {
    state.slots = {
      ...state.slots,
      categoryId: stringValue(input.params?.categoryId),
      categoryName: stringValue(input.params?.categoryName)
    };
    state.step = "itemChoice";
    input.store.set(sessionKey, state);
    return promptContaAzulItems(input, state, sessionKey, CONTAZUL_FLOW, {
      summary: "Categoria selecionada. Agora preciso do item de serviço."
    });
  }

  if (marker.action === "select_item") {
    state.slots = {
      ...state.slots,
      itemId: stringValue(input.params?.itemId),
      itemName: stringValue(input.params?.itemName)
    };
    input.store.set(sessionKey, state);
    if (!state.formChoices) {
      return transitionToSaleDetailsForm(input, state, sessionKey);
    }
    state.step = "saleDetailsForm";
    input.store.set(sessionKey, state);
    await prefetchCustomerBillingDefaults(input, state);
    return {
      handled: true,
      result: promptSaleDetailsForm(state)
    };
  }

  if (marker.action === "submit_sale_details") {
    return collectSaleDetailsForm(input, state, sessionKey, asRecord(input.params));
  }

  if (state.step === "tenant") {
    return promptContaAzulTenant(input);
  }

  if (state.step === "customerChoice") {
    return promptContaAzulCustomers(input, state, sessionKey);
  }

  if (state.step === "categoryChoice") {
    return promptContaAzulCategories(input, state, sessionKey);
  }

  if (state.step === "itemChoice") {
    return promptContaAzulItems(input, state, sessionKey);
  }

  if (state.step === "saleDetailsForm") {
    return {
      handled: true,
      result: promptSaleDetailsForm(state, "Use o formulário abaixo para preencher os dados da cobrança.")
    };
  }

  if (state.step === "serviceDescription") {
    return collectServiceDescription(input, state, sessionKey);
  }

  if (state.step === "unitValue") {
    return collectUnitValue(input, state, sessionKey);
  }

  if (state.step === "dueDate") {
    return collectDueDate(input, state, sessionKey);
  }

  if (state.step === "notificationPhone") {
    return collectNotificationPhone(input, state, sessionKey);
  }

  if (state.step === "notificationEmail") {
    return collectNotificationEmail(input, state, sessionKey);
  }

  if (state.step === "notificationReplyTo") {
    return collectNotificationReplyToAndPlan(input, state, sessionKey);
  }

  return promptContaAzulCustomers(input, state, sessionKey);
}

async function continueContaAzulListFlow(
  input: InteractiveFlowInput,
  sessionKey: string,
  state: InteractiveFlowState,
  marker: InteractiveMarker
): Promise<InteractiveFlowResult> {
  if (marker.action === "select_tenant") {
    const relationId = stringValue(input.params?.relationId);
    if (!relationId) {
      return { handled: true, result: blocked("A empresa selecionada não possui relationId.") };
    }
    const sw = await executeTool<unknown>(input.registry, "contaazul.switch_to_pro_session", { relationId });
    if (sw.status !== "succeeded") {
      return { handled: true, result: blocked(sw.summary) };
    }
    state.slots = {
      ...state.slots,
      tenantId: input.params?.tenantId,
      relationId,
      tenantName: stringValue(input.params?.tenantName)
    };
    input.store.set(sessionKey, state);
    return deliverStatements(input, state, sessionKey);
  }
  return promptContaAzulTenant(input, CONTAZUL_LIST_FLOW);
}

async function deliverStatements(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string
): Promise<InteractiveFlowResult> {
  const relationId = stringValue(state.slots.relationId);
  if (!relationId) {
    return { handled: true, result: blocked("Sessão da empresa não está ativa.") };
  }
  const receipt = await executeTool<FinancialStatementItem[]>(
    input.registry,
    "contaazul.search_financial_statement",
    { relationId }
  );
  const items = Array.isArray(receipt.data) ? receipt.data : [];
  const hints = Array.isArray(state.slots.customerHints)
    ? (state.slots.customerHints as string[])
    : [];
  const onlyOverdue = state.slots.onlyOverdue === true;
  const filtered = filterStatementItems(items, hints, onlyOverdue);
  input.store.delete(sessionKey);

  const scope = hints.length > 0 ? ` de ${hints.join(", ")}` : "";
  const overdueLabel = onlyOverdue ? " vencido(s)" : "";
  const summary =
    filtered.length > 0
      ? `Encontrei ${filtered.length} boleto(s)${overdueLabel}${scope}.`
      : `Nenhum boleto${overdueLabel}${scope} encontrado nesta empresa.`;

  return {
    handled: true,
    result: {
      status: "executed",
      provider: "contaazul",
      intent: "list_charges",
      toolName: "contaazul.search_financial_statement",
      receiptStatus: receipt.status,
      summary,
      missingFields: [],
      questions: [],
      warnings: receipt.warnings,
      approvalAvailable: false,
      receiptData: filtered
    }
  };
}

function filterStatementItems(
  items: FinancialStatementItem[],
  hints: string[],
  onlyOverdue: boolean,
  onlyPending = false
): FinancialStatementItem[] {
  let out = items;
  if (hints.length > 0) {
    const needles = hints.map((hint) => normalize(hint)).filter(Boolean);
    out = out.filter((item) => needles.some((needle) => statementMatchesCustomerHint(item, needle)));
  }
  if (onlyPending) {
    out = out.filter((item) => {
      const status = String(item.status ?? "").toUpperCase();
      return status !== "PAID" && status !== "ACQUITTED";
    });
  }
  if (onlyOverdue) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    out = out.filter((item) => {
      const status = String(item.status ?? "").toUpperCase();
      const paid = status === "PAID" || status === "ACQUITTED";
      if (paid || !item.dueDateIso) return false;
      const due = new Date(`${item.dueDateIso}T00:00:00`);
      return Number.isFinite(due.getTime()) && due.getTime() < today.getTime();
    });
  }
  return out;
}

async function promptContaAzulTenant(
  input: InteractiveFlowInput,
  flow: InteractiveFlowName = CONTAZUL_FLOW
): Promise<InteractiveFlowResult> {
  const tool = input.registry
    .list()
    .find((definition) => definition.name === "contaazul.list_accountancy_clients");
  if (!tool) {
    return {
      handled: true,
      result: blocked("Ferramenta de listagem de empresas do Conta Azul não está registrada.")
    };
  }

  const receipt = (await tool.execute({})) as ToolReceipt<AccountancyClient[]>;
  const clients = Array.isArray(receipt.data) ? receipt.data : [];
  if (clients.length === 0) {
    return {
      handled: true,
      result: blocked("Nenhuma empresa do Conta Azul foi encontrada para seleção.")
    };
  }

  // Memória: empresa usada por último vai para o topo, com rótulo "recente".
  const lastTenant = input.memory?.get().lastTenant;
  const ordered = orderByRememberedTenant(clients, lastTenant);
  const rememberedFirst =
    lastTenant !== undefined &&
    ordered[0] !== undefined &&
    String(ordered[0].tenantId) === String(lastTenant.tenantId);

  return {
    handled: true,
    result: needsInput({
      summary: rememberedFirst
        ? `Selecione a empresa (sugiro ${ordered[0]!.name}, usada recentemente).`
        : "Selecione a empresa do Conta Azul antes de pesquisar o cliente.",
      missingFields: ["tenantId"],
      questions: ["Selecione a empresa para esta operação."],
      choices: ordered.map((client, index) =>
        tenantChoice(client, flow, rememberedFirst && index === 0)
      )
    })
  };
}

function orderByRememberedTenant(
  clients: AccountancyClient[],
  last: RememberedTenant | undefined
): AccountancyClient[] {
  if (!last) return clients;
  const index = clients.findIndex((client) => String(client.tenantId) === String(last.tenantId));
  if (index <= 0) return clients;
  const copy = clients.slice();
  const [remembered] = copy.splice(index, 1);
  return remembered ? [remembered, ...copy] : clients;
}

function rememberFromSelection(
  input: InteractiveFlowInput,
  marker: InteractiveMarker,
  existing: InteractiveFlowState | undefined
): void {
  if (!input.memory) return;
  if (marker.action === "select_tenant" && input.params?.tenantId !== undefined) {
    input.memory.recordTenant({
      tenantId: input.params.tenantId as string | number,
      relationId: stringValue(input.params?.relationId),
      tenantName: stringValue(input.params?.tenantName)
    });
    return;
  }
  if (marker.action === "select_customer") {
    const tenantId = existing?.slots.tenantId;
    const customerId = stringValue(input.params?.customerId);
    if (tenantId !== undefined && customerId) {
      input.memory.recordCustomer(tenantId as string | number, {
        id: customerId,
        name: stringValue(input.params?.customerName) ?? customerId
      });
    }
  }
}

function tenantChoice(
  client: AccountancyClient,
  flow: InteractiveFlowName,
  recent = false
): AgentChoiceView {
  return {
    id: `tenant:${client.tenantId}`,
    label: client.name,
    description: recent ? "Usada recentemente" : `Tenant ${client.tenantId}`,
    params: {
      __interactive: { flow, action: "select_tenant" },
      tenantId: client.tenantId,
      relationId: client.relationId,
      tenantName: client.name
    }
  };
}

async function promptContaAzulCustomers(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string,
  flow: InteractiveFlowName = CONTAZUL_FLOW,
  options?: { summary?: string }
): Promise<InteractiveFlowResult> {
  const relationId = stringValue(state.slots.relationId);
  if (!relationId) {
    return {
      handled: true,
      result: blocked("A empresa selecionada não possui relationId para abrir a sessão Pro.")
    };
  }
  const receipt = await executeTool<unknown[]>(input.registry, "contaazul.search_sale_customers", {
    relationId,
    listAll: true
  });
  const customers = Array.isArray(receipt.data) ? receipt.data : [];
  const hint = stringValue(state.slots.customerHint);
  const matched = hint ? matchCustomersByHint(customers, hint) : customers;

  // Auto-seleção: o nome citado casa com exatamente 1 cliente → pula a escolha.
  if (hint && matched.length === 1 && flow === CONTAZUL_FLOW) {
    const record = asRecord(matched[0]);
    state.slots = {
      ...state.slots,
      customerId: stringValue(record.id),
      customerName: stringValue(record.name)
    };
    state.step = "categoryChoice";
    input.store.set(sessionKey, state);
    return promptContaAzulCategories(input, state, sessionKey, CONTAZUL_FLOW, {
      summary: `Selecionei ${state.slots.customerName} automaticamente. Agora a categoria financeira.`
    });
  }

  const visible = hint && matched.length > 0 ? matched : customers;
  state.step = "customerChoice";
  input.store.set(sessionKey, state);
  if (visible.length === 0) {
    return {
      handled: true,
      result: needsInput({
        summary: options?.summary ?? "Selecione o cliente para esta operação.",
        missingFields: ["customerId"],
        questions: ["Nenhum cliente cadastrado. Use a opção para criar um novo."],
        choices: []
      })
    };
  }
  return {
    handled: true,
    result: needsInput({
      summary:
        options?.summary ??
        (hint && matched.length > 0
          ? `Encontrei ${visible.length} cliente(s) parecido(s) com "${hint}".`
          : `Encontrei ${visible.length} cliente(s).`),
      missingFields: ["customerId"],
      questions: ["Selecione o cliente para esta venda."],
      choices: visible.map((customer) => customerChoice(customer, flow))
    })
  };
}

function matchCustomersByHint(customers: unknown[], hint: string): unknown[] {
  const needle = normalize(hint);
  if (!needle) return customers;
  return customers.filter((customer) => {
    const name = normalize(stringValue(asRecord(customer).name) ?? "");
    return name.includes(needle);
  });
}

async function promptContaAzulCategories(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string,
  flow: InteractiveFlowName = CONTAZUL_FLOW,
  options?: { summary?: string }
): Promise<InteractiveFlowResult> {
  const relationId = stringValue(state.slots.relationId);
  if (!relationId) {
    return {
      handled: true,
      result: blocked("A empresa selecionada não possui relationId para buscar categorias.")
    };
  }
  const receipt = await executeTool<unknown[]>(input.registry, "contaazul.search_financial_categories", {
    relationId,
    listAll: true
  });
  const categories = Array.isArray(receipt.data) ? receipt.data : [];
  state.step = "categoryChoice";
  input.store.set(sessionKey, state);
  if (categories.length === 0) {
    return {
      handled: true,
      result: needsInput({
        summary: options?.summary ?? "Selecione a categoria financeira.",
        missingFields: ["categoryId"],
        questions: ["Nenhuma categoria financeira encontrada."],
        choices: []
      })
    };
  }
  return {
    handled: true,
    result: needsInput({
      summary: options?.summary ?? `Encontrei ${categories.length} categoria(s).`,
      missingFields: ["categoryId"],
      questions: ["Selecione a categoria financeira."],
      choices: categories.map((category) => categoryChoice(category, flow))
    })
  };
}

async function promptContaAzulItems(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string,
  flow: InteractiveFlowName = CONTAZUL_FLOW,
  options?: { summary?: string }
): Promise<InteractiveFlowResult> {
  const relationId = stringValue(state.slots.relationId);
  if (!relationId) {
    return {
      handled: true,
      result: blocked("A empresa selecionada não possui relationId para buscar itens.")
    };
  }
  const receipt = await executeTool<unknown[]>(input.registry, "contaazul.search_service_items", {
    relationId,
    listAll: true
  });
  const items = Array.isArray(receipt.data) ? receipt.data : [];
  state.step = "itemChoice";
  input.store.set(sessionKey, state);
  if (items.length === 0) {
    return {
      handled: true,
      result: needsInput({
        summary: options?.summary ?? "Selecione o item de serviço.",
        missingFields: ["itemId"],
        questions: ["Nenhum item de serviço encontrado."],
        choices: []
      })
    };
  }
  return {
    handled: true,
    result: needsInput({
      summary: options?.summary ?? `Encontrei ${items.length} item(ns).`,
      missingFields: ["itemId"],
      questions: ["Selecione o item de serviço."],
      choices: items.map((item) => itemChoice(item, flow))
    })
  };
}

function collectServiceDescription(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string
): InteractiveFlowResult {
  const serviceDescription = input.request.trim();
  if (!serviceDescription) {
    return {
      handled: true,
      result: needsInput({
        summary: "Os detalhes do item são obrigatórios.",
        missingFields: ["serviceDescription"],
        questions: ["Digite os detalhes do item."]
      })
    };
  }
  state.slots = { ...state.slots, serviceDescription };
  state.step = "unitValue";
  input.store.set(sessionKey, state);
  return {
    handled: true,
    result: needsInput({
      summary: "Detalhes do item registrados.",
      missingFields: ["unitValueBr"],
      questions: ["Digite o valor unitário (ex: 10,00)."]
    })
  };
}

function collectUnitValue(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string
): InteractiveFlowResult {
  const unitValueBr = input.request.trim();
  if (!isValidMoneyBr(unitValueBr)) {
    return {
      handled: true,
      result: needsInput({
        summary: "Valor unitário inválido.",
        missingFields: ["unitValueBr"],
        questions: ["Digite o valor unitário no formato 10,00."]
      })
    };
  }
  state.slots = { ...state.slots, unitValueBr };
  state.step = "dueDate";
  input.store.set(sessionKey, state);
  return {
    handled: true,
    result: needsInput({
      summary: "Valor unitário registrado.",
      missingFields: ["dueDateBr"],
      questions: ["Digite a data de vencimento (DD/MM/AAAA)."]
    })
  };
}

function collectDueDate(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string
): InteractiveFlowResult | Promise<InteractiveFlowResult> {
  const dueDateBr = input.request.trim();
  if (!isValidDateBr(dueDateBr)) {
    return {
      handled: true,
      result: needsInput({
        summary: "Data de vencimento inválida.",
        missingFields: ["dueDateBr"],
        questions: ["Digite a data de vencimento no formato DD/MM/AAAA."]
      })
    };
  }
  state.slots = { ...state.slots, dueDateBr };
  state.step = "notificationPhone";
  input.store.set(sessionKey, state);
  return prefetchCustomerBillingDefaults(input, state).then(() => {
    const phoneDefault = stringValue(state.slots.notificationPhoneDefault);
    const emailDefault = stringValue(state.slots.notificationEmailDefault);
    const phoneQuestion = phoneDefault
      ? `Digite o telefone celular do cliente com DDD (deixe em branco para usar "${phoneDefault}").`
      : "Digite o telefone celular do cliente com DDD.";
    const summary = emailDefault
      ? `Vencimento registrado. E-mail sugerido: ${emailDefault}.`
      : "Vencimento registrado.";
    return {
      handled: true,
      result: needsInput({
        summary,
        missingFields: ["notification.phone"],
        questions: [phoneQuestion]
      })
    };
  });
}

async function prefetchCustomerBillingDefaults(
  input: InteractiveFlowInput,
  state: InteractiveFlowState
): Promise<void> {
  if (state.slots.notificationPhoneDefault && state.slots.notificationEmailDefault) {
    return;
  }
  const relationId = stringValue(state.slots.relationId);
  const personUuid = stringValue(state.slots.customerId);
  if (!relationId || !personUuid) return;

  try {
    const receipt = await executeTool<Record<string, unknown>>(
      input.registry,
      "contaazul.get_person_details",
      { relationId, personUuid, __skipDataRedaction: true }
    );
    if (receipt.status !== "succeeded" || !receipt.data) return;
    const person = receipt.data;
    const billing = asRecord(person.billingContact);
    const billingEmails = billing.emails;
    const email = usableOperatorDefault(
      (Array.isArray(billingEmails) && typeof billingEmails[0] === "string"
        ? billingEmails[0]
        : "") || stringValue(person.email) || ""
    );
    const phone = usableOperatorDefault(
      stringValue(billing.phoneNumber)?.replace(/\D/g, "") ||
        stringValue(person.cellPhone)?.replace(/\D/g, "") ||
        stringValue(person.commercialPhone)?.replace(/\D/g, "") ||
        ""
    );
    state.slots = {
      ...state.slots,
      notificationPhoneDefault: phone || state.slots.notificationPhoneDefault,
      notificationEmailDefault: email || state.slots.notificationEmailDefault
    };
  } catch {
    // Mirror contaazul/interativo.js: continue without suggested defaults.
  }
}

function collectNotificationPhone(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string
): InteractiveFlowResult {
  const phoneDefault = stringValue(state.slots.notificationPhoneDefault);
  const phone = (input.request.trim() || phoneDefault || "").replace(/\D/g, "");
  if (phone.length < 10) {
    return {
      handled: true,
      result: needsInput({
        summary: "Telefone inválido.",
        missingFields: ["notification.phone"],
        questions: [
          phoneDefault
            ? `Digite o telefone celular do cliente com DDD (deixe em branco para usar "${phoneDefault}").`
            : "Digite o telefone celular do cliente com DDD."
        ]
      })
    };
  }
  state.slots = { ...state.slots, notificationPhone: phone };
  state.step = "notificationEmail";
  input.store.set(sessionKey, state);
  const emailDefault = stringValue(state.slots.notificationEmailDefault);
  return {
    handled: true,
    result: needsInput({
      summary: "Telefone registrado.",
      missingFields: ["notification.email"],
      questions: [
        emailDefault
          ? `Digite o e-mail de cobrança do cliente (deixe em branco para usar "${emailDefault}").`
          : "Digite o e-mail de cobrança do cliente."
      ]
    })
  };
}

function collectNotificationEmail(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string
): InteractiveFlowResult {
  const emailDefault = stringValue(state.slots.notificationEmailDefault);
  const email = (input.request.trim() || emailDefault || "").trim();
  if (!isLikelyEmail(email)) {
    return {
      handled: true,
      result: needsInput({
        summary: "E-mail de cobrança inválido.",
        missingFields: ["notification.email"],
        questions: [
          emailDefault
            ? `Digite um e-mail de cobrança válido (deixe em branco para usar "${emailDefault}").`
            : "Digite um e-mail de cobrança válido."
        ]
      })
    };
  }
  state.slots = { ...state.slots, notificationEmail: email };
  state.step = "notificationReplyTo";
  input.store.set(sessionKey, state);
  return {
    handled: true,
    result: needsInput({
      summary: "E-mail de cobrança registrado.",
      missingFields: ["notification.replyTo"],
      questions: [
        "Digite o e-mail para o destinatário entrar em contato (deixe em branco para usar o padrão do harness)."
      ]
    })
  };
}

async function collectNotificationReplyToAndPlan(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string
): Promise<InteractiveFlowResult> {
  const replyTo = input.request.trim();
  if (replyTo && !isLikelyEmail(replyTo)) {
    return {
      handled: true,
      result: needsInput({
        summary: "E-mail de contato inválido.",
        missingFields: ["notification.replyTo"],
        questions: ["Digite um e-mail de contato válido."]
      })
    };
  }
  state.slots = { ...state.slots, notificationReplyTo: replyTo };
  input.store.delete(sessionKey);

  const params = serviceSaleWorkflowParams(state.slots);
  const receipt = await executeTool<unknown>(
    input.registry,
    "contaazul.create_service_sale_boleto_workflow",
    params
  );
  const operationId = operationIdFromReceipt(receipt);

  return {
    handled: true,
    draftOperationId: receipt.status === "planned" ? operationId : undefined,
    draft: receipt.status === "planned"
      ? {
          operationId,
          toolName: receipt.toolName,
          params
        }
      : undefined,
    result: {
      status: "executed",
      provider: "contaazul",
      intent: "create_service_sale_boleto",
      toolName: receipt.toolName,
      operationId,
      receiptStatus: receipt.status,
      summary: receipt.status === "planned"
        ? "Dry-run concluído. Revise os dados e aprove para emitir o boleto de verdade."
        : receipt.summary,
      missingFields: [],
      questions: [],
      warnings: receipt.warnings,
      approvalAvailable: receipt.status === "planned",
      receiptData: receipt.data
    }
  };
}

function serviceSaleWorkflowParams(slots: Record<string, unknown>): Record<string, unknown> {
  const replyTo = stringValue(slots.notificationReplyTo)?.trim();
  const notification: Record<string, unknown> = {
    phone: slots.notificationPhone,
    email: slots.notificationEmail
  };
  if (replyTo) {
    notification.replyTo = replyTo;
  }
  return {
    tenantId: slots.tenantId,
    customerName: slots.customerName,
    categoryName: slots.categoryName,
    itemName: slots.itemName,
    serviceDescription: slots.serviceDescription,
    unitValueBr: slots.unitValueBr,
    dueDateBr: slots.dueDateBr,
    notification
  };
}

async function executeTool<T>(
  registry: ToolRegistry,
  toolName: string,
  params: Record<string, unknown>
): Promise<ToolReceipt<T>> {
  const tool = registry.list().find((definition) => definition.name === toolName);
  if (!tool) {
    throw new Error(`Ferramenta interativa não registrada: ${toolName}`);
  }
  return (await tool.execute(params)) as ToolReceipt<T>;
}

function customerChoice(item: unknown, flow: InteractiveFlowName = CONTAZUL_FLOW): AgentChoiceView {
  const record = asRecord(item);
  const id = stringValue(record.id) ?? "";
  const name = stringValue(record.name) ?? id;
  return {
    id: `customer:${id}`,
    label: name,
    description: "Cliente Conta Azul",
    params: {
      __interactive: { flow, action: "select_customer" },
      customerId: id,
      customerName: name
    }
  };
}

function contaazulCustomerFormChoice(item: unknown): AgentChoiceView {
  const record = asRecord(item);
  const id = stringValue(record.id) ?? "";
  const name = stringValue(record.name) ?? id;
  return {
    id: `contaazul-customer:${id}`,
    label: name,
    description: "Cliente Conta Azul",
    params: {
      customerId: id,
      customerName: name
    }
  };
}

function asaasCustomerChoice(
  customer: CustomerMatch,
  flow: typeof ASAAS_FLOW | typeof ASAAS_UPDATE_FLOW | typeof ASAAS_DOWNLOAD_FLOW = ASAAS_FLOW
): AgentChoiceView {
  return {
    id: `asaas-customer:${customer.id}`,
    label: customer.name,
    description: "Cliente Asaas",
    params: {
      __interactive: { flow, action: "select_customer" },
      customerId: customer.id,
      customerName: customer.name
    }
  };
}

function categoryChoice(item: unknown, flow: InteractiveFlowName = CONTAZUL_FLOW): AgentChoiceView {
  const record = asRecord(item);
  const id = stringValue(record.uuid) ?? "";
  const name = stringValue(record.dsNaturezaFinanceira) ?? id;
  return {
    id: `category:${id}`,
    label: name,
    description: "Categoria financeira",
    params: {
      __interactive: { flow, action: "select_category" },
      categoryId: id,
      categoryName: name
    }
  };
}

function itemChoice(item: unknown, flow: InteractiveFlowName = CONTAZUL_FLOW): AgentChoiceView {
  const record = asRecord(item);
  const id = stringValue(record.id) ?? "";
  const name = stringValue(record.name) ?? id;
  return {
    id: `item:${id}`,
    label: name,
    description: "Item de serviço",
    params: {
      __interactive: { flow, action: "select_item" },
      itemId: id,
      itemName: name
    }
  };
}

async function transitionToAsaasBoletoForm(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string,
  options?: { summary?: string }
): Promise<InteractiveFlowResult> {
  const receipt = await executeTool<CustomerMatch[]>(input.registry, "asaas.search_customers", {
    query: ""
  });
  const customers = Array.isArray(receipt.data) ? receipt.data : [];
  if (customers.length === 0) {
    return {
      handled: true,
      result: needsInput({
        toolName: "asaas.interactive_boleto_charge",
        provider: "asaas",
        intent: "create_boleto_charge",
        summary: "Nenhum cliente encontrado no Asaas.",
        missingFields: ["customerId"],
        questions: ["Nenhum cliente cadastrado no Asaas."],
        choices: []
      })
    };
  }

  state.formChoices = {
    customerId: customers.map((customer) => asaasCustomerChoice(customer, ASAAS_FLOW))
  };
  state.step = "asaasDetailsForm";
  input.store.set(sessionKey, state);

  return {
    handled: true,
    result: promptAsaasBoletoDetailsForm(
      state,
      options?.summary ?? "Preencha os dados da cobrança no Asaas."
    )
  };
}

async function transitionToAsaasUpdateForm(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string,
  options?: { summary?: string }
): Promise<InteractiveFlowResult> {
  const receipt = await executeTool<CustomerMatch[]>(input.registry, "asaas.search_customers", {
    query: ""
  });
  const customers = Array.isArray(receipt.data) ? receipt.data : [];
  if (customers.length === 0) {
    return {
      handled: true,
      result: needsInput({
        toolName: ASAAS_UPDATE_TOOL_NAME,
        provider: "asaas",
        intent: "update_charge_due_date",
        summary: "Nenhum cliente encontrado no Asaas.",
        missingFields: ["customerId"],
        questions: ["Nenhum cliente cadastrado no Asaas."],
        choices: []
      })
    };
  }

  state.formChoices = {
    customerId: customers.map((customer) => asaasCustomerChoice(customer, ASAAS_UPDATE_FLOW))
  };
  state.step = "asaasUpdateDetailsForm";
  input.store.set(sessionKey, state);

  return {
    handled: true,
    result: promptAsaasUpdateDetailsForm(
      state,
      options?.summary ?? "Selecione o cliente e a cobrança para alterar o vencimento."
    )
  };
}

async function loadAsaasChargesIntoForm(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string,
  params: Record<string, unknown>,
  options?: { summary?: string }
): Promise<InteractiveFlowResult> {
  const customerId = stringValue(params.customerId) ?? stringValue(state.slots.customerId);
  const customerName =
    stringValue(params.customerName) ??
    resolveChoiceLabel(state.formChoices?.customerId, "customerId", customerId) ??
    stringValue(state.slots.customerName);

  if (!customerId) {
    return {
      handled: true,
      result: promptAsaasUpdateDetailsForm(state, "Selecione o cliente.", formDefaultsFromParams(params))
    };
  }

  if (!state.formChoices?.customerId) {
    const customersReceipt = await executeTool<CustomerMatch[]>(input.registry, "asaas.search_customers", {
      query: ""
    });
    const customers = Array.isArray(customersReceipt.data) ? customersReceipt.data : [];
    state.formChoices = {
      customerId: customers.map((customer) => asaasCustomerChoice(customer, ASAAS_UPDATE_FLOW))
    };
  }

  const receipt = await executeTool<PendingCharge[]>(input.registry, "asaas.list_pending_charges", {
    customerId
  });
  const charges = Array.isArray(receipt.data) ? receipt.data : [];

  state.slots = {
    ...state.slots,
    customerId,
    customerName
  };
  state.formChoices = {
    ...state.formChoices,
    customerId: state.formChoices?.customerId ?? [],
    chargeId: charges.map((charge) => asaasChargeFormChoice(charge))
  };
  state.step = "asaasUpdateDetailsForm";
  input.store.set(sessionKey, state);

  const formDefaults = {
    ...formDefaultsFromParams(params),
    customerId,
    chargeIds: parseChargeIds(params).join(",")
  };

  if (charges.length === 0) {
    return {
      handled: true,
      result: {
        ...promptAsaasUpdateDetailsForm(
          state,
          `Nenhuma cobrança pendente para ${customerName ?? "este cliente"}.`,
          formDefaults
        ),
        formDefaults
      }
    };
  }

  return {
    handled: true,
    result: {
      ...promptAsaasUpdateDetailsForm(
        state,
        options?.summary ?? `Cobranças pendentes de ${customerName ?? "cliente"}. Selecione e informe o novo vencimento.`,
        formDefaults
      ),
      formDefaults
    }
  };
}

function promptAsaasBoletoDetailsForm(
  state: InteractiveFlowState,
  summary = "Preencha os dados da cobrança no Asaas.",
  partialDefaults?: Record<string, string>
): AgentResultView {
  const customerId = stringValue(state.slots.customerId) ?? "";
  const customerName = stringValue(state.slots.customerName) ?? "";

  return {
    ...needsInput({
      toolName: "asaas.interactive_boleto_charge",
      provider: "asaas",
      intent: "create_boleto_charge",
      summary,
      missingFields: ["customerId", "valueBr", "dueDateBr", "description"],
      questions: []
    }),
    formId: "asaas_boleto_details",
    formDefaults: {
      customerId,
      valueBr: "",
      dueDateBr: "",
      description: "",
      ...partialDefaults
    },
    formChoices: state.formChoices,
    formContext: {
      customerName
    }
  };
}

function promptAsaasUpdateDetailsForm(
  state: InteractiveFlowState,
  summary = "Selecione o cliente e as cobranças para alterar o vencimento.",
  partialDefaults?: Record<string, string>
): AgentResultView {
  const customerId = stringValue(state.slots.customerId) ?? "";
  const customerName = stringValue(state.slots.customerName) ?? "";

  return {
    ...needsInput({
      toolName: ASAAS_UPDATE_TOOL_NAME,
      provider: "asaas",
      intent: "update_charge_due_date",
      summary,
      missingFields: ["customerId", "chargeIds", "dueDateBr"],
      questions: []
    }),
    formId: "asaas_update_due_date",
    formDefaults: {
      customerId,
      chargeIds: "",
      dueDateBr: "",
      ...partialDefaults
    },
    formChoices: state.formChoices,
    formContext: {
      customerName
    }
  };
}

async function collectAsaasBoletoDetailsForm(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string,
  params: Record<string, unknown>
): Promise<InteractiveFlowResult> {
  const customerId = stringValue(params.customerId)?.trim() ?? "";
  const valueBr = normalizeMoneyBr(stringValue(params.valueBr) ?? "");
  const dueDateBr = stringValue(params.dueDateBr)?.trim() ?? "";
  const description = stringValue(params.description)?.trim() ?? "";
  const customerName =
    stringValue(params.customerName) ??
    resolveChoiceLabel(state.formChoices?.customerId, "customerId", customerId) ??
    stringValue(state.slots.customerName);

  const formDefaults = {
    customerId,
    valueBr,
    dueDateBr,
    description
  };

  if (!customerId) {
    return {
      handled: true,
      result: {
        ...promptAsaasBoletoDetailsForm(state, "Selecione o cliente.", formDefaults),
        formDefaults
      }
    };
  }
  if (!isValidMoneyBr(valueBr)) {
    return {
      handled: true,
      result: {
        ...promptAsaasBoletoDetailsForm(state, "Valor inválido. Use o formato 10,00.", formDefaults),
        formDefaults
      }
    };
  }
  if (!isValidDateBr(dueDateBr)) {
    return {
      handled: true,
      result: {
        ...promptAsaasBoletoDetailsForm(state, "Data de vencimento inválida. Use DD/MM/AAAA.", formDefaults),
        formDefaults
      }
    };
  }
  if (!description) {
    return {
      handled: true,
      result: {
        ...promptAsaasBoletoDetailsForm(state, "A descrição da cobrança é obrigatória.", formDefaults),
        formDefaults
      }
    };
  }

  state.slots = { ...state.slots, customerId, customerName, valueBr, dueDateBr, description };
  input.store.delete(sessionKey);
  const workflowParams = {
    customerName,
    valueBr,
    dueDateBr,
    description
  };
  const receipt = await executeTool<unknown>(
    input.registry,
    "asaas.create_boleto_charge_workflow",
    workflowParams
  );
  const operationId = operationIdFromReceipt(receipt);

  return {
    handled: true,
    draftOperationId: receipt.status === "planned" ? operationId : undefined,
    draft: receipt.status === "planned"
      ? {
          operationId,
          toolName: receipt.toolName,
          params: workflowParams
        }
      : undefined,
    result: {
      status: "executed",
      provider: "asaas",
      intent: "create_boleto_charge",
      toolName: receipt.toolName,
      operationId,
      receiptStatus: receipt.status,
      summary: receipt.status === "planned"
        ? "Dry-run concluído. Revise os dados e aprove para emitir o boleto de verdade."
        : receipt.summary,
      missingFields: [],
      questions: [],
      warnings: receipt.warnings,
      approvalAvailable: receipt.status === "planned",
      receiptData: receipt.data
    }
  };
}

async function collectAsaasUpdateDetailsForm(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string,
  params: Record<string, unknown>
): Promise<InteractiveFlowResult> {
  const customerId = stringValue(params.customerId)?.trim() ?? "";
  const chargeIds = parseChargeIds(params);
  const dueDateBr = stringValue(params.dueDateBr)?.trim() ?? "";
  const customerName =
    stringValue(params.customerName) ??
    resolveChoiceLabel(state.formChoices?.customerId, "customerId", customerId) ??
    stringValue(state.slots.customerName);

  const formDefaults = {
    customerId,
    chargeIds: chargeIds.join(","),
    dueDateBr
  };

  if (!customerId) {
    return {
      handled: true,
      result: {
        ...promptAsaasUpdateDetailsForm(state, "Selecione o cliente.", formDefaults),
        formDefaults
      }
    };
  }

  if (chargeIds.length === 0) {
    return loadAsaasChargesIntoForm(input, state, sessionKey, params, {
      summary: "Selecione ao menos uma cobrança pendente."
    });
  }

  if (!isValidDateBr(dueDateBr)) {
    return {
      handled: true,
      result: {
        ...promptAsaasUpdateDetailsForm(state, "Data inválida. Use DD/MM/AAAA.", formDefaults),
        formDefaults
      }
    };
  }

  state.slots = { ...state.slots, customerId, customerName, chargeIds: chargeIds.join(","), dueDateBr };
  input.store.delete(sessionKey);

  const receipts = [];
  const drafts: OperationDraftPayload[] = [];
  for (const chargeId of chargeIds) {
    const workflowParams = { chargeId, dueDateBr };
    const receipt = await executeTool<unknown>(input.registry, "asaas.update_charge_due_date", workflowParams);
    receipts.push(receipt);
    if (receipt.status !== "planned") continue;

    const operationId = operationIdFromReceipt(receipt);
    drafts.push({
      operationId,
      toolName: receipt.toolName,
      params: { chargeId, dueDateBr, customerName }
    });
  }

  const firstDraft = drafts[0];
  const firstReceipt = receipts.find((receipt) => receipt.status === "planned") ?? receipts[receipts.length - 1];
  const operationId = firstDraft?.operationId;
  const allPlanned = receipts.length > 0 && receipts.every((receipt) => receipt.status === "planned");
  const summary =
    chargeIds.length > 1 && allPlanned
      ? `${chargeIds.length} alterações preparadas (dry-run). Revise e aprove cada operação em Operações.`
      : firstDraft
        ? "Dry-run concluído. Revise os dados e aprove para emitir a alteração."
        : receipts[receipts.length - 1]?.summary ?? "Alteração concluída.";

  return {
    handled: true,
    draftOperationId: firstDraft ? operationId : undefined,
    draft: firstDraft,
    drafts: drafts.length > 0 ? drafts : undefined,
    result: {
      status: "executed",
      provider: "asaas",
      intent: "update_charge_due_date",
      toolName: firstDraft?.toolName ?? receipts[receipts.length - 1]?.toolName ?? ASAAS_UPDATE_TOOL_NAME,
      operationId,
      receiptStatus: firstReceipt?.status,
      summary,
      missingFields: [],
      questions: [],
      warnings: receipts.flatMap((receipt) => receipt.warnings ?? []),
      approvalAvailable: Boolean(firstDraft),
      receiptData: receipts.length === 1 ? receipts[0]?.data : receipts.map((receipt) => receipt.data)
    }
  };
}

async function transitionToAsaasDownloadForm(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string,
  options?: { summary?: string }
): Promise<InteractiveFlowResult> {
  const receipt = await executeTool<CustomerMatch[]>(input.registry, "asaas.search_customers", {
    query: ""
  });
  const customers = Array.isArray(receipt.data) ? receipt.data : [];
  if (customers.length === 0) {
    return {
      handled: true,
      result: needsInput({
        toolName: ASAAS_DOWNLOAD_TOOL_NAME,
        provider: "asaas",
        intent: "download_boleto_pdf",
        summary: "Nenhum cliente encontrado no Asaas.",
        missingFields: ["customerId"],
        questions: ["Nenhum cliente cadastrado no Asaas."],
        choices: []
      })
    };
  }

  state.formChoices = {
    customerId: customers.map((customer) => asaasCustomerChoice(customer, ASAAS_DOWNLOAD_FLOW))
  };
  state.step = "asaasDownloadDetailsForm";
  input.store.set(sessionKey, state);

  return {
    handled: true,
    result: promptAsaasDownloadDetailsForm(
      state,
      options?.summary ?? "Selecione o cliente. As cobranças boleto aparecem na lista abaixo."
    )
  };
}

function promptAsaasDownloadDetailsForm(
  state: InteractiveFlowState,
  summary = "Selecione o cliente. As cobranças boleto aparecem na lista abaixo.",
  partialDefaults?: Record<string, string>
): AgentResultView {
  const customerId = stringValue(state.slots.customerId) ?? "";
  const customerName = stringValue(state.slots.customerName) ?? "";
  const chargeId = stringValue(state.slots.chargeId) ?? "";

  return {
    ...needsInput({
      toolName: ASAAS_DOWNLOAD_TOOL_NAME,
      provider: "asaas",
      intent: "download_boleto_pdf",
      summary,
      missingFields: ["customerId", "chargeIds"],
      questions: []
    }),
    formId: "asaas_download_boleto",
    formDefaults: {
      customerId,
      chargeIds: chargeId,
      ...partialDefaults
    },
    formChoices: state.formChoices,
    formContext: {
      customerName,
      chargeSummary: resolveChoiceLabel(state.formChoices?.chargeId, "chargeId", chargeId) ?? ""
    }
  };
}

async function loadAsaasDownloadChargesIntoForm(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string,
  params: Record<string, unknown>,
  options?: { summary?: string }
): Promise<InteractiveFlowResult> {
  const customerId = stringValue(params.customerId) ?? stringValue(state.slots.customerId);
  const customerName =
    stringValue(params.customerName) ??
    resolveChoiceLabel(state.formChoices?.customerId, "customerId", customerId) ??
    stringValue(state.slots.customerName);

  if (!customerId) {
    return {
      handled: true,
      result: promptAsaasDownloadDetailsForm(state, "Selecione o cliente.", formDefaultsFromParams(params))
    };
  }

  if (!state.formChoices?.customerId) {
    const customersReceipt = await executeTool<CustomerMatch[]>(input.registry, "asaas.search_customers", {
      query: ""
    });
    const customers = Array.isArray(customersReceipt.data) ? customersReceipt.data : [];
    state.formChoices = {
      customerId: customers.map((customer) => asaasCustomerChoice(customer, ASAAS_DOWNLOAD_FLOW))
    };
  }

  const receipt = await executeTool<PendingCharge[]>(input.registry, "asaas.list_charges", {
    customerId,
    statusFilter: "all",
    billingType: "boleto"
  });
  const charges = Array.isArray(receipt.data) ? receipt.data : [];

  state.slots = {
    ...state.slots,
    customerId,
    customerName
  };
  state.formChoices = {
    ...state.formChoices,
    customerId: state.formChoices?.customerId ?? [],
    chargeId: charges.map((charge) => asaasChargeFormChoice(charge))
  };
  state.step = "asaasDownloadDetailsForm";
  input.store.set(sessionKey, state);

  const formDefaults = {
    ...formDefaultsFromParams(params),
    customerId,
    chargeIds: stringValue(params.chargeIds) ?? stringValue(params.chargeId) ?? ""
  };

  if (charges.length === 0) {
    return {
      handled: true,
      result: {
        ...promptAsaasDownloadDetailsForm(
          state,
          `Nenhuma cobrança boleto encontrada para ${customerName ?? "este cliente"}.`,
          formDefaults
        ),
        formDefaults
      }
    };
  }

  return {
    handled: true,
    result: {
      ...promptAsaasDownloadDetailsForm(
        state,
        options?.summary ??
          `Encontrei ${charges.length} cobrança(s) boleto de ${customerName ?? "cliente"}. Selecione a cobrança e clique em Baixar PDF.`,
        formDefaults
      ),
      formDefaults
    }
  };
}

async function collectAsaasDownloadBoletoForm(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string,
  params: Record<string, unknown>
): Promise<InteractiveFlowResult> {
  const customerId = stringValue(params.customerId)?.trim() ?? "";
  const chargeId =
    stringValue(params.chargeId)?.trim() ?? parseChargeIds(params)[0] ?? "";
  const customerName =
    stringValue(params.customerName) ??
    resolveChoiceLabel(state.formChoices?.customerId, "customerId", customerId) ??
    stringValue(state.slots.customerName);
  const chargeLabel =
    resolveChoiceLabel(state.formChoices?.chargeId, "chargeId", chargeId) ?? chargeId;
  const chargeFacts = chargeFactsFromFormChoices(state.formChoices?.chargeId, chargeId);

  const formDefaults = { customerId, chargeId };

  if (!customerId) {
    return {
      handled: true,
      result: {
        ...promptAsaasDownloadDetailsForm(state, "Selecione o cliente.", formDefaults),
        formDefaults
      }
    };
  }

  if (!chargeId) {
    return loadAsaasDownloadChargesIntoForm(input, state, sessionKey, params, {
      summary: "Selecione a cobrança para baixar o PDF."
    });
  }

  const linksReceipt = await executeTool<{ externalToken?: string; boletoUrl?: string }>(
    input.registry,
    "asaas.get_charge_links",
    { chargeId }
  );
  const externalToken = stringValue(linksReceipt.data?.externalToken);
  if (!externalToken) {
    return {
      handled: true,
      result: {
        ...promptAsaasDownloadDetailsForm(
          state,
          "Esta cobrança não possui link de boleto PDF disponível.",
          formDefaults
        ),
        formDefaults
      }
    };
  }

  const safeName = chargeLabel.replace(/[^\w.-]+/g, "_").slice(0, 80) || `boleto_${chargeId}`;
  const downloadReceipt = (await executeTool(
    input.registry,
    "asaas.download_boleto_pdf",
    {
      externalToken,
      fileName: `${safeName}.pdf`
    }
  )) as ToolReceipt;
  const operationId = operationIdFromReceipt(downloadReceipt);

  state.slots = { ...state.slots, customerId, customerName, chargeId };
  input.store.delete(sessionKey);

  return {
    handled: true,
    result: {
      status: "executed",
      provider: "asaas",
      intent: "download_boleto_pdf",
      toolName: "asaas.download_boleto_pdf",
      operationId,
      receiptStatus: downloadReceipt.status,
      summary:
        downloadReceipt.status === "succeeded"
          ? "PDF do boleto baixado com sucesso."
          : downloadReceipt.summary ?? "Não foi possível baixar o PDF do boleto.",
      missingFields: [],
      questions: [],
      warnings: downloadReceipt.warnings,
      approvalAvailable: false,
      receiptData: {
        chargeId,
        customerName,
        chargeLabel,
        valueBr: chargeFacts.valueBr,
        dueDateBr: chargeFacts.dueDateBr,
        boletoUrl: linksReceipt.data?.boletoUrl,
        artifacts: downloadReceipt.artifacts
      }
    }
  };
}

function asaasChargeFormChoice(charge: PendingCharge): AgentChoiceView {
  const valueLabel = charge.valueBr.trim().startsWith("R$") ? charge.valueBr : `R$ ${charge.valueBr}`;
  return {
    id: `asaas-charge:${charge.id}`,
    label: charge.description ?? `Cobrança ${charge.id}`,
    description: `${valueLabel} · vence ${charge.dueDateBr} · ${charge.status}`,
    params: {
      chargeId: charge.id
    }
  };
}

function contaazulStatementFormChoice(item: FinancialStatementItem): AgentChoiceView {
  const installmentId = item.installmentId ?? item.id;
  const status = String(item.status ?? "").toUpperCase();
  const statusLabel =
    status === "PAID" || status === "ACQUITTED" ? "liquidada" : status ? status.toLowerCase() : "pendente";
  const dueLabel = item.dueDateIso ? formatIsoToBr(item.dueDateIso) : "—";
  return {
    id: `contaazul-statement:${installmentId}`,
    label: item.description,
    description: `${formatMoneyBr(item.value)} · vence ${dueLabel} · ${statusLabel}`,
    params: {
      chargeId: installmentId,
      financialEventId: item.financialEventId,
      installmentId
    }
  };
}

function formatMoneyBr(value: number): string {
  return `R$ ${value.toFixed(2).replace(".", ",")}`;
}

function statementSearchQueryFromCustomerName(customerName: string): string {
  const trimmed = customerName.trim();
  if (!trimmed) return "";

  const dashParts = trimmed.split(/\s*-\s+/);
  if (dashParts.length > 1) {
    const lead = dashParts[0]?.trim();
    if (lead && lead.length >= 3) return lead;
  }

  const firstWord = trimmed.split(/\s+/)[0]?.trim();
  if (firstWord && firstWord.length >= 3) return firstWord;

  return trimmed.length > 48 ? trimmed.slice(0, 48).trim() : trimmed;
}

function statementMatchesCustomerHint(item: FinancialStatementItem, needle: string): boolean {
  if (!needle) return true;

  const customerName = normalize(stringValue(item.customerName) ?? "");
  if (customerName && (customerName.includes(needle) || needle.includes(customerName))) {
    return true;
  }

  const description = normalize(item.description ?? "");
  if (description.includes(needle)) return true;

  const categoryName = normalize(stringValue(item.categoryName) ?? "");
  if (categoryName.includes(needle)) return true;

  return false;
}

function resolveStatementFromFormChoices(
  choices: AgentChoiceView[] | undefined,
  chargeId: string
): { financialEventId: string; installmentId: string } | undefined {
  const choice = choices?.find((item) => stringValue(item.params?.chargeId) === chargeId);
  if (!choice) return undefined;
  const financialEventId = stringValue(choice.params?.financialEventId);
  const installmentId = stringValue(choice.params?.installmentId);
  if (!financialEventId || !installmentId) return undefined;
  return { financialEventId, installmentId };
}

function chargeFactsFromFormChoices(
  choices: AgentChoiceView[] | undefined,
  chargeId: string
): { valueBr?: string; dueDateBr?: string } {
  const choice = choices?.find((item) => stringValue(item.params?.chargeId) === chargeId);
  const description = choice?.description ?? "";
  const valueMatch = /R\$\s*[\d.,]+/.exec(description);
  const dateMatch = /vence\s+(\d{2}\/\d{2}\/\d{4})/.exec(description);
  return {
    valueBr: valueMatch?.[0],
    dueDateBr: dateMatch?.[1]
  };
}

function resolveChoiceLabel(
  choices: AgentChoiceView[] | undefined,
  fieldName: string,
  value: string | undefined
): string | undefined {
  if (!value || !choices) return undefined;
  const match = choices.find((choice) => choiceValueFromParams(fieldName, choice) === value);
  return stringValue(match?.label);
}

function choiceValueFromParams(fieldName: string, choice: AgentChoiceView): string {
  const params = choice.params ?? {};
  if (fieldName === "customerId") return String(params.customerId ?? "");
  if (fieldName === "chargeId") return String(params.chargeId ?? "");
  if (fieldName === "categoryId") return String(params.categoryId ?? "");
  if (fieldName === "itemId") return String(params.itemId ?? "");
  if (fieldName === "personType") return String(params.personType ?? "");
  return String(params[fieldName] ?? choice.id);
}

function formDefaultsFromParams(params: Record<string, unknown>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === "__interactive") continue;
    const text = stringValue(value);
    if (text) output[key] = text;
  }
  return output;
}

async function transitionToSaleDetailsForm(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string,
  options?: { summary?: string }
): Promise<InteractiveFlowResult> {
  const relationId = stringValue(state.slots.relationId);
  if (!relationId) {
    return {
      handled: true,
      result: blocked("A empresa selecionada não possui relationId para buscar categorias e itens.")
    };
  }

  const [categoriesReceipt, itemsReceipt] = await Promise.all([
    executeTool<unknown[]>(input.registry, "contaazul.search_financial_categories", {
      relationId,
      listAll: true
    }),
    executeTool<unknown[]>(input.registry, "contaazul.search_service_items", {
      relationId,
      listAll: true
    })
  ]);
  const categories = Array.isArray(categoriesReceipt.data) ? categoriesReceipt.data : [];
  const items = Array.isArray(itemsReceipt.data) ? itemsReceipt.data : [];

  state.formChoices = {
    categoryId: categories.map((category) => categoryChoice(category)),
    itemId: items.map((item) => itemChoice(item))
  };
  state.step = "saleDetailsForm";
  input.store.set(sessionKey, state);
  await prefetchCustomerBillingDefaults(input, state);

  return {
    handled: true,
    result: promptSaleDetailsForm(
      state,
      options?.summary ??
        (stringValue(state.slots.customerName)
          ? `Quase lá! Preencha os dados da cobrança para ${stringValue(state.slots.customerName)}.`
          : "Preencha os dados da cobrança.")
    )
  };
}

function promptSaleDetailsForm(
  state: InteractiveFlowState,
  summary?: string,
  partialDefaults?: Record<string, string>
): AgentResultView {
  const customerName = stringValue(state.slots.customerName) ?? "";
  const itemName = stringValue(state.slots.itemName) ?? "";
  const categoryName = stringValue(state.slots.categoryName) ?? "";
  const tenantName = stringValue(state.slots.tenantName) ?? "";
  const phoneDefault = usableOperatorDefault(stringValue(state.slots.notificationPhoneDefault));
  const emailDefault = usableOperatorDefault(stringValue(state.slots.notificationEmailDefault));
  const categoryId = stringValue(state.slots.categoryId) ?? "";
  const itemId = stringValue(state.slots.itemId) ?? "";

  return {
    ...needsInput({
      summary:
        summary ??
        (customerName
          ? `Quase lá! Preencha os dados da cobrança para ${customerName}.`
          : "Preencha os dados da cobrança."),
      missingFields: [
        "categoryId",
        "itemId",
        "serviceDescription",
        "unitValueBr",
        "dueDateBr",
        "notification.phone",
        "notification.email",
        "notification.replyTo"
      ],
      questions: []
    }),
    formId: "contaazul_service_sale_details",
    formDefaults: {
      categoryId,
      itemId,
      serviceDescription: itemName,
      unitValueBr: "",
      dueDateBr: "",
      "notification.phone": phoneDefault ? formatPhoneBrDisplay(phoneDefault) : "",
      "notification.email": emailDefault ?? "",
      "notification.replyTo": "",
      ...partialDefaults
    },
    formChoices: state.formChoices,
    formContext: {
      customerName,
      itemName,
      categoryName,
      tenantName
    }
  };
}

async function collectSaleDetailsForm(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string,
  params: Record<string, unknown>
): Promise<InteractiveFlowResult> {
  const categoryId = stringValue(params.categoryId)?.trim() ?? "";
  const itemId = stringValue(params.itemId)?.trim() ?? "";
  const serviceDescription = stringValue(params.serviceDescription)?.trim() ?? "";
  const unitValueBr = normalizeMoneyBr(stringValue(params.unitValueBr) ?? "");
  const dueDateBr = stringValue(params.dueDateBr)?.trim() ?? "";
  const phoneDefault = usableOperatorDefault(stringValue(state.slots.notificationPhoneDefault));
  const emailDefault = usableOperatorDefault(stringValue(state.slots.notificationEmailDefault));
  const phone = (stringValue(params["notification.phone"])?.trim() || phoneDefault || "").replace(
    /\D/g,
    ""
  );
  const email = (stringValue(params["notification.email"])?.trim() || emailDefault || "").trim();
  const replyTo = stringValue(params["notification.replyTo"])?.trim() ?? "";

  const categoryChoiceMatch = state.formChoices?.categoryId?.find(
    (choice) => stringValue(choice.params?.categoryId) === categoryId
  );
  const itemChoiceMatch = state.formChoices?.itemId?.find(
    (choice) => stringValue(choice.params?.itemId) === itemId
  );
  const categoryName = stringValue(categoryChoiceMatch?.label) ?? stringValue(state.slots.categoryName);
  const itemName = stringValue(itemChoiceMatch?.label) ?? stringValue(state.slots.itemName);

  const formDefaults = {
    categoryId,
    itemId,
    serviceDescription,
    unitValueBr,
    dueDateBr,
    "notification.phone": stringValue(params["notification.phone"]) ?? (phoneDefault ? formatPhoneBrDisplay(phoneDefault) : ""),
    "notification.email": stringValue(params["notification.email"]) ?? emailDefault ?? "",
    "notification.replyTo": replyTo
  };

  if (!categoryId) {
    return {
      handled: true,
      result: {
        ...promptSaleDetailsForm(state, "Selecione a categoria financeira.", formDefaults),
        formDefaults
      }
    };
  }
  if (!itemId) {
    return {
      handled: true,
      result: {
        ...promptSaleDetailsForm(state, "Selecione o item de serviço.", formDefaults),
        formDefaults
      }
    };
  }
  if (!serviceDescription) {
    return {
      handled: true,
      result: {
        ...promptSaleDetailsForm(state, "Informe a descrição do serviço."),
        formDefaults
      }
    };
  }
  if (!isValidMoneyBr(unitValueBr)) {
    return {
      handled: true,
      result: {
        ...promptSaleDetailsForm(state, "Valor inválido. Use o formato 10,00."),
        formDefaults
      }
    };
  }
  if (!isValidDateBr(dueDateBr)) {
    return {
      handled: true,
      result: {
        ...promptSaleDetailsForm(state, "Data de vencimento inválida. Use DD/MM/AAAA."),
        formDefaults
      }
    };
  }
  if (phone.length < 10) {
    return {
      handled: true,
      result: {
        ...promptSaleDetailsForm(state, "Telefone inválido. Informe DDD + número."),
        formDefaults
      }
    };
  }
  if (!isLikelyEmail(email)) {
    return {
      handled: true,
      result: {
        ...promptSaleDetailsForm(state, "E-mail de cobrança inválido."),
        formDefaults
      }
    };
  }
  if (replyTo && !isLikelyEmail(replyTo)) {
    return {
      handled: true,
      result: {
        ...promptSaleDetailsForm(state, "E-mail de contato inválido."),
        formDefaults
      }
    };
  }

  state.slots = {
    ...state.slots,
    categoryId,
    categoryName,
    itemId,
    itemName,
    serviceDescription,
    unitValueBr,
    dueDateBr,
    notificationPhone: phone,
    notificationEmail: email,
    ...(replyTo ? { notificationReplyTo: replyTo } : {})
  };
  input.store.delete(sessionKey);

  const workflowParams = serviceSaleWorkflowParams(state.slots);
  const receipt = await executeTool<unknown>(
    input.registry,
    "contaazul.create_service_sale_boleto_workflow",
    workflowParams
  );
  const operationId = operationIdFromReceipt(receipt);

  return {
    handled: true,
    draftOperationId: receipt.status === "planned" ? operationId : undefined,
    draft: receipt.status === "planned"
      ? {
          operationId,
          toolName: receipt.toolName,
          params: workflowParams
        }
      : undefined,
    result: {
      status: "executed",
      provider: "contaazul",
      intent: "create_service_sale_boleto",
      toolName: receipt.toolName,
      operationId,
      receiptStatus: receipt.status,
      summary: receipt.status === "planned"
        ? "Dry-run concluído. Revise os dados e aprove para emitir o boleto de verdade."
        : receipt.summary,
      missingFields: [],
      questions: [],
      warnings: receipt.warnings,
      approvalAvailable: receipt.status === "planned",
      receiptData: receipt.data
    }
  };
}

function needsInput(input: {
  summary: string;
  missingFields: string[];
  questions: string[];
  choices?: AgentChoiceView[];
  toolName?: string;
  provider?: "asaas" | "contaazul";
  intent?: string;
}): AgentResultView {
  return {
    status: "needs_input",
    provider: input.provider ?? "contaazul",
    intent: input.intent ?? "create_service_sale_boleto",
    toolName: input.toolName ?? INTERACTIVE_TOOL_NAME,
    summary: input.summary,
    missingFields: input.missingFields,
    questions: input.questions,
    warnings: [],
    approvalAvailable: false,
    choices: input.choices
  };
}

function blocked(reason: string): AgentResultView {
  return {
    status: "blocked",
    provider: "contaazul",
    intent: "create_service_sale_boleto",
    toolName: INTERACTIVE_TOOL_NAME,
    missingFields: [],
    questions: [],
    warnings: [reason],
    approvalAvailable: false,
    reason
  };
}

function getInteractiveMarker(params: Record<string, unknown> | undefined): InteractiveMarker {
  const value = params?.__interactive;
  if (!value || typeof value !== "object") return {};
  const marker = value as InteractiveMarker;
  return {
    flow: marker.flow,
    action: marker.action
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function parseChargeIds(params: Record<string, unknown>): string[] {
  const fromArray = params.chargeIds;
  if (Array.isArray(fromArray)) {
    return fromArray.map((value) => String(value).trim()).filter(Boolean);
  }
  const csv = stringValue(params.chargeIds);
  if (csv) {
    return csv.split(",").map((part) => part.trim()).filter(Boolean);
  }
  const single = stringValue(params.chargeId)?.trim();
  return single ? [single] : [];
}

function usableOperatorDefault(value: string | undefined): string | undefined {
  if (!value || isRedactedPlaceholder(value)) return undefined;
  return value;
}

function formatPhoneBrDisplay(digits: string): string {
  const clean = digits.replace(/\D/g, "").slice(0, 11);
  if (clean.length === 0) return "";
  if (clean.length <= 2) return clean;
  if (clean.length <= 6) return `(${clean.slice(0, 2)}) ${clean.slice(2)}`;
  if (clean.length <= 10) return `(${clean.slice(0, 2)}) ${clean.slice(2, 6)}-${clean.slice(6)}`;
  return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function isValidMoneyBr(value: string): boolean {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) && parsed > 0;
}

function normalizeMoneyBr(value: string): string {
  const cleaned = value.replace(/^R\$\s*/i, "").trim();
  if (cleaned.includes(".") && !cleaned.includes(",")) {
    return cleaned.replace(".", ",");
  }
  if (!cleaned.includes(",") && !cleaned.includes(".")) {
    return `${cleaned},00`;
  }
  return cleaned;
}

function isValidDateBr(value: string): boolean {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return false;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function operationIdFromReceipt(receipt: ToolReceipt<unknown>): string {
  const data = asRecord(receipt.data);
  const approvalPreview = asRecord(data.approvalPreview);
  return stringValue(approvalPreview.operationId) ?? receipt.operationId;
}

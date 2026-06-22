import type { AgentChoiceView, AgentResultView } from "./api-types.js";
import type { ToolRegistry } from "../core/tool-registry.js";
import type { AccountancyClient, CustomerMatch, ToolReceipt } from "../core/tool-types.js";

const CONTAZUL_FLOW = "contaazul_service_sale_boleto";
const ASAAS_FLOW = "asaas_boleto_charge";
const PROVIDER_CHOICE_FLOW = "provider_choice";
const INTERACTIVE_TOOL_NAME = "contaazul.interactive_service_sale_boleto";
const PROVIDER_CHOICE_TOOL_NAME = "confere.interactive_boleto_provider";

type InteractiveFlowName = typeof CONTAZUL_FLOW | typeof ASAAS_FLOW;

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
    | "serviceDescription"
    | "unitValue"
    | "dueDate"
    | "notificationPhone"
    | "notificationEmail"
    | "notificationReplyTo"
    | "asaasCustomerSearch"
    | "asaasCustomerChoice"
    | "asaasValue"
    | "asaasDueDate"
    | "asaasDescription";
  slots: Record<string, unknown>;
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
};

export type InteractiveFlowResult =
  | {
      handled: false;
    }
  | {
      handled: true;
      result: AgentResultView;
      draftOperationId?: string;
      draft?: {
        operationId: string;
        toolName: string;
        params: Record<string, unknown>;
      };
    };

export async function runInteractiveFlowTurn(input: InteractiveFlowInput): Promise<InteractiveFlowResult> {
  const sessionKey = input.sessionId ?? "default";
  const marker = getInteractiveMarker(input.params);
  const existing = input.store.get(sessionKey);

  if (marker.flow === PROVIDER_CHOICE_FLOW) {
    if (marker.action === "select_contaazul_service_sale") {
      const state: InteractiveFlowState = {
        flow: CONTAZUL_FLOW,
        step: "tenant",
        slots: {}
      };
      input.store.set(sessionKey, state);
      return promptContaAzulTenant(input.registry);
    }
    if (marker.action === "select_asaas_boleto") {
      input.store.set(sessionKey, {
        flow: ASAAS_FLOW,
        step: "asaasCustomerSearch",
        slots: {}
      });
      return {
        handled: true,
        result: needsInput({
          toolName: "asaas.interactive_boleto_charge",
          provider: "asaas",
          intent: "create_boleto_charge",
          summary: "Vamos preparar uma cobrança no Asaas.",
          missingFields: ["customerSearch"],
          questions: ["Digite o nome do cliente para pesquisa."]
        })
      };
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

  if (!looksLikeContaAzulServiceBoletoRequest(input.request)) {
    return looksLikeGenericBoletoRequest(input.request)
      ? promptBoletoProvider()
      : { handled: false };
  }

  const state: InteractiveFlowState = {
    flow: CONTAZUL_FLOW,
    step: "tenant",
    slots: {}
  };
  input.store.set(sessionKey, state);
  return promptContaAzulTenant(input.registry);
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
    state.step = "asaasValue";
    input.store.set(sessionKey, state);
    return {
      handled: true,
      result: needsInput({
        toolName: "asaas.interactive_boleto_charge",
        provider: "asaas",
        intent: "create_boleto_charge",
        summary: "Cliente selecionado no Asaas.",
        missingFields: ["valueBr"],
        questions: ["Digite o valor da cobrança (ex: 10,00)."]
      })
    };
  }

  if (state.step === "asaasCustomerSearch") {
    return searchAsaasCustomers(input, state, sessionKey);
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

  return {
    handled: true,
    result: needsInput({
      toolName: "asaas.interactive_boleto_charge",
      provider: "asaas",
      intent: "create_boleto_charge",
      summary: "Aguardando pesquisa do cliente.",
      missingFields: ["customerSearch"],
      questions: ["Digite o nome do cliente para pesquisa."]
    })
  };
}

async function searchAsaasCustomers(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string
): Promise<InteractiveFlowResult> {
  const query = input.request.trim();
  if (!query) {
    return {
      handled: true,
      result: needsInput({
        toolName: "asaas.interactive_boleto_charge",
        provider: "asaas",
        intent: "create_boleto_charge",
        summary: "Aguardando pesquisa do cliente.",
        missingFields: ["customerSearch"],
        questions: ["Digite o nome do cliente para pesquisa."]
      })
    };
  }

  const receipt = await executeTool<CustomerMatch[]>(input.registry, "asaas.search_customers", {
    query
  });
  const customers = Array.isArray(receipt.data) ? receipt.data : [];
  if (customers.length === 0) {
    state.step = "asaasCustomerSearch";
    input.store.set(sessionKey, state);
    return {
      handled: true,
      result: needsInput({
        toolName: "asaas.interactive_boleto_charge",
        provider: "asaas",
        intent: "create_boleto_charge",
        summary: `Não encontrei ninguém com "${query}".`,
        missingFields: ["customerSearch"],
        questions: [`Não encontrei ninguém com "${query}". Tente outro nome.`]
      })
    };
  }
  if (customers.length === 1) {
    const customer = customers[0]!;
    state.slots = {
      ...state.slots,
      customerId: customer.id,
      customerName: customer.name
    };
    state.step = "asaasValue";
    input.store.set(sessionKey, state);
    return {
      handled: true,
      result: needsInput({
        toolName: "asaas.interactive_boleto_charge",
        provider: "asaas",
        intent: "create_boleto_charge",
        summary: `Cliente selecionado automaticamente: ${customer.name}.`,
        missingFields: ["valueBr"],
        questions: ["Digite o valor da cobrança (ex: 10,00)."]
      })
    };
  }

  state.step = "asaasCustomerChoice";
  input.store.set(sessionKey, state);
  return {
    handled: true,
    result: needsInput({
      toolName: "asaas.interactive_boleto_charge",
      provider: "asaas",
      intent: "create_boleto_charge",
      summary: `Encontrei ${customers.length} cliente(s) para "${query}".`,
      missingFields: ["customerId"],
      questions: ["Selecione o cliente para esta cobrança."],
      choices: customers.map(asaasCustomerChoice)
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
        ? "Dry-run preparado para revisão."
        : receipt.summary,
      missingFields: [],
      questions: [],
      warnings: receipt.warnings,
      approvalAvailable: receipt.status === "planned",
      receiptData: receipt.data
    }
  };
}

function promptBoletoProvider(): InteractiveFlowResult {
  return {
    handled: true,
    result: needsInput({
      toolName: PROVIDER_CHOICE_TOOL_NAME,
      summary: "Escolha onde vamos emitir o boleto.",
      missingFields: ["provider"],
      questions: ["Selecione onde o boleto deve ser emitido."],
      choices: [
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
      ]
    })
  };
}

async function continueContaAzulFlow(
  input: InteractiveFlowInput,
  sessionKey: string,
  state: InteractiveFlowState,
  marker: InteractiveMarker
): Promise<InteractiveFlowResult> {
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
    state.step = "customerSearch";
    input.store.set(sessionKey, state);
    return {
      handled: true,
      result: needsInput({
        summary: tenantName
          ? `Empresa selecionada: ${tenantName}.`
          : "Empresa selecionada.",
        missingFields: ["customerSearch"],
        questions: ["Digite o nome do cliente para pesquisa."]
      })
    };
  }

  if (marker.action === "select_customer") {
    state.slots = {
      ...state.slots,
      customerId: stringValue(input.params?.customerId),
      customerName: stringValue(input.params?.customerName)
    };
    state.step = "categorySearch";
    input.store.set(sessionKey, state);
    return {
      handled: true,
      result: needsInput({
        summary: "Cliente selecionado. Agora preciso da categoria financeira.",
        missingFields: ["categorySearch"],
        questions: ["Digite o nome da categoria financeira."]
      })
    };
  }

  if (marker.action === "select_category") {
    state.slots = {
      ...state.slots,
      categoryId: stringValue(input.params?.categoryId),
      categoryName: stringValue(input.params?.categoryName)
    };
    state.step = "itemSearch";
    input.store.set(sessionKey, state);
    return {
      handled: true,
      result: needsInput({
        summary: "Categoria selecionada. Agora preciso do item de serviço.",
        missingFields: ["itemSearch"],
        questions: ["Digite o nome do item de serviço."]
      })
    };
  }

  if (marker.action === "select_item") {
    state.slots = {
      ...state.slots,
      itemId: stringValue(input.params?.itemId),
      itemName: stringValue(input.params?.itemName)
    };
    state.step = "serviceDescription";
    input.store.set(sessionKey, state);
    return {
      handled: true,
      result: needsInput({
        summary: "Item selecionado.",
        missingFields: ["serviceDescription"],
        questions: ["Digite os detalhes do item."]
      })
    };
  }

  if (state.step === "tenant") {
    return promptContaAzulTenant(input.registry);
  }

  if (state.step === "customerSearch") {
    return searchCustomers(input, state, sessionKey);
  }

  if (state.step === "categorySearch") {
    return searchCategories(input, state, sessionKey);
  }

  if (state.step === "itemSearch") {
    return searchServiceItems(input, state, sessionKey);
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

  return {
    handled: true,
    result: needsInput({
      summary: "Aguardando pesquisa do cliente.",
      missingFields: ["customerSearch"],
      questions: ["Digite o nome do cliente para pesquisa."]
    })
  };
}

async function promptContaAzulTenant(registry: ToolRegistry): Promise<InteractiveFlowResult> {
  const tool = registry.list().find((definition) => definition.name === "contaazul.list_accountancy_clients");
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

  return {
    handled: true,
    result: needsInput({
      summary: "Selecione a empresa do Conta Azul antes de pesquisar o cliente.",
      missingFields: ["tenantId"],
      questions: ["Selecione a empresa para esta operação."],
      choices: clients.map(tenantChoice)
    })
  };
}

function tenantChoice(client: AccountancyClient): AgentChoiceView {
  return {
    id: `tenant:${client.tenantId}`,
    label: client.name,
    description: `Tenant ${client.tenantId}`,
    params: {
      __interactive: { flow: CONTAZUL_FLOW, action: "select_tenant" },
      tenantId: client.tenantId,
      relationId: client.relationId,
      tenantName: client.name
    }
  };
}

async function searchCustomers(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string
): Promise<InteractiveFlowResult> {
  const searchTerm = input.request.trim();
  if (!searchTerm) {
    return promptCustomerSearch();
  }
  const relationId = stringValue(state.slots.relationId);
  if (!relationId) {
    return {
      handled: true,
      result: blocked("A empresa selecionada não possui relationId para abrir a sessão Pro.")
    };
  }
  const receipt = await executeTool<unknown[]>(input.registry, "contaazul.search_sale_customers", {
    relationId,
    searchTerm
  });
  const customers = Array.isArray(receipt.data) ? receipt.data : [];
  if (customers.length === 0) {
    state.step = "customerSearch";
    input.store.set(sessionKey, state);
    return {
      handled: true,
      result: needsInput({
        summary: `Não encontrei ninguém com "${searchTerm}".`,
        missingFields: ["customerSearch"],
        questions: [`Não encontrei ninguém com "${searchTerm}". Tente outro nome.`]
      })
    };
  }
  state.step = "customerChoice";
  input.store.set(sessionKey, state);
  return {
    handled: true,
    result: needsInput({
      summary: `Encontrei ${customers.length} cliente(s) para "${searchTerm}".`,
      missingFields: ["customerId"],
      questions: ["Selecione o cliente para esta venda."],
      choices: customers.map(customerChoice)
    })
  };
}

async function searchCategories(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string
): Promise<InteractiveFlowResult> {
  const searchTerm = input.request.trim();
  if (!searchTerm) {
    return {
      handled: true,
      result: needsInput({
        summary: "Aguardando categoria financeira.",
        missingFields: ["categorySearch"],
        questions: ["Digite o nome da categoria financeira."]
      })
    };
  }
  const relationId = stringValue(state.slots.relationId);
  if (!relationId) {
    return {
      handled: true,
      result: blocked("A empresa selecionada não possui relationId para buscar categorias.")
    };
  }
  const receipt = await executeTool<unknown[]>(input.registry, "contaazul.search_financial_categories", {
    relationId,
    searchTerm
  });
  const categories = Array.isArray(receipt.data) ? receipt.data : [];
  if (categories.length === 0) {
    state.step = "categorySearch";
    input.store.set(sessionKey, state);
    return {
      handled: true,
      result: needsInput({
        summary: `Não encontrei categoria com "${searchTerm}".`,
        missingFields: ["categorySearch"],
        questions: [`Não encontrei categoria com "${searchTerm}". Tente outro nome.`]
      })
    };
  }
  state.step = "categoryChoice";
  input.store.set(sessionKey, state);
  return {
    handled: true,
    result: needsInput({
      summary: `Encontrei ${categories.length} categoria(s) para "${searchTerm}".`,
      missingFields: ["categoryId"],
      questions: ["Selecione a categoria financeira."],
      choices: categories.map(categoryChoice)
    })
  };
}

async function searchServiceItems(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string
): Promise<InteractiveFlowResult> {
  const searchTerm = input.request.trim();
  if (!searchTerm) {
    return {
      handled: true,
      result: needsInput({
        summary: "Aguardando item de serviço.",
        missingFields: ["itemSearch"],
        questions: ["Digite o nome do item de serviço."]
      })
    };
  }
  const relationId = stringValue(state.slots.relationId);
  if (!relationId) {
    return {
      handled: true,
      result: blocked("A empresa selecionada não possui relationId para buscar itens.")
    };
  }
  const receipt = await executeTool<unknown[]>(input.registry, "contaazul.search_service_items", {
    relationId,
    searchTerm
  });
  const items = Array.isArray(receipt.data) ? receipt.data : [];
  if (items.length === 0) {
    state.step = "itemSearch";
    input.store.set(sessionKey, state);
    return {
      handled: true,
      result: needsInput({
        summary: `Não encontrei item com "${searchTerm}".`,
        missingFields: ["itemSearch"],
        questions: [`Não encontrei item com "${searchTerm}". Tente outro nome.`]
      })
    };
  }
  state.step = "itemChoice";
  input.store.set(sessionKey, state);
  return {
    handled: true,
    result: needsInput({
      summary: `Encontrei ${items.length} item(ns) para "${searchTerm}".`,
      missingFields: ["itemId"],
      questions: ["Selecione o item de serviço."],
      choices: items.map(itemChoice)
    })
  };
}

function promptCustomerSearch(): InteractiveFlowResult {
  return {
    handled: true,
    result: needsInput({
      summary: "Empresa selecionada.",
      missingFields: ["customerSearch"],
      questions: ["Digite o nome do cliente para pesquisa."]
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
): InteractiveFlowResult {
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
  return {
    handled: true,
    result: needsInput({
      summary: "Vencimento registrado.",
      missingFields: ["notification.phone"],
      questions: ["Digite o telefone celular do cliente com DDD."]
    })
  };
}

function collectNotificationPhone(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string
): InteractiveFlowResult {
  const phone = input.request.replace(/\D/g, "");
  if (phone.length < 10) {
    return {
      handled: true,
      result: needsInput({
        summary: "Telefone inválido.",
        missingFields: ["notification.phone"],
        questions: ["Digite o telefone celular do cliente com DDD."]
      })
    };
  }
  state.slots = { ...state.slots, notificationPhone: phone };
  state.step = "notificationEmail";
  input.store.set(sessionKey, state);
  return {
    handled: true,
    result: needsInput({
      summary: "Telefone registrado.",
      missingFields: ["notification.email"],
      questions: ["Digite o e-mail de cobrança do cliente."]
    })
  };
}

function collectNotificationEmail(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string
): InteractiveFlowResult {
  const email = input.request.trim();
  if (!isLikelyEmail(email)) {
    return {
      handled: true,
      result: needsInput({
        summary: "E-mail de cobrança inválido.",
        missingFields: ["notification.email"],
        questions: ["Digite um e-mail de cobrança válido."]
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
      questions: ["Digite o e-mail para o destinatário entrar em contato."]
    })
  };
}

async function collectNotificationReplyToAndPlan(
  input: InteractiveFlowInput,
  state: InteractiveFlowState,
  sessionKey: string
): Promise<InteractiveFlowResult> {
  const replyTo = input.request.trim();
  if (!isLikelyEmail(replyTo)) {
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
        ? "Dry-run preparado para revisão."
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
  return {
    tenantId: slots.tenantId,
    customerName: slots.customerName,
    categoryName: slots.categoryName,
    itemName: slots.itemName,
    serviceDescription: slots.serviceDescription,
    unitValueBr: slots.unitValueBr,
    dueDateBr: slots.dueDateBr,
    notification: {
      phone: slots.notificationPhone,
      email: slots.notificationEmail,
      replyTo: slots.notificationReplyTo
    }
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

function customerChoice(item: unknown): AgentChoiceView {
  const record = asRecord(item);
  const id = stringValue(record.id) ?? "";
  const name = stringValue(record.name) ?? id;
  return {
    id: `customer:${id}`,
    label: name,
    description: "Cliente Conta Azul",
    params: {
      __interactive: { flow: CONTAZUL_FLOW, action: "select_customer" },
      customerId: id,
      customerName: name
    }
  };
}

function asaasCustomerChoice(customer: CustomerMatch): AgentChoiceView {
  return {
    id: `asaas-customer:${customer.id}`,
    label: customer.name,
    description: "Cliente Asaas",
    params: {
      __interactive: { flow: ASAAS_FLOW, action: "select_customer" },
      customerId: customer.id,
      customerName: customer.name
    }
  };
}

function categoryChoice(item: unknown): AgentChoiceView {
  const record = asRecord(item);
  const id = stringValue(record.uuid) ?? "";
  const name = stringValue(record.dsNaturezaFinanceira) ?? id;
  return {
    id: `category:${id}`,
    label: name,
    description: "Categoria financeira",
    params: {
      __interactive: { flow: CONTAZUL_FLOW, action: "select_category" },
      categoryId: id,
      categoryName: name
    }
  };
}

function itemChoice(item: unknown): AgentChoiceView {
  const record = asRecord(item);
  const id = stringValue(record.id) ?? "";
  const name = stringValue(record.name) ?? id;
  return {
    id: `item:${id}`,
    label: name,
    description: "Item de serviço",
    params: {
      __interactive: { flow: CONTAZUL_FLOW, action: "select_item" },
      itemId: id,
      itemName: name
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

function looksLikeContaAzulServiceBoletoRequest(request: string): boolean {
  const normalized = normalize(request);
  return (
    normalized.includes("boleto de servico") ||
    normalized.includes("novo boleto de servico") ||
    normalized.includes("venda de servico") ||
    (normalized.includes("conta azul") && normalized.includes("boleto"))
  );
}

function looksLikeGenericBoletoRequest(request: string): boolean {
  const normalized = normalize(request);
  return normalized.includes("boleto") && !normalized.includes("conta azul") && !normalized.includes("asaas");
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
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

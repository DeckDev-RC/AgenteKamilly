import { z } from "zod";

import type { ToolRegistry } from "../core/tool-registry.js";
import type { Provider, ToolReceipt } from "../core/tool-types.js";
import type { AsaasMutationTools, AsaasReadTools } from "../modules/asaas/tools.js";
import {
  AsaasCreateBoletoChargeParamsSchema,
  AsaasCreateBoletoChargeWorkflowParamsSchema,
  AsaasDownloadBoletoPdfParamsSchema,
  AsaasGetChargeLinksParamsSchema,
  AsaasListPendingChargesParamsSchema,
  AsaasListChargesParamsSchema,
  AsaasSearchCustomersParamsSchema,
  AsaasUpdateChargeDueDateParamsSchema
} from "../modules/asaas/tools.js";
import type {
  ContaAzulMutationTools,
  ContaAzulReadTools
} from "../modules/contaazul/tools.js";
import {
  ContaAzulAcknowledgeOrphanCleanupParamsSchema,
  ContaAzulCreateCustomerParamsSchema,
  ContaAzulCreateCustomerWorkflowParamsSchema,
  ContaAzulCreateServiceSaleAndIssueBoletoParamsSchema,
  ContaAzulGetPersonDetailsParamsSchema,
  ContaAzulSearchFinancialCategoriesParamsSchema,
  ContaAzulSearchFinancialStatementParamsSchema,
  ContaAzulSearchSaleCustomersParamsSchema,
  ContaAzulSearchServiceItemsParamsSchema,
  ContaAzulSwitchToProSessionParamsSchema,
  ContaAzulUpdateDueDateReissueBoletoParamsSchema,
  ContaAzulUpdateDueDateReissueBoletoWorkflowParamsSchema
} from "../modules/contaazul/tools.js";
import { ContaAzulCreateServiceSaleBoletoWorkflowParamsSchema } from "../modules/contaazul/workflows.js";

export type HarnessToolset = {
  asaasRead?: Partial<AsaasReadTools>;
  asaasMutation?: Partial<AsaasMutationTools>;
  contaAzulRead?: Partial<ContaAzulReadTools>;
  contaAzulMutation?: Partial<ContaAzulMutationTools>;
};

export type OrchestratorTurnInput = {
  request: string;
  registry: ToolRegistry;
  params?: Record<string, unknown>;
  approvalText?: string;
};

export type OrchestratorTurnResult =
  | {
      status: "needs_input";
      provider: Provider;
      intent: string;
      toolName: string;
      missingFields: string[];
      questions: string[];
    }
  | {
      status: "executed";
      provider: Provider;
      intent: string;
      toolName: string;
      receipt: ToolReceipt;
    }
  | { status: "blocked"; reason: string; toolName?: string }
  | { status: "unsupported"; reason: string };

type Route = {
  provider: Provider;
  intent: string;
  toolName: string;
  requiredFields: string[];
  priority: number;
  match: (request: string) => boolean;
};

export function registerHarnessTools(registry: ToolRegistry, toolset: HarnessToolset): void {
  registerIfPresent(
    registry,
    toolset.asaasRead?.searchCustomers,
    "asaas.search_customers",
    "Search Asaas customers through mapped session HTTP.",
    AsaasSearchCustomersParamsSchema
  );
  registerIfPresent(
    registry,
    toolset.asaasRead?.listPendingCharges,
    "asaas.list_pending_charges",
    "List pending Asaas charges through mapped session HTTP.",
    AsaasListPendingChargesParamsSchema
  );
  registerIfPresent(
    registry,
    toolset.asaasRead?.listCharges,
    "asaas.list_charges",
    "List Asaas charges (all statuses or pending only) through mapped session HTTP.",
    AsaasListChargesParamsSchema
  );
  registerIfPresent(
    registry,
    toolset.asaasRead?.getChargeLinks,
    "asaas.get_charge_links",
    "Get Asaas boleto and invoice links through mapped session HTTP.",
    AsaasGetChargeLinksParamsSchema
  );
  registerIfPresent(
    registry,
    toolset.asaasMutation?.updateChargeDueDate,
    "asaas.update_charge_due_date",
    "Plan or execute an Asaas due-date update through mapped session HTTP.",
    AsaasUpdateChargeDueDateParamsSchema
  );
  registerIfPresent(
    registry,
    toolset.asaasMutation?.createBoletoCharge,
    "asaas.create_boleto_charge",
    "Plan or execute an Asaas boleto charge creation through mapped session HTTP.",
    AsaasCreateBoletoChargeParamsSchema
  );
  registerIfPresent(
    registry,
    toolset.asaasMutation?.createBoletoChargeWorkflow,
    "asaas.create_boleto_charge_workflow",
    "Resolve an Asaas customer by mapped session HTTP, then plan or execute boleto creation.",
    AsaasCreateBoletoChargeWorkflowParamsSchema
  );
  registerIfPresent(
    registry,
    toolset.asaasMutation?.downloadBoletoPdf,
    "asaas.download_boleto_pdf",
    "Download an Asaas boleto PDF through mapped session HTTP.",
    AsaasDownloadBoletoPdfParamsSchema
  );
  registerIfPresent(
    registry,
    toolset.contaAzulRead?.listAccountancyClients,
    "contaazul.list_accountancy_clients",
    "List Conta Azul Mais clients through mapped session HTTP.",
    undefined
  );
  registerIfPresent(
    registry,
    toolset.contaAzulRead?.switchToProSession,
    "contaazul.switch_to_pro_session",
    "Switch a mapped Conta Azul Mais relation into a Pro session.",
    ContaAzulSwitchToProSessionParamsSchema
  );
  registerIfPresent(
    registry,
    toolset.contaAzulRead?.searchFinancialStatement,
    "contaazul.search_financial_statement",
    "Search Conta Azul Pro financial statement through mapped session HTTP.",
    ContaAzulSearchFinancialStatementParamsSchema
  );
  registerIfPresent(
    registry,
    toolset.contaAzulRead?.searchSaleCustomers,
    "contaazul.search_sale_customers",
    "Search Conta Azul Pro sale customers through mapped session HTTP.",
    ContaAzulSearchSaleCustomersParamsSchema
  );
  registerIfPresent(
    registry,
    toolset.contaAzulRead?.searchFinancialCategories,
    "contaazul.search_financial_categories",
    "Search Conta Azul Pro financial categories through mapped session HTTP.",
    ContaAzulSearchFinancialCategoriesParamsSchema
  );
  registerIfPresent(
    registry,
    toolset.contaAzulRead?.searchServiceItems,
    "contaazul.search_service_items",
    "Search Conta Azul Pro service items through mapped session HTTP.",
    ContaAzulSearchServiceItemsParamsSchema
  );
  registerIfPresent(
    registry,
    toolset.contaAzulRead?.getPersonDetails,
    "contaazul.get_person_details",
    "Load Conta Azul Pro person details for billing defaults.",
    ContaAzulGetPersonDetailsParamsSchema
  );
  registerIfPresent(
    registry,
    toolset.contaAzulMutation?.updateDueDateReissueBoleto,
    "contaazul.update_due_date_reissue_boleto",
    "Plan or execute Conta Azul due-date update and boleto reissue.",
    ContaAzulUpdateDueDateReissueBoletoParamsSchema
  );
  registerIfPresent(
    registry,
    toolset.contaAzulMutation?.updateDueDateReissueBoletoWorkflow,
    "contaazul.update_due_date_reissue_boleto_workflow",
    "Resolve Conta Azul tenant, details of installment, then plan or execute due-date update and boleto reissue.",
    ContaAzulUpdateDueDateReissueBoletoWorkflowParamsSchema
  );
  registerIfPresent(
    registry,
    toolset.contaAzulMutation?.createCustomer,
    "contaazul.create_customer",
    "Plan or execute Conta Azul customer creation.",
    ContaAzulCreateCustomerParamsSchema
  );
  registerIfPresent(
    registry,
    toolset.contaAzulMutation?.createCustomerWorkflow,
    "contaazul.create_customer_workflow",
    "Resolve Conta Azul tenant, CNPJ/CPF details, then plan or execute customer creation.",
    ContaAzulCreateCustomerWorkflowParamsSchema
  );
  registerIfPresent(
    registry,
    toolset.contaAzulMutation?.acknowledgeOrphanCleanup,
    "contaazul.acknowledge_orphan_cleanup",
    "Acknowledge manual cleanup of an orphaned Conta Azul sale before allowing a retry.",
    ContaAzulAcknowledgeOrphanCleanupParamsSchema
  );
  registerIfPresent(
    registry,
    toolset.contaAzulMutation?.createServiceSaleAndIssueBoleto,
    "contaazul.create_service_sale_and_issue_boleto",
    "Plan Conta Azul service sale, boleto issue, and notification.",
    ContaAzulCreateServiceSaleAndIssueBoletoParamsSchema
  );
  registerIfPresent(
    registry,
    toolset.contaAzulMutation?.createServiceSaleBoletoWorkflow,
    "contaazul.create_service_sale_boleto_workflow",
    "Resolve Conta Azul tenant, customer, category, service item, then plan or execute sale, boleto, notification, and PDF.",
    ContaAzulCreateServiceSaleBoletoWorkflowParamsSchema
  );
}

export async function planOrchestratorTurn(
  input: OrchestratorTurnInput
): Promise<OrchestratorTurnResult> {
  if (mentionsForbiddenOfficialIntegration(input.request)) {
    return {
      status: "blocked",
      reason:
        "Request blocked: official provider APIs, OAuth, webhooks, and provider MCPs are outside this harness boundary."
    };
  }

  const normalizedRequest = normalize(input.request);
  const params = {
    ...(input.params ?? {}),
    ...(input.approvalText ? { approvalText: input.approvalText } : {})
  };
  const routeMatch = ROUTES
    .filter((candidate) => candidate.match(normalizedRequest))
    .map((route) => ({
      route,
      missingFields: route.requiredFields.filter((field) => !hasParam(params, field))
    }))
    .sort((a, b) =>
      a.missingFields.length - b.missingFields.length ||
      b.route.priority - a.route.priority
    )[0];
  const route = routeMatch?.route;

  if (!route) {
    return {
      status: "unsupported",
      reason: "No mapped-session harness route matched this request."
    };
  }

  const missingFields = routeMatch.missingFields;

  if (missingFields.length > 0) {
    return {
      status: "needs_input",
      provider: route.provider,
      intent: route.intent,
      toolName: route.toolName,
      missingFields,
      questions: missingFields.map(questionForField)
    };
  }

  const tool = input.registry.list().find((definition) => definition.name === route.toolName);
  if (!tool) {
    return {
      status: "blocked",
      toolName: route.toolName,
      reason: `Mapped tool is not registered: ${route.toolName}`
    };
  }

  const parsedParams = tool.parameters.parse(params);
  const receipt = (await tool.execute(parsedParams)) as ToolReceipt;
  return {
    status: "executed",
    provider: route.provider,
    intent: route.intent,
    toolName: route.toolName,
    receipt
  };
}

function registerIfPresent<TParams extends z.ZodType>(
  registry: ToolRegistry,
  execute:
    | ((params: z.output<TParams>) => Promise<unknown>)
    | undefined,
  name: string,
  description: string,
  parameters: TParams | undefined
): void {
  if (!execute) return;

  if (!parameters) {
    registry.register({
      name,
      description,
      parameters: emptyParamsSchema(),
      execute: async () => execute({} as z.output<TParams>)
    });
    return;
  }

  registry.register({
    name,
    description,
    parameters,
    execute: async (params) => execute(params)
  });
}

function emptyParamsSchema(): z.ZodObject<Record<string, never>> {
  return z.object({}) as z.ZodObject<Record<string, never>>;
}

const ROUTES: Route[] = [
  {
    provider: "asaas",
    intent: "search_customers",
    toolName: "asaas.search_customers",
    requiredFields: [],
    priority: 0,
    match: (request) => hasAll(request, ["asaas", "cliente"]) && hasAny(request, ["buscar", "pesquisar", "procurar"])
  },
  {
    provider: "asaas",
    intent: "list_pending_charges",
    toolName: "asaas.list_pending_charges",
    requiredFields: ["customerId"],
    priority: 0,
    match: (request) => hasAll(request, ["asaas"]) && request.includes("pendente")
  },
  {
    provider: "asaas",
    intent: "get_charge_links",
    toolName: "asaas.get_charge_links",
    requiredFields: ["chargeId"],
    priority: 0,
    match: (request) => hasAll(request, ["asaas"]) && hasAny(request, ["link", "fatura", "boleto"])
  },
  {
    provider: "asaas",
    intent: "update_charge_due_date",
    toolName: "asaas.update_charge_due_date",
    requiredFields: ["chargeId", "dueDateBr"],
    priority: 0,
    match: (request) => hasAll(request, ["asaas"]) && hasAny(request, ["vencimento", "vencer", "alterar"])
  },
  {
    provider: "asaas",
    intent: "create_boleto_charge",
    toolName: "asaas.create_boleto_charge",
    requiredFields: ["customerId", "valueBr", "dueDateBr", "description"],
    priority: 10,
    match: (request) => hasAll(request, ["asaas", "boleto"]) && hasAny(request, ["criar", "emitir", "gerar"])
  },
  {
    provider: "asaas",
    intent: "create_boleto_charge_workflow",
    toolName: "asaas.create_boleto_charge_workflow",
    requiredFields: ["customerName", "valueBr", "dueDateBr", "description"],
    priority: 5,
    match: (request) => hasAll(request, ["asaas", "boleto"]) && hasAny(request, ["criar", "emitir", "gerar"])
  },
  {
    provider: "contaazul",
    intent: "list_accountancy_clients",
    toolName: "contaazul.list_accountancy_clients",
    requiredFields: [],
    priority: 0,
    match: (request) => hasAll(request, ["conta azul"]) && hasAny(request, ["clientes", "empresas"])
  },
  {
    provider: "contaazul",
    intent: "switch_to_pro_session",
    toolName: "contaazul.switch_to_pro_session",
    requiredFields: ["relationId"],
    priority: 0,
    match: (request) => hasAll(request, ["conta azul"]) && hasAny(request, ["sessao", "pro"])
  },
  {
    provider: "contaazul",
    intent: "search_financial_statement",
    toolName: "contaazul.search_financial_statement",
    requiredFields: ["relationId"],
    priority: 0,
    match: (request) => hasAll(request, ["conta azul"]) && hasAny(request, ["extrato", "lancamento", "movimentacao"])
  },
  {
    provider: "contaazul",
    intent: "update_due_date_reissue_boleto",
    toolName: "contaazul.update_due_date_reissue_boleto",
    requiredFields: [
      "relationId",
      "financialEventId",
      "installmentId",
      "dueDateIso",
      "email",
      "value",
      "originalDescription",
      "installmentVersion",
      "installmentIndex"
    ],
    priority: 0,
    match: (request) =>
      hasAll(request, ["conta azul"]) &&
      hasAny(request, ["reemitir", "vencimento"])
  },
  {
    provider: "contaazul",
    intent: "create_customer",
    toolName: "contaazul.create_customer",
    requiredFields: ["relationId", "person"],
    priority: 0,
    match: (request) => hasAll(request, ["conta azul", "cliente"]) && hasAny(request, ["cadastrar", "criar"])
  },
  {
    provider: "contaazul",
    intent: "create_customer_workflow",
    toolName: "contaazul.create_customer_workflow",
    requiredFields: ["tenantId", "personType", "document"],
    priority: 10,
    match: (request) =>
      hasAll(request, ["conta azul", "cliente"]) &&
      hasAny(request, ["cadastrar", "criar", "novo", "nova"])
  },
  {
    provider: "contaazul",
    intent: "acknowledge_orphan_cleanup",
    toolName: "contaazul.acknowledge_orphan_cleanup",
    requiredFields: ["previousOperationId", "orphanedSaleId", "cleanupAction"],
    priority: 20,
    match: (request) =>
      hasAll(request, ["conta azul"]) &&
      hasAny(request, ["orfa", "orfao", "cleanup", "limpeza", "cancelada", "cancelado", "reconhecer"])
  },
  {
    provider: "contaazul",
    intent: "create_service_sale_boleto_workflow",
    toolName: "contaazul.create_service_sale_boleto_workflow",
    requiredFields: [
      "tenantId",
      "customerName",
      "categoryName",
      "itemName",
      "serviceDescription",
      "unitValueOrBr",
      "dueDateIsoOrBr",
      "notification"
    ],
    priority: 5,
    match: (request) =>
      hasAll(request, ["conta azul"]) &&
      hasAny(request, ["venda", "servico", "servico"]) &&
      hasAny(request, ["boleto", "cobranca", "fatura"])
  },
  {
    provider: "contaazul",
    intent: "create_service_sale_and_issue_boleto",
    toolName: "contaazul.create_service_sale_and_issue_boleto",
    requiredFields: [
      "relationId",
      "customerId",
      "customerName",
      "categoryId",
      "serviceItemId",
      "serviceDescription",
      "unitValue",
      "dueDateIso",
      "saleDateIso",
      "saleNumber",
      "operationNatureId",
      "notification"
    ],
    priority: 10,
    match: (request) =>
      hasAll(request, ["conta azul"]) &&
      hasAny(request, ["venda", "servico", "servico"]) &&
      hasAny(request, ["boleto", "cobranca", "fatura"])
  }
];

function mentionsForbiddenOfficialIntegration(request: string): boolean {
  const normalized = normalize(request);
  return (
    normalized.includes("oauth") ||
    normalized.includes("asaas_mcp") ||
    normalized.includes("contaazul_mcp") ||
    normalized.includes("official") ||
    (normalized.includes("oficial") &&
      hasAny(normalized, ["api", "webhook", "mcp", "oauth"]))
  );
}

function hasParam(params: Record<string, unknown>, field: string): boolean {
  if (field === "unitValueOrBr") {
    return hasParam(params, "unitValue") || hasParam(params, "unitValueBr");
  }
  if (field === "dueDateIsoOrBr") {
    return hasParam(params, "dueDateIso") || hasParam(params, "dueDateBr");
  }

  const value = params[field];
  if (typeof value === "string") return value.trim().length > 0;
  return value !== undefined && value !== null;
}

function questionForField(field: string): string {
  if (field === "unitValueOrBr") return "Informe o valor unitario em numero ou formato BR.";
  if (field === "dueDateIsoOrBr") return "Informe o vencimento em ISO ou formato dd/mm/aaaa.";
  const questions: Record<string, string> = {
    tenantId: "Qual e o tenant/empresa do Conta Azul Mais?",
    relationId: "Qual e a relacao/empresa Conta Azul que deve ser usada?",
    customerId: "Qual e o ID do cliente ja resolvido no provedor?",
    customerName: "Qual e o nome do cliente?",
    categoryId: "Qual e o ID da categoria financeira?",
    categoryName: "Qual e o nome da categoria financeira?",
    serviceItemId: "Qual e o ID do item de servico?",
    itemName: "Qual e o nome do item de servico?",
    serviceDescription: "Qual descricao deve aparecer no item/servico?",
    unitValue: "Qual e o valor unitario?",
    valueBr: "Qual e o valor em formato BR?",
    dueDateIso: "Qual e o vencimento no formato aaaa-mm-dd?",
    dueDateBr: "Qual e o vencimento no formato dd/mm/aaaa?",
    saleDateIso: "Qual e a data da venda no formato aaaa-mm-dd?",
    saleNumber: "Qual numero de venda deve ser usado?",
    operationNatureId: "Qual e o ID da natureza de operacao?",
    previousOperationId: "Qual operationId da falha parcial deve ser liberado?",
    orphanedSaleId: "Qual saleId da venda orfa foi tratado manualmente?",
    cleanupAction: "A venda orfa foi cancelada ou verificada como nao criada?",
    notification: "Quais dados de notificacao devo usar: email, telefone, replyTo e nome exibido?",
    person: "Quais dados completos do cliente devem ser cadastrados?",
    chargeId: "Qual e o ID da cobranca?",
    description: "Qual descricao deve ser usada?"
  };
  return questions[field] ?? `Informe o campo obrigatorio: ${field}.`;
}

function hasAll(request: string, terms: string[]): boolean {
  return terms.every((term) => request.includes(normalize(term)));
}

function hasAny(request: string, terms: string[]): boolean {
  return terms.some((term) => request.includes(normalize(term)));
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

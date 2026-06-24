import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import { z } from "zod";

import { saveBinaryArtifact, saveJsonArtifact } from "../../core/artifacts.js";
import { parseApprovalText } from "../../core/approval.js";
import { assertLiveMutationAllowed, MutationBlockedError } from "../../core/dry-run.js";
import { appendLedgerEntry, readLedgerEntries, type LedgerEntry } from "../../core/ledger.js";
import type {
  AccountancyClient,
  ApprovalPreview,
  Artifact,
  FinancialStatementItem,
  RuntimeMode,
  ToolReceipt
} from "../../core/tool-types.js";
import { redact } from "../../core/redaction.js";
import {
  ContaAzulSessionExpiredError,
  type ContaAzulMutationClient,
  type ContaAzulReadClient
} from "./client.js";
import {
  mergeCepLookupIntoPrefill,
  normalizeCnpjCompanyInfo,
  type CustomerCnpjPrefill
} from "./cnpj-prefill.js";
import { parseAccountancyClients, parseFinancialStatementItems } from "./parsers.js";

const optionalEmailField = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().email().optional()
);

export class AmbiguityError extends Error {
  constructor(
    message: string,
    public readonly candidates: string[],
    public readonly fieldName: string
  ) {
    super(message);
    this.name = "AmbiguityError";
  }
}


const LIST_ACCOUNTANCY_CLIENTS_TOOL = "contaazul.list_accountancy_clients";
const SWITCH_TO_PRO_SESSION_TOOL = "contaazul.switch_to_pro_session";
const SEARCH_FINANCIAL_STATEMENT_TOOL = "contaazul.search_financial_statement";
const SEARCH_SALE_CUSTOMERS_TOOL = "contaazul.search_sale_customers";
const SEARCH_FINANCIAL_CATEGORIES_TOOL = "contaazul.search_financial_categories";
const SEARCH_SERVICE_ITEMS_TOOL = "contaazul.search_service_items";
const GET_PERSON_DETAILS_TOOL = "contaazul.get_person_details";
const LOOKUP_CNPJ_TOOL = "contaazul.lookup_cnpj";
const LOOKUP_CEP_TOOL = "contaazul.lookup_cep";
/** Legacy default mirrored from contaazul/interativo.js */
const CONTAAZUL_LEGACY_FINANCIAL_ACCOUNT_ID = "cf6eedce-10e8-4554-b707-9246826b12c6";
const UPDATE_DUE_DATE_REISSUE_BOLETO_TOOL = "contaazul.update_due_date_reissue_boleto";
const UPDATE_DUE_DATE_REISSUE_BOLETO_WORKFLOW_TOOL = "contaazul.update_due_date_reissue_boleto_workflow";
const CREATE_CUSTOMER_TOOL = "contaazul.create_customer";
const CREATE_CUSTOMER_WORKFLOW_TOOL = "contaazul.create_customer_workflow";
const ACKNOWLEDGE_ORPHAN_CLEANUP_TOOL = "contaazul.acknowledge_orphan_cleanup";
const CREATE_SERVICE_SALE_AND_ISSUE_BOLETO_TOOL =
  "contaazul.create_service_sale_and_issue_boleto";
const CREATE_SERVICE_SALE_BOLETO_WORKFLOW_TOOL =
  "contaazul.create_service_sale_boleto_workflow";
const REDACTED_SECRET = "[REDACTED_SECRET]";
const SERVICES_BASE_URL = "https://services.contaazul.com";
const BATCH_CANCEL_URL = `${SERVICES_BASE_URL}/finance-pro/v1/charge-requests/batch-cancel`;
const BATCH_CREATE_URL = `${SERVICES_BASE_URL}/finance-pro/v2/charge-requests/batch-create`;
const PERSON_CREATE_URL = `${SERVICES_BASE_URL}/contaazul-bff/person-registration/v1/persons`;
const SALE_CREATE_URL = `${SERVICES_BASE_URL}/app/v1/sales/`;
const CHARGE_NOTIFICATION_URL = `${SERVICES_BASE_URL}/finance-pro/v1/charge-notifications`;

export const ContaAzulSwitchToProSessionParamsSchema = z.object({
  relationId: z.string().min(1)
});

export const ContaAzulSearchFinancialStatementParamsSchema = z.object({
  relationId: z.string().min(1),
  query: z.string().optional()
});

export const ContaAzulSearchSaleCustomersParamsSchema = z
  .object({
    relationId: z.string().min(1),
    searchTerm: z.string().optional(),
    listAll: z.boolean().optional()
  })
  .refine((data) => data.listAll === true || (data.searchTerm?.length ?? 0) >= 1, {
    message: "searchTerm is required unless listAll is true"
  });

export const ContaAzulSearchFinancialCategoriesParamsSchema = z
  .object({
    relationId: z.string().min(1),
    searchTerm: z.string().optional(),
    listAll: z.boolean().optional()
  })
  .refine((data) => data.listAll === true || (data.searchTerm?.length ?? 0) >= 1, {
    message: "searchTerm is required unless listAll is true"
  });

export const ContaAzulSearchServiceItemsParamsSchema = z
  .object({
    relationId: z.string().min(1),
    searchTerm: z.string().optional(),
    listAll: z.boolean().optional()
  })
  .refine((data) => data.listAll === true || (data.searchTerm?.length ?? 0) >= 1, {
    message: "searchTerm is required unless listAll is true"
  });

export const ContaAzulGetPersonDetailsParamsSchema = z.object({
  relationId: z.string().min(1),
  personUuid: z.string().min(1)
});

export const ContaAzulLookupCnpjParamsSchema = z.object({
  relationId: z.string().min(1),
  cnpj: z.string().min(1)
});

export const ContaAzulLookupCepParamsSchema = z.object({
  cep: z.string().min(1)
});

const ApprovalFieldsSchema = z.object({
  operationId: z.string().optional(),
  approvalText: z.string().optional()
});

export const ContaAzulUpdateDueDateReissueBoletoParamsSchema = ApprovalFieldsSchema.extend({
  relationId: z.string().min(1),
  financialEventId: z.string().min(1),
  installmentId: z.string().min(1),
  dueDateIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  email: z.string().email(),
  value: z.number(),
  originalDescription: z.string().min(1),
  installmentVersion: z.number().int().nonnegative(),
  installmentIndex: z.number().int().positive(),
  activeChargeRequests: z.array(z.unknown()).optional(),
  financialAccountId: z.string().optional(),
  customerName: z.string().optional()
});

export const ContaAzulUpdateDueDateReissueBoletoWorkflowParamsSchema = ApprovalFieldsSchema.extend({
  tenantId: z.union([z.string().min(1), z.number()]),
  financialEventId: z.string().min(1),
  installmentId: z.string().min(1),
  dueDateIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  email: z.string().email().optional(),
  financialAccountId: z.string().optional(),
  customerName: z.string().optional()
});

const ContaAzulAddressSchema = z
  .object({
    zipcode: z.string(),
    neighborhood: z.string(),
    numberAddress: z.string(),
    state: z.string(),
    city: z.union([z.string(), z.number()]),
    address: z.string(),
    complement: z.string().optional(),
    country: z.string(),
    idCity: z.union([z.string(), z.number()])
  })
  .passthrough();

export const ContaAzulCreateCustomerParamsSchema = ApprovalFieldsSchema.extend({
  relationId: z.string().min(1),
  person: z.object({
    personType: z.string().min(1),
    legalDocument: z.string().optional().default(""),
    naturalDocument: z.string().optional().default(""),
    name: z.string().min(1),
    companyName: z.string().optional().default(""),
    birthDate: z.string().optional().default(""),
    email: z.string().optional().default(""),
    commercialPhone: z.string().optional().default(""),
    cellPhone: z.string().optional().default(""),
    billingEmail: z.string().min(1),
    billingPhone: z.string().min(1),
    address: ContaAzulAddressSchema
  })
});

export const ContaAzulCreateCustomerWorkflowParamsSchema = ApprovalFieldsSchema.extend({
  tenantId: z.union([z.string().min(1), z.number()]),
  personType: z.enum(["Física", "Jurídica"]),
  document: z.string().min(1),
  name: z.string().optional(),
  companyName: z.string().optional(),
  email: z.string().optional(),
  commercialPhone: z.string().optional(),
  cellPhone: z.string().optional(),
  zipcode: z.string().optional(),
  street: z.string().optional(),
  numberAddress: z.string().optional(),
  neighborhood: z.string().optional(),
  complement: z.string().optional(),
  billingEmail: z.string().optional(),
  billingPhone: z.string().optional(),
  createBoleto: z.boolean().optional().default(false)
});


export const ContaAzulAcknowledgeOrphanCleanupParamsSchema = ApprovalFieldsSchema.extend({
  previousOperationId: z.string().min(1),
  orphanedSaleId: z.string().min(1),
  cleanupAction: z.enum(["cancelled", "verified_not_created"]),
  notes: z.string().optional()
});

export const ContaAzulCreateServiceSaleAndIssueBoletoParamsSchema = ApprovalFieldsSchema.extend({
  relationId: z.string().min(1),
  customerId: z.string().min(1),
  customerName: z.string().min(1),
  categoryId: z.string().min(1),
  serviceItemId: z.string().min(1),
  serviceDescription: z.string().min(1),
  unitValue: z.number(),
  dueDateIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  saleDateIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  saleNumber: z.number().int().positive(),
  operationNatureId: z.string().min(1),
  financialAccountId: z.string().optional(),
  idempotencyKey: z.string().min(1).optional(),
  notification: z.object({
    email: z.string().email(),
    phone: z.string().optional(),
    replyTo: optionalEmailField,
    companyDisplayName: z.string().optional()
  })
});

export const ContaAzulCreateServiceSaleBoletoWorkflowParamsSchema = ApprovalFieldsSchema.extend({
  tenantId: z.union([z.string().min(1), z.number()]),
  customerName: z.string().min(1),
  categoryName: z.string().min(1),
  itemName: z.string().min(1),
  serviceDescription: z.string().min(1),
  unitValue: z.number().positive().optional(),
  unitValueBr: z.string().min(1).optional(),
  dueDateIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueDateBr: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/).optional(),
  saleDateIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  saleNumber: z.number().int().positive().optional(),
  financialAccountId: z.string().optional(),
  idempotencyKey: z.string().min(1).optional(),
  notification: z.object({
    email: z.string().email(),
    phone: z.string().optional(),
    replyTo: optionalEmailField,
    companyDisplayName: z.string().optional()
  })
}).superRefine((value, context) => {
  if (value.unitValue === undefined && !value.unitValueBr) {
    context.addIssue({
      code: "custom",
      path: ["unitValue"],
      message: "unitValue or unitValueBr is required."
    });
  }
  if (!value.dueDateIso && !value.dueDateBr) {
    context.addIssue({
      code: "custom",
      path: ["dueDateIso"],
      message: "dueDateIso or dueDateBr is required."
    });
  }
});

export type ContaAzulSwitchToProSessionParams = z.input<
  typeof ContaAzulSwitchToProSessionParamsSchema
>;
export type ContaAzulSearchFinancialStatementParams = z.input<
  typeof ContaAzulSearchFinancialStatementParamsSchema
>;
export type ContaAzulSearchSaleCustomersParams = z.input<
  typeof ContaAzulSearchSaleCustomersParamsSchema
>;
export type ContaAzulSearchFinancialCategoriesParams = z.input<
  typeof ContaAzulSearchFinancialCategoriesParamsSchema
>;
export type ContaAzulSearchServiceItemsParams = z.input<
  typeof ContaAzulSearchServiceItemsParamsSchema
>;
export type ContaAzulUpdateDueDateReissueBoletoParams = z.input<
  typeof ContaAzulUpdateDueDateReissueBoletoParamsSchema
>;
export type ContaAzulCreateCustomerParams = z.input<typeof ContaAzulCreateCustomerParamsSchema>;
export type ContaAzulAcknowledgeOrphanCleanupParams = z.input<
  typeof ContaAzulAcknowledgeOrphanCleanupParamsSchema
>;
export type ContaAzulCreateServiceSaleAndIssueBoletoParams = z.input<
  typeof ContaAzulCreateServiceSaleAndIssueBoletoParamsSchema
>;
export type ContaAzulCreateServiceSaleBoletoWorkflowParams = z.input<
  typeof ContaAzulCreateServiceSaleBoletoWorkflowParamsSchema
>;

export type ContaAzulSwitchSessionReceipt = {
  relationId: string;
  proSessionId: string;
  authToken: typeof REDACTED_SECRET;
};

export type ContaAzulReadTools = {
  listAccountancyClients(): Promise<ToolReceipt<AccountancyClient[]>>;
  switchToProSession(
    params: ContaAzulSwitchToProSessionParams
  ): Promise<ToolReceipt<ContaAzulSwitchSessionReceipt>>;
  searchFinancialStatement(
    params: ContaAzulSearchFinancialStatementParams
  ): Promise<ToolReceipt<FinancialStatementItem[]>>;
  searchSaleCustomers(
    params: ContaAzulSearchSaleCustomersParams
  ): Promise<ToolReceipt<unknown[]>>;
  searchFinancialCategories(
    params: ContaAzulSearchFinancialCategoriesParams
  ): Promise<ToolReceipt<unknown[]>>;
  searchServiceItems(
    params: ContaAzulSearchServiceItemsParams
  ): Promise<ToolReceipt<unknown[]>>;
  getPersonDetails(
    params: z.infer<typeof ContaAzulGetPersonDetailsParamsSchema>
  ): Promise<ToolReceipt<Record<string, unknown>>>;
  lookupCnpj(
    params: z.infer<typeof ContaAzulLookupCnpjParamsSchema>
  ): Promise<ToolReceipt<CustomerCnpjPrefill>>;
  lookupCep(
    params: z.infer<typeof ContaAzulLookupCepParamsSchema>
  ): Promise<ToolReceipt<CustomerCnpjPrefill>>;
};

export type ContaAzulPlannedMappedRequest = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  url: string;
  payload?: unknown;
};

export type ContaAzulPollingPlan = {
  url: string;
  maxAttempts: number;
  delayMs: number;
};

export type ContaAzulMutationPlan = {
  approvalPreview: ApprovalPreview;
  plannedRequests: ContaAzulPlannedMappedRequest[];
  pollingPlan?: ContaAzulPollingPlan;
  result?: unknown;
  resolved?: unknown;
  idempotencyKey?: string;
};

export type ContaAzulCreateCustomerWorkflowParams = z.input<
  typeof ContaAzulCreateCustomerWorkflowParamsSchema
>;

export type ContaAzulUpdateDueDateReissueBoletoWorkflowParams = z.input<
  typeof ContaAzulUpdateDueDateReissueBoletoWorkflowParamsSchema
>;

export type ContaAzulMutationTools = {
  updateDueDateReissueBoleto(
    params: ContaAzulUpdateDueDateReissueBoletoParams
  ): Promise<ToolReceipt<ContaAzulMutationPlan>>;
  updateDueDateReissueBoletoWorkflow(
    params: ContaAzulUpdateDueDateReissueBoletoWorkflowParams
  ): Promise<ToolReceipt<ContaAzulMutationPlan>>;
  createCustomer(
    params: ContaAzulCreateCustomerParams
  ): Promise<ToolReceipt<ContaAzulMutationPlan>>;
  createCustomerWorkflow(
    params: ContaAzulCreateCustomerWorkflowParams
  ): Promise<ToolReceipt<any>>;
  acknowledgeOrphanCleanup(
    params: ContaAzulAcknowledgeOrphanCleanupParams
  ): Promise<ToolReceipt<ContaAzulMutationPlan>>;
  createServiceSaleAndIssueBoleto(
    params: ContaAzulCreateServiceSaleAndIssueBoletoParams
  ): Promise<ToolReceipt<ContaAzulMutationPlan>>;
  createServiceSaleBoletoWorkflow(
    params: ContaAzulCreateServiceSaleBoletoWorkflowParams
  ): Promise<ToolReceipt<ContaAzulMutationPlan>>;
};

export type CreateContaAzulReadToolsOptions = {
  client: ContaAzulReadClient;
  ledgerPath: string;
  runtimeMode?: RuntimeMode;
  proSessionStore?: Map<string, string>;
  operationIdFactory?: (toolName: string) => string;
};

export type ContaAzulMutationConfig = {
  financialAccountId: string;
  defaultReplyToEmail: string;
  defaultCompanyDisplayName: string;
};

export type CreateContaAzulMutationToolsOptions = {
  client: ContaAzulMutationClient;
  ledgerPath: string;
  artifactsDir: string;
  runtimeMode?: RuntimeMode;
  allowLiveMutations?: boolean;
  config: ContaAzulMutationConfig;
  proSessionStore?: Map<string, string>;
  operationIdFactory?: (toolName: string) => string;
};

export function createContaAzulReadTools(
  options: CreateContaAzulReadToolsOptions
): ContaAzulReadTools {
  const runtimeMode = options.runtimeMode ?? "dry-run";
  const createOperationId = options.operationIdFactory ?? defaultOperationId;
  const proSessions = options.proSessionStore ?? new Map<string, string>();

  return {
    async listAccountancyClients() {
      const operationId = createOperationId(LIST_ACCOUNTANCY_CLIENTS_TOOL);

      try {
        const raw = await options.client.listAccountancyClients();
        const data = parseAccountancyClients(raw);
        return writeReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: LIST_ACCOUNTANCY_CLIENTS_TOOL,
          status: "succeeded",
          summary: `Encontrados ${data.length} cliente(s) no Conta Azul Mais.`,
          args: {},
          data,
          responseSummary: { itemCount: data.length }
        });
      } catch (error) {
        return writeErrorReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: LIST_ACCOUNTANCY_CLIENTS_TOOL,
          args: {},
          error
        });
      }
    },

    async switchToProSession(rawParams) {
      const params = ContaAzulSwitchToProSessionParamsSchema.parse(rawParams);
      const operationId = createOperationId(SWITCH_TO_PRO_SESSION_TOOL);

      try {
        const session = await options.client.switchToProSession(params.relationId);
        proSessions.set(params.relationId, session.authToken);

        const data: ContaAzulSwitchSessionReceipt = {
          relationId: params.relationId,
          proSessionId: `relation:${params.relationId}`,
          authToken: REDACTED_SECRET
        };

        return writeReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: SWITCH_TO_PRO_SESSION_TOOL,
          status: "succeeded",
          summary: "Sessao Pro do Conta Azul preparada para a relacao selecionada.",
          args: params,
          data,
          responseSummary: data
        });
      } catch (error) {
        return writeErrorReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: SWITCH_TO_PRO_SESSION_TOOL,
          args: params,
          error
        });
      }
    },

    async searchFinancialStatement(rawParams) {
      const params = ContaAzulSearchFinancialStatementParamsSchema.parse(rawParams);
      const operationId = createOperationId(SEARCH_FINANCIAL_STATEMENT_TOOL);
      const authToken = proSessions.get(params.relationId);

      if (!authToken) {
        const warning =
          "Conta Azul Pro session is not available. Run switchToProSession for this relation first.";
        return writeReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: SEARCH_FINANCIAL_STATEMENT_TOOL,
          status: "blocked",
          summary: warning,
          args: params,
          data: [],
          warnings: [warning],
          responseSummary: { blocked: true, reason: warning }
        });
      }

      try {
        const rawItems = await options.client.searchFinancialStatement({
          authToken,
          query: params.query,
          pageSize: 100
        });
        const data = parseFinancialStatementItems(rawItems);

        return writeReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: SEARCH_FINANCIAL_STATEMENT_TOOL,
          status: "succeeded",
          summary: `Encontrados ${data.length} lancamento(s) no extrato Conta Azul.`,
          args: params,
          data,
          responseSummary: { itemCount: data.length }
        });
      } catch (error) {
        return writeErrorReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: SEARCH_FINANCIAL_STATEMENT_TOOL,
          args: params,
          error
        });
      }
    },

    async searchSaleCustomers(rawParams) {
      const params = ContaAzulSearchSaleCustomersParamsSchema.parse(rawParams);
      const operationId = createOperationId(SEARCH_SALE_CUSTOMERS_TOOL);
      const authToken = proSessions.get(params.relationId);

      const blocked = await blockIfReadProSessionMissing(
        {
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: SEARCH_SALE_CUSTOMERS_TOOL,
          args: params,
          authToken
        },
        []
      );
      if (blocked) return blocked;

      try {
        const data = params.listAll
          ? await options.client.listSaleCustomers({
              authToken: authToken!,
              searchTerm: params.searchTerm
            })
          : await options.client.searchSaleCustomers({
              authToken: authToken!,
              searchTerm: params.searchTerm!
            });
        return writeReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: SEARCH_SALE_CUSTOMERS_TOOL,
          status: "succeeded",
          summary: `Encontrados ${data.length} cliente(s) no Conta Azul.`,
          args: params,
          data,
          responseSummary: { itemCount: data.length }
        });
      } catch (error) {
        return writeErrorReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: SEARCH_SALE_CUSTOMERS_TOOL,
          args: params,
          error
        });
      }
    },

    async searchFinancialCategories(rawParams) {
      const params = ContaAzulSearchFinancialCategoriesParamsSchema.parse(rawParams);
      const operationId = createOperationId(SEARCH_FINANCIAL_CATEGORIES_TOOL);
      const authToken = proSessions.get(params.relationId);

      const blocked = await blockIfReadProSessionMissing(
        {
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: SEARCH_FINANCIAL_CATEGORIES_TOOL,
          args: params,
          authToken
        },
        []
      );
      if (blocked) return blocked;

      try {
        const data = params.listAll
          ? await options.client.listFinancialCategories({
              authToken: authToken!,
              searchTerm: params.searchTerm
            })
          : await options.client.searchFinancialCategories({
              authToken: authToken!,
              searchTerm: params.searchTerm!
            });
        return writeReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: SEARCH_FINANCIAL_CATEGORIES_TOOL,
          status: "succeeded",
          summary: `Encontradas ${data.length} categoria(s) financeira(s) no Conta Azul.`,
          args: params,
          data,
          responseSummary: { itemCount: data.length }
        });
      } catch (error) {
        return writeErrorReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: SEARCH_FINANCIAL_CATEGORIES_TOOL,
          args: params,
          error
        });
      }
    },

    async searchServiceItems(rawParams) {
      const params = ContaAzulSearchServiceItemsParamsSchema.parse(rawParams);
      const operationId = createOperationId(SEARCH_SERVICE_ITEMS_TOOL);
      const authToken = proSessions.get(params.relationId);

      const blocked = await blockIfReadProSessionMissing(
        {
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: SEARCH_SERVICE_ITEMS_TOOL,
          args: params,
          authToken
        },
        []
      );
      if (blocked) return blocked;

      try {
        const data = params.listAll
          ? await options.client.listServiceItems({
              authToken: authToken!,
              searchTerm: params.searchTerm
            })
          : await options.client.searchServiceItems({
              authToken: authToken!,
              searchTerm: params.searchTerm!
            });
        return writeReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: SEARCH_SERVICE_ITEMS_TOOL,
          status: "succeeded",
          summary: `Encontrados ${data.length} item(ns) de servico no Conta Azul.`,
          args: params,
          data,
          responseSummary: { itemCount: data.length }
        });
      } catch (error) {
        return writeErrorReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: SEARCH_SERVICE_ITEMS_TOOL,
          args: params,
          error
        });
      }
    },

    async getPersonDetails(rawParams) {
      const skipRedaction = asRecord(rawParams)?.__skipDataRedaction === true;
      const params = ContaAzulGetPersonDetailsParamsSchema.parse(rawParams);
      const operationId = createOperationId(GET_PERSON_DETAILS_TOOL);
      const authToken = proSessions.get(params.relationId);

      const blocked = await blockIfReadProSessionMissing(
        {
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: GET_PERSON_DETAILS_TOOL,
          args: params,
          authToken
        },
        {}
      );
      if (blocked) return blocked;

      try {
        const data = asRecord(
          await options.client.getPersonDetails({
            authToken: authToken!,
            personUuid: params.personUuid
          })
        ) ?? {};
        return writeReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: GET_PERSON_DETAILS_TOOL,
          status: "succeeded",
          summary: "Detalhes do cliente carregados no Conta Azul.",
          args: params,
          data,
          redactData: !skipRedaction,
          responseSummary: {
            personUuid: params.personUuid,
            name: stringField(data, "name")
          }
        });
      } catch (error) {
        return writeErrorReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: GET_PERSON_DETAILS_TOOL,
          args: params,
          error
        });
      }
    },

    async lookupCnpj(rawParams) {
      const params = ContaAzulLookupCnpjParamsSchema.parse(rawParams);
      const operationId = createOperationId(LOOKUP_CNPJ_TOOL);
      const authToken = proSessions.get(params.relationId);

      if (!authToken) {
        const warning =
          "Conta Azul Pro session is not available. Run switchToProSession for this relation first.";
        return writeReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: LOOKUP_CNPJ_TOOL,
          status: "blocked",
          summary: warning,
          args: params,
          data: {},
          warnings: [warning],
          responseSummary: { blocked: true, reason: warning }
        });
      }

      try {
        const raw = asRecord(
          await options.client.lookupCnpj({
            authToken,
            cnpj: params.cnpj
          })
        );
        if (!raw) {
          return writeReceipt({
            ledgerPath: options.ledgerPath,
            operationId,
            runtimeMode,
            toolName: LOOKUP_CNPJ_TOOL,
            status: "failed",
            summary: "Nenhum dado retornado para este CNPJ.",
            args: params,
            data: {}
          });
        }
        const data = normalizeCnpjCompanyInfo(raw);
        return writeReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: LOOKUP_CNPJ_TOOL,
          status: "succeeded",
          summary: data.name
            ? `Dados encontrados para ${data.name}.`
            : "Dados do CNPJ recuperados com sucesso.",
          args: params,
          data,
          redactData: false,
          responseSummary: {
            name: data.name,
            companyName: data.companyName,
            zipcode: data.zipcode
          }
        });
      } catch (error) {
        return writeErrorReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: LOOKUP_CNPJ_TOOL,
          args: params,
          error
        });
      }
    },

    async lookupCep(rawParams) {
      const params = ContaAzulLookupCepParamsSchema.parse(rawParams);
      const operationId = createOperationId(LOOKUP_CEP_TOOL);

      try {
        const raw = asRecord(await options.client.lookupCep({ cep: params.cep }));
        if (!raw) {
          return writeReceipt({
            ledgerPath: options.ledgerPath,
            operationId,
            runtimeMode,
            toolName: LOOKUP_CEP_TOOL,
            status: "failed",
            summary: "Nenhum dado retornado para este CEP.",
            args: params,
            data: {}
          });
        }
        const data = mergeCepLookupIntoPrefill({}, raw);
        return writeReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: LOOKUP_CEP_TOOL,
          status: "succeeded",
          summary: "Endereço do CEP recuperado com sucesso.",
          args: params,
          data,
          redactData: false,
          responseSummary: {
            idCity: data.idCity,
            cityName: data.cityName
          }
        });
      } catch (error) {
        return writeErrorReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: LOOKUP_CEP_TOOL,
          args: params,
          error
        });
      }
    }
  };
}

export function createContaAzulMutationTools(
  options: CreateContaAzulMutationToolsOptions
): ContaAzulMutationTools {
  const runtimeMode = options.runtimeMode ?? "dry-run";
  const allowLiveMutations = options.allowLiveMutations === true;
  const createOperationId = options.operationIdFactory ?? defaultOperationId;
  const proSessions = options.proSessionStore ?? new Map<string, string>();

  return {
    async updateDueDateReissueBoletoWorkflow(rawParams) {
      const params = ContaAzulUpdateDueDateReissueBoletoWorkflowParamsSchema.parse(rawParams);
      const operationId = params.operationId ?? createOperationId(UPDATE_DUE_DATE_REISSUE_BOLETO_WORKFLOW_TOOL);

      try {
        const accountancyClients = parseAccountancyClients(await options.client.listAccountancyClients());
        const accountancyClient = pickByField({
          label: "Conta Azul Mais tenant",
          items: accountancyClients,
          expected: String(params.tenantId),
          field: (item) => `${item.tenantId} | ${item.name}`
        });

        const session = await options.client.switchToProSession(accountancyClient.relationId);
        proSessions.set(accountancyClient.relationId, session.authToken);

        // Fetch details of the financial event
        const detalhes = (await options.client.getFinancialEventDetails({
          authToken: session.authToken,
          financialEventId: params.financialEventId
        })) as any;

        const targetInstallmentId = params.installmentId;
        const installment = (detalhes.paymentCondition?.installments || []).find(
          (i: any) => i.id === targetInstallmentId
        );

        if (!installment) {
          throw new Error(`Parcela ${params.installmentId} não encontrada nos detalhes do lançamento.`);
        }

        const installmentVersion = installment.version;
        const installmentIndex = installment.index || 1;
        const value = installment.value || detalhes.value;
        const originalDescription = detalhes.description || detalhes.categoryName || "";
        const activeChargeRequests = (installment.chargeRequests || []).filter(
          (c: any) => c.status !== "CANCELED"
        );
        const financialAccountId = resolveFinancialAccountId(
          params.financialAccountId,
          options.config.financialAccountId,
          typeof installment.financialAccount?.id === "string"
            ? installment.financialAccount.id
            : undefined
        );

        let email = params.email;
        if (!email) {
          try {
            const billingInfo = (await options.client.getBillingContact({
              authToken: session.authToken,
              personId: detalhes.negotiatorId
            })) as any;
            email = billingInfo.emails?.[0] || detalhes.negotiator?.email || "";
          } catch (err) {
            email = detalhes.negotiator?.email || "";
          }
        }

        if (!email) {
          throw new Error("O e-mail para envio da cobrança é obrigatório e não foi encontrado no cadastro do cliente.");
        }

        const nestedTools = createContaAzulMutationTools({
          ...options,
          proSessionStore: proSessions,
          operationIdFactory: () => operationId
        });

        const receipt = await nestedTools.updateDueDateReissueBoleto({
          relationId: accountancyClient.relationId,
          financialEventId: params.financialEventId,
          installmentId: params.installmentId,
          dueDateIso: params.dueDateIso,
          email,
          value,
          originalDescription,
          installmentVersion,
          installmentIndex,
          activeChargeRequests,
          financialAccountId,
          customerName:
            stringValue(params.customerName) ?? stringValue(detalhes.negotiator?.name) ?? undefined,
          approvalText: params.approvalText
        });

        return {
          ...receipt,
          toolName: UPDATE_DUE_DATE_REISSUE_BOLETO_WORKFLOW_TOOL,
          summary: `Workflow de alteração de vencimento resolvido. ${receipt.summary}`,
          data: receipt.data
        };
      } catch (error) {
        return writeErrorReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: UPDATE_DUE_DATE_REISSUE_BOLETO_WORKFLOW_TOOL,
          args: params,
          error
        });
      }
    },

    async updateDueDateReissueBoleto(rawParams) {
      const params = ContaAzulUpdateDueDateReissueBoletoParamsSchema.parse(rawParams);
      const operationId =
        params.operationId ?? createOperationId(UPDATE_DUE_DATE_REISSUE_BOLETO_TOOL);
      const activeChargeRequests = params.activeChargeRequests ?? [];
      const financialAccountId =
        params.financialAccountId ?? options.config.financialAccountId;
      const chargePayload = buildChargeRequestPayload({
        financialAccountId,
        installmentId: params.installmentId,
        installmentVersion: params.installmentVersion,
        originalDescription: params.originalDescription,
        dueDateIso: params.dueDateIso,
        value: params.value,
        index: params.installmentIndex,
        email: params.email,
        smsNumbers: [],
        whatsappNumbers: []
      });
      const plannedRequests = buildReissuePlannedRequests({
        activeChargeRequests,
        installmentId: params.installmentId,
        dueDateIso: params.dueDateIso,
        installmentVersion: params.installmentVersion,
        chargePayload
      });
      const approvalPreview: ApprovalPreview = {
        operationId,
        provider: "contaazul",
        toolName: UPDATE_DUE_DATE_REISSUE_BOLETO_TOOL,
        action: "update",
        target: { installmentId: params.installmentId },
        changes: [{ field: "dueDate", to: params.dueDateIso }],
        irreversible: false,
        rollbackNote:
          "O vencimento pode ser alterado novamente, mas o boleto reemitido pode exigir novo cancelamento manual."
      };
      const data: ContaAzulMutationPlan = {
        approvalPreview,
        plannedRequests,
        pollingPlan: financialEventPollingPlan(params.financialEventId)
      };

      const missingSession = await blockIfProSessionMissing({
        ledgerPath: options.ledgerPath,
        operationId,
        runtimeMode,
        toolName: UPDATE_DUE_DATE_REISSUE_BOLETO_TOOL,
        args: params,
        data,
        authToken: proSessions.get(params.relationId)
      });
      if (missingSession) return missingSession;

      if (runtimeMode === "dry-run") {
        return writeMutationReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: UPDATE_DUE_DATE_REISSUE_BOLETO_TOOL,
          status: "planned",
          summary:
            "Reemissao de boleto Conta Azul planejada; apos aprovar, o PDF atualizado sera baixado.",
          args: params,
          data,
          responseSummary: dueDateReissueResponseSummary({
            params,
            summary:
              "Reemissao de boleto Conta Azul planejada; apos aprovar, o PDF atualizado sera baixado."
          })
        });
      }

      const blocked = await blockIfNotApproved({
        ledgerPath: options.ledgerPath,
        operationId,
        runtimeMode,
        allowLiveMutations,
        toolName: UPDATE_DUE_DATE_REISSUE_BOLETO_TOOL,
        args: params,
        data,
        approvalText: params.approvalText
      });
      if (blocked) return blocked;

      const authToken = proSessions.get(params.relationId);
      if (!authToken) {
        throw new Error("Conta Azul Pro session unexpectedly missing after validation.");
      }

      const cancelResult =
        activeChargeRequests.length > 0
          ? await options.client.cancelChargeRequests({ authToken, chargeRequests: activeChargeRequests })
          : undefined;
      const updateResult = await options.client.updateInstallmentDueDate({
        authToken,
        installmentId: params.installmentId,
        dueDate: params.dueDateIso,
        expectedPaymentDate: params.dueDateIso,
        isCaPaymentType: true,
        version: params.installmentVersion
      });
      const updatedInstallmentVersion = installmentVersionFromUpdateResult(
        updateResult,
        params.installmentVersion
      );
      const liveChargePayload = buildChargeRequestPayload({
        financialAccountId: financialAccountId!,
        installmentId: params.installmentId,
        installmentVersion: updatedInstallmentVersion,
        originalDescription: params.originalDescription,
        dueDateIso: params.dueDateIso,
        value: params.value,
        index: params.installmentIndex,
        email: params.email,
        smsNumbers: [],
        whatsappNumbers: []
      });
      const chargeResult = await options.client.createChargeRequest({
        authToken,
        payload: liveChargePayload
      });
      const chargeRequestId = extractChargeRequestId(chargeResult);

      const warnings: string[] = [];
      const artifacts: Artifact[] = [];
      let chargeUrl: string | undefined;
      let failedStep: string | undefined;

      try {
        failedStep = "poll_charge_url";
        const confirmedCharge = await pollChargeRequestFromFinancialEventSummary({
          client: options.client,
          authToken,
          financialEventId: params.financialEventId,
          chargeRequestId,
          maxAttempts: 10,
          delayMs: 2000
        });
        chargeUrl = confirmedCharge.chargeUrl;

        failedStep = "download_pdf";
        const customerName = params.customerName?.trim() || params.originalDescription;
        const pdf = await options.client.downloadBoletoPdf({
          authToken,
          customerName,
          chargeRequestId: confirmedCharge.chargeRequestId,
          chargeUrl: confirmedCharge.chargeUrl
        });
        const pdfArtifact = await saveBinaryArtifact({
          artifactsDir: options.artifactsDir,
          provider: "contaazul",
          operationId,
          label: "boleto reemitido",
          fileName: `boleto_vencimento_${params.installmentId}.pdf`,
          kind: "pdf",
          contents: pdf
        });
        artifacts.push(pdfArtifact);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "falha ao obter PDF do boleto.";
        warnings.push(
          failedStep === "download_pdf"
            ? `Vencimento atualizado e boleto reemitido, mas o PDF nao foi baixado: ${detail}`
            : `Vencimento atualizado e boleto reemitido, mas a URL da cobranca ainda nao ficou disponivel: ${detail}`
        );
      }

      const resultSummary = {
        cancelResult,
        updateResult,
        chargeResult,
        chargeRequestId,
        chargeUrl,
        financialEventId: params.financialEventId,
        installmentId: params.installmentId
      };
      const summary =
        artifacts.length > 0
          ? "Vencimento atualizado, boleto reemitido e PDF baixado no Conta Azul."
          : "Vencimento atualizado e boleto reemitido no Conta Azul.";

      return writeMutationReceipt({
        ledgerPath: options.ledgerPath,
        operationId,
        runtimeMode,
        toolName: UPDATE_DUE_DATE_REISSUE_BOLETO_TOOL,
        status: "succeeded",
        summary,
        args: params,
        data: {
          ...data,
          result: resultSummary
        },
        artifacts,
        warnings,
        responseSummary: dueDateReissueResponseSummary({
          params,
          summary,
          chargeRequestId,
          chargeUrl
        })
      });
    },

    async createCustomer(rawParams) {
      const params = ContaAzulCreateCustomerParamsSchema.parse(rawParams);
      const operationId = params.operationId ?? createOperationId(CREATE_CUSTOMER_TOOL);
      const payload = buildCustomerPayload(params.person);
      const plannedRequests: ContaAzulPlannedMappedRequest[] = [
        { method: "POST", url: PERSON_CREATE_URL, payload }
      ];
      const approvalPreview: ApprovalPreview = {
        operationId,
        provider: "contaazul",
        toolName: CREATE_CUSTOMER_TOOL,
        action: "create",
        target: { customerName: params.person.name },
        changes: [{ field: "customer", to: params.person.name }],
        irreversible: false,
        rollbackNote: "O cliente criado pode precisar ser inativado manualmente se estiver incorreto."
      };
      const data: ContaAzulMutationPlan = { approvalPreview, plannedRequests };

      const missingSession = await blockIfProSessionMissing({
        ledgerPath: options.ledgerPath,
        operationId,
        runtimeMode,
        toolName: CREATE_CUSTOMER_TOOL,
        args: params,
        data,
        authToken: proSessions.get(params.relationId)
      });
      if (missingSession) return missingSession;

      if (runtimeMode === "dry-run") {
        return writeMutationReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: CREATE_CUSTOMER_TOOL,
          status: "planned",
          summary: "Cadastro de cliente Conta Azul planejado; nenhum POST enviado.",
          args: params,
          data
        });
      }

      const blocked = await blockIfNotApproved({
        ledgerPath: options.ledgerPath,
        operationId,
        runtimeMode,
        allowLiveMutations,
        toolName: CREATE_CUSTOMER_TOOL,
        args: params,
        data,
        approvalText: params.approvalText
      });
      if (blocked) return blocked;

      const authToken = proSessions.get(params.relationId);
      if (!authToken) {
        throw new Error("Conta Azul Pro session unexpectedly missing after validation.");
      }

      try {
        const result = await options.client.createCustomer({ authToken, payload });
        return writeMutationReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: CREATE_CUSTOMER_TOOL,
          status: "succeeded",
          summary: "Cliente criado no Conta Azul.",
          args: params,
          data: { ...data, result }
        });
      } catch (error) {
        const errMessage = error instanceof Error ? error.message : "";
        if (errMessage.includes("já está cadastrado") || errMessage.includes("400")) {
          const cleanDoc = (params.person.legalDocument || params.person.naturalDocument || "").replace(/\D/g, "");
          if (cleanDoc) {
            try {
              const existing = await options.client.searchSaleCustomers({
                authToken,
                searchTerm: cleanDoc
              });
              const match = (existing as any[]).find(c => {
                const doc = (c.document || "").replace(/\D/g, "");
                return doc === cleanDoc;
              }) || existing[0];
              if (match) {
                const warning = `O cliente com documento já está cadastrado no sistema como "${match.name}".`;
                return writeMutationReceipt({
                  ledgerPath: options.ledgerPath,
                  operationId,
                  runtimeMode,
                  toolName: CREATE_CUSTOMER_TOOL,
                  status: "succeeded",
                  summary: warning,
                  args: params,
                  data: {
                    ...data,
                    result: { uuid: match.id, name: match.name, alreadyExists: true }
                  },
                  warnings: [warning]
                });
              }
            } catch (searchErr) {
              // ignore search error and fall through
            }
          }
        }
        return writeErrorReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: CREATE_CUSTOMER_TOOL,
          args: params,
          error
        });
      }
    },

    async createCustomerWorkflow(rawParams) {
      const params = ContaAzulCreateCustomerWorkflowParamsSchema.parse(rawParams);
      const operationId = params.operationId ?? createOperationId(CREATE_CUSTOMER_WORKFLOW_TOOL);

      try {
        const accountancyClients = parseAccountancyClients(await options.client.listAccountancyClients());
        const accountancyClient = pickByField({
          label: "Conta Azul Mais tenant",
          items: accountancyClients,
          expected: String(params.tenantId),
          field: (item) => `${item.tenantId} | ${item.name}`
        });

        const session = await options.client.switchToProSession(accountancyClient.relationId);
        proSessions.set(accountancyClient.relationId, session.authToken);

        const cleanDoc = params.document.replace(/\D/g, "");
        const existing = await options.client.searchSaleCustomers({
          authToken: session.authToken,
          searchTerm: cleanDoc
        });
        const match = (existing as any[]).find(c => {
          const doc = (c.document || "").replace(/\D/g, "");
          return doc === cleanDoc;
        }) || existing[0];

        if (match && (match.document || "").replace(/\D/g, "") === cleanDoc) {
          const warning = `O cliente com documento ${params.document} já está cadastrado no sistema como "${match.name}".`;
          return writeReceipt({
            ledgerPath: options.ledgerPath,
            operationId,
            runtimeMode,
            toolName: CREATE_CUSTOMER_WORKFLOW_TOOL,
            status: runtimeMode === "dry-run" ? "planned" : "succeeded",
            summary: warning,
            args: params,
            data: {
              approvalPreview: {
                operationId,
                provider: "contaazul",
                toolName: CREATE_CUSTOMER_WORKFLOW_TOOL,
                action: "create",
                target: { customerId: match.id, customerName: match.name },
                changes: [],
                irreversible: false,
                rollbackNote: "Nenhuma ação necessária (cliente já cadastrado)."
              },
              plannedRequests: [],
              resolved: {
                customerId: match.id,
                customerName: match.name,
                tenantId: params.tenantId,
                relationId: accountancyClient.relationId,
                tenantName: accountancyClient.name,
                alreadyExists: true
              }
            },
            warnings: [warning]
          });
        }

        let name = params.name;
        let companyName = params.companyName;
        let email = params.email;
        let commercialPhone = params.commercialPhone;
        let cellPhone = params.cellPhone;
        let zipcode = params.zipcode;
        let street = params.street;
        let neighborhood = params.neighborhood;
        let complement = params.complement;
        let billingEmail = params.billingEmail;
        let billingPhone = params.billingPhone;
        let numberAddress = params.numberAddress;
        let idCity: string | number | undefined;
        let state: string | undefined;
        let cityName: string | undefined;

        if (params.personType === "Jurídica" && (!name || !zipcode || !billingEmail)) {
          try {
            const cnpjInfo = (await options.client.lookupCnpj({
              authToken: session.authToken,
              cnpj: cleanDoc
            })) as Record<string, any>;
            if (cnpjInfo) {
              name = name || cnpjInfo.tradingName || cnpjInfo.companyName;
              companyName = companyName || cnpjInfo.companyName;
              email = email || cnpjInfo.email;
              commercialPhone = commercialPhone || cnpjInfo.phoneNumber;
              zipcode = zipcode || cnpjInfo.zipCode;
              street = street || cnpjInfo.streetName;
              numberAddress = numberAddress || cnpjInfo.numberAddress;
              neighborhood = neighborhood || cnpjInfo.neighborhood;
              state = state || cnpjInfo.state;
              cityName = cityName || cnpjInfo.cityName;
            }
          } catch (cnpjErr) {
            // ignore CNPJ lookup error
          }
        }

        if (zipcode) {
          try {
            const cepInfo = (await options.client.lookupCep({
              cep: zipcode
            })) as Record<string, any>;
            if (cepInfo) {
              idCity = cepInfo.idCidade;
              state = state || cepInfo.idEstado;
              neighborhood = neighborhood || cepInfo.nmBairro;
              street = street || cepInfo.nmEndereco;
            }
          } catch (cepErr) {
            // ignore CEP lookup error
          }
        }

        const missing: string[] = [];
        if (!name) missing.push("name");
        if (!zipcode) missing.push("zipcode");
        if (!numberAddress) missing.push("numberAddress");
        if (!billingEmail) {
          if (email) {
            billingEmail = email;
          } else {
            missing.push("billingEmail");
          }
        }
        if (!idCity) {
          missing.push("city");
        }

        if (missing.length > 0) {
          const warning = `Campos obrigatórios ausentes: ${missing.join(", ")}. Por favor, forneça-los.`;
          return writeReceipt({
            ledgerPath: options.ledgerPath,
            operationId,
            runtimeMode,
            toolName: CREATE_CUSTOMER_WORKFLOW_TOOL,
            status: "failed",
            summary: warning,
            args: params,
            data: {
              resolved: {
                name,
                companyName,
                email,
                commercialPhone,
                cellPhone,
                zipcode,
                street,
                neighborhood,
                complement,
                billingEmail,
                billingPhone,
                numberAddress
              }
            },
            warnings: [warning]
          });
        }

        const address = {
          zipcode: zipcode!.replace(/\D/g, ""),
          neighborhood: neighborhood!,
          numberAddress: numberAddress!,
          state: state!,
          city: idCity!,
          address: street!,
          complement: complement || "",
          country: "Brasil",
          idCity: idCity!
        };

        const person = {
          personType: params.personType,
          legalDocument: params.personType === "Jurídica" ? cleanDoc : "",
          naturalDocument: params.personType === "Física" ? cleanDoc : "",
          name: name!,
          companyName: companyName || name!,
          email: email || "",
          commercialPhone: commercialPhone || "",
          cellPhone: cellPhone || billingPhone || "",
          billingEmail: billingEmail!,
          billingPhone: billingPhone || "",
          address
        };

        const nestedTools = createContaAzulMutationTools({
          ...options,
          proSessionStore: proSessions,
          operationIdFactory: () => operationId
        });
        const receipt = await nestedTools.createCustomer({
          relationId: accountancyClient.relationId,
          person,
          approvalText: params.approvalText
        });

        return {
          ...receipt,
          toolName: CREATE_CUSTOMER_WORKFLOW_TOOL,
          summary: `Workflow de cadastro resolvido. ${receipt.summary}`,
          data: receipt.data
            ? {
                ...receipt.data,
                resolved: {
                  customerId: (receipt.data.result as any)?.uuid ?? (receipt.data.result as any)?.id,
                  customerName: person.name,
                  tenantId: params.tenantId,
                  relationId: accountancyClient.relationId,
                  tenantName: accountancyClient.name,
                  createBoleto: params.createBoleto
                }
              }
            : receipt.data
        };
      } catch (error) {
        return writeErrorReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: CREATE_CUSTOMER_WORKFLOW_TOOL,
          args: params,
          error
        });
      }
    },

    async acknowledgeOrphanCleanup(rawParams) {
      const params = ContaAzulAcknowledgeOrphanCleanupParamsSchema.parse(rawParams);
      const operationId =
        params.operationId ?? createOperationId(ACKNOWLEDGE_ORPHAN_CLEANUP_TOOL);
      const orphanedFailure = await findOrphanedServiceSaleFailure({
        ledgerPath: options.ledgerPath,
        operationId: params.previousOperationId,
        orphanedSaleId: params.orphanedSaleId
      });
      const cleanupResult = {
        cleanupForOperationId: params.previousOperationId,
        orphanedSaleId: params.orphanedSaleId,
        cleanupAction: params.cleanupAction,
        idempotencyKey: orphanedFailure?.idempotencyKey,
        notes: params.notes
      };
      const approvalPreview: ApprovalPreview = {
        operationId,
        provider: "contaazul",
        toolName: ACKNOWLEDGE_ORPHAN_CLEANUP_TOOL,
        action: "update",
        target: { saleId: params.orphanedSaleId },
        changes: [
          { field: "cleanupForOperationId", to: params.previousOperationId },
          { field: "cleanupAction", to: params.cleanupAction }
        ],
        irreversible: false,
        rollbackNote:
          "Este acknowledgement libera uma nova tentativa para a mesma idempotencyKey; registre outro evento corretivo se ele estiver incorreto."
      };
      const data: ContaAzulMutationPlan = {
        approvalPreview,
        plannedRequests: [],
        idempotencyKey: orphanedFailure?.idempotencyKey,
        result: cleanupResult
      };

      if (!orphanedFailure) {
        const warning =
          "Nenhuma falha parcial Conta Azul compativel foi encontrada para este operationId e saleId.";
        return writeMutationReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: ACKNOWLEDGE_ORPHAN_CLEANUP_TOOL,
          status: "blocked",
          summary: warning,
          args: params,
          data,
          warnings: [warning],
          responseSummary: {
            summary: warning,
            cleanupForOperationId: params.previousOperationId,
            orphanedSaleId: params.orphanedSaleId,
            cleanupAction: params.cleanupAction
          }
        });
      }

      if (runtimeMode === "dry-run") {
        return writeMutationReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: ACKNOWLEDGE_ORPHAN_CLEANUP_TOOL,
          status: "planned",
          summary:
            "Acknowledgement de limpeza de venda orfa planejado; nenhuma liberacao de retry registrada.",
          args: params,
          data,
          responseSummary: {
            summary:
              "Acknowledgement de limpeza de venda orfa planejado; nenhuma liberacao de retry registrada.",
            cleanupForOperationId: params.previousOperationId,
            orphanedSaleId: params.orphanedSaleId,
            cleanupAction: params.cleanupAction,
            idempotencyKey: orphanedFailure.idempotencyKey
          }
        });
      }

      const blocked = await blockIfNotApproved({
        ledgerPath: options.ledgerPath,
        operationId,
        runtimeMode,
        allowLiveMutations,
        toolName: ACKNOWLEDGE_ORPHAN_CLEANUP_TOOL,
        args: params,
        data,
        approvalText: params.approvalText
      });
      if (blocked) return blocked;

      const summary =
        `Limpeza manual da venda orfa ${params.orphanedSaleId} reconhecida para ${params.previousOperationId}. ` +
        "Uma nova tentativa com a mesma idempotencyKey pode prosseguir.";
      return writeMutationReceipt({
        ledgerPath: options.ledgerPath,
        operationId,
        runtimeMode,
        toolName: ACKNOWLEDGE_ORPHAN_CLEANUP_TOOL,
        status: "succeeded",
        summary,
        args: params,
        data,
        responseSummary: {
          summary,
          cleanupForOperationId: params.previousOperationId,
          orphanedSaleId: params.orphanedSaleId,
          cleanupAction: params.cleanupAction,
          idempotencyKey: orphanedFailure.idempotencyKey
        }
      });
    },

    async createServiceSaleBoletoWorkflow(rawParams) {
      const params = ContaAzulCreateServiceSaleBoletoWorkflowParamsSchema.parse(rawParams);
      const operationId =
        params.operationId ?? createOperationId(CREATE_SERVICE_SALE_BOLETO_WORKFLOW_TOOL);

      try {
        const resolved = await resolveServiceSaleWorkflowParams({
          client: options.client,
          params,
          operationId,
          config: options.config,
          proSessions
        });
        const nestedTools = createContaAzulMutationTools({
          ...options,
          proSessionStore: proSessions,
          operationIdFactory: () => operationId
        });
        const receipt = await nestedTools.createServiceSaleAndIssueBoleto(resolved.params);

        return {
          ...receipt,
          toolName: CREATE_SERVICE_SALE_BOLETO_WORKFLOW_TOOL,
          summary: `Workflow Conta Azul resolvido. ${receipt.summary}`,
          data: receipt.data
            ? {
                ...receipt.data,
                resolved: resolved.summary
              }
            : receipt.data
        };
      } catch (error) {
        return writeErrorReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: CREATE_SERVICE_SALE_BOLETO_WORKFLOW_TOOL,
          args: params,
          error
        });
      }
    },

    async createServiceSaleAndIssueBoleto(rawParams) {
      const params = ContaAzulCreateServiceSaleAndIssueBoletoParamsSchema.parse(rawParams);
      const operationId =
        params.operationId ?? createOperationId(CREATE_SERVICE_SALE_AND_ISSUE_BOLETO_TOOL);
      const financialAccountId = resolveFinancialAccountId(
        params.financialAccountId,
        options.config.financialAccountId
      );
      const idempotencyKey =
        params.idempotencyKey ?? createServiceSaleIdempotencyKey(params, financialAccountId);
      const duplicate = await findBlockingServiceSaleDuplicate({
        ledgerPath: options.ledgerPath,
        operationId,
        idempotencyKey
      });
      if (duplicate) {
        return writeBlockedServiceSaleDuplicateReceipt({
          ledgerPath: options.ledgerPath,
          artifactsDir: options.artifactsDir,
          operationId,
          runtimeMode,
          params,
          idempotencyKey,
          duplicate
        });
      }

      let serviceTaxInformation: any;
      const authToken = proSessions.get(params.relationId);
      if (authToken) {
        try {
          const person = (await options.client.getPersonDetails({
            authToken,
            personUuid: params.customerId
          })) as any;
          if (person) {
            const isLegal = person.personType === "Jurídica";
            const isPublic = person.isPublicAgency === true || person.publicAgency === true;
            const cityId = person.address?.[0]?.idCity || 2174;
            const taxResult = (await options.client.calculateTaxes({
              authToken,
              payload: {
                key: 1,
                provider: { taxationRegime: "SIMPLE_NATIONAL", nationalPattern: false },
                taker: {
                  type: isLegal ? "LEGAL_PERSON" : "NATURAL_PERSON",
                  taxationRegime: "NORMAL",
                  publicAgency: isPublic
                },
                service: {
                  id: params.serviceItemId,
                  values: { base: params.unitValue },
                  provisionPlace: { cityId },
                  taxes: { iss: { roundingMode: "HALF_EVEN" } }
                }
              }
            })) as any;

            if (taxResult && taxResult.service) {
              serviceTaxInformation = {
                id: params.serviceItemId,
                values: taxResult.service.values,
                taxes: taxResult.service.taxes,
                provisionPlace: taxResult.service.provisionPlace
              };
            }
          }
        } catch (err) {
          // ignore tax error, fallback to default
        }
      }

      const authTokenForLookup = proSessions.get(params.relationId);
      const companyDisplayName = authTokenForLookup
        ? await resolveCompanyDisplayNameFromSession(
            options.client,
            authTokenForLookup,
            params.notification.companyDisplayName,
            options.config.defaultCompanyDisplayName
          )
        : params.notification.companyDisplayName ?? options.config.defaultCompanyDisplayName;

      const salePayload = buildServiceSalePayload({
        params,
        financialAccountId,
        serviceTaxInformation
      });
      const chargePayload = buildChargeRequestPayload({
        financialAccountId,
        installmentId: "<installment_id_from_created_sale>",
        installmentVersion: 0,
        originalDescription: `Venda ${params.saleNumber}`,
        dueDateIso: params.dueDateIso,
        value: params.unitValue,
        index: 1,
        email: params.notification.email,
        smsNumbers: compact([params.notification.phone]),
        whatsappNumbers: compact([params.notification.phone])
      });
      const notificationPayload = buildChargeNotificationPayload({
        customerName: params.customerName,
        value: params.unitValue,
        dueDateIso: params.dueDateIso,
        saleNumber: params.saleNumber,
        email: params.notification.email,
        replyTo: params.notification.replyTo ?? options.config.defaultReplyToEmail,
        companyDisplayName,
        chargeRequestIds: ["<charge_request_id_from_batch_create>"]
      });
      const plannedRequests: ContaAzulPlannedMappedRequest[] = [
        { method: "POST", url: SALE_CREATE_URL, payload: salePayload },
        { method: "POST", url: BATCH_CREATE_URL, payload: chargePayload },
        { method: "POST", url: CHARGE_NOTIFICATION_URL, payload: notificationPayload }
      ];
      const approvalPreview: ApprovalPreview = {
        operationId,
        provider: "contaazul",
        toolName: CREATE_SERVICE_SALE_AND_ISSUE_BOLETO_TOOL,
        action: "create",
        target: { customerId: params.customerId, customerName: params.customerName },
        changes: [
          { field: "saleNumber", to: String(params.saleNumber) },
          { field: "serviceDescription", to: params.serviceDescription },
          { field: "value", to: String(params.unitValue) },
          { field: "dueDate", to: params.dueDateIso },
          { field: "notificationEmail", to: params.notification.email },
          { field: "notificationPhone", to: params.notification.phone ?? "" },
          {
            field: "replyTo",
            to: params.notification.replyTo ?? options.config.defaultReplyToEmail
          }
        ],
        irreversible: false,
        rollbackNote:
          "Venda, boleto e notificacao podem exigir cancelamento manual se algum dado estiver incorreto."
      };
      const pdfArtifact: Artifact = {
        kind: "pdf",
        path: path.join(
          options.artifactsDir,
          "contaazul",
          operationId,
          `boleto_venda_${params.saleNumber}.pdf`
        ),
        label: "boleto da venda planejado"
      };
      const data: ContaAzulMutationPlan = {
        approvalPreview,
        plannedRequests,
        pollingPlan: {
          url: `${SERVICES_BASE_URL}/finance-pro/v1/financial-events?reference_id=<created_sale_id>`,
          maxAttempts: 10,
          delayMs: 2000
        },
        idempotencyKey
      };

      const missingSession = await blockIfProSessionMissing({
        ledgerPath: options.ledgerPath,
        operationId,
        runtimeMode,
        toolName: CREATE_SERVICE_SALE_AND_ISSUE_BOLETO_TOOL,
        args: params,
        data,
        artifacts: [pdfArtifact],
        authToken: proSessions.get(params.relationId)
      });
      if (missingSession) return missingSession;

      if (runtimeMode === "dry-run") {
        const planArtifact = await saveJsonArtifact({
          artifactsDir: options.artifactsDir,
          provider: "contaazul",
          operationId,
          label: "plano da venda e boleto",
          fileName: `plano_venda_${params.saleNumber}.json`,
          contents: redact({
            approvalPreview,
            plannedRequests,
            pollingPlan: data.pollingPlan,
            idempotencyKey
          })
        });

        return writeMutationReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: CREATE_SERVICE_SALE_AND_ISSUE_BOLETO_TOOL,
          status: "planned",
          summary:
            "Venda de servico, boleto e notificacao Conta Azul planejados; nenhum POST enviado.",
          args: params,
          data,
          artifacts: [pdfArtifact, planArtifact],
          responseSummary: serviceSaleResponseSummary({
            summary:
              "Venda de servico, boleto e notificacao Conta Azul planejados; nenhum POST enviado.",
            idempotencyKey,
            params
          })
        });
      }

      const blocked = await blockIfNotApproved({
        ledgerPath: options.ledgerPath,
        operationId,
        runtimeMode,
        allowLiveMutations,
        toolName: CREATE_SERVICE_SALE_AND_ISSUE_BOLETO_TOOL,
        args: params,
        data,
        artifacts: [pdfArtifact],
        approvalText: params.approvalText
      });
      if (blocked) return blocked;

      if (!authToken) {
        throw new Error("Conta Azul Pro session unexpectedly missing after validation.");
      }

      if (options.client.verifyProSession) {
        try {
          const ok = await options.client.verifyProSession({ authToken });
          if (!ok) {
            const warning =
              "Conta Azul Pro session health check failed before creating sale.";
            return writeMutationReceipt({
              ledgerPath: options.ledgerPath,
              operationId,
              runtimeMode,
              toolName: CREATE_SERVICE_SALE_AND_ISSUE_BOLETO_TOOL,
              status: "failed",
              summary: warning,
              args: params,
              data,
              artifacts: [pdfArtifact],
              warnings: [warning],
              responseSummary: {
                summary: warning,
                idempotencyKey,
                failedStep: "verify_pro_session"
              }
            });
          }
        } catch (error) {
          if (error instanceof ContaAzulSessionExpiredError) {
            const warning = `${error.message} Recapture session with ${error.recaptureCommand}.`;
            return writeMutationReceipt({
              ledgerPath: options.ledgerPath,
              operationId,
              runtimeMode,
              toolName: CREATE_SERVICE_SALE_AND_ISSUE_BOLETO_TOOL,
              status: "blocked",
              summary: warning,
              args: params,
              data,
              artifacts: [pdfArtifact],
              warnings: [warning]
            });
          }
          const detail = error instanceof Error ? error.message : "unknown error";
          const warning =
            `Conta Azul Pro session health check failed before creating sale: ${detail}`;
          return writeMutationReceipt({
            ledgerPath: options.ledgerPath,
            operationId,
            runtimeMode,
            toolName: CREATE_SERVICE_SALE_AND_ISSUE_BOLETO_TOOL,
            status: "failed",
            summary: warning,
            args: params,
            data,
            artifacts: [pdfArtifact],
            warnings: [warning],
            responseSummary: {
              summary: warning,
              idempotencyKey,
              failedStep: "verify_pro_session"
            }
          });
        }
      }

      const saleResult = await options.client.createServiceSale({
        authToken,
        payload: salePayload
      });
      const saleId = extractRequiredString(saleResult, ["id"], "created sale id");
      let failedStep = "poll_financial_event";

      try {
        const createdSaleNumber = extractOptionalNumber(saleResult, ["number"]) ?? params.saleNumber;
        const financialEvent = await pollFinancialEventForSale({
          client: options.client,
          authToken,
          saleId,
          maxAttempts: 10,
          delayMs: 2000
        });

        failedStep = "create_charge_request";
        const liveChargePayload = buildChargeRequestPayload({
          financialAccountId,
          installmentId: financialEvent.installmentId,
          installmentVersion: financialEvent.installmentVersion,
          originalDescription: `Venda ${createdSaleNumber}`,
          dueDateIso: params.dueDateIso,
          value: params.unitValue,
          index: 1,
          email: params.notification.email,
          smsNumbers: compact([params.notification.phone]),
          whatsappNumbers: compact([params.notification.phone])
        });
        const chargeResult = await options.client.createChargeRequest({
          authToken,
          payload: liveChargePayload
        });
        const chargeRequestId = extractChargeRequestId(chargeResult);

        failedStep = "send_notification";
        const liveNotificationPayload = buildChargeNotificationPayload({
          customerName: params.customerName,
          value: params.unitValue,
          dueDateIso: params.dueDateIso,
          saleNumber: createdSaleNumber,
          email: params.notification.email,
          replyTo: params.notification.replyTo ?? options.config.defaultReplyToEmail,
          companyDisplayName,
          chargeRequestIds: [chargeRequestId]
        });
        const notificationResult = await options.client.sendChargeNotification({
          authToken,
          payload: liveNotificationPayload
        });

        failedStep = "poll_charge_url";
        const chargeRequestFromStatement = await pollChargeRequestFromFinancialStatement({
          client: options.client,
          authToken,
          saleNumber: createdSaleNumber,
          value: params.unitValue,
          chargeRequestId,
          maxAttempts: 20,
          delayMs: 3000
        });

        failedStep = "download_pdf";
        const pdf = await options.client.downloadBoletoPdf({
          authToken,
          customerName: params.customerName,
          chargeRequestId: chargeRequestFromStatement.chargeRequestId,
          chargeUrl: chargeRequestFromStatement.chargeUrl
        });
        const pdfArtifactResult = await saveBinaryArtifact({
          artifactsDir: options.artifactsDir,
          provider: "contaazul",
          operationId,
          label: "boleto da venda",
          fileName: `boleto_venda_${createdSaleNumber}.pdf`,
          kind: "pdf",
          contents: pdf
        });
        const resultSummary = {
          saleId,
          saleNumber: createdSaleNumber,
          financialEventId: financialEvent.financialEventId,
          installmentId: financialEvent.installmentId,
          installmentVersion: financialEvent.installmentVersion,
          chargeRequestId: chargeRequestFromStatement.chargeRequestId,
          chargeUrl: chargeRequestFromStatement.chargeUrl,
          chargeUrlSource: "financial_statement",
          saleResult,
          chargeResult,
          notificationResult
        };
        const resultArtifact = await saveJsonArtifact({
          artifactsDir: options.artifactsDir,
          provider: "contaazul",
          operationId,
          label: "resultado da venda e boleto",
          fileName: `resultado_venda_${createdSaleNumber}.json`,
          contents: redact({
            idempotencyKey,
            approvalPreview,
            result: resultSummary
          })
        });

        return writeMutationReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: CREATE_SERVICE_SALE_AND_ISSUE_BOLETO_TOOL,
          status: "succeeded",
          summary: "Venda de servico, boleto, notificacao e PDF gerados no Conta Azul.",
          args: params,
          data: {
            ...data,
            result: resultSummary
          },
          artifacts: [pdfArtifactResult, resultArtifact],
          responseSummary: serviceSaleResponseSummary({
            summary: "Venda de servico, boleto, notificacao e PDF gerados no Conta Azul.",
            idempotencyKey,
            params,
            result: resultSummary
          })
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "etapa pos-venda falhou.";
        const warning =
          `Venda criada no Conta Azul (saleId=${saleId}) mas a etapa "${failedStep}" falhou: ${detail}. ` +
          "Verifique e cancele a venda manualmente se necessario antes de tentar novamente.";
        return writeMutationReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: CREATE_SERVICE_SALE_AND_ISSUE_BOLETO_TOOL,
          status: "failed",
          summary: warning,
          args: params,
          data: {
            ...data,
            result: { orphanedSaleId: saleId, failedStep, error: detail }
          },
          artifacts: [pdfArtifact],
          warnings: [warning],
          responseSummary: {
            summary: warning,
            idempotencyKey,
            orphanedSaleId: saleId,
            failedStep
          }
        });
      }
    }
  };
}

async function writeErrorReceipt<T>(input: {
  ledgerPath: string;
  operationId: string;
  runtimeMode: RuntimeMode;
  toolName: string;
  args: unknown;
  error: unknown;
}): Promise<ToolReceipt<T>> {
  const expiredError =
    input.error instanceof ContaAzulSessionExpiredError ? input.error : undefined;
  const ambiguityError =
    input.error instanceof AmbiguityError ? input.error : undefined;
  const isExpired = Boolean(expiredError);
  const message = input.error instanceof Error ? input.error.message : "Conta Azul tool failed.";
  const warning = expiredError
    ? `${message} Recapture session with ${expiredError.recaptureCommand}.`
    : message;

  return writeReceipt({
    ledgerPath: input.ledgerPath,
    operationId: input.operationId,
    runtimeMode: input.runtimeMode,
    toolName: input.toolName,
    status: isExpired ? "blocked" : "failed",
    summary: warning,
    args: input.args,
    data: undefined as T,
    warnings: [warning],
    responseSummary: { error: warning },
    ...(ambiguityError
      ? {
          candidates: ambiguityError.candidates,
          fieldName: ambiguityError.fieldName
        }
      : {})
  });
}

async function blockIfProSessionMissing(input: {
  ledgerPath: string;
  operationId: string;
  runtimeMode: RuntimeMode;
  toolName: string;
  args: unknown;
  data: ContaAzulMutationPlan;
  artifacts?: Artifact[];
  authToken?: string;
}): Promise<ToolReceipt<ContaAzulMutationPlan> | undefined> {
  if (input.authToken) return undefined;

  const warning =
    "Conta Azul Pro session is not available. Run switchToProSession for this relation first.";

  return writeMutationReceipt({
    ledgerPath: input.ledgerPath,
    operationId: input.operationId,
    runtimeMode: input.runtimeMode,
    toolName: input.toolName,
    status: "blocked",
    summary: warning,
    args: input.args,
    data: input.data,
    artifacts: input.artifacts,
    warnings: [warning]
  });
}

async function blockIfReadProSessionMissing<T>(
  input: {
    ledgerPath: string;
    operationId: string;
    runtimeMode: RuntimeMode;
    toolName: string;
    args: unknown;
    authToken?: string;
  },
  blockedData: T
): Promise<ToolReceipt<T> | undefined> {
  if (input.authToken) return undefined;

  const warning =
    "Conta Azul Pro session is not available. Run switchToProSession for this relation first.";

  return writeReceipt({
    ledgerPath: input.ledgerPath,
    operationId: input.operationId,
    runtimeMode: input.runtimeMode,
    toolName: input.toolName,
    status: "blocked",
    summary: warning,
    args: input.args,
    data: blockedData,
    warnings: [warning],
    responseSummary: { blocked: true, reason: warning }
  });
}

async function blockIfNotApproved(input: {
  ledgerPath: string;
  operationId: string;
  runtimeMode: RuntimeMode;
  allowLiveMutations: boolean;
  toolName: string;
  args: unknown;
  data: ContaAzulMutationPlan;
  artifacts?: Artifact[];
  approvalText?: string;
}): Promise<ToolReceipt<ContaAzulMutationPlan> | undefined> {
  const parsed = parseApprovalText(input.approvalText ?? "", input.operationId);

  try {
    assertLiveMutationAllowed({
      runtimeMode: input.runtimeMode,
      allowLiveMutations: input.allowLiveMutations,
      operationId: input.operationId,
      approvedOperationId: parsed.approved ? parsed.operationId : undefined
    });
    return undefined;
  } catch (error) {
    if (!(error instanceof MutationBlockedError)) throw error;

    return writeMutationReceipt({
      ledgerPath: input.ledgerPath,
      operationId: input.operationId,
      runtimeMode: input.runtimeMode,
      toolName: input.toolName,
      status: "blocked",
      summary: error.message,
      args: input.args,
      data: input.data,
      artifacts: input.artifacts,
      warnings: [error.message]
    });
  }
}

async function writeMutationReceipt(input: {
  ledgerPath: string;
  operationId: string;
  runtimeMode: RuntimeMode;
  toolName: string;
  status: ToolReceipt<ContaAzulMutationPlan>["status"];
  summary: string;
  args: unknown;
  data: ContaAzulMutationPlan;
  artifacts?: Artifact[];
  warnings?: string[];
  responseSummary?: unknown;
}): Promise<ToolReceipt<ContaAzulMutationPlan>> {
  const receipt: ToolReceipt<ContaAzulMutationPlan> = {
    operationId: input.operationId,
    provider: "contaazul",
    toolName: input.toolName,
    status: input.status,
    dryRun: input.runtimeMode === "dry-run",
    summary: input.summary,
    data: input.data,
    artifacts: input.artifacts ?? [],
    warnings: input.warnings ?? []
  };

  await appendLedgerEntry(input.ledgerPath, {
    operationId: receipt.operationId,
    provider: receipt.provider,
    toolName: receipt.toolName,
    status: receipt.status,
    args: input.args,
    responseSummary: input.responseSummary ?? { summary: receipt.summary },
    artifacts: receipt.artifacts,
    warnings: receipt.warnings
  });

  return receipt;
}

async function writeReceipt<T>(input: {
  ledgerPath: string;
  operationId: string;
  runtimeMode: RuntimeMode;
  toolName: string;
  status: ToolReceipt<T>["status"];
  summary: string;
  args: unknown;
  data: T;
  warnings?: string[];
  responseSummary?: unknown;
  candidates?: string[];
  fieldName?: string;
  redactData?: boolean;
}): Promise<ToolReceipt<T>> {
  const redactData = input.redactData !== false;
  const receipt: ToolReceipt<T> = {
    operationId: input.operationId,
    provider: "contaazul",
    toolName: input.toolName,
    status: input.status,
    dryRun: input.runtimeMode === "dry-run",
    summary: input.summary,
    data: redactData ? redact(input.data) : input.data,
    artifacts: [],
    warnings: input.warnings ?? [],
    ...(input.candidates ? { candidates: input.candidates } : {}),
    ...(input.fieldName ? { fieldName: input.fieldName } : {})
  };

  await appendLedgerEntry(input.ledgerPath, {
    operationId: receipt.operationId,
    provider: receipt.provider,
    toolName: receipt.toolName,
    status: receipt.status,
    args: input.args,
    responseSummary: input.responseSummary ?? { summary: input.summary },
    artifacts: receipt.artifacts,
    warnings: receipt.warnings
  });

  return receipt;
}

function resolveFinancialAccountId(
  explicit: string | undefined,
  configValue: string,
  installmentAccountId?: string
): string {
  return (
    explicit?.trim() ||
    installmentAccountId?.trim() ||
    configValue.trim() ||
    CONTAAZUL_LEGACY_FINANCIAL_ACCOUNT_ID
  );
}

async function resolveCompanyDisplayNameFromSession(
  client: ContaAzulMutationClient,
  authToken: string,
  explicit: string | undefined,
  fallback: string
): Promise<string> {
  if (explicit?.trim()) return explicit.trim();
  try {
    const details = asRecord(await client.getCompanyDetails({ authToken }));
    const resolved =
      stringField(details, "fantasyName") || stringField(details, "name");
    if (resolved) return resolved;
  } catch {
    // Mirror contaazul/interativo.js: keep fallback when company details fail.
  }
  return fallback;
}

async function resolveSaleNotificationDefaults(input: {
  client: ContaAzulMutationClient;
  authToken: string;
  customerId: string;
  notification: {
    email: string;
    phone?: string;
    replyTo?: string;
    companyDisplayName?: string;
  };
  defaultReplyToEmail: string;
}): Promise<{ email: string; phone?: string; replyTo: string }> {
  let email = input.notification.email?.trim() ?? "";
  let phone = input.notification.phone?.replace(/\D/g, "") ?? "";
  const replyTo = input.notification.replyTo?.trim() || input.defaultReplyToEmail;

  if (email && phone) {
    return { email, phone, replyTo };
  }

  try {
    const personRaw = await input.client.getPersonDetails({
      authToken: input.authToken,
      personUuid: input.customerId
    });
    const person = asRecord(personRaw);
    if (!person) {
      return { email, phone: phone || undefined, replyTo };
    }
    const billing = asRecord(person.billingContact);
    const billingEmails = billing?.emails;
    if (!email) {
      email =
        (Array.isArray(billingEmails) && typeof billingEmails[0] === "string"
          ? billingEmails[0]
          : "") ||
        stringField(person, "email") ||
        "";
    }
    if (!phone) {
      phone =
        stringField(billing, "phoneNumber")?.replace(/\D/g, "") ||
        stringField(person, "cellPhone")?.replace(/\D/g, "") ||
        stringField(person, "commercialPhone")?.replace(/\D/g, "") ||
        "";
    }
  } catch {
    // Mirror contaazul/interativo.js: proceed with whatever the operator provided.
  }

  return { email, phone: phone || undefined, replyTo };
}

async function resolveServiceSaleWorkflowParams(input: {
  client: ContaAzulMutationClient;
  params: z.output<typeof ContaAzulCreateServiceSaleBoletoWorkflowParamsSchema>;
  operationId: string;
  config: ContaAzulMutationConfig;
  proSessions: Map<string, string>;
}): Promise<{
  params: ContaAzulCreateServiceSaleAndIssueBoletoParams;
  summary: Record<string, unknown>;
}> {
  const accountancyClients = parseAccountancyClients(await input.client.listAccountancyClients());
  const accountancyClient = pickByField({
    label: "Conta Azul Mais tenant",
    items: accountancyClients,
    expected: String(input.params.tenantId),
    field: (item) => `${item.tenantId} | ${item.name}`
  });

  const session = await input.client.switchToProSession(accountancyClient.relationId);
  input.proSessions.set(accountancyClient.relationId, session.authToken);

  const customers = await input.client.searchSaleCustomers({
    authToken: session.authToken,
    searchTerm: input.params.customerName
  });
  const customer = pickByField({
    label: "customer",
    items: customers,
    expected: input.params.customerName,
    field: (item) => stringField(item, "name")
  });

  const categories = await input.client.searchFinancialCategories({
    authToken: session.authToken,
    searchTerm: input.params.categoryName
  });
  const category = pickByField({
    label: "financial category",
    items: categories,
    expected: input.params.categoryName,
    field: (item) => stringField(item, "dsNaturezaFinanceira")
  });

  const serviceItems = await input.client.searchServiceItems({
    authToken: session.authToken,
    searchTerm: input.params.itemName
  });
  const serviceItem = pickByField({
    label: "service item",
    items: serviceItems,
    expected: input.params.itemName,
    field: (item) => stringField(item, "name")
  });

  const operationNature = (await input.client.listOperationNatures({
    authToken: session.authToken
  }))
    .map(asRecord)
    .find((item) => stringField(item, "operationTemplate") === "PRESTACAO_SERVICO");
  if (!operationNature) {
    throw new Error("No PRESTACAO_SERVICO operation nature was found.");
  }

  const unitValue = input.params.unitValue ?? parseMoneyBr(requiredString(input.params.unitValueBr));
  const dueDateIso = input.params.dueDateIso ?? parseDateBr(requiredString(input.params.dueDateBr));
  const saleNumber =
    input.params.saleNumber ?? await input.client.getNextSaleNumber({ authToken: session.authToken });
  const saleDateIso = input.params.saleDateIso ?? todayIso();
  const customerId = requiredStringField(customer, "id", "customer id");
  const customerName = requiredStringField(customer, "name", "customer name");
  const notificationDefaults = await resolveSaleNotificationDefaults({
    client: input.client,
    authToken: session.authToken,
    customerId,
    notification: input.params.notification,
    defaultReplyToEmail: input.config.defaultReplyToEmail
  });
  const companyDisplayName = await resolveCompanyDisplayNameFromSession(
    input.client,
    session.authToken,
    input.params.notification.companyDisplayName,
    input.config.defaultCompanyDisplayName
  );
  const resolvedFinancialAccountId = resolveFinancialAccountId(
    input.params.financialAccountId,
    input.config.financialAccountId
  );

  const resolvedParams: ContaAzulCreateServiceSaleAndIssueBoletoParams = {
    operationId: input.operationId,
    approvalText: input.params.approvalText,
    relationId: accountancyClient.relationId,
    customerId,
    customerName,
    categoryId: requiredStringField(category, "uuid", "category uuid"),
    serviceItemId: requiredStringField(serviceItem, "id", "service item id"),
    serviceDescription: input.params.serviceDescription,
    unitValue,
    dueDateIso,
    saleDateIso,
    saleNumber,
    operationNatureId: requiredStringField(operationNature, "uuid", "operation nature uuid"),
    financialAccountId: resolvedFinancialAccountId,
    idempotencyKey: input.params.idempotencyKey,
    notification: {
      email: notificationDefaults.email,
      phone: notificationDefaults.phone,
      replyTo: notificationDefaults.replyTo,
      companyDisplayName
    }
  };
  resolvedParams.idempotencyKey =
    resolvedParams.idempotencyKey ??
    createServiceSaleWorkflowIdempotencyKey(
      resolvedParams,
      resolvedFinancialAccountId
    );

  return {
    params: resolvedParams,
    summary: {
      tenantId: accountancyClient.tenantId,
      relationId: accountancyClient.relationId,
      customerId: resolvedParams.customerId,
      customerName: resolvedParams.customerName,
      categoryId: resolvedParams.categoryId,
      categoryName: input.params.categoryName,
      serviceItemId: resolvedParams.serviceItemId,
      serviceItemName: input.params.itemName,
      saleNumber,
      operationNatureId: resolvedParams.operationNatureId,
      dueDateIso,
      unitValue
    }
  };
}

function createServiceSaleIdempotencyKey(
  params: ContaAzulCreateServiceSaleAndIssueBoletoParams,
  financialAccountId: string
): string {
  const payload = {
    provider: "contaazul",
    toolName: CREATE_SERVICE_SALE_AND_ISSUE_BOLETO_TOOL,
    relationId: params.relationId,
    customerId: params.customerId,
    categoryId: params.categoryId,
    serviceItemId: params.serviceItemId,
    serviceDescription: normalizeText(params.serviceDescription),
    unitValue: Number(params.unitValue).toFixed(2),
    dueDateIso: params.dueDateIso,
    saleNumber: params.saleNumber,
    financialAccountId
  };
  return `contaazul-sale-boleto:${createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")}`;
}

function createServiceSaleWorkflowIdempotencyKey(
  params: ContaAzulCreateServiceSaleAndIssueBoletoParams,
  financialAccountId: string
): string {
  const payload = {
    provider: "contaazul",
    flow: CREATE_SERVICE_SALE_BOLETO_WORKFLOW_TOOL,
    relationId: params.relationId,
    customerId: params.customerId,
    categoryId: params.categoryId,
    serviceItemId: params.serviceItemId,
    serviceDescription: normalizeText(params.serviceDescription),
    unitValue: Number(params.unitValue).toFixed(2),
    dueDateIso: params.dueDateIso,
    financialAccountId
  };
  return `contaazul-sale-boleto-workflow:${createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")}`;
}

async function writeBlockedServiceSaleDuplicateReceipt(input: {
  ledgerPath: string;
  artifactsDir: string;
  operationId: string;
  runtimeMode: RuntimeMode;
  params: z.output<typeof ContaAzulCreateServiceSaleAndIssueBoletoParamsSchema>;
  idempotencyKey: string;
  duplicate: LedgerEntry;
}) {
  const duplicateSummary = asRecord(input.duplicate.responseSummary);
  const duplicateOrphanedSaleId = stringValue(duplicateSummary?.orphanedSaleId);
  const duplicateFailedStep = stringValue(duplicateSummary?.failedStep);
  const warning = duplicateOrphanedSaleId
    ? `Operacao similar ja criou uma venda no Conta Azul, mas falhou antes de concluir: ${input.duplicate.operationId} ` +
      `(saleId=${duplicateOrphanedSaleId}${duplicateFailedStep ? `, etapa=${duplicateFailedStep}` : ""}). ` +
      "Nenhuma nova venda ou boleto foi criado. Verifique e cancele a venda manualmente se necessario antes de tentar novamente."
    : `Operacao similar ja concluida no Conta Azul: ${input.duplicate.operationId}. ` +
      "Nenhuma nova venda ou boleto foi criado.";
  const pdfArtifact: Artifact = {
    kind: "pdf",
    path: path.join(
      input.artifactsDir,
      "contaazul",
      input.operationId,
      `boleto_venda_${input.params.saleNumber}.pdf`
    ),
    label: "boleto da venda planejado"
  };
  const data: ContaAzulMutationPlan = {
    idempotencyKey: input.idempotencyKey,
    approvalPreview: {
      operationId: input.operationId,
      provider: "contaazul",
      toolName: CREATE_SERVICE_SALE_AND_ISSUE_BOLETO_TOOL,
      action: "create",
      target: {
        customerId: input.params.customerId,
        customerName: input.params.customerName
      },
      changes: [],
      irreversible: false,
      rollbackNote: ""
    },
    plannedRequests: [],
    pollingPlan: {
      url: `${SERVICES_BASE_URL}/finance-pro/v1/financial-events?reference_id=<created_sale_id>`,
      maxAttempts: 10,
      delayMs: 2000
    }
  };

  return writeMutationReceipt({
    ledgerPath: input.ledgerPath,
    operationId: input.operationId,
    runtimeMode: input.runtimeMode,
    toolName: CREATE_SERVICE_SALE_AND_ISSUE_BOLETO_TOOL,
    status: "blocked",
    summary: warning,
    args: input.params,
    data,
    artifacts:
      input.duplicate.artifacts.length > 0 ? input.duplicate.artifacts : [pdfArtifact],
    warnings: [warning],
    responseSummary: {
      summary: warning,
      idempotencyKey: input.idempotencyKey,
      duplicateOperationId: input.duplicate.operationId,
      orphanedSaleId: duplicateOrphanedSaleId,
      failedStep: duplicateFailedStep
    }
  });
}

async function findBlockingServiceSaleDuplicate(input: {
  ledgerPath: string;
  operationId: string;
  idempotencyKey: string;
}): Promise<LedgerEntry | undefined> {
  const entries = await safeReadLedgerEntries(input.ledgerPath);
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]!;
    if (entry.provider !== "contaazul") continue;
    if (!isServiceSaleMutationTool(entry.toolName)) continue;

    const summary = asRecord(entry.responseSummary);
    const matches =
      entry.operationId === input.operationId ||
      stringValue(summary?.idempotencyKey) === input.idempotencyKey;
    if (!matches) continue;

    if (entry.status === "succeeded") return entry;

    const orphanedSaleId = stringValue(summary?.orphanedSaleId);
    if (!orphanedSaleId || entry.status !== "failed") continue;

    const idempotencyKey = stringValue(summary?.idempotencyKey) ?? input.idempotencyKey;
    if (
      !hasLaterOrphanCleanupAcknowledgement(entries, index, {
        cleanupForOperationId: entry.operationId,
        orphanedSaleId,
        idempotencyKey
      })
    ) {
      return entry;
    }
  }
  return undefined;
}

async function findOrphanedServiceSaleFailure(input: {
  ledgerPath: string;
  operationId: string;
  orphanedSaleId: string;
}): Promise<{ entry: LedgerEntry; idempotencyKey: string } | undefined> {
  const entries = await safeReadLedgerEntries(input.ledgerPath);
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]!;
    if (entry.provider !== "contaazul") continue;
    if (!isServiceSaleMutationTool(entry.toolName)) continue;
    if (entry.status !== "failed") continue;
    if (entry.operationId !== input.operationId) continue;

    const summary = asRecord(entry.responseSummary);
    if (stringValue(summary?.orphanedSaleId) !== input.orphanedSaleId) continue;

    const idempotencyKey = stringValue(summary?.idempotencyKey);
    if (!idempotencyKey) return undefined;

    return { entry, idempotencyKey };
  }
  return undefined;
}

function hasLaterOrphanCleanupAcknowledgement(
  entries: LedgerEntry[],
  failedEntryIndex: number,
  input: {
    cleanupForOperationId: string;
    orphanedSaleId: string;
    idempotencyKey: string;
  }
): boolean {
  return entries.slice(failedEntryIndex + 1).some((entry) => {
    if (entry.provider !== "contaazul") return false;
    if (entry.toolName !== ACKNOWLEDGE_ORPHAN_CLEANUP_TOOL) return false;
    if (entry.status !== "succeeded") return false;

    const summary = asRecord(entry.responseSummary);
    return (
      stringValue(summary?.cleanupForOperationId) === input.cleanupForOperationId &&
      stringValue(summary?.orphanedSaleId) === input.orphanedSaleId &&
      stringValue(summary?.idempotencyKey) === input.idempotencyKey
    );
  });
}

function isServiceSaleMutationTool(toolName: string): boolean {
  return (
    toolName === CREATE_SERVICE_SALE_AND_ISSUE_BOLETO_TOOL ||
    toolName === CREATE_SERVICE_SALE_BOLETO_WORKFLOW_TOOL
  );
}

async function safeReadLedgerEntries(ledgerPath: string): Promise<LedgerEntry[]> {
  try {
    return await readLedgerEntries(ledgerPath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function serviceSaleResponseSummary(input: {
  summary: string;
  idempotencyKey: string;
  params: ContaAzulCreateServiceSaleAndIssueBoletoParams;
  result?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    summary: input.summary,
    idempotencyKey: input.idempotencyKey,
    saleNumber: input.result?.saleNumber ?? input.params.saleNumber,
    customerId: input.params.customerId,
    customerName: input.params.customerName,
    dueDateIso: input.params.dueDateIso,
    unitValue: input.params.unitValue,
    chargeUrl: input.result?.chargeUrl
  };
}

function pickByField<T>(input: {
  label: string;
  items: T[];
  expected: string;
  field: (item: T) => string;
}): T {
  const expected = normalizeText(input.expected);
  const exact = input.items.filter((item) => normalizeText(input.field(item)) === expected);
  if (exact.length === 1) return exact[0] as T;

  const partial = input.items.filter((item) => normalizeText(input.field(item)).includes(expected));
  if (partial.length === 1) return partial[0] as T;

  const candidates = input.items.map((item) => input.field(item)).filter(Boolean);
  if (candidates.length > 0) {
    throw new AmbiguityError(
      `Multiplos itens encontrados para "${input.expected}". Escolha um:\n` +
        candidates.map((c, i) => `[${i + 1}] ${c}`).join("\n"),
      candidates,
      input.label
    );
  }

  throw new Error(`Nenhum(a) ${input.label} encontrado(a) para "${input.expected}".`);
}

function parseMoneyBr(value: string): number {
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid BR money value: ${value}`);
  }
  return parsed;
}

function parseDateBr(value: string): string {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) throw new Error(`Invalid BR date value: ${value}`);
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function requiredString(value: string | undefined): string {
  if (value) return value;
  throw new Error("Required string value is missing.");
}

function requiredStringField(input: unknown, key: string, label: string): string {
  const value = stringField(input, key);
  if (value) return value;
  throw new Error(`Missing ${label} in resolved Conta Azul object.`);
}

function stringField(input: unknown, key: string): string {
  const value = asRecord(input)?.[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildReissuePlannedRequests(input: {
  activeChargeRequests: unknown[];
  installmentId: string;
  dueDateIso: string;
  installmentVersion: number;
  chargePayload: Record<string, unknown>;
}): ContaAzulPlannedMappedRequest[] {
  const plannedRequests: ContaAzulPlannedMappedRequest[] = [];

  if (input.activeChargeRequests.length > 0) {
    plannedRequests.push({
      method: "POST",
      url: BATCH_CANCEL_URL,
      payload: { chargeRequests: input.activeChargeRequests }
    });
  }

  plannedRequests.push(
    {
      method: "PATCH",
      url: `${SERVICES_BASE_URL}/finance-pro/v1/installments/${input.installmentId}`,
      payload: {
        dueDate: input.dueDateIso,
        expectedPaymentDate: input.dueDateIso,
        isCaPaymentType: true,
        version: input.installmentVersion
      }
    },
    {
      method: "POST",
      url: BATCH_CREATE_URL,
      payload: input.chargePayload
    }
  );

  return plannedRequests;
}

function installmentVersionFromUpdateResult(updateResult: unknown, previousVersion: number): number {
  const version = asRecord(updateResult)?.version;
  if (typeof version === "number" && Number.isFinite(version)) {
    return version;
  }
  return previousVersion + 1;
}

function buildChargeRequestPayload(input: {
  financialAccountId: string;
  installmentId: string;
  installmentVersion: number;
  originalDescription: string;
  dueDateIso: string;
  value: number;
  index: number;
  email: string;
  smsNumbers: string[];
  whatsappNumbers: string[];
}): Record<string, unknown> {
  return {
    financialAccountId: input.financialAccountId,
    installmentGroups: [
      {
        originalDescription: input.originalDescription,
        description: `${input.originalDescription} - ${input.index}/${input.index}`,
        installmentIds: [{ id: input.installmentId, version: input.installmentVersion }],
        dueDate: input.dueDateIso,
        value: input.value,
        index: input.index
      }
    ],
    type: "RECEBA_FACIL_BANK_SLIP",
    customAttributes: { charge: { type: "INVOICE" } },
    notification: {
      emails: [input.email],
      scheduled: true,
      instantSending: false,
      smsNumbers: input.smsNumbers,
      whatsappNumbers: input.whatsappNumbers
    }
  };
}

function buildCustomerPayload(
  person: ContaAzulCreateCustomerParams["person"]
): Record<string, unknown> {
  return {
    personType: person.personType,
    legalDocument: person.legalDocument ?? "",
    naturalDocument: person.naturalDocument ?? "",
    name: person.name,
    code: "",
    isActive: false,
    isOptingSimple: false,
    companyName: person.companyName ?? "",
    generalRegistry: "",
    birthDate: person.birthDate ?? "",
    email: person.email ?? "",
    commercialPhone: person.commercialPhone ?? "",
    cellPhone: person.cellPhone ?? "",
    observation: "",
    idContactPrincipal: "",
    profiles: [{ profileType: "Cliente" }],
    registrations: [{}],
    otherContacts: [],
    address: [person.address],
    doDuplicate: false,
    billingContact: {
      emails: [person.billingEmail],
      phoneNumber: person.billingPhone
    },
    origin: "CadastroUnico"
  };
}

function buildServiceSalePayload(input: {
  params: ContaAzulCreateServiceSaleAndIssueBoletoParams;
  financialAccountId: string;
  serviceTaxInformation?: unknown;
}): Record<string, unknown> {
  const { params } = input;
  return {
    customerId: params.customerId,
    number: params.saleNumber,
    suggestedNumber: params.saleNumber,
    committedDate: params.saleDateIso,
    categoryId: params.categoryId,
    operationNatureId: params.operationNatureId,
    saleItems: [
      {
        description: params.serviceDescription,
        amount: 1,
        value: params.unitValue,
        id: params.serviceItemId,
        costValue: 0,
        priceAdjustmentMethod: null
      }
    ],
    valueComposition: {
      shipping: 0,
      discount: { type: "VALUE", value: 0 },
      serviceTaxTotal: 0
    },
    paymentCondition: {
      paymentType: "BANKING_BILLET",
      financialAccountId: input.financialAccountId,
      paymentConditionOption: "1x",
      installments: [{ dueDate: params.dueDateIso, value: params.unitValue }]
    },
    observations: "",
    invoiceObservations: "",
    situation: "APPROVED",
    automation: {
      serviceInvoiceEmission: { type: "PAYMENT_IDENTIFICATION", active: false }
    },
    originFlowType: "SIMPLIFIED_SALE",
    ...(input.serviceTaxInformation ? { serviceTaxInformation: input.serviceTaxInformation } : {})
  };
}

function buildChargeNotificationPayload(input: {
  customerName: string;
  value: number;
  dueDateIso: string;
  saleNumber: number;
  email: string;
  replyTo: string;
  companyDisplayName: string;
  chargeRequestIds: string[];
}): Record<string, unknown> {
  const valueBr = input.value.toFixed(2).replace(".", ",");
  return {
    body:
      `Ola, ${input.customerName}.<br><br>` +
      `Voce acaba de receber 1 cobranca no valor total de R$ ${valueBr}, ` +
      `emitida por ${input.companyDisplayName}. Confira os detalhes:<br>` +
      `- R$ ${valueBr} com vencimento em ${toBrazilianDate(input.dueDateIso)}, ` +
      `referente a: Venda ${input.saleNumber} - 1/1`,
    emails: [input.email],
    selfNotification: false,
    scheduled: false,
    subject: `[Importante] Chegou sua fatura de ${input.companyDisplayName}`,
    replyTo: input.replyTo,
    instantSending: true,
    chargeRequestIds: input.chargeRequestIds
  };
}

function financialEventPollingPlan(financialEventId: string): ContaAzulPollingPlan {
  return {
    url: `${SERVICES_BASE_URL}/contaazul-bff/finance/v1/financial-events/${financialEventId}/summary`,
    maxAttempts: 10,
    delayMs: 2000
  };
}

async function pollFinancialEventForSale(input: {
  client: ContaAzulMutationClient;
  authToken: string;
  saleId: string;
  maxAttempts: number;
  delayMs: number;
}): Promise<{
  financialEventId: string;
  installmentId: string;
  installmentVersion: number;
}> {
  for (let attempt = 1; attempt <= input.maxAttempts; attempt++) {
    const events = await input.client.getFinancialEventsByReference({
      authToken: input.authToken,
      saleId: input.saleId
    });
    const financialEvent = extractFinancialEventInstallment(events);
    if (financialEvent) return financialEvent;

    if (attempt < input.maxAttempts) {
      await sleep(input.delayMs);
    }
  }

  throw new Error(`Conta Azul financial event not found for sale ${input.saleId}.`);
}

async function pollChargeRequestFromFinancialEventSummary(input: {
  client: ContaAzulMutationClient;
  authToken: string;
  financialEventId: string;
  chargeRequestId: string;
  maxAttempts: number;
  delayMs: number;
}): Promise<{ chargeRequestId: string; chargeUrl: string }> {
  for (let attempt = 1; attempt <= input.maxAttempts; attempt++) {
    const summary = await input.client.getFinancialEventSummary({
      authToken: input.authToken,
      financialEventId: input.financialEventId
    });
    const chargeRequest = extractChargeRequestFromEventSummary(summary, input.chargeRequestId);
    if (chargeRequest) return chargeRequest;

    if (attempt < input.maxAttempts) {
      await sleep(input.delayMs);
    }
  }

  throw new Error(
    "Conta Azul charge request URL not found in financial event summary after boleto reissue."
  );
}

function extractChargeRequestFromEventSummary(
  summary: unknown,
  chargeRequestId: string
): { chargeRequestId: string; chargeUrl: string } | undefined {
  const paymentCondition = asRecord(asRecord(summary)?.paymentCondition);
  const installments = asArray(paymentCondition?.installments);

  for (const installment of installments) {
    const chargeRequests = asArray(asRecord(installment)?.chargeRequests);
    for (const request of chargeRequests) {
      const record = asRecord(request);
      const id = stringValue(record?.id);
      const url = stringValue(record?.url);
      if (id === chargeRequestId && url) {
        return { chargeRequestId: id, chargeUrl: url };
      }
    }
  }

  return undefined;
}

function dueDateReissueResponseSummary(input: {
  params: {
    customerName?: string;
    dueDateIso: string;
    installmentId: string;
    originalDescription?: string;
  };
  summary: string;
  chargeRequestId?: string;
  chargeUrl?: string;
}): Record<string, string> {
  const output: Record<string, string> = {
    summary: input.summary,
    installmentId: input.params.installmentId,
    chargeId: input.chargeRequestId ?? input.params.installmentId,
    dueDateIso: input.params.dueDateIso,
    dueDateBr: formatIsoDateBr(input.params.dueDateIso)
  };
  if (input.params.customerName) output.customerName = input.params.customerName;
  if (input.params.originalDescription) output.chargeLabel = input.params.originalDescription;
  if (input.chargeRequestId) output.chargeRequestId = input.chargeRequestId;
  if (input.chargeUrl) output.chargeUrl = input.chargeUrl;
  return output;
}

function formatIsoDateBr(iso: string): string {
  const parts = iso.split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : iso;
}

async function pollChargeRequestFromFinancialStatement(input: {
  client: ContaAzulMutationClient;
  authToken: string;
  saleNumber: number;
  value: number;
  chargeRequestId: string;
  maxAttempts: number;
  delayMs: number;
}): Promise<{ chargeRequestId: string; chargeUrl: string }> {
  const query = `Venda ${input.saleNumber}`;

  for (let attempt = 1; attempt <= input.maxAttempts; attempt++) {
    const items = await input.client.searchFinancialStatement({
      authToken: input.authToken,
      query,
      pageSize: 100
    });
    const chargeRequest = extractChargeRequestFromStatementItems({
      items,
      saleNumber: input.saleNumber,
      value: input.value,
      chargeRequestId: input.chargeRequestId
    });
    if (chargeRequest) return chargeRequest;

    if (attempt < input.maxAttempts) {
      await sleep(input.delayMs);
    }
  }

  throw new Error(
    `Conta Azul charge request URL not found in financial statement for Venda ${input.saleNumber}.`
  );
}

function extractFinancialEventInstallment(
  events: unknown[]
):
  | {
      financialEventId: string;
      installmentId: string;
      installmentVersion: number;
    }
  | undefined {
  for (const event of events) {
    const eventRecord = asRecord(event);
    const financialEventId = stringValue(eventRecord?.id);
    const installments = asArray(asRecord(eventRecord?.paymentCondition)?.installments);
    const installment = installments
      .map(asRecord)
      .find((candidate) => stringValue(candidate?.id));
    const installmentId = stringValue(installment?.id);

    if (financialEventId && installmentId) {
      return {
        financialEventId,
        installmentId,
        installmentVersion: numberValue(installment?.version) ?? 0
      };
    }
  }

  return undefined;
}

function extractChargeRequestFromStatementItems(input: {
  items: unknown[];
  saleNumber: number;
  value: number;
  chargeRequestId: string;
}): { chargeRequestId: string; chargeUrl: string } | undefined {
  const saleDescription = `venda ${input.saleNumber}`;

  for (const item of input.items) {
    const record = asRecord(item);
    const description = stringValue(record?.description)?.toLowerCase() ?? "";
    const value = numberValue(record?.value);
    const descriptionMatches = description.includes(saleDescription);
    const valueMatches = value === undefined ? false : Math.abs(value - input.value) < 0.01;

    if (!descriptionMatches && !valueMatches) continue;

    const chargeRequest = asRecord(record?.chargeRequest);
    const chargeRequestId = stringValue(chargeRequest?.id);
    const chargeUrl = stringValue(chargeRequest?.url);

    if (chargeRequestId === input.chargeRequestId && chargeUrl) {
      return { chargeRequestId, chargeUrl };
    }
  }

  return undefined;
}

function extractChargeRequestId(result: unknown): string {
  const root = asRecord(result);
  const rootId = stringValue(root?.id);
  if (rootId) return rootId;

  const firstItem = asRecord(asArray(root?.items)[0]);
  const itemId = stringValue(firstItem?.id);
  if (itemId) return itemId;

  throw new Error("Conta Azul charge request id not found after boleto creation.");
}

function extractRequiredString(input: unknown, pathSegments: string[], label: string): string {
  const value = valueAtPath(input, pathSegments);
  const parsed = stringValue(value);
  if (parsed) return parsed;
  throw new Error(`Conta Azul ${label} not found.`);
}

function extractOptionalNumber(input: unknown, pathSegments: string[]): number | undefined {
  return numberValue(valueAtPath(input, pathSegments));
}

function valueAtPath(input: unknown, pathSegments: string[]): unknown {
  let current = input;
  for (const segment of pathSegments) {
    current = asRecord(current)?.[segment];
  }
  return current;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toBrazilianDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

function compact(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultOperationId(toolName: string): string {
  return `op_${toolName.replace(/[^a-z0-9]+/gi, "_")}_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

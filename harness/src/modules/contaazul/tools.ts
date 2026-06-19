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
import { parseAccountancyClients, parseFinancialStatementItems } from "./parsers.js";

const LIST_ACCOUNTANCY_CLIENTS_TOOL = "contaazul.list_accountancy_clients";
const SWITCH_TO_PRO_SESSION_TOOL = "contaazul.switch_to_pro_session";
const SEARCH_FINANCIAL_STATEMENT_TOOL = "contaazul.search_financial_statement";
const UPDATE_DUE_DATE_REISSUE_BOLETO_TOOL = "contaazul.update_due_date_reissue_boleto";
const CREATE_CUSTOMER_TOOL = "contaazul.create_customer";
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
  financialAccountId: z.string().optional()
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
    replyTo: z.string().email().optional(),
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
    replyTo: z.string().email().optional(),
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
export type ContaAzulUpdateDueDateReissueBoletoParams = z.input<
  typeof ContaAzulUpdateDueDateReissueBoletoParamsSchema
>;
export type ContaAzulCreateCustomerParams = z.input<typeof ContaAzulCreateCustomerParamsSchema>;
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

export type ContaAzulMutationTools = {
  updateDueDateReissueBoleto(
    params: ContaAzulUpdateDueDateReissueBoletoParams
  ): Promise<ToolReceipt<ContaAzulMutationPlan>>;
  createCustomer(
    params: ContaAzulCreateCustomerParams
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
            "Reemissao de boleto Conta Azul planejada; nenhum POST/PATCH enviado.",
          args: params,
          data
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
      const chargeResult = await options.client.createChargeRequest({
        authToken,
        payload: chargePayload
      });

      return writeMutationReceipt({
        ledgerPath: options.ledgerPath,
        operationId,
        runtimeMode,
        toolName: UPDATE_DUE_DATE_REISSUE_BOLETO_TOOL,
        status: "succeeded",
        summary: "Vencimento atualizado e boleto reemitido no Conta Azul.",
        args: params,
        data: {
          ...data,
          result: { cancelResult, updateResult, chargeResult }
        }
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
      const financialAccountId =
        params.financialAccountId ?? options.config.financialAccountId;
      if (!financialAccountId) {
        const warning =
          "Conta financeira nao configurada: defina CONTAAZUL_FINANCIAL_ACCOUNT_ID antes de criar venda ao vivo.";
        return writeMutationReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: CREATE_SERVICE_SALE_AND_ISSUE_BOLETO_TOOL,
          status: "blocked",
          summary: warning,
          args: params,
          data: {
            approvalPreview: {
              operationId,
              provider: "contaazul",
              toolName: CREATE_SERVICE_SALE_AND_ISSUE_BOLETO_TOOL,
              action: "create",
              target: { customerId: params.customerId, customerName: params.customerName },
              changes: [],
              irreversible: false,
              rollbackNote: "Nenhuma acao executada."
            },
            plannedRequests: []
          },
          warnings: [warning]
        });
      }
      const idempotencyKey =
        params.idempotencyKey ?? createServiceSaleIdempotencyKey(params, financialAccountId);
      const salePayload = buildServiceSalePayload({
        params,
        financialAccountId
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
        companyDisplayName:
          params.notification.companyDisplayName ??
          options.config.defaultCompanyDisplayName,
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

      const duplicate = await findSucceededServiceSaleDuplicate({
        ledgerPath: options.ledgerPath,
        operationId,
        idempotencyKey
      });
      if (duplicate) {
        const warning =
          `Operacao similar ja concluida no Conta Azul: ${duplicate.operationId}. ` +
          "Nenhuma nova venda ou boleto foi criado.";
        return writeMutationReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: CREATE_SERVICE_SALE_AND_ISSUE_BOLETO_TOOL,
          status: "blocked",
          summary: warning,
          args: params,
          data,
          artifacts: duplicate.artifacts.length > 0 ? duplicate.artifacts : [pdfArtifact],
          warnings: [warning],
          responseSummary: {
            summary: warning,
            idempotencyKey,
            duplicateOperationId: duplicate.operationId
          }
        });
      }

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

      const authToken = proSessions.get(params.relationId);
      if (!authToken) {
        throw new Error("Conta Azul Pro session unexpectedly missing after validation.");
      }

      const saleResult = await options.client.createServiceSale({
        authToken,
        payload: salePayload
      });
      const saleId = extractRequiredString(saleResult, ["id"], "created sale id");
      const createdSaleNumber = extractOptionalNumber(saleResult, ["number"]) ?? params.saleNumber;
      const financialEvent = await pollFinancialEventForSale({
        client: options.client,
        authToken,
        saleId,
        maxAttempts: 10,
        delayMs: 2000
      });
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
      const liveNotificationPayload = buildChargeNotificationPayload({
        customerName: params.customerName,
        value: params.unitValue,
        dueDateIso: params.dueDateIso,
        saleNumber: createdSaleNumber,
        email: params.notification.email,
        replyTo: params.notification.replyTo ?? options.config.defaultReplyToEmail,
        companyDisplayName:
          params.notification.companyDisplayName ??
          options.config.defaultCompanyDisplayName,
        chargeRequestIds: [chargeRequestId]
      });
      const notificationResult = await options.client.sendChargeNotification({
        authToken,
        payload: liveNotificationPayload
      });
      const chargeRequestFromStatement = await pollChargeRequestFromFinancialStatement({
        client: options.client,
        authToken,
        saleNumber: createdSaleNumber,
        value: params.unitValue,
        chargeRequestId,
        maxAttempts: 20,
        delayMs: 3000
      });
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
    responseSummary: { error: warning }
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
}): Promise<ToolReceipt<T>> {
  const receipt: ToolReceipt<T> = {
    operationId: input.operationId,
    provider: "contaazul",
    toolName: input.toolName,
    status: input.status,
    dryRun: input.runtimeMode === "dry-run",
    summary: input.summary,
    data: redact(input.data),
    artifacts: [],
    warnings: input.warnings ?? []
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
    field: (item) => String(item.tenantId)
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

  const resolvedParams: ContaAzulCreateServiceSaleAndIssueBoletoParams = {
    operationId: input.operationId,
    approvalText: input.params.approvalText,
    relationId: accountancyClient.relationId,
    customerId: requiredStringField(customer, "id", "customer id"),
    customerName: requiredStringField(customer, "name", "customer name"),
    categoryId: requiredStringField(category, "uuid", "category uuid"),
    serviceItemId: requiredStringField(serviceItem, "id", "service item id"),
    serviceDescription: input.params.serviceDescription,
    unitValue,
    dueDateIso,
    saleDateIso,
    saleNumber,
    operationNatureId: requiredStringField(operationNature, "uuid", "operation nature uuid"),
    financialAccountId: input.params.financialAccountId,
    idempotencyKey: input.params.idempotencyKey,
    notification: {
      email: input.params.notification.email,
      phone: input.params.notification.phone,
      replyTo: input.params.notification.replyTo ?? input.config.defaultReplyToEmail,
      companyDisplayName:
        input.params.notification.companyDisplayName ??
        input.config.defaultCompanyDisplayName
    }
  };
  resolvedParams.idempotencyKey =
    resolvedParams.idempotencyKey ??
    createServiceSaleWorkflowIdempotencyKey(
      resolvedParams,
      resolvedParams.financialAccountId ?? input.config.financialAccountId
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

async function findSucceededServiceSaleDuplicate(input: {
  ledgerPath: string;
  operationId: string;
  idempotencyKey: string;
}): Promise<LedgerEntry | undefined> {
  const entries = await safeReadLedgerEntries(input.ledgerPath);
  return entries
    .slice()
    .reverse()
    .find((entry) => {
      if (entry.provider !== "contaazul") return false;
      if (entry.status !== "succeeded") return false;
      if (
        entry.toolName !== CREATE_SERVICE_SALE_AND_ISSUE_BOLETO_TOOL &&
        entry.toolName !== CREATE_SERVICE_SALE_BOLETO_WORKFLOW_TOOL
      ) {
        return false;
      }

      const summary = asRecord(entry.responseSummary);
      return (
        entry.operationId === input.operationId ||
        stringValue(summary?.idempotencyKey) === input.idempotencyKey
      );
    });
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
  throw new Error(
    `Could not resolve unique ${input.label} for "${input.expected}". Candidates: ${candidates.join(" | ")}`
  );
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
    originFlowType: "SIMPLIFIED_SALE"
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

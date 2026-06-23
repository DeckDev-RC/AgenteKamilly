import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { saveBinaryArtifact, saveJsonArtifact } from "../../core/artifacts.js";
import { parseApprovalText } from "../../core/approval.js";
import { assertLiveMutationAllowed, MutationBlockedError } from "../../core/dry-run.js";
import { z } from "zod";

import { appendLedgerEntry, readLedgerEntries, type LedgerEntry } from "../../core/ledger.js";
import { redact } from "../../core/redaction.js";
import type {
  ApprovalPreview,
  Artifact,
  ChargeLinks,
  CustomerMatch,
  PendingCharge,
  RuntimeMode,
  ToolReceipt
} from "../../core/tool-types.js";
import type { AsaasMutationClient, AsaasSessionClient, CreateBoletoChargeInput } from "./client.js";
import {
  filterCustomersByQuery,
  parseChargeLinksFromHtml,
  parseCustomerTableContent,
  parseChargesTableContent,
  parsePendingChargesTableContent
} from "./parsers.js";

const SEARCH_CUSTOMERS_TOOL = "asaas.search_customers";
const LIST_PENDING_CHARGES_TOOL = "asaas.list_pending_charges";
const LIST_CHARGES_TOOL = "asaas.list_charges";
const GET_CHARGE_LINKS_TOOL = "asaas.get_charge_links";
const UPDATE_CHARGE_DUE_DATE_TOOL = "asaas.update_charge_due_date";
const CREATE_BOLETO_CHARGE_TOOL = "asaas.create_boleto_charge";
const CREATE_BOLETO_CHARGE_WORKFLOW_TOOL = "asaas.create_boleto_charge_workflow";
const DOWNLOAD_BOLETO_PDF_TOOL = "asaas.download_boleto_pdf";
const ASAAS_BASE_URL = "https://www.asaas.com";

export const AsaasSearchCustomersParamsSchema = z.object({
  query: z.string().default(""),
  refreshCache: z.boolean().optional()
});

export const AsaasListPendingChargesParamsSchema = z.object({
  customerId: z.string().min(1)
});

export const AsaasListChargesParamsSchema = z.object({
  customerId: z.string().min(1),
  statusFilter: z.enum(["all", "pending"]).default("all"),
  billingType: z.enum(["all", "boleto"]).default("boleto")
});

export const AsaasGetChargeLinksParamsSchema = z.object({
  chargeId: z.string().min(1)
});

const ApprovalFieldsSchema = z.object({
  operationId: z.string().optional(),
  approvalText: z.string().optional()
});

export const AsaasUpdateChargeDueDateParamsSchema = ApprovalFieldsSchema.extend({
  chargeId: z.string().min(1),
  dueDateBr: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/),
  customerName: z.string().min(1).optional()
});

export const AsaasCreateBoletoChargeParamsSchema = ApprovalFieldsSchema.extend({
  customerId: z.string().min(1),
  valueBr: z.string().min(1),
  dueDateBr: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/),
  description: z.string().min(1),
  idempotencyKey: z.string().min(1).optional()
});

export const AsaasCreateBoletoChargeWorkflowParamsSchema = ApprovalFieldsSchema.extend({
  customerName: z.string().min(1),
  valueBr: z.string().min(1),
  dueDateBr: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/),
  description: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
  refreshCustomerCache: z.boolean().optional()
});

export const AsaasDownloadBoletoPdfParamsSchema = z.object({
  externalToken: z.string().min(1),
  fileName: z.string().min(1).default("boleto.pdf")
});

export type AsaasSearchCustomersParams = z.infer<typeof AsaasSearchCustomersParamsSchema>;
export type AsaasListPendingChargesParams = z.infer<typeof AsaasListPendingChargesParamsSchema>;
export type AsaasListChargesParams = z.infer<typeof AsaasListChargesParamsSchema>;
export type AsaasGetChargeLinksParams = z.infer<typeof AsaasGetChargeLinksParamsSchema>;
export type AsaasUpdateChargeDueDateParams = z.infer<
  typeof AsaasUpdateChargeDueDateParamsSchema
>;
export type AsaasCreateBoletoChargeParams = z.infer<typeof AsaasCreateBoletoChargeParamsSchema>;
export type AsaasCreateBoletoChargeWorkflowParams = z.infer<
  typeof AsaasCreateBoletoChargeWorkflowParamsSchema
>;
export type AsaasDownloadBoletoPdfParams = z.infer<typeof AsaasDownloadBoletoPdfParamsSchema>;

export type PlannedMappedRequest = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  url: string;
  payload?: Record<string, string>;
};

export type AsaasMutationPlan = {
  approvalPreview?: ApprovalPreview;
  plannedRequest: PlannedMappedRequest;
  result?: unknown;
  resolved?: unknown;
  idempotencyKey?: string;
};

export type AsaasReadTools = {
  searchCustomers(params: AsaasSearchCustomersParams): Promise<ToolReceipt<CustomerMatch[]>>;
  listPendingCharges(
    params: AsaasListPendingChargesParams
  ): Promise<ToolReceipt<PendingCharge[]>>;
  listCharges(params: AsaasListChargesParams): Promise<ToolReceipt<PendingCharge[]>>;
  getChargeLinks(params: AsaasGetChargeLinksParams): Promise<ToolReceipt<ChargeLinks>>;
};

export type CreateAsaasReadToolsOptions = {
  client: AsaasSessionClient;
  ledgerPath: string;
  runtimeMode?: RuntimeMode;
  operationIdFactory?: (toolName: string) => string;
  maxCustomerPages?: number;
  customerCachePath?: string;
  customerCacheTtlMs?: number;
};

export type AsaasMutationTools = {
  updateChargeDueDate(
    params: AsaasUpdateChargeDueDateParams
  ): Promise<ToolReceipt<AsaasMutationPlan>>;
  createBoletoCharge(
    params: AsaasCreateBoletoChargeParams
  ): Promise<ToolReceipt<AsaasMutationPlan>>;
  createBoletoChargeWorkflow(
    params: AsaasCreateBoletoChargeWorkflowParams
  ): Promise<ToolReceipt<AsaasMutationPlan>>;
  downloadBoletoPdf(
    params: AsaasDownloadBoletoPdfParams
  ): Promise<ToolReceipt<AsaasMutationPlan>>;
};

export type CreateAsaasMutationToolsOptions = {
  client: AsaasMutationClient;
  ledgerPath: string;
  artifactsDir: string;
  runtimeMode?: RuntimeMode;
  allowLiveMutations?: boolean;
  operationIdFactory?: (toolName: string) => string;
  maxCustomerPages?: number;
  customerCachePath?: string;
  customerCacheTtlMs?: number;
};

export function createAsaasReadTools(options: CreateAsaasReadToolsOptions): AsaasReadTools {
  const runtimeMode = options.runtimeMode ?? "dry-run";
  const createOperationId = options.operationIdFactory ?? defaultOperationId;

  return {
    async searchCustomers(rawParams) {
      const params = AsaasSearchCustomersParamsSchema.parse(rawParams);
      const operationId = createOperationId(SEARCH_CUSTOMERS_TOOL);
      const customers = await loadCustomers({
        client: options.client,
        maxPages: options.maxCustomerPages ?? 20,
        cachePath: options.customerCachePath,
        cacheTtlMs: options.customerCacheTtlMs ?? 24 * 60 * 60 * 1000,
        refreshCache: params.refreshCache === true
      });
      const data = filterCustomersByQuery(customers, params.query);

      return writeReadReceipt({
        ledgerPath: options.ledgerPath,
        operationId,
        runtimeMode,
        toolName: SEARCH_CUSTOMERS_TOOL,
        args: params,
        data,
        summary: `Encontrados ${data.length} cliente(s) no Asaas.`
      });
    },

    async listPendingCharges(rawParams) {
      const params = AsaasListPendingChargesParamsSchema.parse(rawParams);
      const operationId = createOperationId(LIST_PENDING_CHARGES_TOOL);
      const content = await options.client.listChargesPage(params.customerId, 0, 100);
      const data = parsePendingChargesTableContent(content, params.customerId);

      return writeReadReceipt({
        ledgerPath: options.ledgerPath,
        operationId,
        runtimeMode,
        toolName: LIST_PENDING_CHARGES_TOOL,
        args: params,
        data,
        summary: `Encontradas ${data.length} cobranca(s) pendente(s) no Asaas.`
      });
    },

    async listCharges(rawParams) {
      const params = AsaasListChargesParamsSchema.parse(rawParams);
      const operationId = createOperationId(LIST_CHARGES_TOOL);
      const content = await options.client.listChargesPage(params.customerId, 0, 100);
      const data = parseChargesTableContent(content, params.customerId, {
        statusFilter: params.statusFilter,
        billingType: params.billingType
      });

      return writeReadReceipt({
        ledgerPath: options.ledgerPath,
        operationId,
        runtimeMode,
        toolName: LIST_CHARGES_TOOL,
        args: params,
        data,
        summary: `Encontradas ${data.length} cobranca(s) no Asaas.`
      });
    },

    async getChargeLinks(rawParams) {
      const params = AsaasGetChargeLinksParamsSchema.parse(rawParams);
      const operationId = createOperationId(GET_CHARGE_LINKS_TOOL);
      const html = await options.client.getChargeDetailHtml(params.chargeId);
      const data = parseChargeLinksFromHtml(html, params.chargeId);

      return writeReadReceipt({
        ledgerPath: options.ledgerPath,
        operationId,
        runtimeMode,
        toolName: GET_CHARGE_LINKS_TOOL,
        args: params,
        data,
        summary: data.boletoUrl
          ? "Links de boleto/fatura encontrados no Asaas."
          : "Nenhum link de boleto/fatura encontrado no Asaas."
      });
    }
  };
}

export function createAsaasMutationTools(
  options: CreateAsaasMutationToolsOptions
): AsaasMutationTools {
  const runtimeMode = options.runtimeMode ?? "dry-run";
  const allowLiveMutations = options.allowLiveMutations === true;
  const createOperationId = options.operationIdFactory ?? defaultOperationId;

  return {
    async updateChargeDueDate(rawParams) {
      const params = AsaasUpdateChargeDueDateParamsSchema.parse(rawParams);
      const operationId = params.operationId ?? createOperationId(UPDATE_CHARGE_DUE_DATE_TOOL);
      const plannedRequest: PlannedMappedRequest = {
        method: "POST",
        url: `${ASAAS_BASE_URL}/payment/update`,
        payload: { id: params.chargeId, dueDate: params.dueDateBr }
      };
      const approvalPreview: ApprovalPreview = {
        operationId,
        provider: "asaas",
        toolName: UPDATE_CHARGE_DUE_DATE_TOOL,
        action: "update",
        target: { chargeId: params.chargeId },
        changes: [{ field: "dueDate", to: params.dueDateBr }],
        irreversible: false,
        rollbackNote: "O vencimento pode ser alterado novamente se a cobranca ainda permitir edicao."
      };

      if (runtimeMode === "dry-run") {
        return writeMutationReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: UPDATE_CHARGE_DUE_DATE_TOOL,
          status: "planned",
          summary:
            "Alteracao de vencimento planejada; apos aprovar, o PDF atualizado sera baixado.",
          args: params,
          data: { approvalPreview, plannedRequest },
          artifacts: [],
          warnings: [],
          responseSummary: dueDateUpdateResponseSummary(
            params,
            "Alteracao de vencimento planejada; apos aprovar, o PDF atualizado sera baixado."
          )
        });
      }

      const blocked = await blockIfNotApproved({
        ledgerPath: options.ledgerPath,
        operationId,
        runtimeMode,
        allowLiveMutations,
        toolName: UPDATE_CHARGE_DUE_DATE_TOOL,
        args: params,
        data: { approvalPreview, plannedRequest },
        approvalText: params.approvalText
      });
      if (blocked) return blocked;

      const result = await options.client.updateChargeDueDate(params.chargeId, params.dueDateBr);
      const succeeded = result.ok;
      const pdfResult = succeeded
        ? await resolveBoletoPdfArtifactAfterChargeUpdate({
            client: options.client,
            chargeId: params.chargeId,
            operationId,
            artifactsDir: options.artifactsDir
          })
        : { artifacts: [], warnings: [] as string[] };

      const summary = succeeded
        ? pdfResult.artifacts.length > 0
          ? "Vencimento atualizado e PDF do boleto baixado."
          : "Vencimento atualizado no Asaas."
        : `Asaas rejeitou a alteracao com HTTP ${result.status}.`;

      return writeMutationReceipt({
        ledgerPath: options.ledgerPath,
        operationId,
        runtimeMode,
        toolName: UPDATE_CHARGE_DUE_DATE_TOOL,
        status: succeeded ? "succeeded" : "failed",
        summary,
        args: params,
        data: { approvalPreview, plannedRequest, result, chargeLinks: pdfResult.links },
        artifacts: pdfResult.artifacts,
        warnings: pdfResult.warnings,
        responseSummary: dueDateUpdateResponseSummary(params, summary)
      });
    },

    async createBoletoCharge(rawParams) {
      const params = AsaasCreateBoletoChargeParamsSchema.parse(rawParams);
      const operationId = params.operationId ?? createOperationId(CREATE_BOLETO_CHARGE_TOOL);
      const idempotencyKey = params.idempotencyKey ?? createBoletoChargeIdempotencyKey(params);
      const payload = boletoChargePayload(params);
      const plannedRequest: PlannedMappedRequest = {
        method: "POST",
        url: `${ASAAS_BASE_URL}/payment/save`,
        payload
      };
      const approvalPreview: ApprovalPreview = {
        operationId,
        provider: "asaas",
        toolName: CREATE_BOLETO_CHARGE_TOOL,
        action: "create",
        target: { customerId: params.customerId },
        changes: [
          { field: "billingType", to: "BOLETO" },
          { field: "value", to: params.valueBr },
          { field: "dueDate", to: params.dueDateBr }
        ],
        irreversible: false,
        rollbackNote: "A cobranca criada pode exigir cancelamento/delecao manual se algo estiver incorreto."
      };
      const data: AsaasMutationPlan = { approvalPreview, plannedRequest, idempotencyKey };

      const duplicate = await findSucceededAsaasDuplicate({
        ledgerPath: options.ledgerPath,
        operationId,
        idempotencyKey,
        toolName: CREATE_BOLETO_CHARGE_TOOL
      });
      if (duplicate) {
        const warning =
          `Operacao similar ja concluida no Asaas: ${duplicate.operationId}. ` +
          "Nenhuma nova cobranca foi criada.";
        return writeMutationReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: CREATE_BOLETO_CHARGE_TOOL,
          status: "blocked",
          summary: warning,
          args: params,
          data,
          artifacts: duplicate.artifacts,
          warnings: [warning],
          responseSummary: {
            summary: warning,
            idempotencyKey,
            duplicateOperationId: duplicate.operationId
          }
        });
      }

      if (runtimeMode === "dry-run") {
        const planArtifact = await saveJsonArtifact({
          artifactsDir: options.artifactsDir,
          provider: "asaas",
          operationId,
          label: "plano do boleto",
          fileName: "plano_boleto.json",
          contents: redact({ approvalPreview, plannedRequest, idempotencyKey })
        });
        return writeMutationReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: CREATE_BOLETO_CHARGE_TOOL,
          status: "planned",
          summary: "Criacao de boleto planejada; nenhum POST enviado ao Asaas.",
          args: params,
          data,
          artifacts: [planArtifact],
          responseSummary: boletoChargeResponseSummary({
            summary: "Criacao de boleto planejada; nenhum POST enviado ao Asaas.",
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
        toolName: CREATE_BOLETO_CHARGE_TOOL,
        args: params,
        data,
        approvalText: params.approvalText
      });
      if (blocked) return blocked;

      const result = await options.client.createBoletoCharge(params);
      const resultArtifact = await saveJsonArtifact({
        artifactsDir: options.artifactsDir,
        provider: "asaas",
        operationId,
        label: "resultado do boleto",
        fileName: "resultado_boleto.json",
        contents: redact({ idempotencyKey, approvalPreview, result })
      });
      return writeMutationReceipt({
        ledgerPath: options.ledgerPath,
        operationId,
        runtimeMode,
        toolName: CREATE_BOLETO_CHARGE_TOOL,
        status: "succeeded",
        summary: "Boleto criado no Asaas.",
        args: params,
        data: { ...data, result },
        artifacts: [resultArtifact],
        responseSummary: boletoChargeResponseSummary({
          summary: "Boleto criado no Asaas.",
          idempotencyKey,
          params,
          result
        })
      });
    },

    async createBoletoChargeWorkflow(rawParams) {
      const params = AsaasCreateBoletoChargeWorkflowParamsSchema.parse(rawParams);
      const operationId =
        params.operationId ?? createOperationId(CREATE_BOLETO_CHARGE_WORKFLOW_TOOL);

      const customers = await loadCustomers({
        client: options.client,
        maxPages: options.maxCustomerPages ?? 20,
        cachePath: options.customerCachePath,
        cacheTtlMs: options.customerCacheTtlMs ?? 24 * 60 * 60 * 1000,
        refreshCache: params.refreshCustomerCache === true
      });
      const customer = pickByField({
        label: "Asaas customer",
        items: customers,
        expected: params.customerName,
        field: (item) => item.name
      });
      const idempotencyKey =
        params.idempotencyKey ??
        createBoletoChargeIdempotencyKey({
          customerId: customer.id,
          valueBr: params.valueBr,
          dueDateBr: params.dueDateBr,
          description: params.description
        });

      const lowLevelTools = createAsaasMutationTools({
        ...options,
        operationIdFactory: () => operationId
      });
      const receipt = await lowLevelTools.createBoletoCharge({
        operationId,
        approvalText: params.approvalText,
        customerId: customer.id,
        valueBr: params.valueBr,
        dueDateBr: params.dueDateBr,
        description: params.description,
        idempotencyKey
      });

      return {
        ...receipt,
        toolName: CREATE_BOLETO_CHARGE_WORKFLOW_TOOL,
        summary: `Workflow Asaas resolvido. ${receipt.summary}`,
        data: receipt.data
          ? {
              ...receipt.data,
              resolved: {
                customerId: customer.id,
                customerName: customer.name
              }
            }
          : receipt.data
      };
    },

    async downloadBoletoPdf(rawParams) {
      const params = AsaasDownloadBoletoPdfParamsSchema.parse(rawParams);
      const operationId = createOperationId(DOWNLOAD_BOLETO_PDF_TOOL);
      const plannedRequest: PlannedMappedRequest = {
        method: "GET",
        url: `${ASAAS_BASE_URL}/b/pdf/${params.externalToken}`
      };
      // Download de PDF é somente leitura no Asaas — sempre executa o GET real.
      const pdf = await options.client.downloadBoletoPdf(params.externalToken);
      const artifact = await saveBinaryArtifact({
        artifactsDir: options.artifactsDir,
        provider: "asaas",
        operationId,
        label: "boleto pdf",
        fileName: params.fileName,
        kind: "pdf",
        contents: pdf
      });

      return writeMutationReceipt({
        ledgerPath: options.ledgerPath,
        operationId,
        runtimeMode,
        toolName: DOWNLOAD_BOLETO_PDF_TOOL,
        status: "succeeded",
        summary: "PDF do boleto baixado do Asaas.",
        args: params,
        data: { plannedRequest },
        artifacts: [artifact]
      });
    }
  };
}

async function loadAllCustomers(
  client: AsaasSessionClient,
  maxPages: number
): Promise<CustomerMatch[]> {
  const customers: CustomerMatch[] = [];
  const pageSize = 50;

  for (let page = 0; page < maxPages; page++) {
    const offset = page * pageSize;
    const content = await client.listCustomersPage(offset, pageSize);
    const pageCustomers = parseCustomerTableContent(content);

    if (pageCustomers.length === 0) break;

    customers.push(...pageCustomers);

    if (pageCustomers.length < pageSize) break;
  }

  return customers;
}

async function loadCustomers(options: {
  client: AsaasSessionClient;
  maxPages: number;
  cachePath?: string;
  cacheTtlMs: number;
  refreshCache: boolean;
}): Promise<CustomerMatch[]> {
  if (options.cachePath && !options.refreshCache) {
    const cached = await readFreshCustomerCache(options.cachePath, options.cacheTtlMs);
    if (cached) return cached;
  }

  const customers = await loadAllCustomers(options.client, options.maxPages);

  if (options.cachePath) {
    await writeCustomerCache(options.cachePath, customers);
  }

  return customers;
}

async function readFreshCustomerCache(
  cachePath: string,
  cacheTtlMs: number
): Promise<CustomerMatch[] | undefined> {
  try {
    const raw = await readFile(cachePath, "utf-8");
    const parsed = JSON.parse(raw) as { cachedAt?: string; customers?: CustomerMatch[] };
    const cachedAt = parsed.cachedAt ? Date.parse(parsed.cachedAt) : Number.NaN;

    if (!Number.isFinite(cachedAt) || Date.now() - cachedAt > cacheTtlMs) {
      return undefined;
    }

    if (!Array.isArray(parsed.customers)) {
      return undefined;
    }

    return parsed.customers
      .filter((customer) => customer?.id && customer?.name)
      .map((customer) => ({ id: String(customer.id), name: String(customer.name) }));
  } catch {
    return undefined;
  }
}

async function writeCustomerCache(cachePath: string, customers: CustomerMatch[]): Promise<void> {
  await mkdir(path.dirname(cachePath), { recursive: true });
  const cacheableCustomers = customers.map((customer) => ({
    id: customer.id,
    name: customer.name
  }));

  await writeFile(
    cachePath,
    `${JSON.stringify({ cachedAt: new Date().toISOString(), customers: cacheableCustomers }, null, 2)}\n`,
    "utf-8"
  );
}

async function writeReadReceipt<T>(input: {
  ledgerPath: string;
  operationId: string;
  runtimeMode: RuntimeMode;
  toolName: string;
  args: unknown;
  data: T;
  summary: string;
}): Promise<ToolReceipt<T>> {
  const receipt: ToolReceipt<T> = {
    operationId: input.operationId,
    provider: "asaas",
    toolName: input.toolName,
    status: "succeeded",
    dryRun: input.runtimeMode === "dry-run",
    summary: input.summary,
    data: input.data,
    artifacts: [],
    warnings: []
  };

  await appendLedgerEntry(input.ledgerPath, {
    operationId: receipt.operationId,
    provider: receipt.provider,
    toolName: receipt.toolName,
    status: receipt.status,
    args: input.args,
    responseSummary: {
      summary: receipt.summary,
      itemCount: Array.isArray(input.data) ? input.data.length : undefined
    },
    artifacts: receipt.artifacts,
    warnings: receipt.warnings
  });

  return receipt;
}

async function blockIfNotApproved(input: {
  ledgerPath: string;
  operationId: string;
  runtimeMode: RuntimeMode;
  allowLiveMutations: boolean;
  toolName: string;
  args: unknown;
  data: AsaasMutationPlan;
  approvalText?: string;
}): Promise<ToolReceipt<AsaasMutationPlan> | undefined> {
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
      warnings: [error.message]
    });
  }
}

async function writeMutationReceipt<T>(input: {
  ledgerPath: string;
  operationId: string;
  runtimeMode: RuntimeMode;
  toolName: string;
  status: ToolReceipt<T>["status"];
  summary: string;
  args: unknown;
  data: T;
  artifacts?: Artifact[];
  warnings?: string[];
  responseSummary?: unknown;
}): Promise<ToolReceipt<T>> {
  const receipt: ToolReceipt<T> = {
    operationId: input.operationId,
    provider: "asaas",
    toolName: input.toolName,
    status: input.status,
    dryRun: input.runtimeMode === "dry-run",
    summary: input.summary,
    data: redact(input.data),
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

function dueDateUpdateResponseSummary(
  params: AsaasUpdateChargeDueDateParams,
  summary = "Alteracao de vencimento planejada; apos aprovar, o PDF atualizado sera baixado."
): Record<string, string> {
  const output: Record<string, string> = {
    summary,
    chargeId: params.chargeId,
    dueDateBr: params.dueDateBr
  };
  if (params.customerName) output.customerName = params.customerName;
  return output;
}

async function resolveBoletoPdfArtifactAfterChargeUpdate(input: {
  client: AsaasMutationClient;
  chargeId: string;
  operationId: string;
  artifactsDir: string;
}): Promise<{
  links?: ChargeLinks;
  artifacts: Artifact[];
  warnings: string[];
}> {
  try {
    const html = await input.client.getChargeDetailHtml(input.chargeId);
    const links = parseChargeLinksFromHtml(html, input.chargeId);
    const token = links.externalToken;
    if (!token) {
      return {
        links,
        artifacts: [],
        warnings: ["Nao foi possivel obter o link do boleto apos a alteracao."]
      };
    }

    const fileName = `boleto_${input.chargeId}.pdf`;
    const pdf = await input.client.downloadBoletoPdf(token);
    const artifact = await saveBinaryArtifact({
      artifactsDir: input.artifactsDir,
      provider: "asaas",
      operationId: input.operationId,
      label: "boleto pdf atualizado",
      fileName,
      kind: "pdf",
      contents: pdf
    });

    return { links, artifacts: [artifact], warnings: [] };
  } catch (error) {
    return {
      artifacts: [],
      warnings: [
        error instanceof Error
          ? `Falha ao baixar PDF do boleto: ${error.message}`
          : "Falha ao baixar PDF do boleto."
      ]
    };
  }
}

function boletoChargePayload(input: CreateBoletoChargeInput): Record<string, string> {
  return {
    customerAccountId: input.customerId,
    chargeType: "DETACHED",
    chargeTarget: "individual",
    billingType: "BOLETO",
    totalValue: input.valueBr,
    value: input.valueBr,
    dueDate: input.dueDateBr,
    "interest.value": "2,00",
    "fine.fineType": "PERCENTAGE",
    "fine.value": "1,00",
    description: input.description
  };
}

function createBoletoChargeIdempotencyKey(input: {
  customerId: string;
  valueBr: string;
  dueDateBr: string;
  description: string;
}): string {
  const payload = {
    provider: "asaas",
    toolName: CREATE_BOLETO_CHARGE_TOOL,
    customerId: input.customerId,
    valueBr: normalizeMoneyBr(input.valueBr),
    dueDateBr: input.dueDateBr,
    description: normalizeText(input.description)
  };
  return `asaas-boleto:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}

async function findSucceededAsaasDuplicate(input: {
  ledgerPath: string;
  operationId: string;
  idempotencyKey: string;
  toolName: string;
}): Promise<LedgerEntry | undefined> {
  const entries = await safeReadLedgerEntries(input.ledgerPath);
  return entries
    .slice()
    .reverse()
    .find((entry) => {
      if (entry.provider !== "asaas") return false;
      if (entry.status !== "succeeded") return false;
      if (entry.toolName !== input.toolName) return false;

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

function boletoChargeResponseSummary(input: {
  summary: string;
  idempotencyKey: string;
  params: AsaasCreateBoletoChargeParams;
  result?: unknown;
}): Record<string, unknown> {
  const result = asRecord(input.result);
  return {
    summary: input.summary,
    idempotencyKey: input.idempotencyKey,
    customerId: input.params.customerId,
    dueDateBr: input.params.dueDateBr,
    valueBr: input.params.valueBr,
    paymentId: stringValue(result?.paymentId),
    externalToken: stringValue(result?.externalToken)
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

function normalizeMoneyBr(value: string): string {
  const parsed = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed.toFixed(2) : value.trim();
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function defaultOperationId(toolName: string): string {
  return `op_${toolName.replace(/[^a-z0-9]+/gi, "_")}_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

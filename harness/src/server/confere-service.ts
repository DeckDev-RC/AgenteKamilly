import { config as loadDotenv } from "dotenv";
import path from "node:path";

import { runAgentTurn } from "../agent/agent-runner.js";
import { createAgentModelProvider } from "../agent/model-provider-factory.js";
import type { ModelProvider } from "../agent/model-provider.js";
import { loadHarnessConfig, type HarnessConfig } from "../core/config.js";
import { checkConnections, type ConnectionHealth } from "../core/connection-health.js";
import { SessionExpiredError } from "../core/http-client.js";
import { createPreferencesStore } from "../core/preferences-store.js";
import {
  createDefaultMappedToolRegistry,
  resolveConfigCwd,
  type RuntimeRegistryResult
} from "../core/harness-runtime.js";
import {
  listOperationSummaries,
  summarizeOperationById
} from "../core/operation-summary.js";
import {
  checkContaAzulSessionState,
  loadBrowserState
} from "../core/session-store.js";
import type { ToolRegistry } from "../core/tool-registry.js";
import type { ToolReceipt } from "../core/tool-types.js";
import { MappedContaAzulSessionClient } from "../modules/contaazul/client.js";
import { parseAccountancyClients } from "../modules/contaazul/parsers.js";
import type {
  AgentTurnApiRequest,
  AgentTurnApiResponse,
  ConfirmationSheetApiResponse,
  ConfirmationSheetView,
  ConfereStatus,
  ExecuteOperationApiRequest,
  ExecuteOperationApiResponse
} from "./api-types.js";
import {
  createDraftStore,
  type DraftStore,
  type OperationDraft
} from "./draft-store.js";
import {
  createInteractiveFlowStore,
  runInteractiveFlowTurn
} from "./interactive-flow-controller.js";
import { formatAgentBlockedMessage } from "./agent-user-messages.js";

export type ConfereService = {
  getStatus(): Promise<ConfereStatus>;
  checkConnections(): Promise<ConnectionHealth[]>;
  runAgentTurn(input: AgentTurnApiRequest): Promise<AgentTurnApiResponse>;
  getConfirmationSheet(operationId: string): Promise<ConfirmationSheetApiResponse>;
  executeApprovedOperation(input: ExecuteOperationApiRequest): Promise<ExecuteOperationApiResponse>;
  listOperations(limit?: number): Promise<Awaited<ReturnType<typeof listOperationSummaries>>>;
  summarizeOperation(operationId: string): Promise<Awaited<ReturnType<typeof summarizeOperationById>>>;
  getDraft(operationId: string): OperationDraft | undefined;
  saveDraftForTest(draft: OperationDraft): void;
  listAccountancyClients(): Promise<any[]>;
  searchSaleCustomers(relationId: string, searchTerm: string): Promise<any[]>;
  searchFinancialCategories(relationId: string, searchTerm: string): Promise<any[]>;
  searchServiceItems(relationId: string, searchTerm: string): Promise<any[]>;
};

export type CreateConfereServiceOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  registryFactory?: (config: HarnessConfig) => Promise<RuntimeRegistryResult>;
  modelProvider?: ModelProvider;
  draftStore?: DraftStore;
};

export async function createConfereService(
  options: CreateConfereServiceOptions = {}
): Promise<ConfereService> {
  const cwd = resolveConfigCwd(options.cwd ?? process.cwd());
  loadDotenv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });
  loadDotenv({ path: path.resolve(cwd, "contaazul/.env"), override: false, quiet: true });
  const baseEnv = { ...process.env, ...(options.env ?? {}) };
  // Persist Pro-session tokens across agent turns. runtime() rebuilds the tool
  // registry every turn, so without a shared store the session switched on the
  // tenant-selection turn is gone by the search turn (search would block as
  // "Pro session not available"). One store, reused by every per-turn registry.
  const proSessionStore = new Map<string, string>();
  const registryFactory =
    options.registryFactory ??
    ((config: HarnessConfig) => createDefaultMappedToolRegistry(config, proSessionStore));
  const draftStore = options.draftStore ?? createDraftStore();
  const interactiveFlowStore = createInteractiveFlowStore();

  function loadConfig(runtimeMode?: "dry-run" | "live"): HarnessConfig {
    return loadHarnessConfig(
      {
        ...baseEnv,
        RUNTIME_MODE: runtimeMode ?? baseEnv.RUNTIME_MODE
      },
      cwd
    );
  }

  // Memória de preferências (última empresa, clientes recentes) persistida no disco.
  const preferencesStore = createPreferencesStore(
    path.join(loadConfig("dry-run").artifactsDir, "preferences.json")
  );

  async function runtime(runtimeMode?: "dry-run" | "live"): Promise<{
    config: HarnessConfig;
    registry: ToolRegistry;
    warnings: string[];
  }> {
    const config = loadConfig(runtimeMode);
    const { registry, warnings } = await registryFactory(config);
    return { config, registry, warnings };
  }

  async function getContaAzulClient() {
    const config = loadConfig("dry-run");
    const state = await loadBrowserState(config.contaAzulStatePath);
    const health = checkContaAzulSessionState(state);
    if (!health.ok) {
      throw new Error(`Sessão do Conta Azul inválida ou expirada. ${health.reason}`);
    }
    return new MappedContaAzulSessionClient({ state });
  }

  async function getProAuthToken(relationId: string): Promise<string> {
    let token = proSessionStore.get(relationId);
    if (!token) {
      const client = await getContaAzulClient();
      const session = await client.switchToProSession(relationId);
      token = session.authToken;
      proSessionStore.set(relationId, token);
    }
    return token;
  }

  return {
    async getStatus() {
      const { config, warnings } = await runtime("dry-run");
      return {
        appName: "Confere",
        runtimeMode: config.runtimeMode,
        allowLiveMutations: config.allowLiveMutations,
        sessions: {
          asaas: warnings.some((warning) => warning.includes("Asaas session env not found"))
            ? "missing"
            : "available",
          contaazul: warnings.some((warning) => warning.includes("Conta Azul state not found"))
            ? "missing"
            : "available"
        },
        model: {
          provider: config.agentModelProvider,
          model: config.agentModelName,
          dailyLimit: config.agentModelMaxDailyRequests,
          usagePath: config.agentModelUsagePath
        },
        warnings,
        artifactsDir: config.artifactsDir,
        ledgerPath: config.ledgerPath
      };
    },

    async checkConnections() {
      const config = loadConfig("dry-run");
      return checkConnections(config);
    },

    async runAgentTurn(input) {
      const { config, registry, warnings } = await runtime("dry-run");
      try {
        const params = {
          ...(input.params ?? {}),
          ...(input.operatorConfirmation ? { operatorConfirmation: true } : {})
        };
        const interactive = await runInteractiveFlowTurn({
          request: input.request,
          registry,
          sessionId: input.sessionId,
          store: interactiveFlowStore,
          params,
          memory: preferencesStore
        });
        if (interactive.handled) {
          const draftsToSave = interactive.drafts?.length
            ? interactive.drafts
            : interactive.draft
              ? [interactive.draft]
              : [];
          for (const draft of draftsToSave) {
            draftStore.save({
              operationId: draft.operationId,
              toolName: draft.toolName,
              request: input.request,
              params: draft.params,
              createdAt: new Date().toISOString()
            });
          }
          return {
            status: "ok",
            result: interactive.result,
            draftOperationId: interactive.draftOperationId,
            warnings
          };
        }

        const provider = options.modelProvider ?? createAgentModelProvider(config);
        const result = await runAgentTurn({
          request: input.request,
          registry,
          provider,
          runtimeMode: "dry-run",
          params,
          sessionId: input.sessionId,
          sessionsDir: config.agentSessionsDir
        });
        const draftOperationId = saveDraftFromAgentResult({
          draftStore,
          request: input.request,
          result
        });
        return {
          status: "ok",
          result: toAgentResultView(result),
          draftOperationId,
          warnings
        };
      } catch (error) {
        const expired = sessionExpiredMessage(error);
        if (!expired) throw error;
        return {
          status: "ok",
          result: {
            status: "blocked",
            missingFields: [],
            questions: [],
            warnings: [],
            approvalAvailable: false,
            reason: expired.message,
            summary: expired.message,
            toolName: expired.provider ? `${expired.provider}.session` : undefined
          },
          warnings
        };
      }
    },

    async getConfirmationSheet(operationId) {
      const draft = draftStore.get(operationId);
      if (!draft) {
        return {
          status: "blocked",
          reason: `No active dry-run draft found for operation: ${operationId}`
        };
      }
      if (!isLiveApprovalToolAllowed(draft.toolName)) {
        return {
          status: "blocked",
          reason: `Tool is not allowed for Confere live approval: ${draft.toolName}`
        };
      }
      return {
        status: "ok",
        sheet: confirmationSheetFromDraft(draft)
      };
    },

    async executeApprovedOperation(input) {
      const draft = draftStore.consume(input.operationId);
      if (!draft) {
        return {
          status: "blocked",
          reason: `No active dry-run draft found for operation: ${input.operationId}`
        };
      }
      if (!isLiveApprovalToolAllowed(draft.toolName)) {
        draftStore.save(draft);
        return {
          status: "blocked",
          reason: `Tool is not allowed for Confere live approval: ${draft.toolName}`
        };
      }
      const { config, registry } = await runtime("live");
      if (!config.allowLiveMutations) {
        draftStore.save(draft);
        return {
          status: "blocked",
          reason: "Live mutations are disabled. Set ALLOW_LIVE_MUTATIONS=true for controlled execution."
        };
      }
      const tool = registry.list().find((definition) => definition.name === draft.toolName);
      if (!tool) {
        draftStore.save(draft);
        return { status: "blocked", reason: `Mapped tool is not registered: ${draft.toolName}` };
      }
      const params = tool.parameters.parse({
        ...normalizeDraftParamsForExecution(draft.toolName, draft.params),
        operationId: input.operationId,
        approvalText: `APROVAR ${input.operationId}`
      });
      const receipt = (await tool.execute(params)) as ToolReceipt;
      const operation = await summarizeOperationById({
        ledgerPath: config.ledgerPath,
        operationId: input.operationId
      });
      return {
        status: "executed",
        operation,
        receiptStatus: receipt.status,
        warnings: receipt.warnings
      };
    },

    async listOperations(limit) {
      const config = loadConfig("dry-run");
      return listOperationSummaries({ ledgerPath: config.ledgerPath, limit });
    },

    async summarizeOperation(operationId) {
      const config = loadConfig("dry-run");
      return summarizeOperationById({ ledgerPath: config.ledgerPath, operationId });
    },

    getDraft(operationId) {
      return draftStore.get(operationId);
    },

    saveDraftForTest(draft) {
      draftStore.save(draft);
    },

    async listAccountancyClients() {
      const client = await getContaAzulClient();
      const raw = await client.listAccountancyClients();
      return parseAccountancyClients(raw);
    },

    async searchSaleCustomers(relationId, searchTerm) {
      const client = await getContaAzulClient();
      const authToken = await getProAuthToken(relationId);
      return client.searchSaleCustomers({ authToken, searchTerm });
    },

    async searchFinancialCategories(relationId, searchTerm) {
      const client = await getContaAzulClient();
      const authToken = await getProAuthToken(relationId);
      return client.searchFinancialCategories({ authToken, searchTerm });
    },

    async searchServiceItems(relationId, searchTerm) {
      const client = await getContaAzulClient();
      const authToken = await getProAuthToken(relationId);
      return client.searchServiceItems({ authToken, searchTerm });
    }
  };
}

const PROVIDER_LABEL: Record<string, string> = {
  asaas: "Asaas",
  contaazul: "Conta Azul"
};

/**
 * Traduz erros de sessão expirada em uma mensagem amigável. Cobre tanto o
 * `SessionExpiredError` (caminhos já tratados) quanto a rede de segurança para o
 * `SyntaxError` cru de "Unexpected token '<'" (quando algum read ainda faz
 * `response.json()` direto numa página de login HTML).
 */
function sessionExpiredMessage(
  error: unknown
): { provider?: "asaas" | "contaazul"; message: string } | undefined {
  if (error instanceof SessionExpiredError) {
    const label = PROVIDER_LABEL[error.provider] ?? error.provider;
    return {
      provider: error.provider,
      message: `Sessão do ${label} expirada ou inválida. Vá em Sessões → Renovar credenciais.`
    };
  }
  if (
    error instanceof SyntaxError &&
    /Unexpected token '<'|<!DOCTYPE|is not valid JSON/i.test(error.message)
  ) {
    return {
      message: "Uma sessão (Asaas ou Conta Azul) expirou. Vá em Sessões → Renovar credenciais."
    };
  }
  return undefined;
}

function saveDraftFromAgentResult(input: {
  draftStore: DraftStore;
  request: string;
  result: Awaited<ReturnType<typeof runAgentTurn>>;
}): string | undefined {
  if (input.result.status !== "executed") return undefined;
  if (input.result.receipt.status !== "planned") return undefined;

  const data = input.result.receipt.data;
  const approvalPreview = data && typeof data === "object" && "approvalPreview" in data
    ? (data as { approvalPreview?: { operationId?: string } }).approvalPreview
    : undefined;
  const operationId = approvalPreview?.operationId ?? input.result.receipt.operationId;

  input.draftStore.save({
    operationId,
    toolName: input.result.receipt.toolName,
    request: input.request,
    params: input.result.plan.params,
    createdAt: new Date().toISOString()
  });
  return operationId;
}

const LIVE_APPROVAL_TOOL_ALLOWLIST = new Set([
  "asaas.create_boleto_charge_workflow",
  "asaas.update_charge_due_date",
  "contaazul.create_service_sale_boleto_workflow",
  "contaazul.update_due_date_reissue_boleto_workflow",
  "contaazul.create_customer_workflow",
  "contaazul.acknowledge_orphan_cleanup"
]);

function isLiveApprovalToolAllowed(toolName: string): boolean {
  return LIVE_APPROVAL_TOOL_ALLOWLIST.has(toolName);
}

function normalizeDraftParamsForExecution(
  toolName: string,
  params: Record<string, unknown>
): Record<string, unknown> {
  if (toolName !== "asaas.update_charge_due_date") return params;
  if (stringValue(params.chargeId)) return params;

  const fromArray = params.chargeIds;
  if (Array.isArray(fromArray) && fromArray.length > 0) {
    return { ...params, chargeId: String(fromArray[0]) };
  }

  const csv = stringValue(params.chargeIds);
  if (csv) {
    const [first] = csv.split(",").map((part) => part.trim()).filter(Boolean);
    if (first) return { ...params, chargeId: first };
  }

  return params;
}

function confirmationSheetFromDraft(draft: OperationDraft): ConfirmationSheetView {
  return {
    operationId: draft.operationId,
    toolName: draft.toolName,
    provider: draft.toolName.startsWith("asaas.") ? "asaas" : "contaazul",
    tenantId: stringOrNumber(draft.params.tenantId),
    tenantName: stringValue(draft.params.tenantName) ?? stringValue(draft.params.companyName),
    customerName: stringValue(draft.params.customerName),
    categoryName: stringValue(draft.params.categoryName),
    itemName: stringValue(draft.params.itemName),
    description:
      stringValue(draft.params.serviceDescription) ?? stringValue(draft.params.description),
    value:
      stringOrNumber(draft.params.unitValue) ??
      stringValue(draft.params.unitValueBr) ??
      stringValue(draft.params.valueBr),
    dueDate:
      stringValue(draft.params.dueDateBr) ?? stringValue(draft.params.dueDateIso),
    idempotencyKey: stringValue(draft.params.idempotencyKey),
    warnings: []
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringOrNumber(value: unknown): string | number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return stringValue(value);
}

function publicAgentSummary(status: string): string {
  const summaries: Record<string, string> = {
    planned: "Plano preparado para revisão.",
    blocked: "Operação bloqueada pelo harness.",
    failed: "Workflow falhou antes de liberar execução.",
    succeeded: "Workflow concluído.",
    running: "Workflow em execução.",
    approved: "Operação aprovada."
  };
  return summaries[status] ?? "Resultado recebido do harness.";
}

function toAgentResultView(result: Awaited<ReturnType<typeof runAgentTurn>>) {
  if (result.status === "executed") {
    return {
      status: "executed" as const,
      provider: result.provider,
      model: result.model,
      intent: result.plan.intent,
      toolName: result.receipt.toolName,
      operationId: result.receipt.operationId,
      receiptStatus: result.receipt.status,
      summary: publicAgentSummary(result.receipt.status),
      missingFields: [],
      questions: [],
      warnings: result.receipt.warnings,
      risk: result.plan.risk,
      confidence: result.plan.confidence,
      approvalAvailable: result.receipt.status === "planned"
    };
  }

  if (result.status === "needs_input") {
    return {
      status: "needs_input" as const,
      provider: result.provider,
      model: result.model,
      intent: result.intent,
      toolName: result.toolName,
      missingFields: result.missingFields,
      questions: result.questions,
      warnings: [],
      risk: result.risk,
      confidence: result.confidence,
      approvalAvailable: false,
      reason: result.reason,
      summary: result.reason
    };
  }

  if (result.status === "planned") {
    return {
      status: "planned" as const,
      provider: result.provider,
      model: result.model,
      intent: result.plan.intent,
      toolName: result.plan.toolName,
      missingFields: [],
      questions: [],
      warnings: [],
      risk: result.plan.risk,
      confidence: result.plan.confidence,
      approvalAvailable: false,
      reason: result.plan.reason,
      summary: result.plan.reason
    };
  }

  return {
    status: result.status,
    missingFields: [],
    questions: [],
    warnings: [],
    approvalAvailable: false,
    reason: formatAgentBlockedMessage("reason" in result ? result.reason : undefined),
    toolName: "toolName" in result ? result.toolName : undefined,
    summary: formatAgentBlockedMessage("reason" in result ? result.reason : undefined)
  };
}

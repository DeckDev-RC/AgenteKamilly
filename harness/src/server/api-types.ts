import type { ConnectionHealth } from "../core/connection-health.js";
import type { OperationSummary } from "../core/operation-summary.js";
import type { OperationStatus, Provider, RuntimeMode } from "../core/tool-types.js";

export type { ConnectionHealth, ConnectionStatus } from "../core/connection-health.js";

export type ConfereModule = "home" | "contaazul" | "asaas" | "operacoes" | "sessoes";

export type CheckConnectionsApiResponse = {
  status: "ok";
  connections: ConnectionHealth[];
};

export type RenewProvider = "asaas" | "contaazul";

/** Eventos emitidos pelo processo de renovação (captura) para a UI. */
export type RenewEvent =
  | { provider: RenewProvider; type: "log"; line: string }
  | { provider: RenewProvider; type: "ready" }
  | { provider: RenewProvider; type: "done"; ok: boolean; detail?: string };

export type RenewStartApiResponse =
  | { status: "started" }
  | { status: "unavailable"; reason: string };

export type ConfereStatus = {
  appName: "Confere";
  runtimeMode: RuntimeMode;
  allowLiveMutations: boolean;
  sessions: {
    asaas: "available" | "missing" | "invalid";
    contaazul: "available" | "missing" | "invalid";
  };
  model: {
    provider: "gemini";
    model: string;
    dailyLimit: number;
    usagePath: string;
  };
  warnings: string[];
  artifactsDir: string;
  ledgerPath: string;
};

export type AgentTurnApiRequest = {
  request: string;
  module?: "contaazul" | "asaas";
  sessionId?: string;
  params?: Record<string, unknown>;
  operatorConfirmation?: boolean;
};

export type AgentTurnApiResponse = {
  status: "ok";
  result: AgentResultView;
  draftOperationId?: string;
  warnings: string[];
};

export type AgentResultView = {
  status: "needs_input" | "planned" | "blocked" | "unsupported" | "executed";
  provider?: Provider | "gemini";
  model?: string;
  intent?: string;
  toolName?: string;
  operationId?: string;
  receiptStatus?: OperationStatus;
  summary?: string;
  missingFields: string[];
  questions: string[];
  warnings: string[];
  risk?: "low" | "medium" | "high";
  confidence?: number;
  approvalAvailable: boolean;
  reason?: string;
  candidates?: string[];
  choices?: AgentChoiceView[];
  fieldName?: string;
  receiptData?: unknown;
  /** Formulário embutido no chat (ex.: dados da cobrança após seleções). */
  formId?: string;
  formDefaults?: Record<string, string>;
  formContext?: Record<string, string>;
  /** Opções para campos select do formulário embutido (ex.: categoria, item). */
  formChoices?: Record<string, AgentChoiceView[]>;
};

export type AgentChoiceView = {
  id: string;
  label: string;
  description?: string;
  request?: string;
  params?: Record<string, unknown>;
};

export type ExecuteOperationApiRequest = {
  operationId: string;
};

export type ConfirmationSheetApiResponse =
  | {
      status: "ok";
      sheet: ConfirmationSheetView;
    }
  | {
      status: "blocked";
      reason: string;
    };

export type ExecuteOperationApiResponse =
  | {
      status: "executed";
      operation: OperationSummary;
      receiptStatus: OperationStatus;
      warnings: string[];
    }
  | {
      status: "blocked";
      reason: string;
    };

export type ConfirmationSheetView = {
  operationId: string;
  toolName?: string;
  provider?: Provider;
  tenantId?: string | number;
  tenantName?: string;
  customerName?: string;
  categoryName?: string;
  itemName?: string;
  description?: string;
  value?: string | number;
  dueDate?: string;
  saleNumber?: string | number;
  chargeUrl?: string;
  idempotencyKey?: string;
  duplicateOperationId?: string;
  orphanedSaleId?: string;
  warnings: string[];
};

export type OperationListApiResponse = {
  status: "ok";
  operations: OperationSummary[];
};

export type OperationSummaryApiResponse = {
  status: "ok";
  operation: OperationSummary;
};

export type AppSettingsView = {
  envPath: string;
  allowLiveMutations: boolean;
  geminiApiKeyConfigured: boolean;
  geminiApiKeyHint?: string;
};

export type UpdateAppSettingsRequest = {
  allowLiveMutations?: boolean;
  geminiApiKey?: string;
};

export type UpdateAppSettingsResponse = {
  status: "ok";
  settings: AppSettingsView;
};

export type ConversationSummaryView = {
  id: string;
  title: string;
  updatedAt: string;
  preview: string;
  messageCount: number;
};

export type ConversationListApiResponse = {
  status: "ok";
  conversations: ConversationSummaryView[];
};

export type StoredConversationView = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Array<
    | {
        id: string;
        role: "user";
        text: string;
        timestamp: string;
      }
    | {
        id: string;
        role: "assistant";
        result: AgentResultView;
        draftOperationId?: string;
        timestamp: string;
      }
  >;
};

export type ConversationGetApiResponse =
  | { status: "ok"; conversation: StoredConversationView }
  | { status: "not_found" };

export type ConversationSaveApiRequest = StoredConversationView;

export type ConversationSaveApiResponse = {
  status: "ok";
  conversation: ConversationSummaryView;
};

export type ConversationDeleteApiResponse = {
  status: "ok" | "not_found";
};

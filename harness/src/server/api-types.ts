import type { OperationSummary } from "../core/operation-summary.js";
import type { OperationStatus, Provider, RuntimeMode } from "../core/tool-types.js";

export type ConfereModule = "home" | "contaazul" | "asaas" | "operacoes" | "sessoes";

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

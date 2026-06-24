import type {
  AgentTurnApiRequest,
  AgentTurnApiResponse,
  AppSettingsView,
  CheckConnectionsApiResponse,
  ConfirmationSheetApiResponse,
  ConfereStatus,
  ConnectionHealth,
  ConversationDeleteApiResponse,
  ConversationGetApiResponse,
  ConversationListApiResponse,
  ConversationSaveApiRequest,
  ConversationSaveApiResponse,
  ExecuteOperationApiResponse,
  OperationListApiResponse,
  OperationSummaryApiResponse,
  RenewEvent,
  RenewProvider,
  RenewStartApiResponse,
  UpdateAppSettingsRequest,
  UpdateAppSettingsResponse
} from "../server/api-types.js";

let cachedBaseUrl: string | undefined;

export async function getApiBaseUrl(): Promise<string> {
  if (cachedBaseUrl) return cachedBaseUrl;
  cachedBaseUrl = "http://127.0.0.1:3737";
  return cachedBaseUrl;
}

export async function getStatus(): Promise<ConfereStatus> {
  if (window.confere) return window.confere.getStatus();
  return getJson("/api/status");
}

// Fora do shell do Electron (preview no navegador) não há checagem real de
// sessão; mostramos "missing" para exercitar o onboarding visualmente.
const PREVIEW_CONNECTIONS: ConnectionHealth[] = [
  {
    provider: "asaas",
    label: "Asaas",
    status: "missing",
    detail: "Pré-visualização sem backend.",
    checkedAt: new Date().toISOString(),
    recaptureCommand: "node renew-session.cjs asaas"
  },
  {
    provider: "contaazul",
    label: "Conta Azul",
    status: "missing",
    detail: "Pré-visualização sem backend.",
    checkedAt: new Date().toISOString(),
    recaptureCommand: "node renew-session.cjs contaazul"
  }
];

export async function checkConnections(): Promise<ConnectionHealth[]> {
  if (window.confere) {
    const response = await window.confere.checkConnections();
    return response.connections;
  }
  return PREVIEW_CONNECTIONS;
}

export async function renewConnection(provider: RenewProvider): Promise<RenewStartApiResponse> {
  if (window.confere) return window.confere.renewConnection(provider);
  return { status: "unavailable", reason: "Renovação disponível apenas no app desktop." };
}

export async function confirmRenew(provider: RenewProvider): Promise<void> {
  if (window.confere) {
    await window.confere.confirmRenew(provider);
  }
}

export function onRenewEvent(callback: (event: RenewEvent) => void): () => void {
  if (window.confere) return window.confere.onRenewEvent(callback);
  return () => undefined;
}

export async function runAgentTurn(input: AgentTurnApiRequest): Promise<AgentTurnApiResponse> {
  if (window.confere) return window.confere.runAgentTurn(input);
  return postJson("/api/agent/turn", input);
}

export async function executeOperation(operationId: string): Promise<ExecuteOperationApiResponse> {
  if (!window.confere) {
    return {
      status: "blocked",
      reason: "Live execution is available only inside the Confere desktop shell."
    };
  }
  return window.confere.executeApprovedOperation(operationId);
}

export async function listOperations(): Promise<OperationListApiResponse> {
  if (window.confere) return window.confere.listOperations();
  return getJson("/api/operations?limit=50");
}

export async function getOperation(operationId: string): Promise<OperationSummaryApiResponse> {
  if (window.confere) return window.confere.getOperation(operationId);
  return getJson(`/api/operations/${encodeURIComponent(operationId)}`);
}

export async function getConfirmationSheet(
  operationId: string
): Promise<ConfirmationSheetApiResponse> {
  if (!window.confere) {
    return {
      status: "blocked",
      reason: "Live confirmation is available only inside the Confere desktop shell."
    };
  }
  return window.confere.getConfirmationSheet(operationId);
}

export async function getAppSettings(): Promise<AppSettingsView> {
  if (window.confere) return window.confere.getAppSettings();
  return {
    envPath: ".env",
    allowLiveMutations: false,
    geminiApiKeyConfigured: false
  };
}

export async function updateAppSettings(
  input: UpdateAppSettingsRequest
): Promise<UpdateAppSettingsResponse> {
  if (!window.confere) {
    throw new Error("Configurações disponíveis apenas no app desktop.");
  }
  return window.confere.updateAppSettings(input);
}

export async function listConversations(): Promise<ConversationListApiResponse> {
  if (window.confere) return window.confere.listConversations();
  return { status: "ok", conversations: [] };
}

export async function getConversation(id: string): Promise<ConversationGetApiResponse> {
  if (window.confere) return window.confere.getConversation(id);
  return { status: "not_found" };
}

export async function saveConversation(
  input: ConversationSaveApiRequest
): Promise<ConversationSaveApiResponse> {
  if (!window.confere) {
    throw new Error("Histórico disponível apenas no app desktop.");
  }
  return window.confere.saveConversation(input);
}

export async function deleteConversation(id: string): Promise<ConversationDeleteApiResponse> {
  if (!window.confere) return { status: "not_found" };
  return window.confere.deleteConversation(id);
}

async function getJson<T>(path: string): Promise<T> {
  const baseUrl = await getApiBaseUrl();
  const response = await fetch(`${baseUrl}${path}`);
  return parseResponse<T>(response);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const baseUrl = await getApiBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return parseResponse<T>(response);
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json() as T;
  if (!response.ok) {
    throw new Error(JSON.stringify(body));
  }
  return body;
}

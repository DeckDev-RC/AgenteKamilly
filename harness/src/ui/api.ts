import type {
  AgentTurnApiRequest,
  AgentTurnApiResponse,
  ConfirmationSheetApiResponse,
  ConfereStatus,
  ExecuteOperationApiResponse,
  OperationListApiResponse,
  OperationSummaryApiResponse
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

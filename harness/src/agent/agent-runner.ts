import type { ToolReceipt } from "../core/tool-types.js";
import type { ToolRegistry } from "../core/tool-registry.js";
import type { RuntimeMode } from "../core/tool-types.js";
import { loadAgentSession, saveAgentSession, type AgentSession } from "./agent-session-store.js";
import { planAgentTurn, type AgentPlan, type AgentTurnResult, questionForField } from "./llm-planner.js";
import type { ModelProvider } from "./model-provider.js";
import { createSafeWorkflowRegistry } from "./safe-workflow-registry.js";

export type AgentRunInput = {
  request: string;
  registry: ToolRegistry;
  provider: ModelProvider;
  runtimeMode: RuntimeMode;
  params?: Record<string, unknown>;
  sessionId?: string;
  sessionsDir?: string;
};

export type AgentRunResult =
  | AgentTurnResult
  | {
      status: "executed";
      provider: "gemini";
      model: string;
      plan: AgentPlan;
      receipt: ToolReceipt;
    };

export async function runAgentTurn(input: AgentRunInput): Promise<AgentRunResult> {
  if (input.runtimeMode !== "dry-run") {
    return {
      status: "blocked",
      reason: "Agent mode currently supports dry-run only. Use the normal harness approval flow for live execution."
    };
  }

  const agentControl = collectAgentControl(input);
  if (!agentControl.request.trim()) {
    return {
      status: "blocked",
      reason:
        "Informe o pedido apos CONFIRMAR AGENTE ou envie um pedido completo para o agente."
    };
  }

  const safeRegistry = createSafeWorkflowRegistry(input.registry);
  const session = await loadOptionalSession(input);
  const knownParams = {
    ...(session?.slots ?? {}),
    ...(input.params ?? {})
  };
  const workflowKnownParams = omitAgentControlParams(knownParams);

  const planned = await planAgentTurn({
    request: agentControl.request,
    registry: safeRegistry,
    provider: input.provider,
    knownParams: workflowKnownParams,
    history: session?.history
  });

  await persistSessionForResult(input, session, planned, workflowKnownParams);

  if (planned.status !== "planned") return planned;
  if (requiresOperatorConfirmation(planned.plan) && !agentControl.operatorConfirmed) {
    return {
      status: "needs_input",
      provider: planned.provider,
      model: planned.model,
      intent: planned.plan.intent,
      toolName: planned.plan.toolName,
      params: planned.plan.params,
      missingFields: ["operatorConfirmation"],
      questions: [
        `Plano com risco ${planned.plan.risk} e confianca ${planned.plan.confidence}. Para confirmar este dry-run, reenvie o pedido com o prefixo CONFIRMAR AGENTE ou passe operatorConfirmation=true.`
      ],
      risk: planned.plan.risk,
      confidence: planned.plan.confidence,
      reason: planned.plan.reason
    };
  }

  const tool = safeRegistry.list().find((definition) => definition.name === planned.plan.toolName);
  if (!tool) {
    return {
      status: "blocked",
      toolName: planned.plan.toolName,
      reason: `Model-selected tool is not registered: ${planned.plan.toolName}`
    };
  }

  const parsedParams = tool.parameters.parse(planned.plan.params);
  const receipt = (await tool.execute(parsedParams)) as ToolReceipt;

  if (
    receipt.status === "failed" &&
    receipt.data &&
    typeof receipt.data === "object" &&
    "missingFields" in receipt.data &&
    Array.isArray((receipt.data as any).missingFields)
  ) {
    const missing = (receipt.data as any).missingFields as string[];
    const needsInputResult: AgentRunResult = {
      status: "needs_input",
      provider: planned.provider,
      model: planned.model,
      intent: planned.plan.intent,
      toolName: planned.plan.toolName,
      params: planned.plan.params,
      missingFields: missing,
      questions: missing.map((field) => questionForField(field)),
      risk: planned.plan.risk,
      confidence: planned.plan.confidence,
      reason: `Não foi possível obter todos os dados automaticamente. Por favor, forneça os seguintes campos obrigatórios: ${missing.join(", ")}.`
    };
    await persistSessionForResult(input, session, needsInputResult, planned.plan.params);
    return needsInputResult;
  }

  await persistSessionForResult(input, session, { ...planned, receipt, status: "executed" }, planned.plan.params);

  return {
    status: "executed",
    provider: planned.provider,
    model: planned.model,
    plan: planned.plan,
    receipt
  };
}

async function loadOptionalSession(input: AgentRunInput): Promise<AgentSession | undefined> {
  if (!input.sessionId) return undefined;
  if (!input.sessionsDir) throw new Error("sessionsDir is required when sessionId is provided.");
  return loadAgentSession({ sessionsDir: input.sessionsDir, sessionId: input.sessionId });
}

async function persistSessionForResult(
  input: AgentRunInput,
  session: AgentSession | undefined,
  result: AgentRunResult,
  params: Record<string, unknown>
): Promise<void> {
  if (!session || !input.sessionsDir) return;
  session.slots = {
    ...session.slots,
    ...params,
    ...paramsFromResult(result)
  };
  session.lastPlan = "plan" in result ? result.plan : result;

  if (!session.history) {
    session.history = [];
  }

  // Check if current user message is already in history to avoid duplication
  const reversedHistory = [...session.history].reverse();
  const lastUserMsgIndex = reversedHistory.findIndex((m) => m.role === "user");
  const hasUserMsg =
    lastUserMsgIndex !== -1 &&
    reversedHistory[lastUserMsgIndex]?.text === input.request;

  if (!hasUserMsg) {
    session.history.push({ role: "user", text: input.request });
  }

  let agentResponseText = "";
  if (result.status === "needs_input") {
    agentResponseText = result.reason || "";
  } else if (result.status === "planned") {
    agentResponseText = result.plan.reason || "";
  } else if (result.status === "executed") {
    agentResponseText = "Operação executada com sucesso.";
  } else if (result.status === "blocked") {
    agentResponseText = result.reason || "Operação bloqueada.";
  }

  if (agentResponseText) {
    const lastAssistantMsgIndex = reversedHistory.findIndex((m) => m.role === "assistant");
    const lastAssistantMsg =
      lastAssistantMsgIndex !== -1 ? reversedHistory[lastAssistantMsgIndex] : undefined;

    if (
      result.status === "executed" &&
      lastAssistantMsg &&
      "plan" in result &&
      lastAssistantMsg.text === result.plan.reason
    ) {
      lastAssistantMsg.text = `${result.plan.reason}\n\n[Operação executada com sucesso]`;
    } else {
      session.history.push({ role: "assistant", text: agentResponseText });
    }
  }

  if (session.history.length > 20) {
    session.history = session.history.slice(-20);
  }

  await saveAgentSession({ sessionsDir: input.sessionsDir, session });
}

function paramsFromResult(result: AgentRunResult): Record<string, unknown> {
  if (result.status === "planned" || result.status === "executed") return result.plan.params;
  if (result.status === "needs_input") return result.params;
  return {};
}

function requiresOperatorConfirmation(plan: AgentPlan): boolean {
  return plan.risk === "high" || plan.confidence < 0.7;
}

function collectAgentControl(input: AgentRunInput): { operatorConfirmed: boolean; request: string } {
  const requestControl = extractOperatorConfirmationFromRequest(input.request);
  return {
    operatorConfirmed: input.params?.operatorConfirmation === true || requestControl.operatorConfirmed,
    request: requestControl.request
  };
}

function omitAgentControlParams(params: Record<string, unknown>): Record<string, unknown> {
  const { operatorConfirmation: _operatorConfirmation, ...workflowParams } = params;
  return workflowParams;
}

function extractOperatorConfirmationFromRequest(request: string): {
  operatorConfirmed: boolean;
  request: string;
} {
  const stripped = request.replace(/^\s*CONFIRMAR\s+AGENTE\b\s*:?/i, "").trim();
  return {
    operatorConfirmed: stripped !== request.trim(),
    request: stripped
  };
}

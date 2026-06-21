import type { ToolReceipt } from "../core/tool-types.js";
import type { ToolRegistry } from "../core/tool-registry.js";
import type { RuntimeMode } from "../core/tool-types.js";
import { loadAgentSession, saveAgentSession, type AgentSession } from "./agent-session-store.js";
import { planAgentTurn, type AgentPlan, type AgentTurnResult } from "./llm-planner.js";
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

  const safeRegistry = createSafeWorkflowRegistry(input.registry);
  const session = await loadOptionalSession(input);
  const knownParams = {
    ...(session?.slots ?? {}),
    ...(input.params ?? {})
  };

  const planned = await planAgentTurn({
    request: input.request,
    registry: safeRegistry,
    provider: input.provider,
    knownParams
  });

  await persistSessionForResult(input, session, planned, knownParams);

  if (planned.status !== "planned") return planned;
  if (requiresOperatorConfirmation(planned.plan)) {
    return {
      status: "needs_input",
      provider: planned.provider,
      model: planned.model,
      intent: planned.plan.intent,
      toolName: planned.plan.toolName,
      params: planned.plan.params,
      missingFields: ["operatorConfirmation"],
      questions: [
        `Plano com risco ${planned.plan.risk} e confianca ${planned.plan.confidence}. Informe se devo confirmar o dry-run desta workflow.`
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

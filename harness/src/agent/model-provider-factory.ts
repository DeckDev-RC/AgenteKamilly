import type { HarnessConfig } from "../core/config.js";
import { createGeminiModelProvider } from "./gemini-provider.js";
import { createJsonFileModelUsageStore } from "./model-usage-store.js";
import type { ModelProvider } from "./model-provider.js";
import { createRateLimitedModelProvider } from "./rate-limited-model-provider.js";

export type ModelProviderFactoryOptions = {
  fetchImpl?: typeof fetch;
};

export function createAgentModelProvider(
  config: HarnessConfig,
  options: ModelProviderFactoryOptions = {}
): ModelProvider {
  if (config.agentModelProvider !== "gemini") {
    throw new Error(`Unsupported agent model provider: ${config.agentModelProvider}`);
  }

  const gemini = createGeminiModelProvider({
    apiKey: config.geminiApiKey,
    model: config.agentModelName,
    fetchImpl: options.fetchImpl
  });

  return createRateLimitedModelProvider(gemini, {
    maxRpm: config.agentModelMaxRpm,
    maxDailyRequests: config.agentModelMaxDailyRequests,
    maxInputTpm: config.agentModelMaxInputTpm,
    usageStore: createJsonFileModelUsageStore(config.agentModelUsagePath)
  });
}

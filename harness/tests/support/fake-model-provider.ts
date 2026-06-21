import type {
  ModelProvider,
  ModelRequest,
  ModelResponse
} from "../../src/agent/model-provider.js";

export function createFakeModelProvider(plan: unknown): ModelProvider & {
  calls: ModelRequest[];
} {
  const calls: ModelRequest[] = [];
  return {
    name: "gemini",
    model: "fake-model",
    calls,
    async generateText(input: ModelRequest): Promise<ModelResponse> {
      calls.push(input);
      return { provider: "gemini", model: "fake-model", text: JSON.stringify(plan) };
    }
  };
}

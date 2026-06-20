import { describe, expect, it, vi } from "vitest";

import { createAgentModelProvider } from "../../src/agent/model-provider-factory.js";
import type { HarnessConfig } from "../../src/core/config.js";

describe("model provider factory", () => {
  it("creates a rate-limited Gemini provider from harness config", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "{}" }] } }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const provider = createAgentModelProvider(config(), { fetchImpl: fetchMock as typeof fetch });

    await expect(
      provider.generateText({ messages: [{ role: "user", content: "primeira" }] })
    ).resolves.toMatchObject({
      provider: "gemini",
      model: "gemini-3-flash-preview"
    });
    await expect(
      provider.generateText({ messages: [{ role: "user", content: "segunda" }] })
    ).rejects.toThrow("Agent model daily request limit exceeded");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function config(): HarnessConfig {
  return {
    asaasEnvPath: "",
    contaAzulEnvPath: "",
    contaAzulStatePath: "",
    contaAzulFinancialAccountId: "",
    contaAzulDefaultReplyToEmail: "",
    contaAzulDefaultCompanyDisplayName: "",
    artifactsDir: "",
    ledgerPath: "",
    runtimeMode: "dry-run",
    allowLiveMutations: false,
    agentModelProvider: "gemini",
    agentModelName: "gemini-3-flash-preview",
    geminiApiKey: "AIza-test",
    agentModelMaxRpm: 10,
    agentModelMaxDailyRequests: 1,
    agentModelMaxInputTpm: 1000
  };
}

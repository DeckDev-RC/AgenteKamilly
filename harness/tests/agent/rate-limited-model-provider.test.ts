import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createRateLimitedModelProvider } from "../../src/agent/rate-limited-model-provider.js";
import { createJsonFileModelUsageStore } from "../../src/agent/model-usage-store.js";
import type { ModelProvider, ModelRequest, ModelResponse } from "../../src/agent/model-provider.js";

describe("rate-limited model provider", () => {
  it("blocks requests after the configured daily limit without calling the wrapped provider", async () => {
    const wrapped = createCountingProvider();
    const provider = createRateLimitedModelProvider(wrapped, {
      maxRpm: 10,
      maxDailyRequests: 1,
      maxInputTpm: 1000
    });

    await expect(provider.generateText(message("primeira"))).resolves.toMatchObject({
      text: "{}"
    });
    await expect(provider.generateText(message("segunda"))).rejects.toThrow(
      "Agent model daily request limit exceeded"
    );
    expect(wrapped.calls).toHaveLength(1);
  });

  it("blocks requests above the configured RPM window", async () => {
    const wrapped = createCountingProvider();
    const provider = createRateLimitedModelProvider(wrapped, {
      maxRpm: 1,
      maxDailyRequests: 10,
      maxInputTpm: 1000,
      now: () => 1000
    });

    await provider.generateText(message("primeira"));
    await expect(provider.generateText(message("segunda"))).rejects.toThrow(
      "Agent model RPM limit exceeded"
    );
    expect(wrapped.calls).toHaveLength(1);
  });

  it("blocks requests above the configured input TPM window", async () => {
    const wrapped = createCountingProvider();
    const provider = createRateLimitedModelProvider(wrapped, {
      maxRpm: 10,
      maxDailyRequests: 10,
      maxInputTpm: 2,
      now: () => 1000
    });

    await expect(provider.generateText(message("tres tokens aqui"))).rejects.toThrow(
      "Agent model input TPM limit exceeded"
    );
    expect(wrapped.calls).toHaveLength(0);
  });

  it("persists daily request usage across provider instances", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-model-usage-"));
    const usageStore = createJsonFileModelUsageStore(path.join(dir, "usage.json"));

    const firstWrapped = createCountingProvider();
    const first = createRateLimitedModelProvider(firstWrapped, {
      maxRpm: 10,
      maxDailyRequests: 1,
      maxInputTpm: 1000,
      usageStore
    });

    await first.generateText(message("primeira"));

    const secondWrapped = createCountingProvider();
    const second = createRateLimitedModelProvider(secondWrapped, {
      maxRpm: 10,
      maxDailyRequests: 1,
      maxInputTpm: 1000,
      usageStore
    });

    await expect(second.generateText(message("segunda"))).rejects.toThrow(
      "Agent model daily request limit exceeded"
    );
    expect(secondWrapped.calls).toHaveLength(0);
  });
});

function message(content: string): ModelRequest {
  return { messages: [{ role: "user", content }] };
}

function createCountingProvider(): ModelProvider & { calls: ModelRequest[] } {
  const calls: ModelRequest[] = [];
  return {
    name: "gemini",
    model: "fake-model",
    calls,
    async generateText(input: ModelRequest): Promise<ModelResponse> {
      calls.push(input);
      return { provider: "gemini", model: "fake-model", text: "{}" };
    }
  };
}

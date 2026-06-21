import type { ModelProvider, ModelRequest, ModelResponse } from "./model-provider.js";
import type { ModelUsageSnapshot, ModelUsageStore } from "./model-usage-store.js";

export type RateLimitOptions = {
  maxRpm: number;
  maxDailyRequests: number;
  maxInputTpm: number;
  now?: () => number;
  usageStore?: ModelUsageStore;
};

export function createRateLimitedModelProvider(
  wrapped: ModelProvider,
  options: RateLimitOptions
): ModelProvider {
  const now = options.now ?? Date.now;
  const scope = `${wrapped.name}:${wrapped.model}`;
  const requestTimestamps: number[] = [];
  const inputTokenEvents: Array<{ timestamp: number; tokens: number }> = [];
  let dailyKey = pacificDateKey(now());
  let dailyRequests = 0;

  return {
    name: wrapped.name,
    model: wrapped.model,
    async generateText(input: ModelRequest): Promise<ModelResponse> {
      const stored = await options.usageStore?.load(scope);
      if (stored) {
        dailyKey = stored.dailyKey;
        dailyRequests = stored.dailyRequests;
        replaceArray(requestTimestamps, stored.requestTimestamps);
        replaceArray(inputTokenEvents, stored.inputTokenEvents);
      }

      const currentTime = now();
      const currentDailyKey = pacificDateKey(currentTime);
      if (currentDailyKey !== dailyKey) {
        dailyKey = currentDailyKey;
        dailyRequests = 0;
      }

      pruneOlderThan(requestTimestamps, currentTime - 60_000);
      pruneTokenEventsOlderThan(inputTokenEvents, currentTime - 60_000);

      if (dailyRequests >= options.maxDailyRequests) {
        throw new Error("Agent model daily request limit exceeded.");
      }
      if (requestTimestamps.length >= options.maxRpm) {
        throw new Error("Agent model RPM limit exceeded.");
      }

      const inputTokens = estimateInputTokens(input);
      const currentInputTokens = inputTokenEvents.reduce((sum, event) => sum + event.tokens, 0);
      if (currentInputTokens + inputTokens > options.maxInputTpm) {
        throw new Error("Agent model input TPM limit exceeded.");
      }

      requestTimestamps.push(currentTime);
      inputTokenEvents.push({ timestamp: currentTime, tokens: inputTokens });
      dailyRequests++;
      await options.usageStore?.save(scope, snapshot());

      return wrapped.generateText(input);
    }
  };

  function snapshot(): ModelUsageSnapshot {
    return {
      dailyKey,
      dailyRequests,
      requestTimestamps: [...requestTimestamps],
      inputTokenEvents: [...inputTokenEvents]
    };
  }
}

function replaceArray<T>(target: T[], source: T[]): void {
  target.splice(0, target.length, ...source);
}

function estimateInputTokens(input: ModelRequest): number {
  return input.messages.reduce((sum, message) => {
    const tokenCount = message.content.trim().split(/\s+/).filter(Boolean).length;
    return sum + tokenCount;
  }, 0);
}

function pruneOlderThan(timestamps: number[], minTimestamp: number): void {
  while (timestamps[0] !== undefined && timestamps[0] <= minTimestamp) {
    timestamps.shift();
  }
}

function pruneTokenEventsOlderThan(
  events: Array<{ timestamp: number; tokens: number }>,
  minTimestamp: number
): void {
  while (events[0] !== undefined && events[0].timestamp <= minTimestamp) {
    events.shift();
  }
}

function pacificDateKey(timestamp: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(timestamp));
}
